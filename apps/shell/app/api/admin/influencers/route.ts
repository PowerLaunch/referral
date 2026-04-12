import { requireAdmin } from '../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const PageSchema = z.coerce.number().int().positive()
const LimitSchema = z.coerce.number().int().positive().max(100)
const SearchSchema = z.string().max(200).optional()

export async function GET(request: NextRequest): Promise<Response> {
  const result = await requireAdmin()
  if (result instanceof Response) return result

  const admin = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const page = PageSchema.safeParse(searchParams.get('page')).data ?? 1
  const limit = LimitSchema.safeParse(searchParams.get('limit')).data ?? 50
  const search = SearchSchema.safeParse(searchParams.get('search') ?? undefined).data
  const offset = (page - 1) * limit

  let query = admin
    .from('influencer_codes')
    .select('id, code, admin_created_by, payout_percentage, monthly_cap, instant_payout, lock_bypass, active, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (search?.trim()) {
    query = query.ilike('code', `%${search.trim()}%`)
  }

  const { data: codes, error } = await query

  if (error) {
    return Response.json({ error: 'Failed to fetch influencer codes' }, { status: 500 })
  }

  const hasMore = (codes?.length ?? 0) > limit
  const sliced = (codes ?? []).slice(0, limit)

  // Fetch admin emails for display
  const adminIds = [...new Set(sliced.map((c) => c.admin_created_by as string))]
  const emailMap = new Map<string, string>()
  if (adminIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email')
      .in('id', adminIds)

    for (const p of profiles ?? []) {
      emailMap.set(p.id as string, p.email as string)
    }
  }

  const enriched = sliced.map((c) => ({
    ...c,
    admin_email: emailMap.get(c.admin_created_by as string) ?? 'unknown',
  }))

  return Response.json({ codes: enriched, hasMore, page })
}
