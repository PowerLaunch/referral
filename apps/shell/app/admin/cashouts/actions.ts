'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { awardCredits } from '@referral/api/credits'
import { getUserRiskScore } from '@referral/api/riskScore'
import { executePayout } from '@referral/api/payoutExecutor'
import { requireAdmin } from '../actions'

const REJECTION_REASONS = [
  'Fraud Suspected',
  'Wrong Details',
  'Policy Violation',
  'Other',
] as const

type RejectionReason = (typeof REJECTION_REASONS)[number]

export async function approvePayout(
  payoutId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  // Fetch current payout
  const { data: payout } = await admin
    .from('payouts')
    .select('status, user_id, amount')
    .eq('id', payoutId)
    .single()

  if (!payout) return { ok: false, error: 'Payout not found' }

  const beforeStatus = payout.status as string

  if (beforeStatus !== 'PENDING' && beforeStatus !== 'PENDING_MANUAL_APPROVAL') {
    return { ok: false, error: `Cannot approve payout in status ${beforeStatus}` }
  }

  // Atomic status guard: only update if still in approvable state
  const { data: updated, error: updateError } = await admin
    .from('payouts')
    .update({ status: 'PROCESSING' })
    .eq('id', payoutId)
    .in('status', ['PENDING', 'PENDING_MANUAL_APPROVAL'])
    .select('id')

  if (updateError) return { ok: false, error: updateError.message }
  if (!updated || updated.length === 0) return { ok: false, error: 'Payout already transitioned' }

  // Execute payout (stub — marks COMPLETED for now)
  const execResult = await executePayout(payoutId)
  if (!execResult.ok) {
    // Revert to previous status on execution failure
    await admin
      .from('payouts')
      .update({ status: beforeStatus })
      .eq('id', payoutId)
    return { ok: false, error: `Execution failed: ${execResult.error}` }
  }

  // Audit log
  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'APPROVE_PAYOUT',
    target_type: 'payout',
    target_id: payoutId,
    before_value: JSON.stringify({ status: beforeStatus }),
    after_value: JSON.stringify({ status: 'COMPLETED' }),
    details: { user_id: payout.user_id, amount: payout.amount },
  })

  return { ok: true }
}

export async function rejectPayout(
  payoutId: string,
  reason: string,
  shouldReturnCredits: boolean
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()

  if (!reason.trim()) return { ok: false, error: 'Reason is required' }
  if (!(REJECTION_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: 'Invalid rejection reason' }
  }

  const admin = createAdminClient()

  // Fetch current payout
  const { data: payout } = await admin
    .from('payouts')
    .select('status, user_id, amount')
    .eq('id', payoutId)
    .single()

  if (!payout) return { ok: false, error: 'Payout not found' }

  const beforeStatus = payout.status as string

  // Can reject from PENDING, PENDING_MANUAL_APPROVAL, or PROCESSING
  if (!['PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING'].includes(beforeStatus)) {
    return { ok: false, error: `Cannot reject payout in status ${beforeStatus}` }
  }

  // Atomic status guard
  const { data: updated, error: updateError } = await admin
    .from('payouts')
    .update({ status: 'REJECTED', admin_notes: reason.trim() })
    .eq('id', payoutId)
    .in('status', ['PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING'])
    .select('id')

  if (updateError) return { ok: false, error: updateError.message }
  if (!updated || updated.length === 0) return { ok: false, error: 'Payout already transitioned' }

  // Return credits if requested
  if (shouldReturnCredits) {
    try {
      await awardCredits(
        payout.user_id as string,
        payout.amount as number,
        'CASH_BALANCE',
        `payout_rejected:${payoutId}`
      )
    } catch (creditError) {
      // Log but don't fail the rejection — credits can be reconciled manually
      console.error(`Failed to return credits for rejected payout ${payoutId}:`, creditError)
      await admin.from('admin_audit_logs').insert({
        admin_user_id: adminId,
        action: 'REJECT_PAYOUT_CREDIT_RETURN_FAILED',
        target_type: 'payout',
        target_id: payoutId,
        details: { error: String(creditError), amount: payout.amount },
      })
    }
  }

  // Audit log
  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'REJECT_PAYOUT',
    target_type: 'payout',
    target_id: payoutId,
    before_value: JSON.stringify({ status: beforeStatus }),
    after_value: JSON.stringify({ status: 'REJECTED' }),
    details: {
      reason: reason.trim(),
      credits_returned: shouldReturnCredits,
      user_id: payout.user_id,
      amount: payout.amount,
    },
  })

  return { ok: true }
}

