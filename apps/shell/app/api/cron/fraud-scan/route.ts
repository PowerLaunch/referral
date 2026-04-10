// Fraud scan cron: runs every 15 minutes. Executes R1–R6.
// Each rule runs independently — one failure does not abort others.
// Protected by Authorization: Bearer {CRON_SECRET} header.

import { NextRequest } from 'next/server'
import {
  runR1SpikeDetection,
  runR2DeviceCluster,
  runR3NewAccountVelocity,
  runR4CashoutSpike,
  runR5ZeroGameplay,
  runR6DisposableEmail,
  runGeoMismatch,
} from '@referral/api/fraudRules'
import { recordCronSuccess } from '@referral/api/cronHealth'
import { awardCredits } from '@referral/api/credits'
import { logAdminAction } from '@referral/api/riskScore'
import { adjustTrustScore } from '@referral/api/trustScore'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest): Promise<Response> {
 try {
  // Step 1 — Auth check (matches confirm-referrals pattern)
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

  // Step 2 — Run R1–R6 with per-rule error isolation
  const scannedAt = new Date().toISOString()
  const results: Array<{ rule: string; flagged: number; error?: string }> = []
  let totalFlagged = 0
  let ruleFailures = 0

  // R1: Spike Detection
  try {
    const flagged = await runR1SpikeDetection()
    results.push({ rule: 'R1_SPIKE_DETECTION', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R1_SPIKE_DETECTION', flagged: 0, error: errorMessage })
    console.error('R1 failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  // R2: Device Cluster
  try {
    const flagged = await runR2DeviceCluster()
    results.push({ rule: 'R2_DEVICE_CLUSTER', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R2_DEVICE_CLUSTER', flagged: 0, error: errorMessage })
    console.error('R2 failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  // R3: New Account Velocity
  try {
    const flagged = await runR3NewAccountVelocity()
    results.push({ rule: 'R3_NEW_ACCOUNT_VELOCITY', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R3_NEW_ACCOUNT_VELOCITY', flagged: 0, error: errorMessage })
    console.error('R3 failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  // R4: Cashout Spike
  try {
    const flagged = await runR4CashoutSpike()
    results.push({ rule: 'R4_CASHOUT_SPIKE', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R4_CASHOUT_SPIKE', flagged: 0, error: errorMessage })
    console.error('R4 failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  // R5: Zero Gameplay
  try {
    const flagged = await runR5ZeroGameplay()
    results.push({ rule: 'R5_ZERO_GAMEPLAY', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R5_ZERO_GAMEPLAY', flagged: 0, error: errorMessage })
    console.error('R5 failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  // R6: Disposable Email
  try {
    const flagged = await runR6DisposableEmail()
    results.push({ rule: 'R6_DISPOSABLE_EMAIL', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R6_DISPOSABLE_EMAIL', flagged: 0, error: errorMessage })
    console.error('R6 failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  // Geo-Mismatch
  try {
    const flagged = await runGeoMismatch()
    results.push({ rule: 'R_GEO_MISMATCH', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R_GEO_MISMATCH', flagged: 0, error: errorMessage })
    console.error('GeoMismatch failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  if (ruleFailures > 0) {
    console.error(`fraud-scan completed with ${ruleFailures} rule failures`)
  }

  const adminClient = createAdminClient()

  // R17: Red Source Attribution
  // Flags referrers whose referees consistently come from red-flagged source domains.
  // Standard accounts: 3+ red-source referees → WARNING (-100 trust)
  // VIP accounts: 10+ red-source referees → INFO (-30 trust)
  // One flag per referrer per calendar month.
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: redReferrals, error: redError } = await adminClient
      .from('referrals')
      .select('referrer_id, referral_source')
      .eq('source_classification', 'RED')
      .gte('created_at', thirtyDaysAgo)
      .limit(10000) // prevents silent PostgREST truncation at default 1000-row cap

    if (redError) {
      throw new Error(`Failed to fetch red-source referrals: ${redError.message}`)
    }

    // Group by referrer_id → count + distinct source domains
    const referrerMap = new Map<string, { count: number; domains: Set<string> }>()
    for (const row of redReferrals ?? []) {
      const referrerId = row.referrer_id as string
      if (!referrerMap.has(referrerId)) {
        referrerMap.set(referrerId, { count: 0, domains: new Set() })
      }
      const entry = referrerMap.get(referrerId)!
      entry.count++
      if (row.referral_source) {
        entry.domains.add(row.referral_source as string)
      }
    }

    let r17Flagged = 0
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    const monthStartIso = monthStart.toISOString()

    for (const [referrerId, { count, domains }] of referrerMap) {
      if (count < 3) continue

      // Idempotency: one flag per referrer per calendar month
      const { data: existingFlag } = await adminClient
        .from('fraud_flags')
        .select('id')
        .eq('user_id', referrerId)
        .eq('rule_triggered', 'R17_RED_SOURCE')
        .gte('created_at', monthStartIso)
        .limit(1)
        .maybeSingle()

      if (existingFlag) continue

      // Check VIP status for threshold and severity
      const { data: profile } = await adminClient
        .from('profiles')
        .select('is_vip')
        .eq('id', referrerId)
        .single()

      const isVip = profile?.is_vip === true
      // VIP threshold is 10, standard is 3
      if (isVip && count < 10) continue

      const severity = isVip ? 'INFO' : 'WARNING'
      const trustDelta = isVip ? -30 : -100

      const { error: flagError } = await adminClient
        .from('fraud_flags')
        .insert({
          user_id: referrerId,
          rule_triggered: 'R17_RED_SOURCE',
          severity,
          details: {
            red_source_count: count,
            domains: Array.from(domains),
          },
        })

      if (flagError) {
        if (flagError.code !== '23505') {
          console.error(`R17 flag insert error for ${referrerId}:`, flagError.message)
        }
        continue
      }

      try {
        await adjustTrustScore(adminClient, referrerId, trustDelta, 'fraud_flag_r17_red_source', 'R17_RED_SOURCE')
      } catch (trustErr) {
        console.error(`R17 trust score adjustment error for ${referrerId}:`, trustErr)
      }

      r17Flagged++
    }

    results.push({ rule: 'R17_RED_SOURCE', flagged: r17Flagged })
    totalFlagged += r17Flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R17_RED_SOURCE', flagged: 0, error: errorMessage })
    console.error('R17 failed:', error)
    Sentry.captureException(error)
    ruleFailures++
  }

  // Step 3 — Promote STAGED payouts whose staging window has expired
  // Runs here (every 15 min) instead of monthly recurring-payouts cron so
  // VETERAN payouts (1-hour staging) are promoted promptly.
  let stagedPromoted = 0
  let stagedCancelled = 0

  try {
    const { data: stagedPayouts, error: stagedError } = await adminClient
      .from('payouts')
      .select('id, user_id, amount, is_first_payout, created_at')
      .eq('status', 'STAGED')
      .lte('staged_until', new Date().toISOString())
      .limit(10000)

    if (stagedError) {
      console.error('Failed to fetch staged payouts:', stagedError.message)
    }

    for (const payout of stagedPayouts ?? []) {
      try {
        // Check if user has any NEW fraud_flags created after the payout was created
        const { data: newFlags, error: flagsError } = await adminClient
          .from('fraud_flags')
          .select('id, severity')
          .eq('user_id', payout.user_id)
          .gte('created_at', payout.created_at as string)
          .in('severity', ['WARNING', 'CRITICAL'])
          .limit(1)

        if (flagsError) {
          console.error(`Failed to check fraud flags for staged payout ${payout.id}:`, flagsError.message)
          continue
        }

        if (newFlags && newFlags.length > 0) {
          // New fraud flags detected — cancel payout and refund credits
          // Use .select() to verify a row was actually updated (optimistic lock).
          // If another concurrent cron already cancelled it, cancelledRows will be empty.
          const { data: cancelledRows, error: cancelError } = await adminClient
            .from('payouts')
            .update({ status: 'REJECTED', admin_notes: 'Auto-cancelled: fraud flags detected during staging' })
            .eq('id', payout.id)
            .eq('status', 'STAGED')
            .select('id')

          if (cancelError) {
            console.error(`Failed to cancel staged payout ${payout.id}:`, cancelError.message)
            continue
          }

          if (!cancelledRows || cancelledRows.length === 0) {
            console.log(`Payout ${payout.id} already cancelled by concurrent execution, skipping refund`)
            continue
          }

          // Refund credits — only if we actually cancelled the payout above
          try {
            await awardCredits(
              payout.user_id as string,
              payout.amount as number,
              'CASH_BALANCE',
              `payout_auto_cancelled:${payout.id}`
            )
          } catch (creditErr) {
            console.error(`Failed to refund credits for cancelled payout ${payout.id}:`, creditErr)
          }

          // Audit log
          await logAdminAction({
            adminUserId: null,
            action: 'PAYOUT_AUTO_CANCELLED_FRAUD',
            targetType: 'payout',
            targetId: payout.id as string,
            beforeValue: 'STAGED',
            afterValue: 'REJECTED',
            reason: 'Fraud flags detected during staging window',
          })

          stagedCancelled++
        } else {
          // No new fraud flags — promote to PENDING or PENDING_MANUAL_APPROVAL
          const newStatus = payout.is_first_payout ? 'PENDING_MANUAL_APPROVAL' : 'PENDING'

          const { error: promoteError } = await adminClient
            .from('payouts')
            .update({ status: newStatus })
            .eq('id', payout.id)
            .eq('status', 'STAGED')

          if (promoteError) {
            console.error(`Failed to promote staged payout ${payout.id}:`, promoteError.message)
            continue
          }

          stagedPromoted++
        }
      } catch (err) {
        console.error(`Error processing staged payout ${payout.id}:`, err)
      }
    }

    if (stagedPromoted > 0 || stagedCancelled > 0) {
      console.log(`Staged payouts: ${stagedPromoted} promoted, ${stagedCancelled} cancelled`)
    }
  } catch (err) {
    console.error('Staged payout promotion error:', err)
    Sentry.captureException(err)
  }

  await recordCronSuccess('fraud-scan', adminClient, process.env.BETTERSTACK_HEARTBEAT_FRAUD_SCAN)

  // Step 4 — Return summary
  return Response.json({
    ok: true,
    scannedAt,
    results,
    totalFlagged,
    ruleFailures,
    stagedPromoted,
    stagedCancelled,
  })
 } catch (error) {
    console.error('Cron error:', error)
    Sentry.captureException(error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
