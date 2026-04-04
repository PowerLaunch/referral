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
        // user_metadata is client-writable — time-bound check limits retroactive injection.
        // Full fix deferred to Phase 4 fraud engine which adds server-side referral code capture.
        const userCreatedAt = new Date(user.created_at)
        const secondsSinceCreation =
          (Date.now() - userCreatedAt.getTime()) / 1000

        if (secondsSinceCreation > 300) {
          console.error(
            'Referral creation skipped — callback arrived too late, possible metadata injection'
          )
        } else {
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

        // Idempotency is the sole guard for first-login detection.
        // Timestamp and URL param approaches are unreliable in Supabase PKCE flow.
        // This query ensures the bonus fires exactly once regardless of how many times this callback runs.
        const { data: existingBonus, error: idempotencyError } =
          await adminClient
            .from('credit_transactions')
            .select('id')
            .eq('user_id', user.id)
            .eq('reason', 'signup_bonus')
            .limit(1)
            .maybeSingle()

        if (idempotencyError) {
          // Query failed — abort to be safe
          console.error(
            'Idempotency check failed — aborting signup bonus to be safe',
            idempotencyError
          )
          return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
        }

        if (existingBonus) {
          // Signup bonus already awarded — skip
          return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
        }

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

        // KNOWN LIMITATION: credit_transactions insert and increment_user_credits RPC are not atomic.
        // If the RPC fails after the insert, a ledger mismatch occurs with no automatic recovery.
        // This entire block will be replaced by awardCredits() in PR 3-A which is fully atomic.
        // Manual reconciliation: check for credit_transactions rows with reason='signup_bonus'
        // where no corresponding user_credits increment exists.
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

        if (!txnError && txnData) {
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
