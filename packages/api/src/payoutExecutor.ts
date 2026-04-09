// Stub payout executor — Phase 5-B will implement actual provider calls.
// For now, marks payout as COMPLETED and logs.

import { getAdminClient } from './credits'

/**
 * Execute a payout — send funds to the provider.
 * STUB: In PR 5-B this will call the real payment provider (Triple-A, XanPool, etc.)
 * For now, it simply marks the payout as COMPLETED and sets completed_at.
 *
 * @param payoutId - Payout UUID
 * @returns Object with ok status and optional error message
 */
export async function executePayout(
  payoutId: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = getAdminClient()

  const { error } = await admin
    .from('payouts')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .in('status', ['PROCESSING'])

  if (error) {
    console.error(`executePayout stub failed for ${payoutId}:`, error.message)
    return { ok: false, error: error.message }
  }

  console.log(`[STUB] Payout ${payoutId} marked COMPLETED — real provider call in PR 5-B`)
  return { ok: true }
}
