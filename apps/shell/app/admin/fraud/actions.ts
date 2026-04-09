'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../actions'

export async function resolveFraudFlag(
  flagId: string
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdmin()
  const admin = createAdminClient()

  const { data: flag } = await admin
    .from('fraud_flags')
    .select('is_resolved, rule_triggered, user_id, severity')
    .eq('id', flagId)
    .single()

  if (!flag) return { ok: false, error: 'Flag not found' }
  if (flag.is_resolved) return { ok: false, error: 'Flag is already resolved' }

  // Atomic guard: only resolve if still unresolved
  const { data: updated, error } = await admin
    .from('fraud_flags')
    .update({ is_resolved: true })
    .eq('id', flagId)
    .eq('is_resolved', false)
    .select('id')

  if (error) return { ok: false, error: error.message }
  if (!updated || updated.length === 0) return { ok: false, error: 'Flag already resolved' }

  await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'RESOLVE_FRAUD_FLAG',
    target_type: 'fraud_flag',
    target_id: flagId,
    before_value: JSON.stringify({ is_resolved: false }),
    after_value: JSON.stringify({ is_resolved: true }),
    details: {
      rule_triggered: flag.rule_triggered,
      user_id: flag.user_id,
      severity: flag.severity,
    },
  })

  return { ok: true }
}
