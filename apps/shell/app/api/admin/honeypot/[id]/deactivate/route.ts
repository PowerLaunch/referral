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
    return Response.json({ error: 'Invalid honeypot ID' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Verify the profile exists and is a honeypot
  const { data: existing, error: fetchError } = await adminClient
    .from('profiles')
    .select('id, is_honeypot')
    .eq('id', parsed.data.id)
    .single()

  if (fetchError || !existing) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  if (!existing.is_honeypot) {
    return Response.json({ error: 'Profile is not a honeypot' }, { status: 400 })
  }

  const { error: updateError } = await adminClient
    .from('profiles')
    .update({ is_honeypot: false })
    .eq('id', parsed.data.id)

  if (updateError) {
    return Response.json({ error: 'Failed to deactivate honeypot' }, { status: 500 })
  }

  try {
    await logAdminAction({
      adminUserId: adminUser.id,
      action: 'honeypot_deactivated',
      targetType: 'profile',
      targetId: parsed.data.id,
      beforeValue: JSON.stringify({ is_honeypot: true }),
      afterValue: JSON.stringify({ is_honeypot: false }),
    })
  } catch (auditErr) {
    console.error('Honeypot deactivation audit log failed:', auditErr)
  }

  return Response.json({ ok: true })
}
