import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../requireAdmin'
import { NextRequest } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { userId } = await params

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return Response.json({ error: 'Invalid ID format' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Fetch profile
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, email, trust_level, status, is_vip, payout_hold, verified_kyc_hash, created_at')
    .eq('id', userId)
    .single()

  if (profileError || !profile) {
    return Response.json({ error: 'User not found' }, { status: 404 })
  }

  // Fetch referrals (as referrer or referee)
  const { data: referrals } = await admin
    .from('referrals')
    .select('id, referrer_id, referee_id, status, referral_code, created_at, confirmed_at')
    .or(`referrer_id.eq.${userId},referee_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(100)

  // Fetch fraud flags
  const { data: fraudFlags } = await admin
    .from('fraud_flags')
    .select('id, rule_triggered, severity, details, is_resolved, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  // Fetch credit transactions
  const { data: creditTransactions } = await admin
    .from('credit_transactions')
    .select('id, amount, type, reason, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  // Fetch subscription
  const { data: subscription } = await admin
    .from('subscriptions')
    .select('status, created_at')
    .eq('user_id', userId)
    .maybeSingle()

  // Compute risk score from unresolved fraud flags
  let riskScore = 0
  for (const flag of fraudFlags ?? []) {
    if (!(flag.is_resolved as boolean)) {
      const points = flag.severity === 'CRITICAL' ? 50 : flag.severity === 'WARNING' ? 30 : 10
      riskScore += points
    }
  }

  return Response.json({
    profile: {
      ...profile,
      has_kyc: !!(profile.verified_kyc_hash),
      verified_kyc_hash: undefined, // Never expose the hash
    },
    subscription: subscription ?? null,
    referrals: referrals ?? [],
    fraudFlags: fraudFlags ?? [],
    creditTransactions: creditTransactions ?? [],
    riskScore,
  })
}
