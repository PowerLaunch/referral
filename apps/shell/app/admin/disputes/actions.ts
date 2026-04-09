'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { awardCredits } from '@referral/api/credits'

async function requireAdmin(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) throw new Error('Not authorized')
  return user.id
}

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
  if (!dispute.referral_id) return { ok: false, error: 'No referral linked to this dispute' }

  const referralId = dispute.referral_id as string

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
    before_value: JSON.stringify({ status: dispute.status, referral_status: 'previous' }),
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

  const userId = dispute.user_id as string

  // Award credits
  await awardCredits(
    userId,
    amount,
    'CASH_BALANCE',
    `dispute_adjustment:${disputeId}`
  )

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
    action: 'dispute_adjust_payout',
    target_type: 'dispute',
    target_id: disputeId,
    before_value: JSON.stringify({ status: dispute.status }),
    after_value: JSON.stringify({ status: 'RESOLVED', credits_awarded: amount }),
    details: { admin_notes: adminNotes.trim(), user_id: userId, amount },
  })

  return { ok: true }
}
