// Fraud rules R1–R7. R1–R6 run on the 15-minute cron. R7 fires in real-time during KYC approval.
// All rules insert into fraud_flags (idempotent via unique index — duplicates silently discarded).
// No rule auto-bans. SUSPICIOUS is the maximum automated trust_level change.
// BANNED only happens via admin action in Phase 7.

import { getAdminClient } from './credits'
import { logAdminAction } from './riskScore'
import { voidPendingCredits } from './credits'

/**
 * Internal helper: insert fraud flag with idempotency.
 * Unique index prevents duplicate flags for same user+rule+day.
 * Returns true if flag was inserted, false if deduplicated.
 */
async function insertFraudFlag(params: {
  userId: string | null
  ruleTriggered: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  details?: Record<string, unknown>
}): Promise<boolean> {
  const adminClient = getAdminClient()
  const { error } = await adminClient.from('fraud_flags').insert({
    user_id: params.userId,
    rule_triggered: params.ruleTriggered,
    severity: params.severity,
    details: params.details ?? null,
  })

  if (error) {
    if (error.code === '23505') return false // Unique violation — already flagged today. Expected.
    console.error(
      `Failed to insert fraud flag ${params.ruleTriggered}:`,
      error.message
    )
    return false
  }
  return true
}

/**
 * R1: Spike Detection
 * 5+ referrals created by the same referrer in the last 1 hour → CRITICAL + payout_hold = true
 * @returns Count of users flagged
 */
export async function runR1SpikeDetection(): Promise<number> {
  const adminClient = getAdminClient()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  // Fetch referrals created in last hour
  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: recentReferrals, error } = await adminClient
    .from('referrals')
    .select('referrer_id')
    .gte('created_at', oneHourAgo)
    .limit(10000)

  if (error) {
    console.error('R1: Failed to fetch recent referrals:', error.message)
    return 0
  }

  if (!recentReferrals || recentReferrals.length === 0) return 0

  // Group by referrer_id in JS (safe at low volume, <10k referrals per hour expected)
  const countsByReferrer = new Map<string, number>()
  for (const ref of recentReferrals) {
    const count = countsByReferrer.get(ref.referrer_id) ?? 0
    countsByReferrer.set(ref.referrer_id, count + 1)
  }

  let flaggedCount = 0

  for (const [referrerId, count] of countsByReferrer.entries()) {
    if (count >= 5) {
      const wasInserted = await insertFraudFlag({
        userId: referrerId,
        ruleTriggered: 'R1_SPIKE_DETECTION',
        severity: 'CRITICAL',
        details: { referral_count_1h: count },
      })

      if (wasInserted) {
        // Set payout_hold only if flag was newly inserted (not deduplicated)
        await adminClient
          .from('profiles')
          .update({ payout_hold: true })
          .eq('id', referrerId)

        // Fire critical fraud hook
        await onCriticalFraudFlag(referrerId, 'R1_SPIKE_DETECTION')

        flaggedCount++
      }
    }
  }

  return flaggedCount
}

/**
 * R2: Device Cluster
 * 3+ distinct user_ids on the same device fingerprint_hash in last 30 days → CRITICAL for all users in cluster
 * @returns Count of users flagged
 */
