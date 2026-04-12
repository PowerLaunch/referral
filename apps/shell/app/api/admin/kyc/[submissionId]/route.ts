import { requireAdmin } from '../../requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { approveKyc, rejectKyc } from '@referral/api/kycApproval'

const ParamSchema = z.object({ submissionId: z.string().uuid() })

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), id_number: z.string().min(1).max(100) }),
  z.object({ action: z.literal('reject'), reason: z.string().min(1).max(200), notes: z.string().max(2000).optional() }),
])

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { submissionId } = await params
  const paramParsed = ParamSchema.safeParse({ submissionId })
  if (!paramParsed.success) {
    return Response.json({ error: 'Invalid submission ID' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: submission, error } = await admin
    .from('kyc_submissions')
    .select('id, user_id, storage_path, status, admin_notes, created_at, reviewed_at, reviewed_by')
    .eq('id', submissionId)
    .single()

  if (error || !submission) {
    return Response.json({ error: 'Submission not found' }, { status: 404 })
  }

  // Get user email
  const { data: profile } = await admin
    .from('profiles')
    .select('email')
    .eq('id', submission.user_id as string)
    .single()

  // Generate signed URL for the stored image (5 min expiry)
  let signedUrl: string | null = null
  if (submission.storage_path) {
    const { data: urlData } = await admin.storage
      .from('kyc-documents')
      .createSignedUrl(submission.storage_path as string, 300)

    signedUrl = urlData?.signedUrl ?? null
  }

  return Response.json({
    submission: {
      ...submission,
      user_email: (profile?.email as string) ?? 'unknown',
      signed_url: signedUrl,
    },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> }
): Promise<Response> {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth
  const { admin: adminUser } = auth

  const { submissionId } = await params
  const paramParsed = ParamSchema.safeParse({ submissionId })
  if (!paramParsed.success) {
    return Response.json({ error: 'Invalid submission ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const actionParsed = ActionSchema.safeParse(body)
  if (!actionParsed.success) {
    return Response.json({ error: 'Invalid request body', details: actionParsed.error.flatten() }, { status: 400 })
  }

  const admin = createAdminClient()
  const action = actionParsed.data

  if (action.action === 'approve') {
    const result = await approveKyc(admin, submissionId, action.id_number, adminUser.id)
    if (!result.success) {
      return Response.json({ error: result.error }, { status: 400 })
    }
    return Response.json({
      success: true,
      sybil_detected: result.sybilDetected,
      matched_user_id: result.matchedUserId,
    })
  }

  // reject
  const result = await rejectKyc(admin, submissionId, action.reason, action.notes ?? null, adminUser.id)
  if (!result.success) {
    return Response.json({ error: result.error }, { status: 400 })
  }
  return Response.json({ success: true })
}
