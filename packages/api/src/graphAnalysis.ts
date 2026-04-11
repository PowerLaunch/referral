import type { SupabaseClient } from '@supabase/supabase-js'
import { adjustTrustScore } from './trustScore'

// --- Shared types ---

interface PatternResult {
  pattern_type: string
  user_ids: string[]
  details: Record<string, unknown>
  severity: string
}

interface ReferralEdge {
  referrer_id: string
  referee_id: string
}

// --- Shared helpers ---

/** Check for existing unresolved graph_analysis_result with overlapping user_ids */
async function hasExistingResult(
  adminClient: SupabaseClient,
  patternType: string,
  userIds: string[]
): Promise<boolean> {
  const { data, error } = await adminClient
    .from('graph_analysis_results')
    .select('id')
    .eq('pattern_type', patternType)
    .eq('resolved', false)
    .overlaps('user_ids', userIds)
    .limit(1)

  if (error) {
    console.error(`graph_analysis_results overlap check failed for ${patternType}:`, error)
    // Fail closed: treat as existing to avoid duplicate flagging
    return true
  }
  return (data?.length ?? 0) > 0
}

/** Check if a user is VIP. Returns false on error (fail closed = stricter rules). */
async function isUserVip(adminClient: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await adminClient
    .from('profiles')
    .select('is_vip')
    .eq('id', userId)
    .single()

  if (error) {
    console.error(`VIP check failed for ${userId}, treating as non-VIP:`, error)
    return false
  }
  return data?.is_vip === true
}

/** Check if ANY user in list is VIP */
async function anyUserVip(adminClient: SupabaseClient, userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return false
  const { data, error } = await adminClient
    .from('profiles')
    .select('id, is_vip')
    .in('id', userIds)
    .eq('is_vip', true)
    .limit(1)

  if (error) {
    console.error('Batch VIP check failed, treating as non-VIP:', error)
    return false
  }
  return (data?.length ?? 0) > 0
}

/** Insert fraud_flag with duplicate guard (23505). Returns true if inserted. */
async function insertFraudFlag(
  adminClient: SupabaseClient,
  userId: string,
  rule: string,
  severity: string,
  details: Record<string, unknown>
): Promise<boolean> {
  const { error } = await adminClient.from('fraud_flags').insert({
    user_id: userId,
    rule_triggered: rule,
    severity,
    details,
  })
  if (error) {
    if (error.code !== '23505') {
      console.error(`fraud_flag insert failed for ${userId} (${rule}):`, error)
    }
    return false
  }
  return true
}

/** Adjust trust score with idempotency guard */
async function safeAdjustTrust(
  adminClient: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
  rule: string
): Promise<void> {
  try {
    await adjustTrustScore(adminClient, userId, delta, reason, rule)
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== '23505') {
      console.error(`Trust adjustment failed for ${userId} (${reason}):`, e)
    }
  }
}

/** Log VIP exception to admin_audit_logs */
async function logVipException(
  adminClient: SupabaseClient,
  userId: string,
  patternType: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await adminClient.from('admin_audit_logs').insert({
      admin_user_id: null,
      action: 'vip_graph_exception',
      target_type: 'profile',
      target_id: userId,
      details: { pattern_type: patternType, ...details },
    })
  } catch (auditErr) {
    console.error(`VIP graph exception audit log failed for ${userId}:`, auditErr)
  }
}

/** Fetch all referral edges from last 90 days. Exported so the cron can call once and share. */
export async function fetchRecentEdges(adminClient: SupabaseClient): Promise<ReferralEdge[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await adminClient
    .from('referrals')
    .select('referrer_id, referee_id')
    .in('status', ['PENDING', 'CONFIRMED'])
    .gt('created_at', ninetyDaysAgo)
    .limit(50000)

  if (error) {
    console.error('Failed to fetch referral edges:', error)
    return []
  }
  return (data ?? []) as ReferralEdge[]
}

// =============================================================================
// FUNCTION A: Star Cluster Detection
// =============================================================================