export async function runR2DeviceCluster(): Promise<number> {
  const adminClient = getAdminClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: fingerprints, error } = await adminClient
    .from('device_fingerprints')
    .select('user_id, fingerprint_hash')
    .gte('created_at', thirtyDaysAgo)
    .limit(10000)

  if (error) {
    console.error('R2: Failed to fetch device fingerprints:', error.message)
    return 0
  }

  if (!fingerprints || fingerprints.length === 0) return 0

  // Group by fingerprint_hash
  const usersByDevice = new Map<string, Set<string>>()
  for (const fp of fingerprints) {
    if (!usersByDevice.has(fp.fingerprint_hash)) {
      usersByDevice.set(fp.fingerprint_hash, new Set())
    }
    usersByDevice.get(fp.fingerprint_hash)!.add(fp.user_id)
  }

  let flaggedCount = 0

  for (const [hash, userIds] of usersByDevice.entries()) {
    if (userIds.size >= 3) {
      // Flag all users in this cluster
      for (const userId of userIds) {
        const wasInserted = await insertFraudFlag({
          userId,
          ruleTriggered: 'R2_DEVICE_CLUSTER',
          severity: 'CRITICAL',
          details: {
            device_hash: hash,
            cluster_size: userIds.size,
          },
        })

        if (wasInserted) {
          await onCriticalFraudFlag(userId, 'R2_DEVICE_CLUSTER')
          flaggedCount++
        }
      }
    }
  }

  return flaggedCount
}

/**
 * R3: New Account Velocity
 * Accounts created in last 7 days with 10+ referrals → WARNING + trust_level = SUSPICIOUS
 * @returns Count of users flagged
 */
export async function runR3NewAccountVelocity(): Promise<number> {
  const adminClient = getAdminClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch profiles created in last 7 days
  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: newProfiles, error: profilesError } = await adminClient
    .from('profiles')
    .select('id, created_at, trust_level')
    .gte('created_at', sevenDaysAgo)
    .limit(10000)

  if (profilesError) {
    console.error('R3: Failed to fetch new profiles:', profilesError.message)
    return 0
  }

  if (!newProfiles || newProfiles.length === 0) return 0

  let flaggedCount = 0

  for (const profile of newProfiles) {
    // Count referrals created by this user
    const { count: referralCount, error: countError } = await adminClient
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', profile.id)

    if (countError) {
      console.error(`R3: Failed to count referrals for ${profile.id}:`, countError.message)
      continue
    }

    if ((referralCount ?? 0) >= 10) {
      const wasInserted = await insertFraudFlag({
        userId: profile.id,
        ruleTriggered: 'R3_NEW_ACCOUNT_VELOCITY',
        severity: 'WARNING',
        details: { referral_count: referralCount },
      })

      if (wasInserted) {
        // Only upgrade trust_level if currently CLEAN
        if (profile.trust_level === 'CLEAN') {
          const { error: updateError } = await adminClient
            .from('profiles')
            .update({ trust_level: 'SUSPICIOUS' })
            .eq('id', profile.id)
            .eq('trust_level', 'CLEAN') // Guard: only if still CLEAN

          if (!updateError) {
            // Log trust_level change
            await logAdminAction({
              adminUserId: null, // Automated action
              action: 'UPDATE_TRUST_LEVEL',
              targetType: 'profile',
              targetId: profile.id,
              beforeValue: 'CLEAN',
              afterValue: 'SUSPICIOUS',
              reason: 'R3: New account velocity (10+ referrals in 7 days)',
            })
          }
        }

        flaggedCount++
      }
    }
  }

  return flaggedCount
}

/**
 * R4: Cashout Spike
 * Current hour payout total > 3x 7-day hourly average → CRITICAL + cashouts_paused = true
 * user_id = null (global flag — no specific user)
 * @returns 1 if circuit breaker triggered, 0 otherwise
 */
