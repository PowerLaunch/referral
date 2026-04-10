import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../requireAdmin'
import { NextRequest } from 'next/server'
import { severityPoints } from '../users/risk-utils'

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const admin = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status') ?? 'PENDING_MANUAL_APPROVAL'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  const VALID_STATUSES = [
    'PENDING_MANUAL_APPROVAL',
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'REJECTED',
    'FAILED',
  ]
  if (!VALID_STATUSES.includes(status)) {
    return Response.json({ error: 'Invalid status filter' }, { status: 400 })
  }

  // Fetch payouts with limit+1 for hasMore detection
  const { data: payouts, error: payoutsError } = await admin
    .from('payouts')
    .select('id, user_id, amount, method, status, is_first_payout, provider_error_code, retry_count, retry_available_at, admin_notes, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (payoutsError) {
    return Response.json({ error: 'Failed to fetch payouts' }, { status: 500 })
  }

  const hasMore = (payouts?.length ?? 0) > limit
  const sliced = (payouts ?? []).slice(0, limit)
  const userIds = [...new Set(sliced.map((p) => p.user_id as string))]

  if (sliced.length === 0) {
    return Response.json({ payouts: [], hasMore: false, page })
  }

  // Batch fetch user emails
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', userIds)

  const emailMap = new Map<string, string>()
  for (const p of profiles ?? []) {
    emailMap.set(p.id as string, p.email as string)
  }

  // Batch fetch fraud flags for risk scores
  const { data: fraudFlags } = await admin
    .from('fraud_flags')
    .select('user_id, severity')
    .in('user_id', userIds)
    .eq('is_resolved', false)
    .limit(10000)

  const scoreMap = new Map<string, number>()
  for (const flag of fraudFlags ?? []) {
    const uid = flag.user_id as string
    scoreMap.set(uid, (scoreMap.get(uid) ?? 0) + severityPoints(flag.severity as string))
  }

  // Batch check if users have prior COMPLETED payouts (for FIRST PAYOUT badge)
  const { data: completedPayouts } = await admin
    .from('payouts')
    .select('user_id')
    .in('user_id', userIds)
    .eq('status', 'COMPLETED')
    .limit(10000)

  const hasCompletedMap = new Set<string>()
  for (const p of completedPayouts ?? []) {
    hasCompletedMap.add(p.user_id as string)
  }

  const enriched = sliced.map((p) => ({
    ...p,
    user_email: emailMap.get(p.user_id as string) ?? 'unknown',
    risk_score: scoreMap.get(p.user_id as string) ?? 0,
    has_prior_completed: hasCompletedMap.has(p.user_id as string),
  }))

  return Response.json({ payouts: enriched, hasMore, page })
}
