// Called by payment webhook (PR 5-A) when a dispute is received.
// One chargeback = freeze + admin review. Two chargebacks = permanent ban.
// Per spec Section 6.5.

import { getAdminClient } from './credits'
import { freezeReferralsForUser } from './maturityCheckpoint'
import { logAdminAction } from './riskScore'

/**
 * Freeze referrals where the given user is the REFEREE (not the referrer).
 * freezeReferralsForUser() only covers referrer_id.
 * This catches the case where a chargeback user's referral should not
 * confirm and earn credits for the referrer who referred them.
 */
async function freezeRefereeReferrals(
  userId: string,
  reason: string
): Promise<void> {
  const adminClient = getAdminClient()
  const { data: refereeReferrals, error } = await adminClient
    .from('referrals')
    .select('id')
    .eq('referee_id', userId)
    .eq('status', 'PENDING')
    .eq('lock_timer_frozen', false)

  if (error) {
    console.error(`Failed to query referee-side referrals for ${userId}:`, error.message)
    return
  }

  if (!refereeReferrals || refereeReferrals.length === 0) return

  for (const ref of refereeReferrals) {
    await adminClient.rpc('freeze_referral', {
      p_referral_id: ref.id,
      p_reason: reason,
    }).catch((err: unknown) => {
      console.error(`Failed to freeze referee-side referral ${ref.id}:`, err)
    })
  }
}

/**
 * Handle a chargeback dispute for a user.
 * First chargeback: REVIEW_HOLD + freeze. Second chargeback: PERMANENT_BAN.
 * @param userId - User UUID
 * @param transactionId - Payment transaction ID that was charged back
 * @returns Action taken (REVIEW_HOLD or PERMANENT_BAN)
 */
export async function handleChargeback(
  userId: string,
  transactionId: string
): Promise<{ action: 'REVIEW_HOLD' | 'PERMANENT_BAN' }> {
  const adminClient = getAdminClient()

  // Step 1: Count existing chargebacks for this user
  // Fail safe: on query error, treat as first chargeback (freeze, don't ban)
  const { count: priorChargebacks, error: countError } = await adminClient
    .from('fraud_flags')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('rule_triggered', 'CHARGEBACK')

  if (countError) {
    console.error(
      `Chargeback handler: failed to count prior chargebacks for ${userId}:`,
      countError.message
    )
    // Fail safe: treat as first chargeback, do not ban on DB error
  }

  // Step 2: Read current profile state for audit log before_value
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('trust_level, status')
    .eq('id', userId)
    .single()

  if (profileError) {
    console.error(
      `Chargeback handler: failed to read profile for ${userId}:`,
      profileError.message
    )
    // Fail safe: continue without before_value in audit log
  }

  const currentTrustLevel = profile?.trust_level || 'CLEAN'
  const currentStatus = profile?.status || 'ACTIVE'

  // Idempotency guard: check if this exact transactionId was already processed.
  // Payment providers retry webhooks on failure. Without this check, a retry
  // would see the flag from the first call and escalate to PERMANENT_BAN.
  const { count: existingForTxn, error: idempotencyError } = await adminClient
    .from('fraud_flags')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('rule_triggered', 'CHARGEBACK')
    .contains('details', { transaction_id: transactionId })

  if (idempotencyError) {
    console.error(
      `Chargeback idempotency check failed for ${userId}/${transactionId}:`,
      idempotencyError.message
    )
    // Fail safe: continue with normal flow (may double-process, better than skipping)
  } else if ((existingForTxn ?? 0) > 0) {
    // Already processed this exact chargeback — return the current state
    const currentAction = profile?.trust_level === 'BANNED' ? 'PERMANENT_BAN' : 'REVIEW_HOLD'
    console.log(
      `Chargeback for transaction ${transactionId} already processed for user ${userId}. Skipping.`
    )
    return { action: currentAction as 'REVIEW_HOLD' | 'PERMANENT_BAN' }
  }

  // Step 3: Determine action based on chargeback count
  const isSecondOrMoreChargeback = (priorChargebacks ?? 0) >= 1

  if (isSecondOrMoreChargeback) {
    // SECOND OR MORE CHARGEBACK → PERMANENT BAN
    const chargebackNumber = (priorChargebacks ?? 0) + 1

    // a) Update profiles: BANNED + BANNED
    await adminClient
      .from('profiles')
      .update({
        trust_level: 'BANNED',
        status: 'BANNED',
      })
      .eq('id', userId)

    // b) Insert CRITICAL fraud flag
    await adminClient.from('fraud_flags').insert({
      user_id: userId,
      rule_triggered: 'CHARGEBACK',
      severity: 'CRITICAL',
      details: {
        transaction_id: transactionId,
        chargeback_number: chargebackNumber,
        action: 'PERMANENT_BAN',
      },
    })

    // c) Freeze all pending referrals (where user is referrer OR referee)
    await freezeReferralsForUser(
      userId,
      `Chargeback #${chargebackNumber} — permanent ban`
    )
    await freezeRefereeReferrals(userId, `Chargeback #${chargebackNumber} — referee-side freeze`)

    // d) Log to admin audit trail
    if (currentStatus !== 'BANNED') {
      await logAdminAction({
        adminUserId: null,
        action: 'CHARGEBACK_PERMANENT_BAN',
        targetType: 'profile',
        targetId: userId,
        beforeValue: `trust_level: ${currentTrustLevel}, status: ${currentStatus}`,
        afterValue: 'trust_level: BANNED, status: BANNED',
        reason: `Chargeback #${chargebackNumber} on transaction ${transactionId}`,
      })
    }

    // e) TODO PR 5-A: Call triggerE5(userId) to send account ban email

    return { action: 'PERMANENT_BAN' }
  } else {
    // FIRST CHARGEBACK → REVIEW_HOLD + FREEZE
    // a) Update profiles: SUSPICIOUS + REVIEW_HOLD
    await adminClient
      .from('profiles')
      .update({
        trust_level: 'SUSPICIOUS',
        status: 'REVIEW_HOLD',
      })
      .eq('id', userId)

    // b) Insert CRITICAL fraud flag
    await adminClient.from('fraud_flags').insert({
      user_id: userId,
      rule_triggered: 'CHARGEBACK',
      severity: 'CRITICAL',
      details: {
        transaction_id: transactionId,
        chargeback_number: 1,
        action: 'REVIEW_HOLD',
      },
    })

    // c) Freeze all pending referrals
    await freezeReferralsForUser(
      userId,
      'First chargeback — pending admin review'
    )
    await freezeRefereeReferrals(userId, `First chargeback on referee ${userId} — referee-side freeze`)

    // d) Log to admin audit trail
    if (currentStatus !== 'REVIEW_HOLD') {
      await logAdminAction({
        adminUserId: null,
        action: 'CHARGEBACK_AUTO_FREEZE',
        targetType: 'profile',
        targetId: userId,
        beforeValue: `trust_level: ${currentTrustLevel}, status: ${currentStatus}`,
        afterValue: 'trust_level: SUSPICIOUS, status: REVIEW_HOLD',
        reason: `First chargeback on transaction ${transactionId}`,
      })
    }

    // e) Do NOT send E5 email — REVIEW_HOLD is shadow review per spec Section 6.2

    return { action: 'REVIEW_HOLD' }
  }
}