export async function runR4CashoutSpike(): Promise<number> {
  const adminClient = getAdminClient()

  // Calculate current hour boundaries
  const now = new Date()
  const currentHourStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())
  )
  const currentHourEnd = new Date(currentHourStart.getTime() + 60 * 60 * 1000)

  // Calculate 7-day baseline
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // Fetch current hour COMPLETED payouts
  // Using created_at as proxy for payout timing. completed_at is wired in PR 5-B.
  // R4 is a best-effort early warning — created_at is accurate enough for spike detection.
  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: currentHourPayouts, error: currentError } = await adminClient
    .from('payouts')
    .select('amount')
    .eq('status', 'COMPLETED')
    .gte('created_at', currentHourStart.toISOString())
    .lt('created_at', currentHourEnd.toISOString())
    .limit(10000)

  if (currentError) {
    console.error('R4: Failed to fetch current hour payouts:', currentError.message)
    return 0
  }

  const currentHourTotal = (currentHourPayouts ?? []).reduce(
    (sum, p) => sum + (p.amount ?? 0),
    0
  )

  // Fetch 7-day COMPLETED payouts
  // Using created_at as proxy for payout timing. completed_at is wired in PR 5-B.
  // R4 is a best-effort early warning — created_at is accurate enough for spike detection.
  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: weeklyPayouts, error: weeklyError } = await adminClient
    .from('payouts')
    .select('amount')
    .eq('status', 'COMPLETED')
    .gte('created_at', sevenDaysAgo.toISOString())
    .limit(10000)

  if (weeklyError) {
    console.error('R4: Failed to fetch weekly payouts:', weeklyError.message)
    return 0
  }

  const weeklyTotal = (weeklyPayouts ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0)

  // Guard: if 7-day total < 500 (cents/credits), return 0 — not enough baseline data
  const MINIMUM_WEEKLY_BASELINE = 500
  if (weeklyTotal < MINIMUM_WEEKLY_BASELINE) {
    return 0
  }

  const weeklyHourlyAverage = weeklyTotal / (7 * 24)
  const threshold = weeklyHourlyAverage * 3

  if (currentHourTotal > threshold) {
    const wasInserted = await insertFraudFlag({
      userId: null, // Global flag
      ruleTriggered: 'R4_CASHOUT_SPIKE',
      severity: 'CRITICAL',
      details: {
        current_hour_total: currentHourTotal,
        weekly_hourly_average: Math.round(weeklyHourlyAverage),
        threshold: Math.round(threshold),
      },
    })

    if (wasInserted) {
      // Pause cashouts
      await adminClient
        .from('game_config')
        .update({ cashouts_paused: true })
        .limit(1)

      // Log circuit breaker trigger
      // targetId is null for global circuit breaker events — no specific user target.
      await logAdminAction({
        adminUserId: null,
        action: 'CIRCUIT_BREAKER_TRIGGERED',
        targetType: 'game_config',
        targetId: null,
        beforeValue: 'cashouts_paused: false',
        afterValue: 'cashouts_paused: true',
        reason: `R4: Cashout spike detected (${currentHourTotal} > ${Math.round(threshold)})`,
      })

      return 1
    }
  }

  return 0
}

/**
 * R5: Zero Gameplay
 * PENDING referrals created 3+ days ago where referee has 0 gameplay_minutes → INFO flag only
 * No trust_level change. No payout_hold.
 * @returns Count of users flagged
 */
export async function runR5ZeroGameplay(): Promise<number> {
  const adminClient = getAdminClient()
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: oldPendingReferrals, error } = await adminClient
    .from('referrals')
    .select('id, referee_id')
    .eq('status', 'PENDING')
    .lte('created_at', threeDaysAgo)
    .limit(10000)

  if (error) {
    console.error('R5: Failed to fetch old pending referrals:', error.message)
    return 0
  }

  if (!oldPendingReferrals || oldPendingReferrals.length === 0) return 0

  let flaggedCount = 0

  for (const referral of oldPendingReferrals) {
    // Check referee gameplay
    const { data: gameplay, error: gameplayError } = await adminClient
      .from('gameplay_sessions')
      .select('total_minutes')
      .eq('user_id', referral.referee_id)
      .maybeSingle()

    if (gameplayError) {
      console.error(
        `R5: Failed to check gameplay for ${referral.referee_id}:`,
        gameplayError.message
      )
      continue
    }

    const totalMinutes = gameplay?.total_minutes ?? 0

    if (totalMinutes === 0) {
      const wasInserted = await insertFraudFlag({
        userId: referral.referee_id,
        ruleTriggered: 'R5_ZERO_GAMEPLAY',
        severity: 'INFO',
        details: { referral_id: referral.id, days_since_created: 3 },
      })

      if (wasInserted) {
        flaggedCount++
      }
    }
  }

  return flaggedCount
}

