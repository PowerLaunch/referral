// Payout failure handler.
// Called when a payment provider reports a failed payout.
// Claims FAILED status first, then refunds the user's CASH_BALANCE, then sends E4 email.
// Claiming FAILED before refunding prevents double-pay if a concurrent success webhook races.
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
    .select('user_id, amount, retry_count, status')
    .eq('id', payoutId)
    .single()

  if (fetchError || !payout) {
    throw new Error(`Payout ${payoutId} not found`)
  }

  if (payout.status === 'COMPLETED') {
    // Payout succeeded — never refund.
    console.log(`Payout ${payoutId} is COMPLETED — skipping failure handler`)
    return
  }

  if (payout.status === 'FAILED') {
    // Already marked FAILED. Check if refund was issued.
    // If awardCredits succeeded on a previous attempt, the idempotency index
    // on credit_transactions will have a row with reason = 'payout_failed_refund:<id>'.
    const { data: refundRow } = await adminClient
      .from('credit_transactions')
      .select('id')
      .eq('user_id', payout.user_id)
      .eq('reason', `payout_failed_refund:${payoutId}`)
      .maybeSingle()

    if (refundRow) {
      // Refund already issued — fully processed. Skip.
      console.log(`Payout ${payoutId} already FAILED and refunded — skipping`)
      return
    }

    // Status is FAILED but no refund row exists — previous attempt failed after
    // status update but before awardCredits. Fall through to issue the refund.
    console.log(`Payout ${payoutId} is FAILED but missing refund — issuing refund now`)
    // Skip the status update step below (already FAILED) and go straight to refund.
    // Set a flag to skip Step 2 (status update).
  }

  const alreadyFailed = payout.status === 'FAILED'

  if (!alreadyFailed) {
    // Step 2 (formerly Step 3) — Claim payout as FAILED first (atomic guard)
    // IMPORTANT: Status must be claimed as FAILED before refunding.
    // If we refund first and a concurrent success webhook wins the status race,
    // the user receives both the completed payout and the refund (double-pay).
    // Claiming FAILED first means: if 0 rows updated, we return before refunding.
    const { data: updatedRows, error: updateError } = await adminClient
      .from('payouts')
      .update({
        status: 'FAILED',
        provider_error_code: errorCode,
        retry_available_at: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
      })
      .eq('id', payoutId)
      .in('status', ['PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING'])
      .select('id')
    // PENDING_MANUAL_APPROVAL: first payouts start in this status.
    // A failure webhook on a first payout must still mark it FAILED,
    // otherwise admin approval would trigger a double-pay after the user was refunded.
    // Never overwrite COMPLETED with FAILED — concurrent success webhook wins.

    if (updateError) {
      console.error(`CRITICAL: Failed to mark payout ${payoutId} as FAILED:`, updateError.message)
      throw new Error(`Payout status update failed: ${updateError.message}`)
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Payout already in terminal state (e.g. COMPLETED by concurrent success webhook).
      // Do NOT refund — the payout succeeded. Return early.
      console.log(`Payout ${payoutId} already in terminal state — skipping refund and E4 email`)
      return
    }
  }

  // Step 3 — Refund (runs whether payout was just marked FAILED or was already FAILED)
  // awardCredits idempotency index prevents double-refund if this runs twice.

  // Use DB-side increment to avoid lost updates from concurrent failure webhooks.
  // Two concurrent calls reading retry_count=0 would both write 1 with client-side math.
  // The raw SQL expression increments atomically on the DB side.
  const { data: newRetryCount, error: retryError } = await adminClient
    .rpc('increment_payout_retry', { p_payout_id: payoutId })

  if (retryError) {
    console.error(`Failed to increment retry_count for payout ${payoutId}:`, retryError.message)
  }

  const retryCount = (newRetryCount as number) ?? (payout.retry_count as number) + 1

  try {
    await awardCredits(
      payout.user_id as string,
      payout.amount as number,
      'CASH_BALANCE',
      `payout_failed_refund:${payoutId}`
    )
  } catch (err: unknown) {
    const pgErr = err as { code?: string }
    if (pgErr?.code === '23505') {
      console.log(`Refund already applied for payout ${payoutId} — continuing`)
    } else {
      throw err
    }
  }

  // Step 4: Send E4 notification (failure does not block)
  try {
    // Convert credit units to dollar string (100 units = $1.00)
    const amountDollars = `$${((payout.amount as number) / 100).toFixed(2)}`
    await triggerE4(
      payout.user_id as string,
      amountDollars,
      errorCode
    )
  } catch (emailErr) {
    console.error(`E4 email failed for payout ${payoutId}:`, emailErr)
  }

  // Step 5: Auto-retry stub for transient errors
  if (isTransient && retryCount < 2) {
    // Use post-increment value. First failure: newRetryCount=1, eligible for auto-retry.
    // Second failure: newRetryCount=2, no more auto-retry.
    // TODO PR 5-B: Schedule automatic retry after 1 hour via Vercel Cron or queue.
    // For now, the retry_available_at is set and admin can trigger manually.
    console.log(
      `Transient failure on payout ${payoutId} — eligible for auto-retry`
    )
  }

  // Step 6: Flag user after 3 cumulative FAILED payouts (across all payouts, not just this one)
  // Note: this counts ALL failures, not just consecutive. For a solo founder MVP,
  // total failure count is simpler and catches the same pattern. Refine in Phase 8.
  // Count total FAILED payouts for this user across ALL payouts (cumulative)
  const { count: totalFailures } = await adminClient
    .from('payouts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', payout.user_id)
    .eq('status', 'FAILED')

  if ((totalFailures ?? 0) >= 3) {
    await adminClient
      .from('profiles')
      .update({ trust_level: 'SUSPICIOUS' })
      .eq('id', payout.user_id)
      .eq('trust_level', 'CLEAN')
    // Only upgrade from CLEAN → SUSPICIOUS. Never downgrade BANNED → SUSPICIOUS.
    // If user is already SUSPICIOUS or BANNED, leave trust_level unchanged.

    console.warn(
      `User ${payout.user_id} flagged SUSPICIOUS: 3+ payout failures`
    )
  }
}
