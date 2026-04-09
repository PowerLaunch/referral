import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../requireAdmin'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const admin = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status') ?? 'OPEN'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  const { data: disputes, error } = await admin
    .from('disputes')
    .select('id, user_id, referral_id, description, status, admin_notes, created_at, resolved_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (error) {
    return Response.json({ error: 'Failed to fetch disputes' }, { status: 500 })
  }

  const hasMore = (disputes?.length ?? 0) > limit
  const sliced = (disputes ?? []).slice(0, limit)

  // Fetch user emails for display
  const userIds = [...new Set(sliced.map((d) => d.user_id as string))]

  const emailMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', userIds)

    for (const p of profiles ?? []) {
      emailMap.set(p.id as string, p.email as string)
    }
  }

  const enriched = sliced.map((d) => ({
    ...d,
    user_email: emailMap.get(d.user_id as string) ?? 'unknown',
  }))

  return Response.json({ disputes: enriched, hasMore, page })
}
