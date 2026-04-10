import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../requireAdmin'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const admin = createAdminClient()

  const searchParams = request.nextUrl.searchParams
  const tab = searchParams.get('tab') ?? 'flags'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  if (tab === 'flags') {
    const severity = searchParams.get('severity')
    const rule = searchParams.get('rule')

    let query = admin
      .from('fraud_flags')
      .select('id, user_id, rule_triggered, severity, details, is_resolved, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit)

    if (severity) {
      query = query.eq('severity', severity)
    }
    if (rule) {
      query = query.eq('rule_triggered', rule)
    }

    const { data: flags, error } = await query

    if (error) {
      return Response.json({ error: 'Failed to fetch fraud flags' }, { status: 500 })
    }

    const hasMore = (flags?.length ?? 0) > limit
    const sliced = (flags ?? []).slice(0, limit)

    return Response.json({ flags: sliced, hasMore, page })
  }

  if (tab === 'devices') {
    // Device fingerprint clusters: fingerprints shared by 2+ users
    const { data: clusters, error } = await admin.rpc('get_device_clusters', {
      p_limit: limit,
      p_offset: offset,
    })

    // If RPC doesn't exist yet, fall back to direct query
    if (error) {
      // Direct query fallback — less efficient but functional
      const { data: fingerprints, error: fpError } = await admin
        .from('device_fingerprints')
        .select('fingerprint_hash, user_id')
        .limit(10000)

      if (fpError) {
        return Response.json({ error: 'Failed to fetch device clusters' }, { status: 500 })
      }

      // Group by fingerprint_hash
      const clusterMap = new Map<string, Set<string>>()
      for (const fp of fingerprints ?? []) {
        const hash = fp.fingerprint_hash as string
        const uid = fp.user_id as string
        if (!clusterMap.has(hash)) clusterMap.set(hash, new Set())
        clusterMap.get(hash)!.add(uid)
      }

      const deviceClusters = Array.from(clusterMap.entries())
        .filter(([, users]) => users.size > 1)
        .sort((a, b) => b[1].size - a[1].size)
        .slice(offset, offset + limit + 1)

      const hasMoreDevices = deviceClusters.length > limit
      const slicedClusters = deviceClusters.slice(0, limit).map(([hash, users]) => ({
        fingerprint_hash: hash,
        user_ids: Array.from(users),
        user_count: users.size,
      }))

      return Response.json({ clusters: slicedClusters, hasMore: hasMoreDevices, page })
    }

    return Response.json({ clusters: clusters ?? [], hasMore: false, page })
  }

  if (tab === 'sybil') {
    // Sybil clusters: users with matching verified_kyc_hash
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, verified_kyc_hash')
      .not('verified_kyc_hash', 'is', null)
      .limit(10000)

    if (error) {
      return Response.json({ error: 'Failed to fetch Sybil clusters' }, { status: 500 })
    }

    const hashMap = new Map<string, string[]>()
    for (const p of profiles ?? []) {
      const hash = p.verified_kyc_hash as string
      if (!hashMap.has(hash)) hashMap.set(hash, [])
      hashMap.get(hash)!.push(p.id as string)
    }

    const sybilClusters = Array.from(hashMap.entries())
      .filter(([, ids]) => ids.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([hash, ids]) => ({
        verified_kyc_hash: hash,
        user_ids: ids,
        user_count: ids.length,
      }))

    return Response.json({ clusters: sybilClusters, hasMore: false, page })
  }

  if (tab === 'webhooks') {
    // Payment events log — table may not exist yet (Phase 5)
    const { data: events, error } = await admin
      .from('payment_events')
      .select('id, event_type, status, amount, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      // Table likely doesn't exist yet
      return Response.json({ events: null, placeholder: true, page })
    }

    return Response.json({ events: events ?? [], placeholder: false, page })
  }

  return Response.json({ error: 'Invalid tab' }, { status: 400 })
}
