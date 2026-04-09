// Daily cron: confirms PENDING referrals that meet all criteria.
// Runs at 02:00 UTC via Vercel Cron. Protected by authorization Bearer token.
// Each referral is processed independently — one failure does not abort the batch.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { triggerE2 } from '@referral/api/email'
import { getUserRiskScore, getRiskCategory } from '@referral/api/riskScore'

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
    .select('min_gameplay_minutes, min_session_count, monthly_referral_cap, referral_confirmations_paused')
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
  const minSessionCount = gameConfig?.min_session_count ?? 3
  const monthlyReferralCap = gameConfig?.monthly_referral_cap ?? 50

  // Circuit breaker check: if referral confirmations are paused, exit early
  if (gameConfig?.referral_confirmations_paused) {
    console.log('Referral confirmations paused by circuit breaker — exiting')
    return Response.json({
      ok: true,
      message: 'Paused by circuit breaker',
      processed: 0,
      confirmed: 0,
      skipped: 0,
      errors: 0,
    })
  }

  // Step 3 — Fetch eligible referrals
  // Batch 1: standard referrals past lock period
  const { data: standardReferrals, error: standardError } = await adminClient
    .from('referrals')
    .select('*')
    .eq('status', 'PENDING')
    .lte('payout_eligible_at', new Date().toISOString())
    .eq('lock_timer_frozen', false)
    .limit(10000)
  // Explicit limit above PostgREST default (1000) to prevent silent truncation.
  // TODO Phase 8: Replace with cursor-based pagination for datasets > 10000 rows.

  if (standardError) {
    console.error('Failed to fetch pending referrals:', standardError)
    return Response.json(
      { error: 'Failed to fetch pending referrals' },
      { status: 500 }
    )
  }

  // Batch 2: influencer referrals that may bypass lock period
  // Join influencer_codes at the DB level to avoid N+1 queries in the loop
  const { data: influencerReferrals, error: influencerError } = await adminClient
    .from('referrals')
    .select('*, influencer_codes!inner(lock_bypass, active)')
    .eq('status', 'PENDING')
    .eq('lock_timer_frozen', false)
    .gt('payout_eligible_at', new Date().toISOString())
    .eq('influencer_codes.lock_bypass', true)
    .eq('influencer_codes.active', true)
    .limit(10000)

  if (influencerError) {
    console.error('Failed to fetch influencer referrals:', influencerError)
    // Non-fatal: continue with standard referrals only
  }

  // Merge and dedup
  const seenIds = new Set<string>()
  const pendingReferrals: typeof standardReferrals = []
  for (const r of [...(standardReferrals ?? []), ...(influencerReferrals ?? [])]) {
    if (!seenIds.has(r.id)) {
      seenIds.add(r.id)
      pendingReferrals.push(r)
    }
  }

  if (pendingReferrals.length === 0) {
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
      // --- Criterion -1: Influencer lock_bypass check ---
      // Influencer lock_bypass: skips payout_eligible_at but enforces all other confirmation criteria
      const lockPeriodPassed = new Date(referral.payout_eligible_at) <= new Date()
      if (!lockPeriodPassed) {
        if (!referral.influencer_code_id) {
          console.log(
            `Referral ${referral.id} skipped: lock period not passed and no influencer code`
          )
          skipped++
          continue
        }

        // lock_bypass + active already verified by Batch 2 DB join
        console.log(
          `Referral ${referral.id}: influencer lock_bypass eligible, checking remaining criteria`
        )
      }

      // --- Criterion 0: Payment collateralization (added in 3-B-patch) ---
      // The referee's subscription payment must be settled and past the
      // 48-hour refund window before any referral can confirm against it.

      if (referral.payment_event_id) {
        // Payment event is linked — verify it's settled
        const { data: paymentEvent, error: paymentError } = await adminClient
          .from('payment_events')
          .select('status, created_at')
          .eq('id', referral.payment_event_id)
          .single()

        if (paymentError || !paymentEvent) {
          console.log(
            `Referral ${referral.id} skipped: payment_event lookup failed`
          )
          skipped++
          continue
        }

        if (paymentEvent.status !== 'COMPLETED') {
          console.log(
            `Referral ${referral.id} skipped: payment_not_settled ` +
              `(status: ${paymentEvent.status})`
          )
          skipped++
          continue
        }

        // Check 48-hour refund window
        const paymentAge =
          Date.now() - new Date(paymentEvent.created_at).getTime()
        const REFUND_WINDOW_MS = 48 * 60 * 60 * 1000 // 48 hours in ms

        if (paymentAge < REFUND_WINDOW_MS) {
          const hoursRemaining = Math.ceil(
            (REFUND_WINDOW_MS - paymentAge) / (60 * 60 * 1000)
          )
          console.log(
            `Referral ${referral.id} skipped: payment_refund_window_open ` +
              `(${hoursRemaining}h remaining)`
          )
          skipped++
          continue
        }
      } else {
        // No payment_event_id linked yet.
        // This happens for referrals created before PR 5-A (payment integration).
        // Two options:
        //   A) Skip confirmation until payment is linked (strict)
        //   B) Allow confirmation without payment collateral (lenient, for pre-payment PRs)
        //
        // During development (before PR 5-A), use option B so the confirmation cron
        // can be tested without real payments. After PR 5-A, switch to option A.
        //
        // For now: allow through with a warning log.
        // TODO PR 5-A: Change this to skip confirmation when payment_event_id is null.
        console.log(
          `Referral ${referral.id}: no payment_event_id linked. ` +
            `Proceeding without payment collateral (pre-PR-5-A behavior).`
        )
      }

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

      // c) Check referee gameplay time and session diversity
      const { data: gameplayData, error: gameplayError } = await adminClient
        .from('gameplay_sessions')
        .select('total_minutes, session_count')
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

      // c2) Check referee session diversity
      const sessionCount = gameplayData?.session_count ?? 0
      if (sessionCount < minSessionCount) {
        console.log(
          `Referral ${referral.id} skipped: insufficient_sessions: ${sessionCount}/${minSessionCount} sessions`
        )
        skipped++
        continue
      }

      // d) Check fraud score (PR 4-D)
      // Get risk score for referee. CRITICAL (100+) and HIGH (61-99) referrals
      // stay PENDING and are re-checked on next cron run. When an admin resolves
      // flags (is_resolved = true in Phase 7), score drops and confirmation proceeds.
      const riskScore = await getUserRiskScore(referral.referee_id)
      const riskCategory = getRiskCategory(riskScore)

      if (riskCategory === 'CRITICAL') {
        console.log(
          `Referral ${referral.id} skipped: Referee risk score CRITICAL (${riskScore})`
        )
        skipped++
        continue
      }

      if (riskCategory === 'HIGH') {
        // HIGH risk (61-99): skip confirmation, leave PENDING for admin review.
        // Do NOT insert a tracking flag — it would inflate the risk score by +10
        // on the next cron run, causing unintended escalation to CRITICAL.
        // The underlying flags that caused the HIGH score are already visible
        // in the admin fraud dashboard.
        console.log(
          `Referral ${referral.id} skipped: Referee risk score HIGH (${riskScore}) — pending review`
        )
        skipped++
        continue
      }

      // e) Check referrer monthly cap
      // CRITICAL: scope to current calendar month using confirmed_at, NOT created_at.
      // A referral created in month N but confirmed in month N+1 should count toward month N+1.
      // Current referral is still PENDING so it's excluded from the cap count.
      const now = new Date()
      const startOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      )
      const startOfNextMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
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

      if ((confirmedCount ?? 0) >= monthlyReferralCap) {
        console.log(
          `Referral ${referral.id} skipped: Referrer monthly cap reached (${monthlyReferralCap}/month)`
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

      // Credit award removed from cron — now handled atomically inside
      // confirm_referral RPC to prevent race condition with voidPendingCredits.
      // The RPC awards $2 CASH_BALANCE (200 credits) atomically with the status
      // change. If the referral is VOIDED between fetch and RPC call, the RPC
      // fails and rolls back both the status change and credit award.
      // See migration 20260404000009_confirm_referral_rpc.sql for details.

      // Confirm the referral atomically (includes credit award inside RPC)
      try {
        const { error: confirmError } = await adminClient.rpc(
          'confirm_referral',
          {
            p_referral_id: referral.id,
          }
        )

        if (confirmError) {
          console.error(
            `Referral ${referral.id}: Confirmation failed:`,
            confirmError
          )
          errors++
          continue
        }
      } catch (confirmError) {
        console.error(
          `Referral ${referral.id}: Confirmation failed:`,
          confirmError
        )
        errors++
        continue
      }

      // Log influencer lock bypass only on successful confirmation
      if (!lockPeriodPassed && referral.influencer_code_id) {
        await adminClient.from('admin_audit_logs').insert({
          admin_user_id: null,
          action: 'INFLUENCER_LOCK_BYPASS',
          target_type: 'referral',
          target_id: referral.id,
          details: { influencer_code_id: referral.influencer_code_id },
        })
        console.log(
          `Referral ${referral.id}: influencer lock_bypass applied`
        )
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