export async function detectStarClusters(adminClient: SupabaseClient): Promise<PatternResult[]> {
  const results: PatternResult[] = []
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    // Find referrers with 15+ referees in last 90 days
    const { data: candidates, error: candError } = await adminClient
      .from('referrals')
      .select('referrer_id')
      .in('status', ['PENDING', 'CONFIRMED'])
      .gt('created_at', ninetyDaysAgo)
      .limit(50000)

    if (candError || !candidates) {
      console.error('Star cluster candidate query failed:', candError)
      return []
    }

    // Count referees per referrer
    const refCounts = new Map<string, number>()
    for (const row of candidates) {
      const rid = row.referrer_id as string
      refCounts.set(rid, (refCounts.get(rid) ?? 0) + 1)
    }

    for (const [referrerId, refCount] of refCounts) {
      if (refCount < 15) continue

      const vip = await isUserVip(adminClient, referrerId)
      const threshold = vip ? 50 : 15
      if (refCount < threshold) continue

      // Get all referee_ids for this referrer
      const { data: refereeRows, error: refError } = await adminClient
        .from('referrals')
        .select('referee_id')
        .eq('referrer_id', referrerId)
        .in('status', ['PENDING', 'CONFIRMED'])
        .gt('created_at', ninetyDaysAgo)
        .limit(10000)

      if (refError || !refereeRows || refereeRows.length === 0) continue

      const refereeIds = refereeRows.map((r) => r.referee_id as string)

      // Check how many referees have zero outgoing referrals.
      // Filter by status to exclude REJECTED/VOIDED — consistent with all other queries.
      const { data: outgoing, error: outErr } = await adminClient
        .from('referrals')
        .select('referrer_id')
        .in('referrer_id', refereeIds)
        .in('status', ['PENDING', 'CONFIRMED'])
        .limit(10000)

      if (outErr) continue

      const refereesWithOutgoing = new Set((outgoing ?? []).map((r) => r.referrer_id as string))
      const zeroOutgoing = refereeIds.filter((id) => !refereesWithOutgoing.has(id)).length
      const zeroOutgoingPct = refereeIds.length > 0 ? zeroOutgoing / refereeIds.length : 0

      if (zeroOutgoingPct < 0.6) continue

      // Check gameplay standard deviation
      const { data: gameplay, error: gpError } = await adminClient
        .from('gameplay_sessions')
        .select('user_id, total_minutes')
        .in('user_id', refereeIds)
        .limit(10000)

      if (gpError) continue

      // Include referees without gameplay_sessions rows as 0 minutes.
      // gameplay_sessions has a unique constraint on user_id, so missing rows = no gameplay.
      const gameplayMap = new Map<string, number>()
      for (const g of gameplay ?? []) {
        gameplayMap.set(g.user_id as string, Math.max(0, (g.total_minutes as number) ?? 0))
      }
      const minutes = refereeIds.map((id) => gameplayMap.get(id) ?? 0)
      let stdev = 0
      if (minutes.length >= 2) {
        const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length
        const variance = minutes.reduce((sum, x) => sum + (x - mean) ** 2, 0) / minutes.length
        stdev = Math.sqrt(Math.max(0, variance))
      }

      if (stdev >= 2.0) continue

      // Pattern matches — check idempotency then flag
      const allIds = [referrerId, ...refereeIds]
      if (await hasExistingResult(adminClient, 'STAR_CLUSTER', allIds)) continue

      const severity = vip ? 'INFO' : 'WARNING'
      const trustDelta = vip ? -30 : -100
      const detailsObj = {
        referrer_id: referrerId,
        referee_count: refereeIds.length,
        zero_outgoing_pct: Math.round(zeroOutgoingPct * 100) / 100,
        gameplay_stdev: Math.round(stdev * 100) / 100,
        is_vip: vip,
      }

      const { error: insertErr } = await adminClient.from('graph_analysis_results').insert({
        pattern_type: 'STAR_CLUSTER',
        user_ids: allIds,
        details: detailsObj,
        severity,
      })
      if (insertErr) {
        console.error('Star cluster result insert failed:', insertErr)
        continue
      }

      await insertFraudFlag(adminClient, referrerId, 'R16_STAR_CLUSTER', severity, detailsObj)
      await safeAdjustTrust(adminClient, referrerId, trustDelta, 'star_cluster', 'R16_STAR_CLUSTER')

      if (vip) {
        await logVipException(adminClient, referrerId, 'STAR_CLUSTER', detailsObj)
      }

      results.push({ pattern_type: 'STAR_CLUSTER', user_ids: allIds, details: detailsObj, severity })
    }
  } catch (err) {
    console.error('detectStarClusters failed:', err)
  }
  return results
}

