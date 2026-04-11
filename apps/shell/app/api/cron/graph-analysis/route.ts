// Graph topology analysis cron: detects referral network fraud patterns.
// Runs every 6 hours via Vercel Cron. Protected by authorization Bearer token.
// Each detection function runs independently — one failure does not abort the batch.

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  detectStarClusters,
  detectBipartiteSwaps,
  detectDisconnectedCliques,
  detectFanOutConverge,
  detectGen2Velocity,
} from '@referral/api/graphAnalysis'
import { recordCronSuccess } from '@referral/api/cronHealth'
import * as Sentry from '@sentry/nextjs'

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Auth check
    const authHeader = request.headers.get('authorization')
    const expectedSecret = process.env.CRON_SECRET

    if (!expectedSecret) {
      console.error('CRON_SECRET not configured')
      return Response.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
    }

    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.error('Unauthorized cron attempt')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()
    const startTime = Date.now()

    // Run detection functions in sequence to avoid DB contention
    const starResults = await detectStarClusters(adminClient)
    const bipartiteResults = await detectBipartiteSwaps(adminClient)
    const cliqueResults = await detectDisconnectedCliques(adminClient)
    const fanConvergeResults = await detectFanOutConverge(adminClient)
    const gen2Results = await detectGen2Velocity(adminClient)

    const totalPatterns =
      starResults.length +
      bipartiteResults.length +
      cliqueResults.length +
      fanConvergeResults.length +
      gen2Results.length

    const durationMs = Date.now() - startTime

    if (durationMs > 300_000) {
      console.warn(`Graph analysis cron took ${durationMs}ms — consider optimizing`)
    }

    await recordCronSuccess('graph-analysis', adminClient, process.env.BETTERSTACK_HEARTBEAT_GRAPH_ANALYSIS)

    return Response.json({
      success: true,
      patterns_found: totalPatterns,
      breakdown: {
        star_clusters: starResults.length,
        bipartite: bipartiteResults.length,
        cliques: cliqueResults.length,
        fan_converge: fanConvergeResults.length,
        gen2_velocity: gen2Results.length,
      },
      duration_ms: durationMs,
    })
  } catch (error) {
    console.error('Graph analysis cron error:', error)
    Sentry.captureException(error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
