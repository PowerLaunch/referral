'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { triggerE5 } from '@referral/api/email'
import { requireAdmin } from '../actions'

export async function toggleVip(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('is_vip')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found' }

  const newValue = !(profile.is_vip as boolean)

  const { error } = await admin
    .from('profiles')
    .update({ is_vip: newValue })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'toggle_vip',
      target_type: 'user',
      target_id: userId,
      before_value: JSON.stringify({ is_vip: !newValue }),
      after_value: JSON.stringify({ is_vip: newValue }),
      details: { toggled_to: newValue },
    })
  } catch (auditErr) {
    console.error('Audit log failed for toggle_vip:', auditErr)
  }

  return { ok: true }
}

export async function freezeAccount(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('trust_level')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found' }
  if (profile.trust_level === 'BANNED') return { ok: false, error: 'Account is already frozen' }

  const beforeTrust = profile.trust_level as string

  const { error } = await admin
    .from('profiles')
    .update({ trust_level: 'BANNED' })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'freeze_account',
      target_type: 'user',
      target_id: userId,
      before_value: JSON.stringify({ trust_level: beforeTrust }),
      after_value: JSON.stringify({ trust_level: 'BANNED' }),
    })
  } catch (auditErr) {
    console.error('Audit log failed for freeze_account:', auditErr)
  }

  await triggerE5(userId)

  return { ok: true }
}

export async function unfreezeAccount(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('trust_level')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found' }
  if (profile.trust_level !== 'BANNED') return { ok: false, error: 'Can only unfreeze accounts that are currently BANNED' }

  const beforeTrust = profile.trust_level as string

  const { error } = await admin
    .from('profiles')
    .update({ trust_level: 'CLEAN' })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'unfreeze_account',
      target_type: 'user',
      target_id: userId,
      before_value: JSON.stringify({ trust_level: beforeTrust }),
      after_value: JSON.stringify({ trust_level: 'CLEAN' }),
    })
  } catch (auditErr) {
    console.error('Audit log failed for unfreeze_account:', auditErr)
  }

  return { ok: true }
}

export async function flagSuspicious(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('trust_level')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found' }
  if (profile.trust_level === 'BANNED') return { ok: false, error: 'Cannot flag a banned account as suspicious — unfreeze first' }

  const beforeTrust = profile.trust_level as string

  const { error } = await admin
    .from('profiles')
    .update({ trust_level: 'SUSPICIOUS' })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'flag_suspicious',
      target_type: 'user',
      target_id: userId,
      before_value: JSON.stringify({ trust_level: beforeTrust }),
      after_value: JSON.stringify({ trust_level: 'SUSPICIOUS' }),
    })
  } catch (auditErr) {
    console.error('Audit log failed for flag_suspicious:', auditErr)
  }

  return { ok: true }
}

export async function unflagSuspicious(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('trust_level')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found' }
  if (profile.trust_level !== 'SUSPICIOUS') return { ok: false, error: 'Can only unflag accounts that are currently SUSPICIOUS' }

  const beforeTrust = profile.trust_level as string

  const { error } = await admin
    .from('profiles')
    .update({ trust_level: 'CLEAN' })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'unflag_suspicious',
      target_type: 'user',
      target_id: userId,
      before_value: JSON.stringify({ trust_level: beforeTrust }),
      after_value: JSON.stringify({ trust_level: 'CLEAN' }),
    })
  } catch (auditErr) {
    console.error('Audit log failed for unflag_suspicious:', auditErr)
  }

  return { ok: true }
}

export async function toggleManualPayout(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('manual_payout_approval')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found' }

  const newValue = !(profile.manual_payout_approval as boolean)

  const { error } = await admin
    .from('profiles')
    .update({ manual_payout_approval: newValue })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'toggle_manual_payout',
      target_type: 'user',
      target_id: userId,
      before_value: JSON.stringify({ manual_payout_approval: !newValue }),
      after_value: JSON.stringify({ manual_payout_approval: newValue }),
      details: { toggled_to: newValue },
    })
  } catch (auditErr) {
    console.error('Audit log failed for toggle_manual_payout:', auditErr)
  }

  return { ok: true }
}

export async function togglePayoutHold(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('payout_hold')
    .eq('id', userId)
    .single()

  if (!profile) return { ok: false, error: 'User not found' }

  const newValue = !(profile.payout_hold as boolean)

  const { error } = await admin
    .from('profiles')
    .update({ payout_hold: newValue })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: adminId,
      action: 'toggle_payout_hold',
      target_type: 'user',
      target_id: userId,
      before_value: JSON.stringify({ payout_hold: !newValue }),
      after_value: JSON.stringify({ payout_hold: newValue }),
      details: { toggled_to: newValue },
    })
  } catch (auditErr) {
    console.error('Audit log failed for toggle_payout_hold:', auditErr)
  }

  return { ok: true }
}