// =============================================================================
// FUNCTION B: Bipartite Swap Detection
// =============================================================================

export async function detectBipartiteSwaps(adminClient: SupabaseClient, cachedEdges?: ReferralEdge[]): Promise<PatternResult[]> {
  const results: PatternResult[] = []
  try {
    const edges = cachedEdges ?? await fetchRecentEdges(adminClient)
    if (edges.length === 0) return []

    // Build adjacency map (directed)
    const adjMap = new Map<string, Set<string>>()
    for (const edge of edges) {
      if (!adjMap.has(edge.referrer_id)) adjMap.set(edge.referrer_id, new Set())
      adjMap.get(edge.referrer_id)!.add(edge.referee_id)
    }

    const processedCycles = new Set<string>()

    // 1. Direct swaps (A↔B)
    for (const edge of edges) {
      const reverse = adjMap.get(edge.referee_id)
      if (reverse?.has(edge.referrer_id)) {
        const sorted = [edge.referrer_id, edge.referee_id].sort()
        const key = JSON.stringify(sorted)
        if (processedCycles.has(key)) continue
        processedCycles.add(key)

        if (await hasExistingResult(adminClient, 'BIPARTITE', sorted)) continue

        const hasVip = await anyUserVip(adminClient, sorted)
        // Bipartite severity is always CRITICAL — no legitimate use case
        const severity = 'CRITICAL'
        const detailsObj = {
          cycle_length: 2,
          is_direct_swap: true,
          members: sorted,
          has_vip_member: hasVip,
        }

        const { error: insertErr } = await adminClient.from('graph_analysis_results').insert({
          pattern_type: 'BIPARTITE',
          user_ids: sorted,
          details: detailsObj,
          severity,
        })
        if (insertErr) {
          console.error('Bipartite result insert failed:', insertErr)
          continue
        }

        for (const userId of sorted) {
          await insertFraudFlag(adminClient, userId, 'R16_BIPARTITE', severity, detailsObj)
          await safeAdjustTrust(adminClient, userId, -300, 'bipartite_swap', 'R16_BIPARTITE')
        }

        if (hasVip) {
          for (const userId of sorted) {
            const uVip = await isUserVip(adminClient, userId)
            if (uVip) await logVipException(adminClient, userId, 'BIPARTITE', detailsObj)
          }
        }

        results.push({ pattern_type: 'BIPARTITE', user_ids: sorted, details: detailsObj, severity })
      }
    }

    // 2. Cycles (length 3-8) via BFS — application-level, not recursive SQL CTE,
    // to avoid unbounded query cost on large referral graphs.
    const allNodes = [...adjMap.keys()]
    const nodesToProcess = allNodes.slice(0, 500)

    for (const startNode of nodesToProcess) {
      // BFS to find cycles back to startNode, max depth 8.
      // Queue size is bounded to prevent combinatorial explosion on high-degree nodes
      // (e.g., a referrer with 20+ referees could generate O(d^7) entries without a cap).
      const MAX_QUEUE_SIZE = 10_000
      // Use index pointer instead of shift() to avoid O(n) re-indexing per dequeue
      const queue: Array<{ node: string; path: string[] }> = [{ node: startNode, path: [startNode] }]
      let queueHead = 0

      while (queueHead < queue.length) {
        const current = queue[queueHead]!
        queueHead++
        if (current.path.length > 8) continue

        const neighbors = adjMap.get(current.node)
        if (!neighbors) continue

        for (const neighbor of neighbors) {
          if (neighbor === startNode && current.path.length >= 3) {
            // Found a cycle
            const cycleSorted = [...current.path].sort()
            const key = JSON.stringify(cycleSorted)
            if (processedCycles.has(key)) continue
            processedCycles.add(key)

            if (await hasExistingResult(adminClient, 'BIPARTITE', cycleSorted)) continue

            const hasVip = await anyUserVip(adminClient, cycleSorted)
            const severity = 'CRITICAL'
            const detailsObj = {
              cycle_length: current.path.length,
              is_direct_swap: false,
              members: cycleSorted,
              has_vip_member: hasVip,
            }

            const { error: cycleInsertErr } = await adminClient.from('graph_analysis_results').insert({
              pattern_type: 'BIPARTITE',
              user_ids: cycleSorted,
              details: detailsObj,
              severity,
            })
            if (cycleInsertErr) {
              console.error('Bipartite cycle result insert failed:', cycleInsertErr)
              continue
            }

            for (const userId of cycleSorted) {
              await insertFraudFlag(adminClient, userId, 'R16_BIPARTITE', severity, detailsObj)
              await safeAdjustTrust(adminClient, userId, -300, 'bipartite_cycle', 'R16_BIPARTITE')
            }

            if (hasVip) {
              for (const userId of cycleSorted) {
                const uVip = await isUserVip(adminClient, userId)
                if (uVip) await logVipException(adminClient, userId, 'BIPARTITE', detailsObj)
              }
            }

            results.push({ pattern_type: 'BIPARTITE', user_ids: cycleSorted, details: detailsObj, severity })
          } else if (!current.path.includes(neighbor) && current.path.length < 8 && queue.length < MAX_QUEUE_SIZE) {
            queue.push({ node: neighbor, path: [...current.path, neighbor] })
          }
        }
      }
    }
  } catch (err) {
    console.error('detectBipartiteSwaps failed:', err)
  }
  return results
}

