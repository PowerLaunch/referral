import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import {
  getLockPeriodDays,
  getCountryFromIp,
  isVpnDetected,
} from '@/../../packages/api/src/lockPeriod'

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

      // Award signup bonus regardless of referral
      const { data: gameConfig, error: configError } = await createAdminClient()
        .from('game_config')
        .select('signup_bonus_amount')
        .limit(1)
        .single()

      if (!configError && gameConfig && gameConfig.signup_bonus_amount > 0) {
        const adminClient = createAdminClient()
        const signupBonusAmount = gameConfig.signup_bonus_amount

        // Ensure user_credits row exists (UPSERT pattern)
        const { error: upsertError } = await adminClient
          .from('user_credits')
          .insert({
            user_id: user.id,
            amount: 0,
            type: 'GAME_CREDITS',
          })

        // Ignore duplicate key errors (23505) - row already exists
        if (upsertError && upsertError.code !== '23505') {
          console.error('Failed to create user_credits row:', upsertError)
        }

        // Award signup bonus in a transaction-like pattern
        // This inline credit logic will be replaced by awardCredits() from packages/api/src/credits.ts in PR 3-A. Keep both in sync until then.
        const { error: txnError } = await adminClient
          .from('credit_transactions')
          .insert({
            user_id: user.id,
            amount: signupBonusAmount,
            type: 'GAME_CREDITS',
            reason: 'signup_bonus',
          })

        if (!txnError) {
          // Atomic credit increment using RPC
          await adminClient.rpc('increment_user_credits', {
            p_user_id: user.id,
            p_type: 'GAME_CREDITS',
            p_amount: signupBonusAmount,
          })
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