export async function batchApproveLowRisk(
  payoutIds: string[]
): Promise<{ ok: boolean; approved: number; skipped: number; errors: string[] }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  let approved = 0
  let skipped = 0
  const errors: string[] = []

  // Process sequentially to avoid race conditions
  for (const payoutId of payoutIds) {
    try {
      // Server-side validation — never trust client filter
      const { data: payout } = await admin
        .from('payouts')
        .select('status, user_id, amount, is_first_payout')
        .eq('id', payoutId)
        .single()

      if (!payout) {
        errors.push(`${payoutId}: not found`)
        skipped++
        continue
      }

      // Must be in approvable state
      if (payout.status !== 'PENDING' && payout.status !== 'PENDING_MANUAL_APPROVAL') {
        errors.push(`${payoutId}: not in approvable state`)
        skipped++
        continue
      }

      // Cannot batch approve first payouts
      if (payout.is_first_payout) {
        errors.push(`${payoutId}: first payout requires individual review`)
        skipped++
        continue
      }

      // Amount must be under $25 (2500 credits)
      if ((payout.amount as number) >= 2500) {
        errors.push(`${payoutId}: amount too high for batch approval`)
        skipped++
        continue
      }

      // Risk score must be < 30
      const riskScore = await getUserRiskScore(payout.user_id as string)
      if (riskScore >= 30) {
        errors.push(`${payoutId}: risk score too high (${riskScore})`)
        skipped++
        continue
      }

      // All checks passed — approve
      const { data: updated } = await admin
        .from('payouts')
        .update({ status: 'PROCESSING' })
        .eq('id', payoutId)
        .in('status', ['PENDING', 'PENDING_MANUAL_APPROVAL'])
        .select('id')

      if (!updated || updated.length === 0) {
        errors.push(`${payoutId}: already transitioned`)
        skipped++
        continue
      }

      // Execute payout stub
      const previousStatus = payout.status as string
      const execResult = await executePayout(payoutId)
      if (!execResult.ok) {
        // Revert to previous status on execution failure
        await admin
          .from('payouts')
          .update({ status: previousStatus })
          .eq('id', payoutId)
        errors.push(`${payoutId}: execution failed`)
        skipped++
        continue
      }

      // Audit log for each approval
      await admin.from('admin_audit_logs').insert({
        admin_user_id: adminId,
        action: 'APPROVE_PAYOUT',
        target_type: 'payout',
        target_id: payoutId,
        before_value: JSON.stringify({ status: payout.status }),
        after_value: JSON.stringify({ status: 'COMPLETED' }),
        details: {
          batch: true,
          user_id: payout.user_id,
          amount: payout.amount,
          risk_score: riskScore,
        },
      })

      approved++
    } catch (err) {
      errors.push(`${payoutId}: ${String(err)}`)
      skipped++
    }
  }

  return { ok: true, approved, skipped, errors }
}

export async function retryFailedPayout(
  payoutId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  // Fetch current payout
  const { data: payout } = await admin
    .from('payouts')
    .select('status, user_id, amount, retry_count')
    .eq('id', payoutId)
    .single()

  if (!payout) return { ok: false, error: 'Payout not found' }
  if (payout.status !== 'FAILED') return { ok: false, error: 'Only FAILED payouts can be retried' }

  // Atomic status guard + increment retry_count
  const { data: updated, error: updateError } = await admin
    .from('payouts')
    .update({
      status: 'PROCESSING',
      retry_count: (payout.retry_count as number) + 1,
    })
    .eq('id', payoutId)
    .eq('status', 'FAILED')
    .select('id')

  if (updateError) return { ok: false, error: updateError.message }
  if (!updated || updated.length === 0) return { ok: false, error: 'Payout already transitioned' }

  // Execute payout stub
  const execResult = await executePayout(payoutId)
  if (!execResult.ok) {
    // Mark back as FAILED
    await admin
      .from('payouts')
      .update({
        status: 'FAILED',
        provider_error_code: execResult.error ?? null,
      })
      .eq('id', payoutId)
    return { ok: false, error: `Retry failed: ${execResult.error}` }
  }

  // Audit log
  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'RETRY_PAYOUT',
    target_type: 'payout',
    target_id: payoutId,
    before_value: JSON.stringify({ status: 'FAILED', retry_count: payout.retry_count }),
    after_value: JSON.stringify({ status: 'COMPLETED', retry_count: (payout.retry_count as number) + 1 }),
    details: { user_id: payout.user_id, amount: payout.amount },
  })

  return { ok: true }
}