// =============================================================================
// FUNCTION C: Disconnected Clique Detection
// =============================================================================

export async function detectDisconnectedCliques(adminClient: SupabaseClient, cachedEdges?: ReferralEdge[]): Promise<PatternResult[]> {
  const results: PatternResult[] = []
  try {
    const edges = cachedEdges ?? await fetchRecentEdges(adminClient)
    if (edges.length === 0) return []

    // Build undirected adjacency map
    const undirected = new Map<string, Set<string>>()
    for (const edge of edges) {
      if (!undirected.has(edge.referrer_id)) undirected.set(edge.referrer_id, new Set())
      if (!undirected.has(edge.referee_id)) undirected.set(edge.referee_id, new Set())
      undirected.get(edge.referrer_id)!.add(edge.referee_id)
      undirected.get(edge.referee_id)!.add(edge.referrer_id)
    }

    // Find connected components via BFS
    const visited = new Set<string>()
    const components: string[][] = []

    for (const node of undirected.keys()) {
      if (visited.has(node)) continue
      const component: string[] = []
      const queue = [node]
      let qHead = 0
      while (qHead < queue.length) {
        const current = queue[qHead]!
        qHead++
        if (visited.has(current)) continue
        visited.add(current)
        component.push(current)
        const neighbors = undirected.get(current)
        if (neighbors) {
          for (const n of neighbors) {
            if (!visited.has(n)) queue.push(n)
          }
        }
      }
      components.push(component)
      if (components.length >= 200) break
    }

    // Filter to components of size 3-8
    const smallComponents = components.filter((c) => c.length >= 3 && c.length <= 8)

    const ninetyDaysAgoClique = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    for (const component of smallComponents) {
      // Check if ALL referral edges involving these users are internal (no external connections).
      // Must match the same status + date filters used to build the graph from fetchRecentEdges,
      // otherwise historical/voided referrals outside the group cause false negatives.
      const { count: totalEdges, error: totalErr } = await adminClient
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .in('status', ['PENDING', 'CONFIRMED'])
        .gt('created_at', ninetyDaysAgoClique)
        .or(`referrer_id.in.(${component.join(',')}),referee_id.in.(${component.join(',')})`)

      const { count: internalEdges, error: intErr } = await adminClient
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .in('status', ['PENDING', 'CONFIRMED'])
        .gt('created_at', ninetyDaysAgoClique)
        .in('referrer_id', component)
        .in('referee_id', component)

      if (totalErr || intErr) continue
      if ((totalEdges ?? 0) !== (internalEdges ?? 0)) continue // Has external connections

      // Check shared signals (need at least 2 of 3)
      let sharedSignalCount = 0
      const sharedSignals: string[] = []

      // Signal 1: Same IP /24 range
      const { data: ipData } = await adminClient
        .from('ip_classifications')
        .select('user_id, ip_range_24')
        .in('user_id', component)

      if (ipData && ipData.length >= 2) {
        // Count DISTINCT users per IP range — a single user with multiple rows
        // (e.g., SIGNUP and SESSION contexts) must not inflate the count.
        const ipRangeUsers = new Map<string, Set<string>>()
        for (const row of ipData) {
          const range = row.ip_range_24 as string
          const userId = row.user_id as string
          if (range) {
            if (!ipRangeUsers.has(range)) ipRangeUsers.set(range, new Set())
            ipRangeUsers.get(range)!.add(userId)
          }
        }
        if ([...ipRangeUsers.values()].some((users) => users.size >= 2)) {
          sharedSignalCount++
          sharedSignals.push('ip_range')
        }
      }

      // Signal 2: Same device fingerprint
      const { data: fpData } = await adminClient
        .from('device_fingerprints')
        .select('user_id, fingerprint_hash')
        .in('user_id', component)

      if (fpData && fpData.length >= 2) {
        // Count DISTINCT users per fingerprint — same dedup reason as IP above
        const fpHashUsers = new Map<string, Set<string>>()
        for (const row of fpData) {
          const hash = row.fingerprint_hash as string
          const userId = row.user_id as string
          if (hash) {
            if (!fpHashUsers.has(hash)) fpHashUsers.set(hash, new Set())
            fpHashUsers.get(hash)!.add(userId)
          }
        }
        if ([...fpHashUsers.values()].some((users) => users.size >= 2)) {
          sharedSignalCount++
          sharedSignals.push('fingerprint')
        }
      }

      // Signal 3: Created within 1 hour of each other
      const { data: profileData } = await adminClient
        .from('profiles')
        .select('id, created_at')
        .in('id', component)

      if (profileData && profileData.length >= 2) {
        const timestamps = profileData
          .map((p) => new Date(p.created_at as string).getTime())
          .filter((t) => !Number.isNaN(t))
        let closeSignup = false
        for (let i = 0; i < timestamps.length && !closeSignup; i++) {
          for (let j = i + 1; j < timestamps.length; j++) {
            if (Math.abs((timestamps[i] ?? 0) - (timestamps[j] ?? 0)) < 3600_000) {
              closeSignup = true
              break
            }
          }
        }
        if (closeSignup) {
          sharedSignalCount++
          sharedSignals.push('signup_time')
        }
      }

      if (sharedSignalCount < 2) continue

      // Pattern matches
      const sorted = [...component].sort()
      if (await hasExistingResult(adminClient, 'CLIQUE', sorted)) continue

      const hasVip = await anyUserVip(adminClient, sorted)
      const severity = hasVip ? 'INFO' : 'WARNING'
      const trustDelta = hasVip ? -30 : -100
      const detailsObj = {
        group_size: sorted.length,
        shared_signals: sharedSignals,
        internal_referral_count: internalEdges ?? 0,
        has_vip_member: hasVip,
      }

      const { error: cliqueInsertErr } = await adminClient.from('graph_analysis_results').insert({
        pattern_type: 'CLIQUE',
        user_ids: sorted,
        details: detailsObj,
        severity,
      })
      if (cliqueInsertErr) {
        console.error('Clique result insert failed:', cliqueInsertErr)
        continue
      }

      for (const userId of sorted) {
        await insertFraudFlag(adminClient, userId, 'R16_CLIQUE', severity, detailsObj)
        await safeAdjustTrust(adminClient, userId, trustDelta, 'disconnected_clique', 'R16_CLIQUE')
      }

      if (hasVip) {
        for (const userId of sorted) {
          const uVip = await isUserVip(adminClient, userId)
          if (uVip) await logVipException(adminClient, userId, 'CLIQUE', detailsObj)
        }
      }

      results.push({ pattern_type: 'CLIQUE', user_ids: sorted, details: detailsObj, severity })
    }
  } catch (err) {
    console.error('detectDisconnectedCliques failed:', err)
  }
  return results
}

