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

function generateCode(): string {
  // crypto.randomBytes for security-relevant operations — never Math.random (CLAUDE.md §4.14)
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars.charAt((bytes[i] ?? 0) % chars.length)
  }
  return result
}

interface CreateInfluencerInput {
  code: string
  payout_percentage: number
  monthly_cap: number
  instant_payout: boolean
  lock_bypass: boolean
}

export async function createInfluencerCode(
  input: CreateInfluencerInput
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const adminId = await requireAdmin()

  const code = input.code.trim() || generateCode()

  if (!/^[A-Za-z0-9]{3,20}$/.test(code)) {
    return { ok: false, error: 'Code must be 3-20 alphanumeric characters' }
  }
  if (typeof input.payout_percentage !== 'number' || Number.isNaN(input.payout_percentage)) {
    return { ok: false, error: 'Payout percentage must be a valid number' }
  }
  if (typeof input.monthly_cap !== 'number' || Number.isNaN(input.monthly_cap)) {
    return { ok: false, error: 'Monthly cap must be a valid number' }
  }
  if (input.payout_percentage < 1 || input.payout_percentage > 100) {
    return { ok: false, error: 'Payout percentage must be 1-100' }
  }
  if (input.monthly_cap < 1 || input.monthly_cap > 500) {
    return { ok: false, error: 'Monthly cap must be 1-500' }
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('influencer_codes')
    .insert({
      code: code.toUpperCase(),
      admin_created_by: adminId,
      payout_percentage: input.payout_percentage,
      monthly_cap: input.monthly_cap,
      instant_payout: input.instant_payout,
      lock_bypass: input.lock_bypass,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Code already exists' }
    }
    return { ok: false, error: `Failed to create: ${error.message}` }
  }

  const { error: auditErr } = await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'INFLUENCER_CODE_CREATED',
    target_type: 'influencer_code',
    target_id: data.id,
    details: {
      code: code.toUpperCase(),
      payout_percentage: input.payout_percentage,
      monthly_cap: input.monthly_cap,
      instant_payout: input.instant_payout,
      lock_bypass: input.lock_bypass,
    },
  })
  if (auditErr) console.error('Audit log failed for INFLUENCER_CODE_CREATED:', auditErr)

  return { ok: true, id: data.id }
}

interface UpdateInfluencerInput {
  payout_percentage: number
  monthly_cap: number
  instant_payout: boolean
  lock_bypass: boolean
}

export async function updateInfluencerCode(
  codeId: string,
  input: UpdateInfluencerInput
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()

  if (typeof input.payout_percentage !== 'number' || Number.isNaN(input.payout_percentage)) {
    return { ok: false, error: 'Payout percentage must be a valid number' }
  }
  if (typeof input.monthly_cap !== 'number' || Number.isNaN(input.monthly_cap)) {
    return { ok: false, error: 'Monthly cap must be a valid number' }
  }
  if (input.payout_percentage < 1 || input.payout_percentage > 100) {
    return { ok: false, error: 'Payout percentage must be 1-100' }
  }
  if (input.monthly_cap < 1 || input.monthly_cap > 500) {
    return { ok: false, error: 'Monthly cap must be 1-500' }
  }

  const admin = createAdminClient()

  const { data: current, error: fetchError } = await admin
    .from('influencer_codes')
    .select('*')
    .eq('id', codeId)
    .single()

  if (fetchError || !current) {
    return { ok: false, error: 'Influencer code not found' }
  }

  const beforeValue: Record<string, unknown> = {}
  const afterValue: Record<string, unknown> = {}
  const changes: Record<string, unknown> = {}

  const fields = ['payout_percentage', 'monthly_cap', 'instant_payout', 'lock_bypass'] as const
  for (const field of fields) {
    if (input[field] !== (current as Record<string, unknown>)[field]) {
      beforeValue[field] = (current as Record<string, unknown>)[field]
      afterValue[field] = input[field]
      changes[field] = input[field]
    }
  }

  if (Object.keys(changes).length === 0) {
    return { ok: true }
  }

  const { error } = await admin
    .from('influencer_codes')
    .update(changes)
    .eq('id', codeId)

  if (error) {
    return { ok: false, error: `Update failed: ${error.message}` }
  }

  const { error: auditErr2 } = await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'INFLUENCER_CODE_UPDATED',
    target_type: 'influencer_code',
    target_id: codeId,
    before_value: JSON.stringify(beforeValue),
    after_value: JSON.stringify(afterValue),
    details: { changed_fields: Object.keys(changes) },
  })
  if (auditErr2) console.error('Audit log failed for INFLUENCER_CODE_UPDATED:', auditErr2)

  return { ok: true }
}

export async function deactivateInfluencerCode(
  codeId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()

  const admin = createAdminClient()

  const { data: current, error: fetchError } = await admin
    .from('influencer_codes')
    .select('active')
    .eq('id', codeId)
    .single()

  if (fetchError || !current) {
    return { ok: false, error: 'Influencer code not found' }
  }

  if (!current.active) {
    return { ok: false, error: 'Already deactivated' }
  }

  const { error } = await admin
    .from('influencer_codes')
    .update({ active: false })
    .eq('id', codeId)

  if (error) {
    return { ok: false, error: `Deactivate failed: ${error.message}` }
  }

  const { error: auditErr3 } = await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'INFLUENCER_CODE_DEACTIVATED',
    target_type: 'influencer_code',
    target_id: codeId,
    before_value: JSON.stringify({ active: true }),
    after_value: JSON.stringify({ active: false }),
    details: { deactivated: true },
  })
  if (auditErr3) console.error('Audit log failed for INFLUENCER_CODE_DEACTIVATED:', auditErr3)

  return { ok: true }
}
