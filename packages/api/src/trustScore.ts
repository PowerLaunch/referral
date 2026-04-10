import type { SupabaseClient } from '@supabase/supabase-js'

export type TrustTier = 'PROBATION' | 'STANDARD' | 'TRUSTED' | 'VETERAN'

interface TierConfig {
  trust_tier_probation_max: number
  trust_tier_standard_max: number
  trust_tier_trusted_max: number
}

/**
 * Pure function. Returns the tier for a given score using config thresholds.
 * Internal reference only — tier computation is authoritative in the adjust_trust_score RPC.
 */
function computeTier(score: number, config: TierConfig): TrustTier {
  if (score <= config.trust_tier_probation_max) return 'PROBATION'
  if (score <= config.trust_tier_standard_max) return 'STANDARD'
  if (score <= config.trust_tier_trusted_max) return 'TRUSTED'
  return 'VETERAN'
}

/**
 * Atomically adjust a user's trust score via the adjust_trust_score RPC.
 * Throws on error (do not silently swallow).
 */
export async function adjustTrustScore(
  adminClient: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
  ruleTriggered?: string
): Promise<{ scoreBefore: number; scoreAfter: number; tierBefore: string; tierAfter: string }> {
  const { data, error } = await adminClient.rpc('adjust_trust_score', {
    p_user_id: userId,
    p_delta: delta,
    p_reason: reason,
    p_rule_triggered: ruleTriggered ?? null,
  })

  if (error) {
    const err = new Error(`adjust_trust_score failed for user ${userId}: ${error.message}`)
    ;(err as Error & { code?: string }).code = error.code
    throw err
  }

  const result = data as {
    score_before: number
    score_after: number
    tier_before: string
    tier_after: string
  }

  return {
    scoreBefore: result.score_before,
    scoreAfter: result.score_after,
    tierBefore: result.tier_before,
    tierAfter: result.tier_after,
  }
}

/**
 * Get the payout staging hours for a user based on their trust tier.
 * VIP users always get the fastest staging (veteran hours).
 */
export async function getPayoutStagingHours(
  adminClient: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('trust_tier, is_vip')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    throw new Error(`Profile not found for user ${userId}`)
  }

  const { data: config, error: configError } = await adminClient
    .from('game_config')
    .select('payout_staging_probation_hours, payout_staging_standard_hours, payout_staging_trusted_hours, payout_staging_veteran_hours')
    .limit(1)
    .single()

  if (configError || !config) {
    throw new Error('Failed to read payout staging config from game_config')
  }

  // VIP always gets fastest staging
  if (profile.is_vip) {
    return config.payout_staging_veteran_hours as number
  }

  const tier = profile.trust_tier as TrustTier
  switch (tier) {
    case 'PROBATION':
      return config.payout_staging_probation_hours as number
    case 'STANDARD':
      return config.payout_staging_standard_hours as number
    case 'TRUSTED':
      return config.payout_staging_trusted_hours as number
    case 'VETERAN':
      return config.payout_staging_veteran_hours as number
    default:
      return config.payout_staging_standard_hours as number
  }
}

/**
 * Get the dynamic lock period for a user based on their trust tier.
 * TRUSTED users get 7 days less, VETERAN users get 14 days less.
 * Minimum lock period is 14 days.
 */
export async function getDynamicLockPeriodDays(
  adminClient: SupabaseClient,
  userId: string,
  baseLockDays: number
): Promise<number> {
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('trust_tier, is_vip')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    throw new Error(`Profile not found for user ${userId}`)
  }

  // VIP accounts always get VETERAN tier behavior
  if (profile.is_vip) {
    return Math.max(14, baseLockDays - 14)
  }

  const tier = profile.trust_tier as TrustTier
  switch (tier) {
    case 'PROBATION':
    case 'STANDARD':
      return baseLockDays
    case 'TRUSTED':
      return Math.max(14, baseLockDays - 7)
    case 'VETERAN':
      return Math.max(14, baseLockDays - 14)
    default:
      return baseLockDays
  }
}

/**
 * Get the dynamic referral cap for a user based on their trust tier.
 * VIP users get the vip_referral_cap from game_config (default 200).
 */
export async function getDynamicReferralCap(
  adminClient: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('trust_tier, is_vip')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    throw new Error(`Profile not found for user ${userId}`)
  }

  if (profile.is_vip) {
    const { data: config, error: configError } = await adminClient
      .from('game_config')
      .select('vip_referral_cap')
      .limit(1)
      .single()

    if (configError || !config) {
      return 200 // Fallback to default
    }
    return config.vip_referral_cap as number
  }

  const tier = profile.trust_tier as TrustTier
  switch (tier) {
    case 'PROBATION':
      return 2
    case 'STANDARD':
      return 5
    case 'TRUSTED':
      return 10
    case 'VETERAN':
      return 20
    default:
      return 5
  }
}
