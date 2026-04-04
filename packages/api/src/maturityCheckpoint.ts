// Maturity checkpoint: freeze/unfreeze referral lock timers.
// Called by payment webhook handlers when referrer subscription changes.
// All operations use admin client (service role) — bypasses RLS.
// Freeze/unfreeze are atomic via Postgres RPCs (audit log included).

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Service role client — this module is server-side only. Never import from client components.
// Lazy initialization to avoid build-time errors when env vars aren't available.
let adminClient: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing Supabase environment variables for maturity checkpoint (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)'
      )
    }

    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return adminClient
}

/**
 * Freeze all PENDING non-frozen referrals for a user.
 * Called when referrer's subscription is cancelled or goes past_due.
 * Each referral is frozen via atomic RPC (status change + audit log).
 *
 * @param userId - The referrer's user ID
 * @param reason - Reason for freeze (e.g., "Subscription cancelled")
 * @returns Object with count of frozen referrals
 */
export async function freezeReferralsForUser(
  userId: string,
  reason: string
): Promise<{ frozen: number }> {
  const adminClient = getAdminClient()

  // Find all PENDING referrals for this referrer that are NOT already frozen
  const { data: referrals, error } = await adminClient
    .from('referrals')
    .select('id')
    .eq('referrer_id', userId)
    .eq('status', 'PENDING')
    .eq('lock_timer_frozen', false)

  if (error) throw new Error(`Failed to query referrals: ${error.message}`)
  if (!referrals || referrals.length === 0) return { frozen: 0 }

  // Freeze each referral via RPC (atomic: status change + audit log)
  let frozenCount = 0
  for (const referral of referrals) {
    try {
      const { error: rpcError } = await adminClient.rpc('freeze_referral', {
        p_referral_id: referral.id,
        p_reason: reason,
      })
      if (rpcError) {
        console.error(`Failed to freeze referral ${referral.id}:`, rpcError.message)
        continue // Do not abort the loop — freeze the rest
      }
      frozenCount++
    } catch (err) {
      console.error(`Unexpected error freezing referral ${referral.id}:`, err)
      continue
    }
  }

  return { frozen: frozenCount }
}

/**
 * Unfreeze all PENDING frozen referrals for a user.
 * Called when referrer resubscribes.
 * Recalculates payout_eligible_at based on remaining lock period at time of freeze.
 * Each referral is unfrozen via atomic RPC (status change + audit log).
 *
 * @param userId - The referrer's user ID
 * @returns Object with count of unfrozen referrals
 */
export async function unfreezeReferralsForUser(
  userId: string
): Promise<{ unfrozen: number }> {
  const adminClient = getAdminClient()

  // Find all PENDING referrals for this referrer that ARE frozen
  const { data: referrals, error } = await adminClient
    .from('referrals')
    .select('id, payout_eligible_at, frozen_at')
    .eq('referrer_id', userId)
    .eq('status', 'PENDING')
    .eq('lock_timer_frozen', true)

  if (error) throw new Error(`Failed to query referrals: ${error.message}`)
  if (!referrals || referrals.length === 0) return { unfrozen: 0 }

  let unfrozenCount = 0
  for (const referral of referrals) {
    try {
      // CRITICAL: Validate frozen_at is not null before calculating.
      // This should never happen if freeze_referral works correctly, but
      // defend against data corruption.
      if (!referral.frozen_at) {
        console.error(
          `Referral ${referral.id} is frozen but frozen_at is null. ` +
            `Skipping — manual admin review required.`
        )
        continue
      }

      if (!referral.payout_eligible_at) {
        console.error(
          `Referral ${referral.id} has no payout_eligible_at. ` +
            `Skipping — manual admin review required.`
        )
        continue
      }

      // Calculate remaining lock period in seconds, then convert to days.
      // Both timestamps are UTC (stored as timestamptz in Postgres).
      // Subtraction gives the time that WAS remaining when the freeze happened.
      const payoutEligible = new Date(referral.payout_eligible_at).getTime()
      const frozenAt = new Date(referral.frozen_at).getTime()
      const remainingMs = payoutEligible - frozenAt

      // Convert to days. Use Math.ceil so partial days round up (user-friendly).
      // Floor at 1 day minimum — even if remaining was 0 or negative due to
      // clock skew, give at least 1 day after resubscribe.
      let remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24))
      if (remainingDays < 1) remainingDays = 1

      // New payout date = now + remaining days
      const newPayoutDate = new Date()
      newPayoutDate.setUTCDate(newPayoutDate.getUTCDate() + remainingDays)

      const { error: rpcError } = await adminClient.rpc('unfreeze_referral', {
        p_referral_id: referral.id,
        p_new_payout_date: newPayoutDate.toISOString(),
        p_reason: `Referrer resubscribed. ${remainingDays} days remaining.`,
      })

      if (rpcError) {
        console.error(`Failed to unfreeze referral ${referral.id}:`, rpcError.message)
        continue
      }
      unfrozenCount++
    } catch (err) {
      console.error(`Unexpected error unfreezing referral ${referral.id}:`, err)
      continue
    }
  }

  return { unfrozen: unfrozenCount }
}
