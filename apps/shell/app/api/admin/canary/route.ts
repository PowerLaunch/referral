import { requireAdmin } from '../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@referral/api/riskScore'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const CreateCanarySchema = z.object({
  seed_gameplay: z.boolean().optional().default(false),
})

const ListParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
})

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const searchParams = request.nextUrl.searchParams
  const parsed = ListParamsSchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  })
  const { page, limit } = parsed.success ? parsed.data : { page: 1, limit: 20 }
  const offset = (page - 1) * limit

  const adminClient = createAdminClient()

  const { data: profiles, error } = await adminClient
    .from('profiles')
    .select('id, email, created_at')
    .eq('is_canary', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (error) {
    return Response.json({ error: 'Failed to fetch canary accounts' }, { status: 500 })
  }

  const hasMore = (profiles?.length ?? 0) > limit
  const sliced = (profiles ?? []).slice(0, limit)

  if (sliced.length === 0) {
    return Response.json({ canaries: [], hasMore: false, page })
  }

  // Batch fetch inbound referral counts (referrals where this profile is the referee)
  const canaryIds = sliced.map((p) => p.id as string)
  const { data: referrals } = await adminClient
    .from('referrals')
    .select('referee_id')
    .in('referee_id', canaryIds)
    .limit(10000)

  const refCountMap = new Map<string, number>()
  for (const ref of referrals ?? []) {
    const rid = ref.referee_id as string
    refCountMap.set(rid, (refCountMap.get(rid) ?? 0) + 1)
  }

  const canaries = sliced.map((p) => ({
    id: p.id,
    email: p.email,
    inbound_referral_count: refCountMap.get(p.id as string) ?? 0,
    created_at: p.created_at,
  }))

  return Response.json({ canaries, hasMore, page })
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth
  const { admin: adminUser } = auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const parsed = CreateCanarySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Create auth user with internal-only email
  const canaryEmail = `canary-${crypto.randomUUID().slice(0, 8)}@canary.internal`
  const canaryPassword = crypto.randomUUID()

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: canaryEmail,
    email_confirm: true,
    password: canaryPassword,
  })

  if (authError || !authData.user) {
    console.error('Failed to create canary auth user:', authError)
    return Response.json({ error: 'Failed to create canary account' }, { status: 500 })
  }

  const userId = authData.user.id

  // Create profile with is_canary = true
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .update({ is_canary: true, email: canaryEmail })
    .eq('id', userId)
    .select('id')
    .single()

  if (profileError || !profile) {
    console.error('Failed to create canary profile:', profileError)
    try {
      await adminClient.auth.admin.deleteUser(userId)
    } catch (cleanupErr) {
      console.error('Failed to cleanup canary auth user after profile error:', cleanupErr)
    }
    return Response.json({ error: 'Failed to create canary profile' }, { status: 500 })
  }

  // Seed gameplay data if requested
  if (parsed.data.seed_gameplay) {
    try {
      const now = Date.now()
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

      // Generate 5-10 realistic gameplay sessions
      const countBuf = crypto.getRandomValues(new Uint8Array(1))
      const sessionCount = 5 + Math.floor((countBuf[0] ?? 0) / 256 * 6)
      let totalMinutes = 0
      let latestHeartbeat = 0

      // Compute aggregate totals and track most recent heartbeat
      const durationBufs = crypto.getRandomValues(new Uint8Array(sessionCount))
      const offsetBufs = crypto.getRandomValues(new Uint32Array(sessionCount))
      for (let i = 0; i < sessionCount; i++) {
        const durationMinutes = 10 + Math.floor((durationBufs[i] ?? 0) / 256 * 36)
        totalMinutes += durationMinutes

        const offsetMs = ((offsetBufs[i] ?? 0) / 0xFFFFFFFF) * thirtyDaysMs
        const sessionStart = now - offsetMs
        const heartbeatMs = sessionStart + durationMinutes * 60 * 1000
        if (heartbeatMs > latestHeartbeat) {
          latestHeartbeat = heartbeatMs
        }
      }

      // Single upsert with aggregated data and chronologically latest heartbeat
      const { error: seedWriteError } = await adminClient
        .from('gameplay_sessions')
        .upsert({
          user_id: userId,
          total_minutes: totalMinutes,
          session_count: sessionCount,
          last_heartbeat_at: new Date(latestHeartbeat).toISOString(),
        }, { onConflict: 'user_id' })

      if (seedWriteError) {
        throw seedWriteError
      }
    } catch (seedErr) {
      console.error('Failed to seed canary gameplay data:', seedErr)
      // Non-critical — canary account is still created
    }
  }

  try {
    await logAdminAction({
      adminUserId: adminUser.id,
      action: 'canary_created',
      targetType: 'profile',
      targetId: profile.id as string,
      afterValue: JSON.stringify({
        profile_id: profile.id,
        seed_gameplay: parsed.data.seed_gameplay,
      }),
    })
  } catch (auditErr) {
    console.error('Canary creation audit log failed:', auditErr)
  }

  return Response.json({ profile_id: profile.id }, { status: 201 })
}
