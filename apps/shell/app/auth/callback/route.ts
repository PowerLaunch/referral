import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import {
  getLockPeriodDays,
  getCountryFromIp,
  isVpnDetected,
} from '@referral/api/lockPeriod'
import { awardCredits } from '@referral/api/credits'
import { createEmailPreferences } from '@referral/api/email'
import { adjustTrustScore, getDynamicLockPeriodDays } from '@referral/api/trustScore'
import { recordAndClassifyIp } from '@referral/api/ipClassification'

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
      const adminClient = createAdminClient()

      // Extract IP early — used by both IP classification and referral lock period
      const forwardedFor = request.headers.get('x-forwarded-for')
      const ip = forwardedFor
        ? forwardedFor.split(',')[0]?.trim() ?? '0.0.0.0'
        : '0.0.0.0'

      // Fetch VIP status once — reused by IP classification and VIP trust bonus below
      let isVip = false
      try {
        const { data: vipProfile } = await adminClient
          .from('profiles')
          .select('is_vip')
          .eq('id', user.id)
          .single()
        isVip = vipProfile?.is_vip === true
      } catch {
        // Profile may not exist yet for brand-new users — default to non-VIP
      }

      // IP infrastructure classification — record and penalize datacenter/VPN signups
      try {
        const ipResult = await recordAndClassifyIp(adminClient, user.id, ip, 'SIGNUP')

        if (ipResult.classification === 'DATACENTER' && !isVip) {
          // Idempotency: partial unique index on trust_score_events prevents duplicate penalties
          const { data: existingPenalty } = await adminClient
            .from('trust_score_events')
            .select('id')
            .eq('user_id', user.id)
            .eq('reason', 'datacenter_ip_signup')
            .limit(1)
            .maybeSingle()

          if (!existingPenalty) {
            await adjustTrustScore(adminClient, user.id, -50, 'datacenter_ip_signup', 'R19_DATACENTER_IP')
          }
        }
        // TODO [Phase 5+]: Add VPN_PROXY trust penalty once MaxMind GeoIP2 is integrated
      } catch (ipErr) {
        console.error('IP classification error:', ipErr)
        // Do not block signup flow
      }

      const referralCode = user.user_metadata?.referral_code as string | null

      if (referralCode) {
        // user_metadata is client-writable but the UNIQUE(referee_id) constraint on referrals
        // limits each user to one referral row. Retroactive injection risk is accepted here
        // and will be addressed in Phase 4 by storing referral_code server-side at click time.

        // Look up referrer by referral_code
        const { data: referrerProfile, error: referrerError } =
          await adminClient
            .from('profiles')
            .select('id')
            .eq('referral_code', referralCode)
            .single()

        if (!referrerError && referrerProfile) {
          // Self-referral prevention: DB has CHECK (referrer_id != referee_id) as hard guard.
          // This application-level check gives a clean log instead of a swallowed DB error.
          if (referrerProfile.id === user.id) {
            console.warn(`Self-referral attempt blocked for user ${user.id}`)
            // Do not create referral row. Continue to dashboard normally.
          } else {
            // Get country and VPN detection
            const countryCode = getCountryFromIp(ip)
            const vpnDetected = isVpnDetected(ip)

            // Calculate lock period with trust-tier-based reduction for the referrer.
            // New users (STANDARD tier) get baseLockDays unchanged — no regression.
            const baseLockDays = getLockPeriodDays(countryCode, vpnDetected)
            let lockPeriodDays = baseLockDays
            try {
              lockPeriodDays = await getDynamicLockPeriodDays(adminClient, referrerProfile.id as string, baseLockDays)
            } catch {
              // Fail open: use base lock period if trust lookup fails
            }

            // Atomic honeymoon check + referral insert via RPC.
            // Advisory lock prevents TOCTOU race on concurrent signups.
            const { data: honeymoonResult, error: honeymoonError } =
              await adminClient.rpc('create_referral_with_honeymoon', {
                p_referrer_id: referrerProfile.id,
                p_referee_id: user.id,
                p_referral_code: referralCode,
                p_lock_period_days: lockPeriodDays,
                p_country_code: countryCode,
              })

            if (honeymoonError) {
              console.error('Honeymoon referral insert failed:', honeymoonError)
              // Fail open: insert referral directly without honeymoon check.
              // A connection blip or lock timeout should not silently drop the referral.
              const payoutEligibleAt = new Date()
              payoutEligibleAt.setDate(payoutEligibleAt.getDate() + lockPeriodDays)
              const { error: fallbackError } = await adminClient
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
              if (fallbackError) {
                console.error('Fallback referral insert also failed:', fallbackError)
              }
            } else if (honeymoonResult && !honeymoonResult.created) {
              console.log(
                `Referral honeymoon: referrer ${referrerProfile.id} blocked until ${honeymoonResult.unlocks_at}`
              )
            }
          }
        }
      }

      // Award signup bonus on initial email verification only
      const { data: gameConfig, error: configError } = await adminClient
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
              // Log but do not throw — email_preferences must still be created.
              // A transient bonus failure should not leave the user without email prefs.
              console.error('Failed to award signup bonus (non-duplicate error):', error)
            }
        }
      }

      // VIP trust score initialization
      // If the user is_vip (set by admin or influencer code), give +300 trust score
      // to bring them from default 200 to 500 (TRUSTED tier).
      // Reuses isVip fetched above to avoid a redundant DB query.
      if (isVip) {
        try {
          // Check idempotency: partial unique index on (user_id, reason) WHERE reason = 'vip_signup_bonus'
          // prevents duplicates at DB level. Application-level check avoids unnecessary RPC call.
          const { data: existingBonus } = await adminClient
            .from('trust_score_events')
            .select('id')
            .eq('user_id', user.id)
            .eq('reason', 'vip_signup_bonus')
            .limit(1)
            .maybeSingle()

          if (!existingBonus) {
            await adjustTrustScore(adminClient, user.id, 300, 'vip_signup_bonus')
          }
        } catch (vipErr) {
          console.error('VIP trust score initialization error:', vipErr)
          // Do not block signup flow
        }
      }

      // Create email preferences row for new user (required by triggerE1-E4)
      await createEmailPreferences(user.id)
      // Uses the canonical utility from packages/api/src/email.ts.
      // Errors are handled inside the utility — no try/catch needed here.
    } catch (err) {
      console.error('Signup flow error:', err)
      // Don't block login on referral/bonus errors
    }
  }

  // Success — redirect to dashboard
  return NextResponse.redirect(`${requestUrl.origin}/dashboard`)
}
