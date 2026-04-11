import { requireAdmin } from '../../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@referral/api/riskScore'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const result = await requireAdmin()
  if (result instanceof Response) return result
  const { admin: adminUser } = result

  const { id } = await params

  const adminClient = createAdminClient()

  // Fetch the entry first for audit logging
  const { data: entry, error: fetchError } = await adminClient
    .from('source_blocklist')
    .select('id, domain')
    .eq('id', id)
    .single()

  if (fetchError || !entry) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  const { error: deleteError } = await adminClient
    .from('source_blocklist')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return Response.json({ error: 'Failed to remove domain' }, { status: 500 })
  }

  await logAdminAction({
    adminUserId: adminUser.id,
    action: 'SOURCE_BLOCKLIST_REMOVE',
    targetType: 'source_blocklist',
    targetId: id,
    beforeValue: entry.domain as string,
    reason: 'Removed from source blocklist',
  })

  return Response.json({ ok: true })
}