/**
 * Check if email uses a disposable domain.
 * Exported for use in both cron and auth signup handler.
 */
export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false

  const disposableDomains = [
    'guerrillamail.com',
    'mailinator.com',
    'tempmail.com',
    'throwaway.email',
    'yopmail.com',
    'sharklasers.com',
    'guerrillamailblock.com',
    'grr.la',
    'guerrillamail.info',
    'spam4.me',
    'trashmail.com',
    'trashmail.at',
    'trashmail.io',
    'dispostable.com',
    'maildrop.cc',
    'spamgourmet.com',
    'mytemp.email',
    'fakeinbox.com',
    'tempinbox.com',
    '10minutemail.com',
    'temp-mail.org',
    'guerrillamail.net',
    'mailnesia.com',
    'mintemail.com',
    'anonbox.net',
  ]

  return disposableDomains.includes(domain)
}

/**
 * R6: Disposable Email
 * Scan all profiles for disposable email domains.
 * Only flags once per user ever (not once per day like other rules).
 * @returns Count of users flagged
 */
export async function runR6DisposableEmail(): Promise<number> {
  const adminClient = getAdminClient()

  // Fetch existing R6 flags to build alreadyFlagged Set
  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: existingFlags, error: flagsError } = await adminClient
    .from('fraud_flags')
    .select('user_id')
    .eq('rule_triggered', 'R6_DISPOSABLE_EMAIL')
    .limit(10000)

  if (flagsError) {
    console.error('R6: Failed to fetch existing flags:', flagsError.message)
    return 0
  }

  const alreadyFlagged = new Set<string>(
    (existingFlags ?? []).map((f) => f.user_id).filter((id): id is string => id !== null)
  )

  // Fetch all profiles with emails
  // .limit(10000) prevents silent PostgREST truncation at default 1000-row cap.
  const { data: profiles, error: profilesError } = await adminClient
    .from('profiles')
    .select('id, email')
    .limit(10000)

  if (profilesError) {
    console.error('R6: Failed to fetch profiles:', profilesError.message)
    return 0
  }

  if (!profiles || profiles.length === 0) return 0

  let flaggedCount = 0

  for (const profile of profiles) {
    if (!profile.email) continue
    if (alreadyFlagged.has(profile.id)) continue

    if (isDisposableEmail(profile.email)) {
      const wasInserted = await insertFraudFlag({
        userId: profile.id,
        ruleTriggered: 'R6_DISPOSABLE_EMAIL',
        severity: 'WARNING',
        details: { email_domain: profile.email.split('@')[1] },
      })

      if (wasInserted) {
        flaggedCount++
      }
    }
  }

  // TODO: Also call isDisposableEmail() from auth signup handler (PR 1-C).

  return flaggedCount
}

/**
 * R7: Identity Cluster (Sybil Detection)
 * Fires in real-time during KYC approval (called from PR 5-C), not from cron.
 * Attempts to set verified_kyc_hash on profile. If UNIQUE violation occurs,
 * sets both accounts to REVIEW_HOLD + SUSPICIOUS and flags as CRITICAL.
 *
 * @param userId - User ID attempting KYC approval
 * @param kycHash - HMAC-SHA256 hash of KYC identity
 * @returns { isCluster: true, conflictingUserId } if Sybil detected, { isCluster: false } otherwise
 */
