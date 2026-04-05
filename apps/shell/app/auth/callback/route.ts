import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import {
  getLockPeriodDays,
  getCountryFromIp,
  isVpnDetected,
} from '@referral/api/lockPeriod'
import { awardCredits } from '@referral/api/credits'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=verification_failed`
    )
  }

  const supabase = await createClient()
  const { data: sessionData, error } =
    await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=verification_failed`
    )
  }

  // Lock period calculation added in PR 2-D.
  // After successful email verification, create referral PENDING row and award signup bonus
  const user = sessionData.user
  if (user) {
    try {
      const referralCode = user.user_metadata?.referral_code as string | null

      if (referralCode) {
        // user_metadata is client-writable but the UNIQUE(referee_id) constraint on referrals
        // limits each user to one referral row. Retroactive injection risk is accepted here
        // and will be addressed in Phase 4 by storing referral_code server-side at click time.
        const adminClient = createAdminClient()

        // Look up referrer by referral_code
        const { data: referrerProfile, error: referrerError } =
          await adminClient
            .from('profiles')
            .select('id')
            .eq('referral_code', referralCode)
            .single()

        if (!referrerError && referrerProfile) {
            // Extract IP from request headers
            const forwardedFor = request.headers.get('x-forwarded-for')
            const ip = forwardedFor
              ? forwardedFor.split(',')[0]?.trim() ?? '0.0.0.0'
              : '0.0.0.0'

            // Get country and VPN detection (stubs for now)
            const countryCode = getCountryFromIp(ip)
            const vpnDetected = isVpnDetected(ip)

            // Calculate lock period
            const lockPeriodDays = getLockPeriodDays(countryCode, vpnDetected)

            // Calculate payout_eligible_at
            const payoutEligibleAt = new Date()
            payoutEligibleAt.setDate(
              payoutEligibleAt.getDate() + lockPeriodDays
            )

            // Create PENDING referral
            const { error: referralError } = await adminClient
              .from('referrals')
              .insert({
                referrer_id: referrerProfile.id,
                referee_id: user.id,
                referral_code: referralCode,
                status: 'PENDING',
                payout_eligible_at: payoutEligibleAt.toISOString(),
                country_code: countryCode,
                lock_timer_frozen: false,
              })

          if (referralError) {
            console.error('Failed to create referral:', referralError)
          }
        }
      }

      // Award signup bonus on initial email verification only
      const { data: gameConfig, error: configError } = await createAdminClient()
        .from('game_config')
        .select('signup_bonus_amount')
        .limit(1)
        .single()

      if (!configError && gameConfig && gameConfig.signup_bonus_amount > 0) {
        const signupBonusAmount = gameConfig.signup_bonus_amount

        // Replaced inline credit logic from PR 2-D with canonical awardCredits() utility.
        // Partial unique index on (user_id) WHERE reason='signup_bonus' is the atomic idempotency guard.
        // The RPC function handles both ledger entry and balance update atomically.
        try {
          await awardCredits(user.id, signupBonusAmount, 'GAME_CREDITS', 'signup_bonus')
        } catch (error: unknown) {
          const pgError = error as { code?: string }
          if (pgError?.code === '23505') {
            // Duplicate signup bonus — idempotent, safe to ignore and continue.
            console.log('Signup bonus already awarded — skipping duplicate')
          } else {
            // Genuine failure — log but do not block the user from reaching dashboard.
            // Re-throw is intentional: the outer catch handles unexpected errors.
            console.error('Failed to award signup bonus:', error)
            throw error
          }
        }
      }
    } catch (err) {
      console.error('Signup flow error:', err)
      // Don't block login on referral/bonus errors
    }
  }

  // Success — redirect to dashboard
  return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
}