// =============================================================================
// FUNCTION D: Fan-Out Convergence Detection
// =============================================================================

export async function detectFanOutConverge(adminClient: SupabaseClient): Promise<PatternResult[]> {
  const results: PatternResult[] = []
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    // Get referees with their referrer, fingerprint, and IP
    const { data: referees, error: refErr } = await adminClient
      .from('referrals')
      .select('referrer_id, referee_id')
      .in('status', ['PENDING', 'CONFIRMED'])
      .gt('created_at', ninetyDaysAgo)
      .limit(50000)

    if (refErr || !referees || referees.length === 0) return []

    const allRefereeIds = [...new Set(referees.map((r) => r.referee_id as string))]

    // Fetch fingerprints for all referees
    const { data: fpData } = await adminClient
      .from('device_fingerprints')
      .select('user_id, fingerprint_hash')
      .in('user_id', allRefereeIds)
      .limit(50000)

    // Fetch IP ranges for all referees
    const { data: ipData } = await adminClient
      .from('ip_classifications')
      .select('user_id, ip_range_24')
      .in('user_id', allRefereeIds)
      .limit(50000)

    // TODO: Add payout_destination convergence check after Phase 5

    // Build referee → referrer map
    const refereeToReferrer = new Map<string, string>()
    for (const r of referees) {
      refereeToReferrer.set(r.referee_id as string, r.referrer_id as string)
    }

    const processedSets = new Set<string>()

    // Group by fingerprint
    if (fpData && fpData.length > 0) {
      const fpGroups = new Map<string, string[]>()
      for (const row of fpData) {
        const hash = row.fingerprint_hash as string
        const userId = row.user_id as string
        if (!hash) continue
        if (!fpGroups.has(hash)) fpGroups.set(hash, [])
        fpGroups.get(hash)!.push(userId)
      }

      for (const [hash, refIds] of fpGroups) {
        if (refIds.length < 2) continue
        const referrerIds = [...new Set(refIds.map((id) => refereeToReferrer.get(id)).filter((r): r is string => r !== undefined))]
        if (referrerIds.length < 3) continue

        // Deduplicate allIds — refIds can contain duplicates from multiple fingerprint rows per user
        const allIds = [...new Set([...referrerIds, ...refIds])].sort()
        const key = JSON.stringify(allIds)
        if (processedSets.has(key)) continue
        processedSets.add(key)

        if (await hasExistingResult(adminClient, 'FAN_CONVERGE', allIds)) continue

        // Check ALL involved users for VIP status (not just referrers) — severity applies to everyone
        const hasVip = await anyUserVip(adminClient, allIds)
        const severity = hasVip ? 'INFO' : 'CRITICAL'
        const trustDelta = hasVip ? -30 : -300
        const uniqueRefIds = [...new Set(refIds)]
        const detailsObj = {
          converging_signal_type: 'fingerprint',
          converging_value: hash,
          referrer_count: referrerIds.length,
          referee_count: uniqueRefIds.length,
          referrer_ids: referrerIds,
          referee_ids: refIds,
          has_vip_member: hasVip,
        }

        const { error: fpInsertErr } = await adminClient.from('graph_analysis_results').insert({
          pattern_type: 'FAN_CONVERGE',
          user_ids: allIds,
          details: detailsObj,
          severity,
        })
        if (fpInsertErr) {
          console.error('Fan converge result insert failed:', fpInsertErr)
          continue
        }

        // allIds is already deduplicated above — safe to iterate directly
        for (const userId of allIds) {
          await insertFraudFlag(adminClient, userId, 'R16_FAN_CONVERGE', severity, detailsObj)
          await safeAdjustTrust(adminClient, userId, trustDelta, 'fan_converge_fingerprint', 'R16_FAN_CONVERGE')
        }

        if (hasVip) {
          // Log VIP exception for ALL VIP users (referrers + referees), not just referrers
          for (const userId of allIds) {
            const uVip = await isUserVip(adminClient, userId)
            if (uVip) await logVipException(adminClient, userId, 'FAN_CONVERGE', detailsObj)
          }
        }

        results.push({ pattern_type: 'FAN_CONVERGE', user_ids: allIds, details: detailsObj, severity })
      }
    }

    // Group by IP range
    if (ipData && ipData.length > 0) {
      const ipGroups = new Map<string, string[]>()
      for (const row of ipData) {
        const range = row.ip_range_24 as string
        const userId = row.user_id as string
        if (!range) continue
        if (!ipGroups.has(range)) ipGroups.set(range, [])
        ipGroups.get(range)!.push(userId)
      }

      for (const [range, refIds] of ipGroups) {
        if (refIds.length < 2) continue
        const referrerIds = [...new Set(refIds.map((id) => refereeToReferrer.get(id)).filter((r): r is string => r !== undefined))]
        if (referrerIds.length < 3) continue

        // Deduplicate allIds — refIds can contain duplicates from multiple IP rows per user
        const allIds = [...new Set([...referrerIds, ...refIds])].sort()
        const key = JSON.stringify(allIds)
        if (processedSets.has(key)) continue
        processedSets.add(key)

        if (await hasExistingResult(adminClient, 'FAN_CONVERGE', allIds)) continue

        // Check ALL involved users for VIP status — consistent with fingerprint block above
        const hasVip = await anyUserVip(adminClient, allIds)
        const severity = hasVip ? 'INFO' : 'CRITICAL'
        const trustDelta = hasVip ? -30 : -300
        const uniqueRefIds = [...new Set(refIds)]
        const detailsObj = {
          converging_signal_type: 'ip_range',
          converging_value: range,
          referrer_count: referrerIds.length,
          referee_count: uniqueRefIds.length,
          referrer_ids: referrerIds,
          referee_ids: refIds,
          has_vip_member: hasVip,
        }

        const { error: ipInsertErr } = await adminClient.from('graph_analysis_results').insert({
          pattern_type: 'FAN_CONVERGE',
          user_ids: allIds,
          details: detailsObj,
          severity,
        })
        if (ipInsertErr) {
          console.error('Fan converge IP result insert failed:', ipInsertErr)
          continue
        }

        // allIds is already deduplicated above — safe to iterate directly
        for (const userId of allIds) {
          await insertFraudFlag(adminClient, userId, 'R16_FAN_CONVERGE', severity, detailsObj)
          await safeAdjustTrust(adminClient, userId, trustDelta, 'fan_converge_ip', 'R16_FAN_CONVERGE')
        }

        if (hasVip) {
          // Log VIP exception for ALL VIP users — consistent with fingerprint block
          for (const userId of allIds) {
            const uVip = await isUserVip(adminClient, userId)
            if (uVip) await logVipException(adminClient, userId, 'FAN_CONVERGE', detailsObj)
          }
        }

        results.push({ pattern_type: 'FAN_CONVERGE', user_ids: allIds, details: detailsObj, severity })
      }
    }
  } catch (err) {
    console.error('detectFanOutConverge failed:', err)
  }
  return results
}

