// Called by payment webhook (PR 5-A) when a dispute is received.
// One chargeback = freeze + admin review. Two chargebacks = permanent ban.
// Per spec Section 6.5.

import { getAdminClient } from './credits'
import { freezeReferralsForUser } from './maturityCheckpoint'
import { logAdminAction } from './riskScore'

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

    // Also freeze referrals where this user is the REFEREE.
    // freezeReferralsForUser only covers referrer_id.
    // For chargebacks, we must also prevent the referrer from earning
    // credits from a disputed referee's subscription payment.
    const { data: refereeReferrals, error: refereeRefError } = await adminClient
      .from('referrals')
      .select('id')
      .eq('referee_id', userId)
      .eq('status', 'PENDING')
      .eq('lock_timer_frozen', false)

    if (!refereeRefError && refereeReferrals && refereeReferrals.length > 0) {
      for (const ref of refereeReferrals) {
        await adminClient.rpc('freeze_referral', {
          p_referral_id: ref.id,
          p_reason: `Chargeback on referee ${userId} — referee-side freeze`,
        }).catch((err: unknown) => {
          console.error(`Failed to freeze referee-side referral ${ref.id}:`, err)
        })
      }
    }

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

    // Also freeze referrals where this user is the REFEREE.
    // freezeReferralsForUser only covers referrer_id.
    // For chargebacks, we must also prevent the referrer from earning
    // credits from a disputed referee's subscription payment.
    const { data: refereeReferrals, error: refereeRefError } = await adminClient
      .from('referrals')
      .select('id')
      .eq('referee_id', userId)
      .eq('status', 'PENDING')
      .eq('lock_timer_frozen', false)

    if (!refereeRefError && refereeReferrals && refereeReferrals.length > 0) {
      for (const ref of refereeReferrals) {
        await adminClient.rpc('freeze_referral', {
          p_referral_id: ref.id,
          p_reason: `Chargeback on referee ${userId} — referee-side freeze`,
        }).catch((err: unknown) => {
          console.error(`Failed to freeze referee-side referral ${ref.id}:`, err)
        })
      }
    }

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
