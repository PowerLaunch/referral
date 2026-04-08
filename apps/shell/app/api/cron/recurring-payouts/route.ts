// Monthly cron: awards $1 CASH_BALANCE to referrers for each active referee.
// Runs on the 1st of each month at 03:00 UTC.
// Uses recurring_reward_logs with UNIQUE(referral_id, reward_month) to prevent
// double-awarding if the cron runs multiple times.
//
// $1 = 100 credit units (100 credits = $1 per spec exchange rate).

import { NextRequest } from 'next/server'
// Uses getAdminClient() from @referral/api/credits so all DB operations in this
// cron (log insert, credit award, log delete) share the same client instance.
import { getAdminClient, awardCredits } from '@referral/api/credits'

const MAX_RECURRING_STANDARD = 15 // spec Section 2.9
// TODO PR 7-G: Check influencer_codes for custom caps. For now, use 15 for all.

const RECURRING_REWARD_AMOUNT = 100 // 100 credit units = $1 (100 credits = $1)

export async function GET(request: NextRequest): Promise<Response> {
  // Step 1 — Auth
  // Vercel Cron sends Authorization: Bearer {CRON_SECRET} — not x-cron-secret.
  const authHeader = request.headers.get('authorization')
  const cronSecret = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    console.error('CRON_SECRET not configured')
    return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (cronSecret !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Step 1b — Kill switch check
  const adminClientForConfig = getAdminClient()
  const { data: gameConfig } = await adminClientForConfig
    .from('game_config')
    .select('cashouts_paused')
    .limit(1)
    .single()

  if (gameConfig?.cashouts_paused) {
    console.log('Payouts paused by admin kill switch — exiting')
    return Response.json({
      ok: true,
      message: 'Payouts paused by admin kill switch',
      rewardMonth: null,
      awarded: 0,
      skipped: 0,
      errors: 0,
    })
  }

  // Step 2 — Calculate reward month (the month that just ended)
  const now = new Date()
  // rewardMonth is the month that just ended (prior to cron run).
  // Cron schedule: 0 3 1 * * (03:00 UTC on 1st of month).
  // Clock skew risk is negligible — Vercel Cron variance is seconds, not hours.
  // If this ever runs on wrong day, the recurring_reward_logs UNIQUE constraint
  // prevents double-awarding and the next run self-corrects.
  const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const rewardMonth = `${priorMonth.getUTCFullYear()}-${String(priorMonth.getUTCMonth() + 1).padStart(2, '0')}`
  // e.g. cron runs 2026-04-01 → rewardMonth = '2026-03'
  // Date.UTC handles January correctly: month -1 wraps to December of prior year.

  const adminClient = getAdminClient()

  // Step 3 — Find eligible referrals
  // Referral must be CONFIRMED, referee must have active subscription,
  // and referrer must have active subscription (spec: referrer must be subscribed).
  // Only referrals confirmed before the start of the current month are eligible.
  // A referral confirmed on April 1 must not receive March recurring reward.
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const currentMonthStartISO = currentMonthStart.toISOString()

  const { data: eligibleReferrals, error: referralsError } = await adminClient
    .from('referrals')
    .select(`
      id,
      referrer_id,
      referee_id,
      created_at
    `)
    .eq('status', 'CONFIRMED')
    .lt('confirmed_at', currentMonthStartISO)
    .limit(10000)
  // Same rationale — explicit limit prevents silent truncation at scale.
  // TODO Phase 8: Replace with cursor-based pagination for datasets > 10000 rows.

  if (referralsError) {
    console.error('Failed to fetch confirmed referrals:', referralsError)
    return Response.json(
      { error: 'Failed to fetch referrals' },
      { status: 500 }
    )
  }

  if (!eligibleReferrals || eligibleReferrals.length === 0) {
    return Response.json({ rewardMonth, awarded: 0, skipped: 0, errors: 0 })
  }

  // Single set covers both roles — a user must have active subscription
  // whether they are referrer or referee.
  const activeUserIds = new Set<string>()

  const { data: activeSubs, error: subsError } = await adminClient
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .limit(10000)
  // Explicit limit above PostgREST default (1000) to prevent silent truncation.
  // Revisit with cursor-based pagination when subscriber count approaches 10000.
  // TODO Phase 8: Replace with cursor-based pagination for datasets > 10000 rows.

  if (subsError) {
    console.error('Failed to fetch active subscriptions:', subsError)
    return Response.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    )
  }

  for (const sub of activeSubs ?? []) {
    activeUserIds.add(sub.user_id as string)
  }

  const fullyEligible = eligibleReferrals.filter(
    (r) =>
      activeUserIds.has(r.referee_id as string) &&
      activeUserIds.has(r.referrer_id as string)
  )

  // Step 4 — Apply recurring cap per referrer (max 15 active recurring referrals)
  // Group by referrer_id, sort each group by created_at ascending (oldest first),
  // then cap at MAX_RECURRING_STANDARD per referrer.
  const referralsByReferrer = new Map<
    string,
    Array<{ id: string; referrer_id: string; created_at: string }>
  >()

  for (const r of fullyEligible) {
    const referrerId = r.referrer_id as string
    if (!referralsByReferrer.has(referrerId)) {
      referralsByReferrer.set(referrerId, [])
    }
    referralsByReferrer.get(referrerId)!.push({
      id: r.id as string,
      referrer_id: referrerId,
      created_at: r.created_at as string,
    })
  }

  const cappedReferrals: Array<{ referralId: string; referrerId: string }> = []

  for (const [referrerId, referrals] of referralsByReferrer) {
    // Sort oldest first so the first 15 by creation date are used
    const sorted = referrals.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const capped = sorted.slice(0, MAX_RECURRING_STANDARD)
    for (const r of capped) {
      cappedReferrals.push({ referralId: r.id, referrerId })
    }
  }

  // Step 5 — Award recurring rewards
  let awarded = 0
  let skipped = 0
  let errors = 0

  for (const { referralId, referrerId } of cappedReferrals) {
    try {
      // Attempt to insert into recurring_reward_logs.
      // If UNIQUE violation on (referral_id, reward_month): already awarded this month.
      const { error: logError } = await adminClient
        .from('recurring_reward_logs')
        .insert({
          referral_id: referralId,
          referrer_id: referrerId,
          reward_month: rewardMonth,
          amount: RECURRING_REWARD_AMOUNT,
        })

      if (logError) {
        // Check if it's a UNIQUE violation (duplicate detection)
        if (logError.code === '23505') {
          // Already awarded this month — skip silently
          skipped++
          continue
        }
        // Other error — log and continue
        console.error(
          `Log insert failed for referral ${referralId}:`,
          logError.message
        )
        errors++
        continue
      }

      // Log insert succeeded — this is the first time processing this referral this month.
      // Now award the credits.
      // The insert-then-award order means: if awardCredits fails after the log insert
      // succeeds, the log row exists but no credit was given. This is the SAFE direction
      // — the admin can manually reconcile. The unsafe direction (award-then-log) could
      // double-pay if the log insert fails.
      let creditAwarded = false
      try {
        await awardCredits(
          referrerId,
          RECURRING_REWARD_AMOUNT,
          'CASH_BALANCE',
          `recurring_reward:${referralId}:${rewardMonth}`
        )
        creditAwarded = true
      } catch (creditErr) {
        console.error(`awardCredits failed for referral ${referralId}:`, creditErr)
        // Remove log row so next cron run can retry this referral this month.
        const { error: deleteError } = await adminClient
          .from('recurring_reward_logs')
          .delete()
          .eq('referral_id', referralId)
          .eq('reward_month', rewardMonth)

        if (deleteError) {
          console.error(
            `CRITICAL: Failed to remove recurring_reward_log for referral ${referralId} ` +
            `month ${rewardMonth}. Admin must manually delete to unblock retry:`,
            deleteError.message
          )
        }
        errors++
      }

      if (creditAwarded) {
        // Includes referral ID so each ledger entry is traceable to its source referral.
        // Pattern matches recurring_reward_logs dedup key for auditability.
        awarded++
      }
    } catch (err) {
      console.error(
        `Error processing recurring reward for referral ${referralId}:`,
        err
      )
      errors++
      // Do not abort batch
    }
  }

  // Step 6 — Return summary
  return Response.json({ rewardMonth, awarded, skipped, errors })
}
