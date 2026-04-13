import { requireAdmin } from '../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
})

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const admin = createAdminClient()
  const searchParams = request.nextUrl.searchParams

  const parsed = QuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    status: searchParams.get('status') ?? undefined,
  })

  if (!parsed.success) {
    return Response.json({ error: 'Invalid query parameters', details: parsed.error.flatten() }, { status: 400 })
  }

  const { page, limit, status } = parsed.data
  const offset = (page - 1) * limit

  const { data: submissions, error } = await admin
    .from('kyc_submissions')
    .select('id, user_id, status, admin_notes, created_at, reviewed_at, reviewed_by')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (error) {
    return Response.json({ error: 'Failed to fetch submissions' }, { status: 500 })
  }

  const hasMore = (submissions?.length ?? 0) > limit
  const sliced = (submissions ?? []).slice(0, limit)

  // Fetch user emails
  const userIds = [...new Set(sliced.map((s) => s.user_id as string))]
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

  const enriched = sliced.map((s) => ({
    ...s,
    user_email: emailMap.get(s.user_id as string) ?? 'unknown',
  }))

  return Response.json({ submissions: enriched, hasMore, page })
}
