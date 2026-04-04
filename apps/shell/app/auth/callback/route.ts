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

        // FIX 2: Stop if user_credits creation failed (not a duplicate)
        if (upsertError && upsertError.code !== '23505') {
          console.error(
            'Aborting signup bonus: failed to create user_credits row',
            upsertError
          )
          return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
        }

        // Partial unique index on (user_id) WHERE reason='signup_bonus' is the atomic idempotency guard.
        // ON CONFLICT DO NOTHING means concurrent requests safely no-op at the DB level.
        // This index only restricts signup_bonus — other reason values are unconstrained.
        const { data: txnData, error: txnError } = await adminClient
          .from('credit_transactions')
          .insert({
            user_id: user.id,
            amount: signupBonusAmount,
            type: 'GAME_CREDITS',
            reason: 'signup_bonus',
          })
          .select('id')
          .single()

        // Check for unique constraint violation (23505)
        if (txnError) {
          if (txnError.code === '23505') {
            // Signup bonus already awarded (unique constraint violation)
            console.log(
              'Signup bonus already awarded (concurrent request blocked by unique constraint)'
            )
            return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
          } else {
            // Other error — abort
            console.error('Failed to insert signup bonus transaction:', txnError)
            return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
          }
        }

        // Transaction inserted successfully — increment user_credits
        if (txnData) {
          const { error: rpcError } = await adminClient.rpc(
            'increment_user_credits',
            {
              p_user_id: user.id,
              p_type: 'GAME_CREDITS',
              p_amount: signupBonusAmount,
            }
          )

          if (rpcError) {
            console.error(
              'increment_user_credits RPC failed — ledger mismatch possible',
              rpcError,
              'credit_transactions row id:',
              txnData.id
            )
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
