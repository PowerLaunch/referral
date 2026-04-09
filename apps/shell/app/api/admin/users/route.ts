import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../requireAdmin'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const admin = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  // Fetch profiles with subscription status
  let query = admin
    .from('profiles')
    .select('id, email, trust_level, status, is_vip, payout_hold, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit) // fetch limit+1 to detect hasMore

  if (search.trim()) {
    query = query.ilike('email', `%${search.trim()}%`)
  }

  const { data: profiles, error: profilesError } = await query

  if (profilesError) {
    return Response.json({ error: 'Failed to fetch users' }, { status: 500 })
  }

  const hasMore = (profiles?.length ?? 0) > limit
  const sliced = (profiles ?? []).slice(0, limit)
  const userIds = sliced.map((p) => p.id as string)

  if (userIds.length === 0) {
    return Response.json({ users: [], hasMore: false, page })
  }

  // Batch fetch subscription statuses
  const { data: subscriptions } = await admin
    .from('subscriptions')
    .select('user_id, status')
    .in('user_id', userIds)

  const subMap = new Map<string, string>()
  for (const sub of subscriptions ?? []) {
    subMap.set(sub.user_id as string, sub.status as string)
  }

  // Batch fetch referral counts (as referrer)
  // Explicit limit above PostgREST default (1000) — max 50 users × many referrals each
  const { data: referralCounts } = await admin
    .from('referrals')
    .select('referrer_id')
    .in('referrer_id', userIds)
    .limit(10000)

  const refCountMap = new Map<string, number>()
  for (const ref of referralCounts ?? []) {
    const rid = ref.referrer_id as string
    refCountMap.set(rid, (refCountMap.get(rid) ?? 0) + 1)
  }

  // Batch fetch fraud scores (sum of severity points per user)
  // Explicit limit above PostgREST default (1000) — max 50 users × many flags each
  const { data: fraudFlags } = await admin
    .from('fraud_flags')
    .select('user_id, severity')
    .in('user_id', userIds)
    .eq('is_resolved', false)
    .limit(10000)

  const scoreMap = new Map<string, number>()
  for (const flag of fraudFlags ?? []) {
    const uid = flag.user_id as string
    const points = flag.severity === 'CRITICAL' ? 50 : flag.severity === 'WARNING' ? 30 : 10
    scoreMap.set(uid, (scoreMap.get(uid) ?? 0) + points)
  }

  const users = sliced.map((p) => ({
    id: p.id,
    email: p.email,
    trust_level: p.trust_level,
    status: p.status,
    is_vip: p.is_vip,
    payout_hold: p.payout_hold,
    subscription_status: subMap.get(p.id as string) ?? 'none',
    referral_count: refCountMap.get(p.id as string) ?? 0,
    risk_score: scoreMap.get(p.id as string) ?? 0,
    created_at: p.created_at,
  }))

  return Response.json({ users, hasMore, page })
}
