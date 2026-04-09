'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { awardCredits } from '@referral/api/credits'
import { requireAdmin } from '../actions'

export async function markUnderReview(
  disputeId: string,
  adminNotes: string
): Promise<{ ok: boolean; error?: string }> {
  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }

  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }
  if (dispute.status === 'RESOLVED') return { ok: false, error: 'Dispute is already resolved' }
  if (dispute.status === 'UNDER_REVIEW') return { ok: false, error: 'Dispute is already under review' }

  const { error } = await admin
    .from('disputes')
    .update({ status: 'UNDER_REVIEW', admin_notes: adminNotes.trim() })
    .eq('id', disputeId)

  if (error) return { ok: false, error: error.message }

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
  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }

  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }
  if (dispute.status === 'RESOLVED') return { ok: false, error: 'Dispute is already resolved' }

  const { error } = await admin
    .from('disputes')
    .update({
      status: 'RESOLVED',
      admin_notes: adminNotes.trim(),
      resolved_at: new Date().toISOString(),
    })
    .eq('id', disputeId)

  if (error) return { ok: false, error: error.message }

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
  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }

  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status, referral_id')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }
  if (dispute.status === 'RESOLVED') return { ok: false, error: 'Dispute is already resolved' }
  if (!dispute.referral_id) return { ok: false, error: 'No referral linked to this dispute' }

  const referralId = dispute.referral_id as string

  // Fetch current referral status for audit log
  const { data: referral } = await admin
    .from('referrals')
    .select('status')
    .eq('id', referralId)
    .single()

  if (!referral) return { ok: false, error: 'Referral not found' }

  const beforeReferralStatus = referral.status as string

  // Restore referral to PENDING
  const { error: refError } = await admin
    .from('referrals')
    .update({ status: 'PENDING' })
    .eq('id', referralId)

  if (refError) return { ok: false, error: `Failed to restore referral: ${refError.message}` }

  // Resolve dispute
  const { error: dispError } = await admin
    .from('disputes')
    .update({
      status: 'RESOLVED',
      admin_notes: adminNotes.trim(),
      resolved_at: new Date().toISOString(),
    })
    .eq('id', disputeId)

  if (dispError) return { ok: false, error: `Failed to resolve dispute: ${dispError.message}` }

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
  if (!adminNotes.trim()) return { ok: false, error: 'Admin notes are required' }

  const adminId = await requireAdmin()

  if (amount <= 0) return { ok: false, error: 'Amount must be positive' }

  const admin = createAdminClient()

  const { data: dispute } = await admin
    .from('disputes')
    .select('status, user_id')
    .eq('id', disputeId)
    .single()

  if (!dispute) return { ok: false, error: 'Dispute not found' }
  if (dispute.status === 'RESOLVED') return { ok: false, error: 'Dispute is already resolved' }

  const userId = dispute.user_id as string

  // Resolve dispute FIRST to prevent double-payout on retry
  const { error: dispError } = await admin
    .from('disputes')
    .update({
      status: 'RESOLVED',
      admin_notes: adminNotes.trim(),
      resolved_at: new Date().toISOString(),
    })
    .eq('id', disputeId)

  if (dispError) return { ok: false, error: `Failed to resolve dispute: ${dispError.message}` }

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
