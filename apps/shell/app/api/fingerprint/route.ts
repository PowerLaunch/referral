// Captures browser fingerprint for device clustering (fraud rule R2).
// Basic browser fingerprint for MVP. FingerprintJS Pro deferred post-MVP.
// Game-to-backend communication via API routes only.

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request): Promise<Response> {
  try {
    // Step 1 — Authenticate
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Step 2 — Parse and validate body
    const body = (await request.json()) as { fingerprintHash: string }
    const { fingerprintHash } = body

    // Validate fingerprintHash
    if (
      typeof fingerprintHash !== 'string' ||
      fingerprintHash.length === 0 ||
      fingerprintHash.length > 128 ||
      !/^[a-zA-Z0-9]+$/.test(fingerprintHash)
    ) {
      return Response.json({ error: 'Invalid fingerprint' }, { status: 400 })
    }

    // Step 3 — Deduplication check
    const adminClient = createAdminClient()

    const { data: existingFingerprint } = await adminClient
      .from('device_fingerprints')
      .select('id')
      .eq('user_id', user.id)
      .eq('fingerprint_hash', fingerprintHash)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()

    if (existingFingerprint) {
      // Silently accept — don't error on duplicates, don't insert another row
      return Response.json({ ok: true, duplicate: true })
    }

    // Step 4 — Store fingerprint
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = request.headers.get('user-agent') ?? null

    await adminClient.from('device_fingerprints').insert({
      user_id: user.id,
      fingerprint_hash: fingerprintHash,
      ip_address: ipAddress,
      user_agent: userAgent,
    })

    return Response.json({ ok: true })
  } catch (error) {
    // Never return errors to the client for fingerprint — it's a silent background operation.
    // Even on failure, return 200 so the client doesn't retry.
    console.error('Fingerprint capture error:', error)
    return Response.json({ ok: true })
  }
}
