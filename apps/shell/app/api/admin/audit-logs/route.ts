import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { type NextRequest } from 'next/server'

export async function GET(request: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return Response.json({ error: 'Not Found' }, { status: 404 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(0, Number(searchParams.get('page') ?? 0))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 50)))
  const offset = page * limit

  const admin = createAdminClient()

  // Fetch audit logs with pagination
  const { data: logs, error } = await admin
    .from('admin_audit_logs')
    .select('id, admin_user_id, action, target_type, target_id, before_value, after_value, reason, details, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (error) {
    return Response.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }

  // Fetch limit+1 rows to detect next page, but only return limit rows
  const allRows = logs ?? []
  const hasMore = allRows.length > limit
  const pageRows = allRows.slice(0, limit)

  // Fetch admin emails for the log entries
  const adminIds = [
    ...new Set(pageRows.map((l) => l.admin_user_id as string | null).filter(Boolean)),
  ] as string[]

  let adminMap = new Map<string, string>()
  if (adminIds.length > 0) {
    const { data: adminProfiles } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', adminIds)

    adminMap = new Map(
      (adminProfiles ?? []).map((p) => [p.id as string, p.email as string])
    )
  }

  const entries = pageRows.map((l) => ({
    ...l,
    admin_email: l.admin_user_id ? (adminMap.get(l.admin_user_id as string) ?? null) : null,
  }))

  return Response.json({
    entries,
    hasMore,
  })
}
