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
    .select('user_id, amount, retry_count, status')
    .eq('id', payoutId)
    .single()

  if (fetchError || !payout) {
    throw new Error(`Payout ${payoutId} not found`)
  }

  if (payout.status === 'FAILED' || payout.status === 'COMPLETED') {
    // FAILED: duplicate webhook — already processed.
    // COMPLETED: erroneous/replayed webhook — must never refund a successful payout.
    // Either way: do nothing. User must not receive both the payout and a refund.
    console.log(`Payout ${payoutId} has status ${payout.status} — skipping failure handler`)
    return
  }

  // Step 2: Credit funds back to user
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
      // Duplicate refund — already credited on a previous attempt.
      // Safe to continue to Step 3 to ensure payout is marked FAILED.
      console.log(`Refund already applied for payout ${payoutId} — continuing to status update`)
    } else {
      throw err
    }
  }

  // Step 3: Update payout record
  const { data: updatedRows, error: updateError } = await adminClient
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
    // Zero rows updated — payout already reached a terminal state (e.g. COMPLETED).
    // Do not send E4 email — the payout succeeded. Return early.
    console.log(`Payout ${payoutId} already in terminal state — skipping E4 email`)
    return
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
  if (isTransient && (payout.retry_count as number) < 1) {
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
