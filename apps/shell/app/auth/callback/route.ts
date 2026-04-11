import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import {
  getLockPeriodDays,
  getCountryFromIp,
} from '@referral/api/lockPeriod'
import { awardCredits } from '@referral/api/credits'
import { createEmailPreferences } from '@referral/api/email'
import { adjustTrustScore, getDynamicLockPeriodDays } from '@referral/api/trustScore'
import { recordAndClassifyIp } from '@referral/api/ipClassification'
import { classifyReferralSource } from '@referral/api/sourceClassification'

export async function GET(request: NextRequest) {
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

      // IP infrastructure classification — record and penalize datacenter/VPN signups.
      // ipResult is reused below for vpnDetected to avoid calling classifyIp() twice.
      let vpnDetected = false
      try {
        const ipResult = await recordAndClassifyIp(adminClient, user.id, ip, 'SIGNUP')
        vpnDetected = ipResult.classification === 'VPN_PROXY' || ipResult.classification === 'DATACENTER'

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

        // Look up referrer by referral_code (include is_honeypot for trap detection)
        const { data: referrerProfile, error: referrerError } =
          await adminClient
            .from('profiles')
            .select('id, is_honeypot')
            .eq('referral_code', referralCode)
            .single()

        if (!referrerError && referrerProfile) {
          // Self-referral prevention: DB has CHECK (referrer_id != referee_id) as hard guard.
          // This application-level check gives a clean log instead of a swallowed DB error.
          if (referrerProfile.id === user.id) {
            console.warn(`Self-referral attempt blocked for user ${user.id}`)
            // Do not create referral row. Continue to dashboard normally.
          } else {
            // Get country code (stub returns null → defaults to 60-day high-risk tier)
            const countryCode = getCountryFromIp(ip)

            // Calculate lock period with trust-tier-based reduction for the referrer.
            // vpnDetected is derived from the single recordAndClassifyIp() call above.
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

            // Source attribution: read from httpOnly cookie set by /ref/[code] route
            // Cookie is not client-readable or forgeable — server-side capture of Referer header
            const rawSource = request.cookies.get('__ref_src')?.value ?? null
            const { source: referralSource, classification: sourceClassification } =
              await classifyReferralSource(adminClient, rawSource)

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
                  referral_source: referralSource,
                  source_classification: sourceClassification,
                })
              if (fallbackError) {
                console.error('Fallback referral insert also failed:', fallbackError)
              }
            } else if (honeymoonResult && !honeymoonResult.created) {
              console.log(
                `Referral honeymoon: referrer ${referrerProfile.id} blocked until ${honeymoonResult.unlocks_at}`
              )
            }

            // Update source attribution on honeymoon-created referral row
            if (!honeymoonError && honeymoonResult?.created) {
              const { error: sourceUpdateError } = await adminClient
                .from('referrals')
                .update({
                  referral_source: referralSource,
                  source_classification: sourceClassification,
                })
                .eq('referee_id', user.id)

              if (sourceUpdateError) {
                console.error('Failed to update referral source:', sourceUpdateError.message)
              }
            }

            // --- Honeypot detection ---
            // If the referrer is a honeypot account, the new referee is flagged.
            // The referral row is still created (to preserve evidence) but will never confirm.
            if (referrerProfile.is_honeypot) {
              try {
                const honeypotSeverity = isVip ? 'INFO' : 'CRITICAL'
                const { error: flagInsertError } = await adminClient.from('fraud_flags').insert({
                  user_id: user.id,
                  rule_triggered: 'R_HONEYPOT',
                  severity: honeypotSeverity,
                  details: {
                    honeypot_code: referralCode,
                    honeypot_profile_id: referrerProfile.id,
                  },
                })
                if (flagInsertError && flagInsertError.code !== '23505') {
                  console.error(`Honeypot fraud_flag insert failed for user ${user.id}:`, flagInsertError)
                }

                try {
                  await adjustTrustScore(adminClient, user.id, -200, 'honeypot_signup', 'R_HONEYPOT')
                } catch (e: unknown) {
                  if ((e as { code?: string }).code !== '23505') {
                    console.error(`Honeypot trust adjustment failed for user ${user.id}:`, e)
                  }
                }

                if (isVip) {
                  try {
                    await adminClient.from('admin_audit_logs').insert({
                      admin_user_id: null,
                      action: 'vip_honeypot_exception',
                      target_type: 'profile',
                      target_id: user.id,
                      details: {
                        honeypot_code: referralCode,
                        honeypot_profile_id: referrerProfile.id,
                        severity_downgrade: 'CRITICAL → INFO',
                      },
                    })
                  } catch (auditErr) {
                    console.error('VIP honeypot audit log failed:', auditErr)
                  }
                }
              } catch (honeypotErr) {
                console.error(`Honeypot detection error for user ${user.id}:`, honeypotErr)
              }
            }

            // Canary detection is NOT done here because canary accounts are created
            // by the admin API (not via normal signup), so user.id in this callback
            // always belongs to a real user — never a canary. Canary detection happens
            // in the confirm-referrals cron where referral rows with canary referees
            // are detected and the referrer is flagged.
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

      // Signup telemetry: store client-side timing signals and apply trust adjustments
      try {
        const rawTelemetry = user.user_metadata?.signup_telemetry as string | null
        if (rawTelemetry) {
          const telemetry = JSON.parse(rawTelemetry) as {
            link_click_at: string | null
            signup_submit_at: string | null
            form_fill_ms: number
            input_corrections: number
          }

          // Write telemetry to profiles.signup_telemetry — non-critical, log and continue on failure
          const { error: telemetryWriteError } = await adminClient
            .from('profiles')
            .update({ signup_telemetry: telemetry })
            .eq('id', user.id)
          if (telemetryWriteError) {
            console.error('Failed to write signup telemetry:', telemetryWriteError)
          }

          // Trust adjustments — soft signals only, never block signup.
          // Each adjustment is idempotency-guarded: check trust_score_events before calling RPC.
          const submitTime = telemetry.signup_submit_at ? new Date(telemetry.signup_submit_at).getTime() : null
          const clickTime = telemetry.link_click_at ? new Date(telemetry.link_click_at).getTime() : null

          // Batch-fetch existing telemetry trust events for this user to avoid N+1 queries
          const telemetryReasons = ['fast_signup', 'fast_form_fill', 'no_corrections_signup'] as const
          const { data: existingTelemetryEvents } = await adminClient
            .from('trust_score_events')
            .select('reason')
            .eq('user_id', user.id)
            .in('reason', [...telemetryReasons])
          const appliedReasons = new Set(existingTelemetryEvents?.map((e) => e.reason) ?? [])

          const signupDeltaMs = (clickTime !== null && submitTime !== null) ? submitTime - clickTime : null

          if (signupDeltaMs !== null && signupDeltaMs >= 0 && signupDeltaMs < 10_000) {
            if (!appliedReasons.has('fast_signup')) {
              try {
                await adjustTrustScore(adminClient, user.id, -40, 'fast_signup')
              } catch (e: unknown) {
                if ((e as { code?: string }).code !== '23505') throw e
              }
            }
          }

          if ((telemetry.form_fill_ms ?? 0) < 5000 && (telemetry.form_fill_ms ?? 0) > 0) {
            if (!appliedReasons.has('fast_form_fill')) {
              try {
                await adjustTrustScore(adminClient, user.id, -30, 'fast_form_fill')
              } catch (e: unknown) {
                if ((e as { code?: string }).code !== '23505') throw e
              }
            }
          }

          // Reduced from -15 to -5 (BugBot round 4) — original value pushed all accurate typists below PROBATION threshold
          if ((telemetry.input_corrections ?? 0) === 0) {
            if (!appliedReasons.has('no_corrections_signup')) {
              try {
                await adjustTrustScore(adminClient, user.id, -5, 'no_corrections_signup')
              } catch (e: unknown) {
                if ((e as { code?: string }).code !== '23505') throw e
              }
            }
          }
        }
      } catch (telemetryErr) {
        console.error('Signup telemetry processing error:', telemetryErr)
        // Do not block signup flow
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
  const response = NextResponse.redirect(`${requestUrl.origin}/dashboard`)

  // Delete the __ref_src cookie after consuming it
  response.cookies.set('__ref_src', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return response
}
