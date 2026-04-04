// Daily cron: confirms PENDING referrals that meet all criteria.
// Runs at 02:00 UTC via Vercel Cron. Protected by authorization Bearer token.
// Each referral is processed independently — one failure does not abort the batch.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { awardCredits } from '@referral/api/credits'
import { triggerE2 } from '@referral/api/email'

export async function GET(request: NextRequest): Promise<Response> {
  // Step 1 — Auth check
  const authHeader = request.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    console.error('CRON_SECRET not configured')
    return Response.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    )
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    console.error('Unauthorized cron attempt')
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  // Step 2 — Read game config
  // Read at runtime, never hardcode — spec Section 2.1
  const { data: gameConfig, error: configError } = await adminClient
    .from('game_config')
    .select('min_gameplay_minutes')
    .limit(1)
    .single()

  if (configError) {
    console.error('Failed to read game_config:', configError)
    return Response.json(
      { error: 'Failed to read game_config' },
      { status: 500 }
    )
  }

  const minGameplayMinutes = gameConfig?.min_gameplay_minutes ?? 10

  // Step 3 — Fetch eligible referrals
  const { data: pendingReferrals, error: referralsError } = await adminClient
    .from('referrals')
    .select('*')
    .eq('status', 'PENDING')
    .lte('payout_eligible_at', new Date().toISOString())
    .eq('lock_timer_frozen', false)

  if (referralsError) {
    console.error('Failed to fetch pending referrals:', referralsError)
    return Response.json(
      { error: 'Failed to fetch pending referrals' },
      { status: 500 }
    )
  }

  if (!pendingReferrals || pendingReferrals.length === 0) {
    return Response.json({
      processed: 0,
      confirmed: 0,
      skipped: 0,
      errors: 0,
    })
  }

  // Step 4 — Process each referral independently
  let confirmed = 0
  let skipped = 0
  let errors = 0

  for (const referral of pendingReferrals) {
    try {
      // a) Check referee email verified
      // Check how email verification status is stored in your schema
      // Using Supabase auth.admin.getUserById to check email_confirmed_at
      const { data: refereeUser, error: refereeUserError } =
        await adminClient.auth.admin.getUserById(referral.referee_id)

      if (refereeUserError || !refereeUser) {
        console.log(
          `Referral ${referral.id} skipped: Failed to fetch referee user`
        )
        skipped++
        continue
      }

      if (!refereeUser.user.email_confirmed_at) {
        console.log(
          `Referral ${referral.id} skipped: Referee email not verified`
        )
        skipped++
        continue
      }

      // b) Check referee has active subscription
      const { data: refereeSubscription, error: refereeSubError } =
        await adminClient
          .from('subscriptions')
          .select('status')
          .eq('user_id', referral.referee_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()

      if (refereeSubError) {
        console.error(
          `Referral ${referral.id}: Failed to check referee subscription:`,
          refereeSubError
        )
        errors++
        continue
      }

      if (!refereeSubscription) {
        console.log(
          `Referral ${referral.id} skipped: Referee subscription not active`
        )
        skipped++
        continue
      }

      // c) Check referee gameplay time
      const { data: gameplayData, error: gameplayError } = await adminClient
        .from('gameplay_sessions')
        .select('total_minutes')
        .eq('user_id', referral.referee_id)
        .maybeSingle()

      if (gameplayError) {
        console.error(
          `Referral ${referral.id}: Failed to check gameplay:`,
          gameplayError
        )
        errors++
        continue
      }

      const totalMinutes = gameplayData?.total_minutes ?? 0
      if (totalMinutes < minGameplayMinutes) {
        console.log(
          `Referral ${referral.id} skipped: Referee gameplay insufficient: ${totalMinutes}/${minGameplayMinutes} minutes`
        )
        skipped++
        continue
      }

      // d) Check fraud flags (STUB)
      // TODO: wire to fraud engine in PR 4-D. Check getUserRiskScore() >= 100.
      const fraudCheckPassed = true
      // For now, always passes. Remove this stub in Phase 4.

      if (!fraudCheckPassed) {
        console.log(`Referral ${referral.id} skipped: Fraud check failed`)
        skipped++
        continue
      }

      // e) Check referrer monthly cap
      // CRITICAL: scope to current calendar month using confirmed_at, NOT created_at.
      // A referral created in month N but confirmed in month N+1 should count toward month N+1.
      // Current referral is still PENDING so it's excluded from the cap count.
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)

      const startOfNextMonth = new Date(
        startOfMonth.getFullYear(),
        startOfMonth.getMonth() + 1,
        1
      )

      const { count: confirmedCount, error: capError } = await adminClient
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', referral.referrer_id)
        .eq('status', 'CONFIRMED')
        .gte('confirmed_at', startOfMonth.toISOString())
        .lt('confirmed_at', startOfNextMonth.toISOString())

      if (capError) {
        console.error(
          `Referral ${referral.id}: Failed to check monthly cap:`,
          capError
        )
        errors++
        continue
      }

      if ((confirmedCount ?? 0) >= 50) {
        console.log(
          `Referral ${referral.id} skipped: Referrer monthly cap reached (50/month)`
        )
        skipped++
        continue
      }

      // f) Check referrer has active subscription
      const { data: referrerSubscription, error: referrerSubError } =
        await adminClient
          .from('subscriptions')
          .select('status')
          .eq('user_id', referral.referrer_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()

      if (referrerSubError) {
        console.error(
          `Referral ${referral.id}: Failed to check referrer subscription:`,
          referrerSubError
        )
        errors++
        continue
      }

      if (!referrerSubscription) {
        console.log(
          `Referral ${referral.id} skipped: Referrer subscription not active`
        )
        skipped++
        continue
      }

      // All checks passed — confirm the referral

      // i) Award credits to referrer
      // $2 one-time payout per spec Section 2.1
      // 100 credits = $1 USD per spec, so $2 = 200 credits
      try {
        await awardCredits(
          referral.referrer_id,
          200,
          'CASH_BALANCE',
          'referral_confirmed'
        )
      } catch (creditError) {
        console.error(
          `Referral ${referral.id}: Failed to award credits:`,
          creditError
        )
        errors++
        continue
      }

      // ii) Confirm the referral atomically
      // TODO: wrap credit award + confirmation in a single
      // transaction in Phase 8 hardening. For now, credit-first is safer
      // than confirm-first (user gets paid even if logging fails).
      try {
        const { error: confirmError } = await adminClient.rpc(
          'confirm_referral',
          {
            p_referral_id: referral.id,
            p_triggered_by: null, // system-triggered, no admin user
          }
        )

        if (confirmError) {
          console.error(
            `CRITICAL: Referral ${referral.id}: Credits awarded but confirmation failed:`,
            confirmError
          )
          errors++
          continue
        }
      } catch (confirmError) {
        console.error(
          `CRITICAL: Referral ${referral.id}: Credits awarded but confirmation failed:`,
          confirmError
        )
        errors++
        continue
      }

      // iii) Fire in-game bonus
      // TODO: wire to game bonus hook. For now, log only.
      console.log(
        `In-game bonus event for referrer ${referral.referrer_id}`
      )

      // iv) Send E2 email
      // triggerE2 handles looking up the referrer's email internally
      // Email failure should NOT block confirmation
      try {
        await triggerE2(referral.referrer_id)
      } catch (emailError) {
        // Email failure is not a confirmation error — just log it
        console.warn(
          `Referral ${referral.id}: Confirmation succeeded but email failed:`,
          emailError
        )
      }

      confirmed++
      console.log(`Referral ${referral.id} confirmed successfully`)
    } catch (error) {
      console.error(`Referral ${referral.id}: Unexpected error:`, error)
      errors++
    }
  }

  // Step 5 — Return summary
  return Response.json({
    processed: pendingReferrals.length,
    confirmed,
    skipped,
    errors,
  })
}
