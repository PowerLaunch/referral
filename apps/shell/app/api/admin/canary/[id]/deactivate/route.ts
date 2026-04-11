import { requireAdmin } from '../../../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@referral/api/riskScore'
import { z } from 'zod'

const ParamSchema = z.object({
  id: z.string().uuid(),
})

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth
  const { admin: adminUser } = auth

  const { id } = await params
  const parsed = ParamSchema.safeParse({ id })
  if (!parsed.success) {
    return Response.json({ error: 'Invalid canary ID' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: existing, error: fetchError } = await adminClient
    .from('profiles')
    .select('id, is_canary')
    .eq('id', parsed.data.id)
    .single()

  if (fetchError || !existing) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  if (!existing.is_canary) {
    return Response.json({ error: 'Profile is not a canary' }, { status: 400 })
  }

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ is_canary: false })
    .eq('id', parsed.data.id)

  if (updateError) {
    return Response.json({ error: 'Failed to deactivate canary' }, { status: 500 })
  }

  try {
    await logAdminAction({
      adminUserId: adminUser.id,
      action: 'canary_deactivated',
      targetType: 'profile',
      targetId: parsed.data.id,
      beforeValue: JSON.stringify({ is_canary: true }),
      afterValue: JSON.stringify({ is_canary: false }),
    })
  } catch (auditErr) {
    console.error('Canary deactivation audit log failed:', auditErr)
  }

  return Response.json({ ok: true })
}
