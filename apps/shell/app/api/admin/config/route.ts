import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../requireAdmin'

export async function GET(): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const admin = createAdminClient()

  const { data: config, error } = await admin
    .from('game_config')
    .select('min_gameplay_minutes, min_session_count, cashouts_paused, referral_confirmations_paused')
    .limit(1)
    .single()

  if (error) {
    return Response.json({ error: 'Failed to fetch config' }, { status: 500 })
  }

  return Response.json({ config })
}
