import { requireAdmin } from '../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@referral/api/riskScore'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const CreateHoneypotSchema = z.object({
  display_name: z.string().trim().max(100).optional(),
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
    .select('id, email, referral_code, created_at')
    .eq('is_honeypot', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)

  if (error) {
    return Response.json({ error: 'Failed to fetch honeypot accounts' }, { status: 500 })
  }

  const hasMore = (profiles?.length ?? 0) > limit
  const sliced = (profiles ?? []).slice(0, limit)

  if (sliced.length === 0) {
    return Response.json({ honeypots: [], hasMore: false, page })
  }

  // Batch fetch referral counts (referrals where this profile is the referrer)
  const honeypotIds = sliced.map((p) => p.id as string)
  const { data: referrals } = await adminClient
    .from('referrals')
    .select('referrer_id')
    .in('referrer_id', honeypotIds)
    .limit(10000)

  const refCountMap = new Map<string, number>()
  for (const ref of referrals ?? []) {
    const rid = ref.referrer_id as string
    refCountMap.set(rid, (refCountMap.get(rid) ?? 0) + 1)
  }

  const honeypots = sliced.map((p) => ({
    id: p.id,
    email: p.email,
    referral_code: p.referral_code,
    referral_count: refCountMap.get(p.id as string) ?? 0,
    created_at: p.created_at,
  }))

  return Response.json({ honeypots, hasMore, page })
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

  const parsed = CreateHoneypotSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Create auth user with internal-only email
  const honeypotEmail = `honeypot-${crypto.randomUUID().slice(0, 8)}@honeypot.internal`
  const honeypotPassword = crypto.randomUUID()

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: honeypotEmail,
    email_confirm: true,
    password: honeypotPassword,
  })

  if (authError || !authData.user) {
    console.error('Failed to create honeypot auth user:', authError)
    return Response.json({ error: 'Failed to create honeypot account' }, { status: 500 })
  }

  const userId = authData.user.id

  // Create profile with is_honeypot = true
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .update({
      is_honeypot: true,
      email: honeypotEmail,
    })
    .eq('id', userId)
    .select('id, referral_code')
    .single()

  if (profileError || !profile) {
    console.error('Failed to create honeypot profile:', profileError)
    // Cleanup: delete the auth user
    try {
      await adminClient.auth.admin.deleteUser(userId)
    } catch (cleanupErr) {
      console.error('Failed to cleanup honeypot auth user after profile error:', cleanupErr)
    }
    return Response.json({ error: 'Failed to create honeypot profile' }, { status: 500 })
  }

  try {
    await logAdminAction({
      adminUserId: adminUser.id,
      action: 'honeypot_created',
      targetType: 'profile',
      targetId: profile.id as string,
      afterValue: JSON.stringify({
        profile_id: profile.id,
        referral_code: profile.referral_code,
      }),
    })
  } catch (auditErr) {
    console.error('Honeypot creation audit log failed:', auditErr)
  }

  return Response.json({
    profile_id: profile.id,
    referral_code: profile.referral_code,
  }, { status: 201 })
}
