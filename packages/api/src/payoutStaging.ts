// Payout staging window enforcement.
// 24-hour delay before executePayout() fires (PR 5-B).
// Gives the 15-minute fraud cron time to flag issues before money leaves.

/**
 * Check if a payout has passed the 24-hour staging window.
 * Called before executePayout() in PR 5-B.
 * Gives the 15-minute fraud cron time to flag issues before money leaves.
 * @param payoutCreatedAt - ISO timestamp from payouts.created_at
 * @returns true if 24+ hours have passed, false if still in staging
 */
export function isPayoutStagingComplete(payoutCreatedAt: string): boolean {
  const STAGING_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
  const age = Date.now() - new Date(payoutCreatedAt).getTime()
  return age >= STAGING_WINDOW_MS
}
