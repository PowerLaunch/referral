import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../requireAdmin'
import { NextRequest } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> }
): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { disputeId } = await params
  const admin = createAdminClient()

  const { data: dispute, error } = await admin
    .from('disputes')
    .select('id, user_id, referral_id, description, status, admin_notes, created_at, resolved_at')
    .eq('id', disputeId)
    .single()

  if (error || !dispute) {
    return Response.json({ error: 'Dispute not found' }, { status: 404 })
  }

  // Fetch user email
  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', dispute.user_id as string)
    .single()

  // Fetch related audit logs for the referral
  let auditLogs: Array<Record<string, unknown>> = []
  if (dispute.referral_id) {
    const { data: logs } = await admin
      .from('admin_audit_logs')
      .select('id, action, admin_user_id, before_value, after_value, details, created_at')
      .eq('target_id', dispute.referral_id as string)
      .order('created_at', { ascending: false })
      .limit(50)

    auditLogs = (logs ?? []) as Array<Record<string, unknown>>
  }

  return Response.json({
    dispute: {
      ...dispute,
      user_email: (profile?.email as string) ?? 'unknown',
    },
    auditLogs,
  })
}
