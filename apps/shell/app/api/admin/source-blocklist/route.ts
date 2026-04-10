import { requireAdmin } from '../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@referral/api/riskScore'
import { extractDomain } from '@referral/api/sourceClassification'

export async function GET(): Promise<Response> {
  const result = await requireAdmin()
  if (result instanceof Response) return result

  const admin = createAdminClient()

  const { data: entries, error } = await admin
    .from('source_blocklist')
    .select('id, domain, added_by, notes, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: 'Failed to fetch blocklist' }, { status: 500 })
  }

  return Response.json({ entries: entries ?? [] })
}

export async function POST(request: Request): Promise<Response> {
  const result = await requireAdmin()
  if (result instanceof Response) return result
  const { admin: adminUser } = result

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { domain: rawDomain, notes } = body as { domain?: string; notes?: string }

  if (!rawDomain || typeof rawDomain !== 'string' || rawDomain.trim().length === 0) {
    return Response.json({ error: 'domain is required' }, { status: 400 })
  }

  if (rawDomain.length > 255) {
    return Response.json({ error: 'domain must be 255 characters or less' }, { status: 400 })
  }

  // Normalize using the same extractDomain used by classifyReferralSource
  const domain = extractDomain(rawDomain.trim())
  if (!domain) {
    return Response.json({ error: 'Invalid domain' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: inserted, error: insertError } = await adminClient
    .from('source_blocklist')
    .insert({
      domain,
      added_by: adminUser.id,
      notes: notes || null,
    })
    .select('id, domain, added_by, notes, created_at')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return Response.json({ error: 'Domain already in blocklist' }, { status: 409 })
    }
    return Response.json({ error: 'Failed to add domain' }, { status: 500 })
  }

  await logAdminAction({
    adminUserId: adminUser.id,
    action: 'SOURCE_BLOCKLIST_ADD',
    targetType: 'source_blocklist',
    targetId: inserted.id as string,
    afterValue: domain,
    reason: notes || 'Added to source blocklist',
  })

  return Response.json({ entry: inserted }, { status: 201 })
}