export async function checkIdentityCluster(
  userId: string,
  kycHash: string
): Promise<{ isCluster: boolean; conflictingUserId?: string }> {
  const adminClient = getAdminClient()

  // Step 1: Verify userId exists in profiles
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, status, trust_level')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    throw new Error(`Profile not found for user ${userId}`)
  }

  // Step 2: Attempt UPDATE profiles SET verified_kyc_hash = kycHash WHERE id = userId
  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ verified_kyc_hash: kycHash })
    .eq('id', userId)

  // Step 3: Check for UNIQUE violation (Sybil detected)
  if (updateError && updateError.code === '23505') {
    // a) Find the conflicting account
    const { data: conflictingProfile, error: conflictError } = await adminClient
      .from('profiles')
      .select('id, status, trust_level')
      .eq('verified_kyc_hash', kycHash)
      .neq('id', userId)
      .single()

    if (conflictError || !conflictingProfile) {
      throw new Error('Sybil detected but could not find conflicting account')
    }

    const conflictingUserId = conflictingProfile.id

    // b) Set status = 'REVIEW_HOLD', trust_level = 'SUSPICIOUS' on BOTH accounts
    for (const targetUser of [
      { id: userId, oldStatus: profile.status, oldTrust: profile.trust_level },
      {
        id: conflictingUserId,
        oldStatus: conflictingProfile.status,
        oldTrust: conflictingProfile.trust_level,
      },
    ]) {
      // Guard: never downgrade a BANNED account. R7 flags for review but admin bans are permanent.
      await adminClient
        .from('profiles')
        .update({
          status: 'REVIEW_HOLD',
          trust_level: 'SUSPICIOUS',
        })
        .eq('id', targetUser.id)
        .not('trust_level', 'eq', 'BANNED')
        .not('status', 'eq', 'BANNED')

      // c) Insert CRITICAL fraud_flag for this account
      await insertFraudFlag({
        userId: targetUser.id,
        ruleTriggered: 'R7_IDENTITY_CLUSTER',
        severity: 'CRITICAL',
        details: {
          conflicting_user_id: targetUser.id === userId ? conflictingUserId : userId,
        },
      })

      // d) Log to admin_audit_logs
      if (targetUser.oldStatus !== 'REVIEW_HOLD') {
        await logAdminAction({
          adminUserId: null,
          action: 'UPDATE_STATUS',
          targetType: 'profile',
          targetId: targetUser.id,
          beforeValue: targetUser.oldStatus,
          afterValue: 'REVIEW_HOLD',
          reason: `R7: Identity cluster detected (KYC hash collision with user ${
            targetUser.id === userId ? conflictingUserId : userId
          })`,
        })
      }

      if (targetUser.oldTrust !== 'SUSPICIOUS') {
        await logAdminAction({
          adminUserId: null,
          action: 'UPDATE_TRUST_LEVEL',
          targetType: 'profile',
          targetId: targetUser.id,
          beforeValue: targetUser.oldTrust,
          afterValue: 'SUSPICIOUS',
          reason: `R7: Identity cluster detected (KYC hash collision with user ${
            targetUser.id === userId ? conflictingUserId : userId
          })`,
        })
      }
    }

    // e) Do NOT send E5 email. REVIEW_HOLD is shadow review — user sees 'Verifying'.
    // E5 fires only when status becomes BANNED.

    // f) Return Sybil detected
    return { isCluster: true, conflictingUserId }
  }

  // Step 4: No UNIQUE violation — return success
  if (!updateError) {
    return { isCluster: false }
  }

  // Step 5: Any other error — throw
  throw new Error(`Failed to update KYC hash for user ${userId}: ${updateError.message}`)
}

/**
 * Hook called when a CRITICAL fraud flag is triggered.
 * Automatically voids all PENDING referrals for the flagged user.
 * (Retained from original stub in PR 3-B-patch)
 */
export async function onCriticalFraudFlag(
  userId: string,
  ruleTriggered: string
): Promise<void> {
  try {
    const result = await voidPendingCredits(
      userId,
      `Auto-voided: CRITICAL fraud flag ${ruleTriggered}`
    )
    if (result.voided > 0) {
      console.log(
        `Voided ${result.voided} pending referrals for user ${userId} ` +
          `due to CRITICAL flag ${ruleTriggered}`
      )
    }
  } catch (err) {
    console.error(`Failed to void credits for ${userId}:`, err)
  }
}
