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

  // R1: Spike Detection
  try {
    const flagged = await runR1SpikeDetection()
    results.push({ rule: 'R1_SPIKE_DETECTION', flagged })
    totalFlagged += flagged
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    results.push({ rule: 'R1_SPIKE_DETECTION', flagged: 0, error: errorMessage })
    console.error('R1 failed:', error)
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
  }

  // Cron health + heartbeat
  try {
    const adminClient = createAdminClient()
    await adminClient.from('cron_health').upsert(
      { cron_name: 'fraud-scan', last_success_at: new Date().toISOString() },
      { onConflict: 'cron_name' }
    )
  } catch { /* cron_health table may not exist yet */ }
  if (process.env.BETTERSTACK_HEARTBEAT_URL) {
    await fetch(process.env.BETTERSTACK_HEARTBEAT_URL).catch(() => {})
  }

  // Step 3 — Return summary
  return Response.json({
    ok: true,
    scannedAt,
    results,
    totalFlagged,
  })
 } catch (error) {
    Sentry.captureException(error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
