import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../requireAdmin'
import { NextRequest } from 'next/server'
import { severityPoints } from './risk-utils'
import { z } from 'zod'

// Validate each param independently so one invalid field doesn't discard valid ones
const SearchSchema = z.string().max(200).optional()
const PageSchema = z.coerce.number().int().positive()
const LimitSchema = z.coerce.number().int().positive().max(100)
const SortBySchema = z.enum(['created_at', 'trust_score', 'trust_level'])
const SortOrderSchema = z.enum(['asc', 'desc'])
const ShowTestSchema = z.enum(['true', 'false'])

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const admin = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const search = SearchSchema.safeParse(searchParams.get('search') ?? undefined).data
  const page = PageSchema.safeParse(searchParams.get('page')).data ?? 1
  const limit = LimitSchema.safeParse(searchParams.get('limit')).data ?? 50
  const sortBy = SortBySchema.safeParse(searchParams.get('sortBy')).data ?? 'created_at'
  const sortOrder = SortOrderSchema.safeParse(searchParams.get('sortOrder')).data ?? 'desc'
  const showTestAccounts = ShowTestSchema.safeParse(searchParams.get('showTestAccounts')).data ?? 'false'
  const offset = (page - 1) * limit

  // Fetch profiles with trust fields
  let query = admin
    .from('profiles')
    .select('id, email, trust_level, trust_score, trust_tier, status, is_vip, payout_hold, manual_payout_approval, is_honeypot, is_canary, created_at')
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(offset, offset + limit) // fetch limit+1 to detect hasMore

  // Filter out honeypot/canary test accounts by default
  if (showTestAccounts !== 'true') {
    query = query.eq('is_honeypot', false).eq('is_canary', false)
  }

  if (search?.trim()) {
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

  // Batch fetch fraud flag counts (unresolved only)
  const { data: fraudFlags } = await admin
    .from('fraud_flags')
    .select('user_id, severity')
    .in('user_id', userIds)
    .eq('is_resolved', false)
    .limit(10000)

  const scoreMap = new Map<string, number>()
  const flagCountMap = new Map<string, number>()
  for (const flag of fraudFlags ?? []) {
    const uid = flag.user_id as string
    scoreMap.set(uid, (scoreMap.get(uid) ?? 0) + severityPoints(flag.severity as string))
    flagCountMap.set(uid, (flagCountMap.get(uid) ?? 0) + 1)
  }

  const users = sliced.map((p) => ({
    id: p.id,
    email: p.email,
    trust_level: p.trust_level,
    trust_score: p.trust_score ?? 200,
    trust_tier: p.trust_tier ?? 'STANDARD',
    status: p.status,
    is_vip: p.is_vip,
    payout_hold: p.payout_hold,
    manual_payout_approval: p.manual_payout_approval,
    is_honeypot: p.is_honeypot,
    is_canary: p.is_canary,
    subscription_status: subMap.get(p.id as string) ?? 'none',
    referral_count: refCountMap.get(p.id as string) ?? 0,
    risk_score: scoreMap.get(p.id as string) ?? 0,
    fraud_flag_count: flagCountMap.get(p.id as string) ?? 0,
    created_at: p.created_at,
  }))

  return Response.json({ users, hasMore, page })
}
