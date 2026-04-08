import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(): Promise<Response> {
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

  const { data: config, error } = await admin
    .from('game_config')
    .select('min_gameplay_minutes, min_session_count, signup_bonus_amount, signup_bonus_label, cashouts_paused, referral_confirmations_paused')
    .limit(1)
    .single()

  if (error) {
    return Response.json({ error: 'Failed to fetch config' }, { status: 500 })
  }

  return Response.json({ config })
}