// =============================================================================
// FUNCTION E: Gen2 Velocity Detection
// =============================================================================

export async function detectGen2Velocity(adminClient: SupabaseClient): Promise<PatternResult[]> {
  const results: PatternResult[] = []
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    // Find referrers with 5+ referees in last 90 days
    const { data: referralRows, error: refErr } = await adminClient
      .from('referrals')
      .select('referrer_id, referee_id')
      .in('status', ['PENDING', 'CONFIRMED'])
      .gt('created_at', ninetyDaysAgo)
      .limit(50000)

    if (refErr || !referralRows || referralRows.length === 0) return []

    // Group by referrer
    const referrerMap = new Map<string, string[]>()
    for (const row of referralRows) {
      const rid = row.referrer_id as string
      if (!referrerMap.has(rid)) referrerMap.set(rid, [])
      referrerMap.get(rid)!.push(row.referee_id as string)
    }

    for (const [referrerId, refereeIds] of referrerMap) {
      if (refereeIds.length < 5) continue

      const vip = await isUserVip(adminClient, referrerId)
      const threshold = vip ? 20 : 5
      if (refereeIds.length < threshold) continue

      // For each referee, find their first outgoing referral timestamp.
      // Filter by status to exclude REJECTED/VOIDED — only active referrals count.
      const { data: gen2Rows, error: gen2Err } = await adminClient
        .from('referrals')
        .select('referrer_id, created_at')
        .in('referrer_id', refereeIds)
        .in('status', ['PENDING', 'CONFIRMED'])
        .order('created_at', { ascending: true })
        .limit(50000)

      if (gen2Err) continue

      // Get first referral per referee
      const firstReferralMap = new Map<string, number>()
      for (const row of gen2Rows ?? []) {
        const rid = row.referrer_id as string
        const ts = new Date(row.created_at as string).getTime()
        if (Number.isNaN(ts) || ts > Date.now()) continue // Guard: skip invalid/future timestamps
        if (!firstReferralMap.has(rid)) {
          firstReferralMap.set(rid, ts)
        }
      }

      // Check if 80%+ of referees made a referral
      const refereesWithReferrals = refereeIds.filter((id) => firstReferralMap.has(id))
      if (refereesWithReferrals.length < refereeIds.length * 0.8) continue

      // Sort timestamps and check for 12-hour window capturing 80%+
      const timestamps = refereesWithReferrals
        .map((id) => firstReferralMap.get(id)!)
        .sort((a, b) => a - b)

      if (timestamps.length < 2) continue

      const twelveHoursMs = 12 * 60 * 60 * 1000
      // Target is 80% of ALL referees (not just those with referrals) to avoid
      // the two-step filter (80% made referrals × 80% in window = only 64% effective threshold)
      const target = Math.ceil(refereeIds.length * 0.8)
      let windowMatch = false
      let windowStart = 0
      let windowEnd = 0

      for (let i = 0; i <= timestamps.length - target; i++) {
        const tsI = timestamps[i] ?? 0
        const windowEndTs = tsI + twelveHoursMs
        let count = 0
        for (let j = i; j < timestamps.length; j++) {
          if ((timestamps[j] ?? 0) <= windowEndTs) count++
          else break
        }
        if (count >= target) {
          windowMatch = true
          windowStart = tsI
          windowEnd = Math.min(windowEndTs, timestamps[Math.min(i + count - 1, timestamps.length - 1)] ?? 0)
          break
        }
      }

      if (!windowMatch) continue

      // Pattern matches
      const allIds = [referrerId, ...refereesWithReferrals]
      if (await hasExistingResult(adminClient, 'GEN2_VELOCITY', allIds)) continue

      const severity = vip ? 'INFO' : 'WARNING'
      const trustDelta = vip ? -30 : -100
      const detailsObj = {
        referrer_id: referrerId,
        total_referees: refereeIds.length,
        referees_with_referrals: refereesWithReferrals.length,
        window_start_utc: new Date(windowStart).toISOString(),
        window_end_utc: new Date(windowEnd).toISOString(),
        match_percentage: Math.round((refereesWithReferrals.length / refereeIds.length) * 100),
        is_vip: vip,
      }

      const { error: gen2InsertErr } = await adminClient.from('graph_analysis_results').insert({
        pattern_type: 'GEN2_VELOCITY',
        user_ids: allIds,
        details: detailsObj,
        severity,
      })
      if (gen2InsertErr) {
        console.error('Gen2 velocity result insert failed:', gen2InsertErr)
        continue
      }

      await insertFraudFlag(adminClient, referrerId, 'R16_GEN2_VELOCITY', severity, detailsObj)
      await safeAdjustTrust(adminClient, referrerId, trustDelta, 'gen2_velocity', 'R16_GEN2_VELOCITY')

      if (vip) {
        await logVipException(adminClient, referrerId, 'GEN2_VELOCITY', detailsObj)
      }

      results.push({ pattern_type: 'GEN2_VELOCITY', user_ids: allIds, details: detailsObj, severity })
    }
  } catch (err) {
    console.error('detectGen2Velocity failed:', err)
  }
  return results
}
