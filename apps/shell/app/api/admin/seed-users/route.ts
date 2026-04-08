import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(): Promise<Response> {
  // Admin check via cookie-based client (RLS)
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

  const admin = createAdminClient()

  // Fetch seed users with profile data
  const { data: seedUsers, error } = await admin
    .from('seed_users')
    .select('id, profile_id, notes, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return Response.json({ error: 'Failed to fetch seed users' }, { status: 500 })
  }

  // Fetch profile data and subscription status for each seed user
  const profileIds = (seedUsers ?? []).map((s) => s.profile_id as string)

  const [profilesResult, subsResult] = await Promise.all([
    admin.from('profiles').select('id, email, referral_code').in('id', profileIds),
    admin.from('subscriptions').select('user_id, status').in('user_id', profileIds),
  ])

  const profileMap = new Map(
    (profilesResult.data ?? []).map((p) => [p.id as string, p])
  )
  const subMap = new Map(
    (subsResult.data ?? []).map((s) => [s.user_id as string, s.status as string])
  )

  const users = (seedUsers ?? []).map((s) => ({
    id: s.id,
    profile_id: s.profile_id,
    notes: s.notes,
    created_at: s.created_at,
    profile: profileMap.get(s.profile_id as string) ?? { email: '—', referral_code: '—' },
    subscription_status: subMap.get(s.profile_id as string) ?? null,
  }))

  return Response.json({ users })
}
