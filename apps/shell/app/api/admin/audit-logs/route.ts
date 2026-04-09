import { createAdminClient } from '@/lib/supabase/admin'
import { type NextRequest } from 'next/server'
import { requireAdmin } from '../requireAdmin'

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(0, Number(searchParams.get('page') ?? 0))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 50)))
  const offset = page * limit

  const admin = createAdminClient()

  // Fetch limit+1 rows to detect next page — .range() uses inclusive bounds,
  // so .range(offset, offset + limit) returns limit+1 rows when available.
  const { data: logs, error } = await admin
    .from('admin_audit_logs')
    .select('id, admin_user_id, action, target_type, target_id, before_value, after_value, reason, details, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (error) {
    return Response.json({ error: 'Failed to fetch audit logs' }, { status: 500 })
  }

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
