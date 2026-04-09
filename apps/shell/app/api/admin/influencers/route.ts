import { requireAdmin } from '../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(): Promise<Response> {
  const result = await requireAdmin()
  if (result instanceof Response) return result

  const admin = createAdminClient()

  const { data: codes, error } = await admin
    .from('influencer_codes')
    .select('id, code, payout_percentage, monthly_cap, instant_payout, lock_bypass, active, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: 'Failed to fetch influencer codes' }, { status: 500 })
  }

  return Response.json({ codes: codes ?? [] })
}
