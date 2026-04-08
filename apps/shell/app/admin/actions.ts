'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

// --- Kill Switches ---

export async function toggleCashoutsPaused(): Promise<{ ok: boolean; paused: boolean }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  // Atomic toggle via RPC — no read-then-write race condition
  const { data: newValue, error } = await admin.rpc('toggle_cashouts_paused')

  if (error) throw new Error('Failed to toggle cashouts_paused')

  const paused = newValue as boolean

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'toggle_cashouts_paused',
    target_type: 'config',
    before_value: JSON.stringify({ cashouts_paused: !paused }),
    after_value: JSON.stringify({ cashouts_paused: paused }),
    details: { toggled_to: paused },
  })

  return { ok: true, paused }
}

export async function toggleReferralConfirmationsPaused(): Promise<{ ok: boolean; paused: boolean }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  // Atomic toggle via RPC — no read-then-write race condition
  const { data: newValue, error } = await admin.rpc('toggle_referral_confirmations_paused')

  if (error) throw new Error('Failed to toggle referral_confirmations_paused')

  const paused = newValue as boolean

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'toggle_referral_confirmations_paused',
    target_type: 'config',
    before_value: JSON.stringify({ referral_confirmations_paused: !paused }),
    after_value: JSON.stringify({ referral_confirmations_paused: paused }),
    details: { toggled_to: paused },
  })

  return { ok: true, paused }
}

// --- Seed Users ---

interface CreateSeedUserInput {
  email: string
  password: string
  referrerCode: string
  subscriptionActive: boolean
  notes: string
}

export async function createSeedUser(
  input: CreateSeedUserInput
): Promise<{ ok: boolean; error?: string; profileId?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  // Create auth user with confirmed email
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  })

  if (authError) {
    return { ok: false, error: `Auth creation failed: ${authError.message}` }
  }

  const userId = authData.user.id

  // Generate a unique referral code for the seed user
  const referralCode = `SEED-${userId.slice(0, 8).toUpperCase()}`

  // Insert profile
  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    email: input.email,
    referral_code: referralCode,
  })

  if (profileError) {
    // Cleanup: delete auth user if profile insert fails
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, error: `Profile creation failed: ${profileError.message}` }
  }

  // Insert subscription if active
  if (input.subscriptionActive) {
    await admin.from('subscriptions').insert({
      user_id: userId,
      status: 'active',
    })
  }

  // Handle referrer code if provided
  let hasReferrer = false
  if (input.referrerCode.trim()) {
    const { data: referrer } = await admin
      .from('profiles')
      .select('id')
      .eq('referral_code', input.referrerCode.trim())
      .maybeSingle()

    if (referrer) {
      hasReferrer = true
      await admin.from('referrals').insert({
        referrer_id: referrer.id,
        referee_id: userId,
        referral_code: input.referrerCode.trim(),
        status: 'PENDING',
      })
    }
  }

  // Track seed user
  await admin.from('seed_users').insert({
    profile_id: userId,
    created_by_admin: adminId,
    notes: input.notes || null,
  })

  // Audit log
  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'create_seed_user',
    target_type: 'seed_user',
    target_id: userId,
    details: { email: input.email, has_referrer: hasReferrer, notes: input.notes || null },
  })

  return { ok: true, profileId: userId }
}

export async function deleteSeedUser(
  profileId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  // Verify it's a seed user
  const { data: seedUser } = await admin
    .from('seed_users')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle()

  if (!seedUser) {
    return { ok: false, error: 'Not a seed user' }
  }

  // Delete auth user (cascades to profile via foreign key)
  const { error: deleteError } = await admin.auth.admin.deleteUser(profileId)
  if (deleteError) {
    return { ok: false, error: `Delete failed: ${deleteError.message}` }
  }

  // Audit log
  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'delete_seed_user',
    target_type: 'seed_user',
    target_id: profileId,
    details: { deleted: true },
  })

  return { ok: true }
}

// --- Config ---

interface ConfigUpdate {
  min_gameplay_minutes?: number
  min_session_count?: number
  signup_bonus_amount?: number
  signup_bonus_label?: string
}

export async function updateGameConfig(
  updates: ConfigUpdate
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  // Read current values for audit log
  const { data: current } = await admin
    .from('game_config')
    .select('*')
    .limit(1)
    .single()

  if (!current) return { ok: false, error: 'game_config not found' }

  // Runtime allowlist — prevents crafted calls from injecting cashouts_paused,
  // referral_confirmations_paused, or any other sensitive field.
  const ALLOWED_CONFIG_FIELDS = ['min_gameplay_minutes', 'min_session_count', 'signup_bonus_amount', 'signup_bonus_label'] as const
  type AllowedField = (typeof ALLOWED_CONFIG_FIELDS)[number]

  // Build update object with only changed fields
  const changes: Record<string, unknown> = {}
  const beforeValue: Record<string, unknown> = {}
  const afterValue: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(updates)) {
    if (!(ALLOWED_CONFIG_FIELDS as readonly string[]).includes(key)) continue
    if (value !== undefined && value !== (current as Record<string, AllowedField>)[key as AllowedField]) {
      changes[key] = value
      beforeValue[key] = (current as Record<string, unknown>)[key]
      afterValue[key] = value
    }
  }

  if (Object.keys(changes).length === 0) {
    return { ok: true } // No changes
  }

  const { error } = await admin
    .from('game_config')
    .update(changes)
    .eq('singleton', true)

  if (error) return { ok: false, error: `Update failed: ${error.message}` }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'update_game_config',
    target_type: 'config',
    before_value: JSON.stringify(beforeValue),
    after_value: JSON.stringify(afterValue),
    details: { changed_fields: Object.keys(changes) },
  })

  return { ok: true }
}
