// Monthly cron: awards $1 CASH_BALANCE to referrers for each active referee.
// Runs on the 1st of each month at 03:00 UTC.
// Uses recurring_reward_logs with UNIQUE(referral_id, reward_month) to prevent
// double-awarding if the cron runs multiple times.
//
// $1 = 100 credit units (100 credits = $1 per spec exchange rate).

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { awardCredits } from '@referral/api/credits'

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

  // Step 2 — Calculate current reward month
  const now = new Date()
  // Reward month is based on UTC date when cron runs.
  const rewardMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const adminClient = createAdminClient()

  // Step 3 — Find eligible referrals
  // Referral must be CONFIRMED, referee must have active subscription,
  // and referrer must have active subscription (spec: referrer must be subscribed).
  const { data: eligibleReferrals, error: referralsError } = await adminClient
    .from('referrals')
    .select(`
      id,
      referrer_id,
      referee_id,
      created_at
    `)
    .eq('status', 'CONFIRMED')

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
      await awardCredits(
        referrerId,
        RECURRING_REWARD_AMOUNT,
        'CASH_BALANCE',
        `recurring_reward_${rewardMonth}`
      )
      awarded++
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
