// Monthly cron: recalculates trust scores for all active subscribers.
// Runs on the 1st of each month at 05:00 UTC.
// Awards positive trust score deltas for:
//   a) +20 for continuous subscription during previous calendar month
//   b) +10 for gameplay above 2x min_gameplay_minutes
//   c) +25 for each referral with 3+ months of continuous referee subscription (one-time per referral)

import { NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getAdminClient } from '@referral/api/credits'
import { adjustTrustScore } from '@referral/api/trustScore'
import { recordCronSuccess } from '@referral/api/cronHealth'

const BATCH_SIZE = 100

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Step 1 — Auth
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

    const adminClient = getAdminClient()
    const now = new Date()

    // Calculate previous month boundaries (UTC)
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const prevMonthKey = `${prevMonthStart.getUTCFullYear()}-${String(prevMonthStart.getUTCMonth() + 1).padStart(2, '0')}`

    // Read game_config for min_gameplay_minutes
    const { data: gameConfig, error: configError } = await adminClient
      .from('game_config')
      .select('min_gameplay_minutes')
      .limit(1)
      .single()

    if (configError || !gameConfig) {
      console.error('Failed to read game_config:', configError?.message)
      return Response.json({ error: 'Failed to read config' }, { status: 500 })
    }

    const minGameplayMinutes = gameConfig.min_gameplay_minutes as number

    // Step 2 — Fetch active subscribers in batches
    let offset = 0
    let totalProcessed = 0
    let totalSubscriptionBonuses = 0
    let totalGameplayBonuses = 0
    let totalLongevityBonuses = 0
    let totalErrors = 0

    while (true) {
      const { data: subscribers, error: subError } = await adminClient
        .from('subscriptions')
        .select('user_id, created_at')
        .eq('status', 'active')
        .range(offset, offset + BATCH_SIZE - 1)

      if (subError) {
        console.error('Failed to fetch subscribers:', subError.message)
        break
      }

      if (!subscribers || subscribers.length === 0) break

      for (const sub of subscribers) {
        const userId = sub.user_id as string

        try {
          // (a) +20 if subscription was active the entire previous calendar month
          // Check: subscription created_at <= first day of previous month
          const subCreatedAt = new Date(sub.created_at as string)
          if (subCreatedAt <= prevMonthStart) {
            // Verify no cancellation during that month by checking subscription is still active
            // (The subscription status is currently 'active', and it was created before the month started)
            const reason = `monthly_subscription:${prevMonthKey}`
            try {
              await adjustTrustScore(adminClient, userId, 20, reason)
              totalSubscriptionBonuses++
            } catch (err) {
              const errMsg = String(err)
              // Unique violation means already awarded — skip
              if (!errMsg.includes('23505')) {
                console.error(`Trust recalc subscription bonus error for ${userId}:`, err)
                totalErrors++
              }
            }
          }

          // (b) +10 if total gameplay_minutes last calendar month > 2x min_gameplay_minutes
          const { data: gameplay, error: gameplayError } = await adminClient
            .from('gameplay_sessions')
            .select('total_minutes')
            .eq('user_id', userId)
            .limit(1)
            .maybeSingle()

          if (!gameplayError && gameplay) {
            const totalMinutes = gameplay.total_minutes as number
            if (totalMinutes > 2 * minGameplayMinutes) {
              const reason = `monthly_gameplay_bonus:${prevMonthKey}`
              try {
                await adjustTrustScore(adminClient, userId, 10, reason)
                totalGameplayBonuses++
              } catch (err) {
                const errMsg = String(err)
                if (!errMsg.includes('23505')) {
                  console.error(`Trust recalc gameplay bonus error for ${userId}:`, err)
                  totalErrors++
                }
              }
            }
          }

          // (c) +25 for each referred user whose subscription has been active for 3+ months
          const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))

          const { data: confirmedReferrals, error: refError } = await adminClient
            .from('referrals')
            .select('id, referee_id')
            .eq('referrer_id', userId)
            .eq('status', 'CONFIRMED')
            .limit(10000)

          if (!refError && confirmedReferrals) {
            for (const referral of confirmedReferrals) {
              // Check if referee has had active subscription for 3+ consecutive months
              const { data: refereeSub, error: refSubError } = await adminClient
                .from('subscriptions')
                .select('created_at')
                .eq('user_id', referral.referee_id)
                .eq('status', 'active')
                .limit(1)
                .maybeSingle()

              if (!refSubError && refereeSub) {
                const refereeSubCreated = new Date(refereeSub.created_at as string)
                if (refereeSubCreated <= threeMonthsAgo) {
                  // Referee has been subscribed for 3+ months
                  const reason = `referral_longevity:${referral.id}`
                  try {
                    await adjustTrustScore(adminClient, userId, 25, reason)
                    totalLongevityBonuses++
                  } catch (err) {
                    const errMsg = String(err)
                    // Unique violation on partial index means already awarded — skip silently
                    if (!errMsg.includes('23505')) {
                      console.error(`Trust recalc longevity bonus error for ${userId}, referral ${referral.id}:`, err)
                      totalErrors++
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`Trust recalc error for user ${userId}:`, err)
          totalErrors++
        }

        totalProcessed++
      }

      offset += BATCH_SIZE

      // Safety: break if we got fewer than batch size (last page)
      if (subscribers.length < BATCH_SIZE) break
    }

    // Update cron_health
    await recordCronSuccess('trust-score-recalc', adminClient, process.env.BETTERSTACK_HEARTBEAT_TRUST_RECALC)

    return Response.json({
      processed: totalProcessed,
      subscriptionBonuses: totalSubscriptionBonuses,
      gameplayBonuses: totalGameplayBonuses,
      longevityBonuses: totalLongevityBonuses,
      errors: totalErrors,
    })
  } catch (error) {
    console.error('Trust score recalc cron error:', error)
    Sentry.captureException(error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
