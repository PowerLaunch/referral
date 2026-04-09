'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { awardCredits } from '@referral/api/credits'
import { requireAdmin } from '../actions'

export async function markUnderReview(
  disputeId: string,
  adminNotes: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()

  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }

  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }
  if (dispute.status === 'UNDER_REVIEW') return { ok: false, error: 'Dispute is already under review' }

  // Atomic status guard: .neq('status', 'RESOLVED') ensures only the first
  // concurrent request succeeds — eliminates TOCTOU race condition.
  const { data: updatedRows, error } = await admin
    .from('disputes')
    .update({ status: 'UNDER_REVIEW', admin_notes: adminNotes.trim() })
    .eq('id', disputeId)
    .neq('status', 'RESOLVED')
    .select('id')

  if (error) return { ok: false, error: error.message }
  if (!updatedRows || updatedRows.length === 0) return { ok: false, error: 'Dispute is already resolved' }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'dispute_mark_under_review',
    target_type: 'dispute',
    target_id: disputeId,
    before_value: JSON.stringify({ status: dispute.status }),
    after_value: JSON.stringify({ status: 'UNDER_REVIEW' }),
    details: { admin_notes: adminNotes.trim() },
  })

  return { ok: true }
}

export async function upholdFlag(
  disputeId: string,
  adminNotes: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()

  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }

  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }

  // Atomic status guard: .neq('status', 'RESOLVED') ensures only the first
  // concurrent request succeeds — eliminates TOCTOU race condition.
  const { data: updatedRows, error } = await admin
    .from('disputes')
    .update({
      status: 'RESOLVED',
      admin_notes: adminNotes.trim(),
      resolved_at: new Date().toISOString(),
    })
    .eq('id', disputeId)
    .neq('status', 'RESOLVED')
    .select('id')

  if (error) return { ok: false, error: error.message }
  if (!updatedRows || updatedRows.length === 0) return { ok: false, error: 'Dispute is already resolved' }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'dispute_uphold_flag',
    target_type: 'dispute',
    target_id: disputeId,
    before_value: JSON.stringify({ status: dispute.status }),
    after_value: JSON.stringify({ status: 'RESOLVED' }),
    details: { admin_notes: adminNotes.trim() },
  })

  return { ok: true }
}

export async function restoreReferral(
  disputeId: string,
  adminNotes: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()

  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }

  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status, referral_id')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }
  if (!dispute.referral_id) return { ok: false, error: 'No referral linked to this dispute' }

  const referralId = dispute.referral_id as string

  // Fetch current referral status for audit log
  const { data: referral } = await admin
    .from('referrals')
    .select('status')
    .eq('id', referralId)
    .single()

  if (!referral) return { ok: false, error: 'Referral not found' }
  if (referral.status === 'CONFIRMED') return { ok: false, error: 'Cannot restore a referral that is already CONFIRMED — credits have already been awarded' }

  const beforeReferralStatus = referral.status as string

  // Resolve dispute FIRST (same pattern as adjustPayout).
  // Atomic status guard: .neq('status', 'RESOLVED') ensures only the first
  // concurrent request succeeds — eliminates TOCTOU race condition.
  const { data: updatedDispute, error: dispError } = await admin
    .from('disputes')
    .update({
      status: 'RESOLVED',
      admin_notes: adminNotes.trim(),
      resolved_at: new Date().toISOString(),
    })
    .eq('id', disputeId)
    .neq('status', 'RESOLVED')
    .select('id')

  if (dispError) return { ok: false, error: `Failed to resolve dispute: ${dispError.message}` }
  if (!updatedDispute || updatedDispute.length === 0) return { ok: false, error: 'Dispute is already resolved' }

  // Restore referral to PENDING AFTER dispute is resolved
  const { error: refError } = await admin
    .from('referrals')
    .update({ status: 'PENDING', lock_timer_frozen: false })
    .eq('id', referralId)

  if (refError) {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'RESTORE_REFERRAL_PARTIAL_FAILURE',
      target_type: 'dispute',
      target_id: disputeId,
      details: {
        admin_notes: adminNotes.trim(),
        referral_id: referralId,
        error: refError.message,
        note: 'Dispute resolved but referral status update failed',
      },
    })
    return {
      ok: false,
      error: 'Dispute marked resolved but referral status update failed — check referrals table manually',
    }
  }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'dispute_restore_referral',
    target_type: 'dispute',
    target_id: disputeId,
    before_value: JSON.stringify({ status: dispute.status, referral_status: beforeReferralStatus }),
    after_value: JSON.stringify({ status: 'RESOLVED', referral_status: 'PENDING' }),
    details: { admin_notes: adminNotes.trim(), referral_id: referralId },
  })

  return { ok: true }
}

export async function adjustPayout(
  disputeId: string,
  adminNotes: string,
  amount: number
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()

  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Amount must be a positive finite number' }
  if (!Number.isInteger(amount)) return { ok: false, error: 'Amount must be a whole number' }

  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status, user_id')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }

  const userId = dispute.user_id as string

  // Resolve dispute FIRST to prevent double-payout on retry.
  // Atomic status guard: .neq('status', 'RESOLVED') ensures only the first
  // concurrent request succeeds — eliminates TOCTOU race condition.
  const { data: updatedDispute, error: dispError } = await admin
    .from('disputes')
    .update({
      status: 'RESOLVED',
      admin_notes: adminNotes.trim(),
      resolved_at: new Date().toISOString(),
    })
    .eq('id', disputeId)
    .neq('status', 'RESOLVED')
    .select('id')

  if (dispError) return { ok: false, error: `Failed to resolve dispute: ${dispError.message}` }
  if (!updatedDispute || updatedDispute.length === 0) return { ok: false, error: 'Dispute is already resolved' }

  // Award credits AFTER dispute is resolved
  try {
    await awardCredits(
      userId,
      amount,
      'CASH_BALANCE',
      `dispute_adjustment:${disputeId}`
    )
  } catch (creditError) {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'ADJUST_PAYOUT_PARTIAL_FAILURE',
      target_type: 'dispute',
      target_id: disputeId,
      details: {
        admin_notes: adminNotes.trim(),
        amount,
        error: String(creditError),
        note: 'Dispute resolved but credit award failed',
      },
    })
    return {
      ok: false,
      error: 'Dispute marked resolved but credit award failed — check credit_transactions manually',
    }
  }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'dispute_adjust_payout',
    target_type: 'dispute',
    target_id: disputeId,
    before_value: JSON.stringify({ status: dispute.status }),
    after_value: JSON.stringify({ status: 'RESOLVED', credits_awarded: amount }),
    details: { admin_notes: adminNotes.trim(), user_id: userId, amount },
  })

  return { ok: true }
}
