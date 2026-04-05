// Payout failure handler.
// Called when a payment provider reports a failed payout.
// Refunds the user's CASH_BALANCE, updates the payout record, and sends E4 email.
// Email failure does not block the failure handling flow.

import { awardCredits, getAdminClient } from './credits'
import { triggerE4 } from './email'

export async function handlePayoutFailure(
  payoutId: string,
  errorCode: string,
  isTransient: boolean
): Promise<void> {
  const adminClient = getAdminClient()

  // Step 1: Read payout details
  const { data: payout, error: fetchError } = await adminClient
    .from('payouts')
    .select('user_id, amount, retry_count')
    .eq('id', payoutId)
    .single()

  if (fetchError || !payout) {
    throw new Error(`Payout ${payoutId} not found`)
  }

  // Step 2: Credit funds back to user
  await awardCredits(
    payout.user_id as string,
    payout.amount as number,
    'CASH_BALANCE',
    'payout_failed_refund'
  )

  // Step 3: Update payout record
  await adminClient
    .from('payouts')
    .update({
      status: 'FAILED',
      provider_error_code: errorCode,
      retry_count: (payout.retry_count as number) + 1,
      retry_available_at: new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString(),
    })
    .eq('id', payoutId)

  // Step 4: Send E4 notification (failure does not block)
  try {
    await triggerE4(
      payout.user_id as string,
      String(payout.amount),
      errorCode
    )
  } catch (emailErr) {
    console.error(`E4 email failed for payout ${payoutId}:`, emailErr)
  }

  // Step 5: Auto-retry stub for transient errors
  if (isTransient && (payout.retry_count as number) < 1) {
    // TODO PR 5-B: Schedule automatic retry after 1 hour via Vercel Cron or queue.
    // For now, the retry_available_at is set and admin can trigger manually.
    console.log(
      `Transient failure on payout ${payoutId} — eligible for auto-retry`
    )
  }

  // Step 6: Flag user after 3 consecutive failures
  // Note: this counts ALL failures, not just consecutive. For a solo founder MVP,
  // total failure count is simpler and catches the same pattern. Refine in Phase 8.
  if ((payout.retry_count as number) + 1 >= 3) {
    await adminClient
      .from('profiles')
      .update({ trust_level: 'SUSPICIOUS' })
      .eq('id', payout.user_id)

    console.warn(
      `User ${payout.user_id} flagged SUSPICIOUS: 3+ payout failures`
    )
  }
}
