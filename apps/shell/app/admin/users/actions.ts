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

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'toggle_vip',
    target_type: 'user',
    target_id: userId,
    before_value: JSON.stringify({ is_vip: !newValue }),
    after_value: JSON.stringify({ is_vip: newValue }),
    details: { toggled_to: newValue },
  })

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

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'freeze_account',
    target_type: 'user',
    target_id: userId,
    before_value: JSON.stringify({ trust_level: beforeTrust }),
    after_value: JSON.stringify({ trust_level: 'BANNED' }),
  })

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

  const beforeTrust = profile.trust_level as string

  const { error } = await admin
    .from('profiles')
    .update({ trust_level: 'CLEAN' })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'unfreeze_account',
    target_type: 'user',
    target_id: userId,
    before_value: JSON.stringify({ trust_level: beforeTrust }),
    after_value: JSON.stringify({ trust_level: 'CLEAN' }),
  })

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

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'flag_suspicious',
    target_type: 'user',
    target_id: userId,
    before_value: JSON.stringify({ trust_level: beforeTrust }),
    after_value: JSON.stringify({ trust_level: 'SUSPICIOUS' }),
  })

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

  const beforeTrust = profile.trust_level as string

  const { error } = await admin
    .from('profiles')
    .update({ trust_level: 'CLEAN' })
    .eq('id', userId)

  if (error) return { ok: false, error: error.message }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'unflag_suspicious',
    target_type: 'user',
    target_id: userId,
    before_value: JSON.stringify({ trust_level: beforeTrust }),
    after_value: JSON.stringify({ trust_level: 'CLEAN' }),
  })

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

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'toggle_payout_hold',
    target_type: 'user',
    target_id: userId,
    before_value: JSON.stringify({ payout_hold: !newValue }),
    after_value: JSON.stringify({ payout_hold: newValue }),
    details: { toggled_to: newValue },
  })

  return { ok: true }
}
