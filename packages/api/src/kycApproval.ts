import type { SupabaseClient } from '@supabase/supabase-js'
import { hashKycId } from './kycHash'
import { checkIdentityCluster } from './fraudRules'

interface ApproveResult {
  success: boolean
  sybilDetected: boolean
  matchedUserId?: string
  error?: string
}

interface RejectResult {
  success: boolean
  error?: string
}

/**
 * Approve a KYC submission: hash the ID number, check for Sybil clusters
 * via the canonical checkIdentityCluster (R7), and update the submission.
 *
 * Raw ID number is NEVER stored or logged — only the HMAC hash is persisted.
 */
export async function approveKyc(
  admin: SupabaseClient,
  submissionId: string,
  rawIdNumber: string,
  adminId: string
): Promise<ApproveResult> {
  // Fetch submission, verify PENDING
  const { data: submission, error: fetchErr } = await admin
    .from('kyc_submissions')
    .select('id, user_id, status')
    .eq('id', submissionId)
    .single()

  if (fetchErr || !submission) {
    return { success: false, sybilDetected: false, error: 'Submission not found' }
  }

  if (submission.status !== 'PENDING') {
    return { success: false, sybilDetected: false, error: `Submission is ${submission.status}, not PENDING` }
  }

  const userId = submission.user_id as string

  // Canonicalize the ID number before hashing to prevent casing/spacing/separator
  // drift from producing different HMACs for the same document (weakens R7 detection).
  // Never store or log the raw or canonicalized value.
  const canonicalId = rawIdNumber.trim().toUpperCase().replace(/[\s\-\.]+/g, '')
  let kycHash: string
  try {
    kycHash = await hashKycId(canonicalId)
  } catch {
    // Do not log the error object — hashKycId already logs a generic Vault failure message.
    // Logging here could expose secret-handling internals on the sensitive KYC path.
    return { success: false, sybilDetected: false, error: 'Failed to hash ID number' }
  }

  // Use the canonical checkIdentityCluster from fraudRules.ts (R7).
  // This handles: hash update on profile, UNIQUE constraint Sybil detection,
  // REVIEW_HOLD + CRITICAL fraud flags, trust score adjustments (-300),
  // and voidPendingCredits for both accounts on collision.
  let sybilDetected = false
  let matchedUserId: string | undefined

  try {
    const clusterResult = await checkIdentityCluster(userId, kycHash)
    sybilDetected = clusterResult.isCluster
    matchedUserId = clusterResult.conflictingUserId
  } catch (clusterErr) {
    console.error('checkIdentityCluster failed:', clusterErr)
    return { success: false, sybilDetected: false, error: 'Identity verification failed — please retry' }
  }

  // Update submission to APPROVED — must succeed, otherwise roll back profile hash.
  // Use .select('id') so Supabase returns matched rows — without it, a zero-row
  // update (e.g., concurrent rejection) returns error: null.
  const { data: approvedRows, error: approveErr } = await admin
    .from('kyc_submissions')
    .update({
      status: 'APPROVED',
      id_hash_hmac: kycHash,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'PENDING')
    .select('id')

  if (approveErr || !approvedRows || approvedRows.length === 0) {
    if (approveErr) {
      console.error('Failed to mark submission as approved — rolling back profile hash:', approveErr)
    }
    // Rollback: clear ONLY the hash THIS call set (match on kycHash value)
    // so we don't accidentally destroy a concurrent admin's successfully committed hash.
    await admin.from('profiles').update({ verified_kyc_hash: null }).eq('id', userId).eq('verified_kyc_hash', kycHash)
    // Preserve sybilDetected state so the admin sees the Sybil warning even on
    // submission update failure — fraud flags and REVIEW_HOLD were already applied.
    return {
      success: false,
      sybilDetected,
      matchedUserId,
      error: sybilDetected
        ? 'Sybil detected and flagged, but submission update failed — check both accounts manually'
        : 'Submission was already processed or failed — please retry',
    }
  }

  // Audit log
  const { error: auditErr } = await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'kyc_approve',
    target_type: 'kyc_submission',
    target_id: submissionId,
    before_value: JSON.stringify({ status: 'PENDING' }),
    after_value: JSON.stringify({ status: 'APPROVED', sybil_detected: sybilDetected }),
    details: { user_id: userId, sybil_detected: sybilDetected, matched_user_id: matchedUserId },
  })
  if (auditErr) console.error('Audit log failed for kyc_approve:', auditErr)

  return { success: true, sybilDetected, matchedUserId }
}

/**
 * Reject a KYC submission with a reason.
 */
export async function rejectKyc(
  admin: SupabaseClient,
  submissionId: string,
  reason: string,
  notes: string | null,
  adminId: string
): Promise<RejectResult> {
  const { data: submission, error: fetchErr } = await admin
    .from('kyc_submissions')
    .select('id, user_id, status')
    .eq('id', submissionId)
    .single()

  if (fetchErr || !submission) {
    return { success: false, error: 'Submission not found' }
  }

  if (submission.status !== 'PENDING') {
    return { success: false, error: `Submission is ${submission.status}, not PENDING` }
  }

  const adminNotes = notes ? `${reason}: ${notes}` : reason

  // Use .select('id') to detect zero-row no-ops (concurrent processing)
  const { data: rejectedRows, error: rejectErr } = await admin
    .from('kyc_submissions')
    .update({
      status: 'REJECTED',
      admin_notes: adminNotes,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'PENDING')
    .select('id')

  if (rejectErr) {
    return { success: false, error: 'Failed to reject submission' }
  }
  if (!rejectedRows || rejectedRows.length === 0) {
    return { success: false, error: 'Submission was already processed by another admin' }
  }

  const { error: auditErr } = await admin.from('admin_audit_logs').insert({
    admin_user_id: adminId,
    action: 'kyc_reject',
    target_type: 'kyc_submission',
    target_id: submissionId,
    before_value: JSON.stringify({ status: 'PENDING' }),
    after_value: JSON.stringify({ status: 'REJECTED' }),
    details: { user_id: submission.user_id, reason, notes },
  })
  if (auditErr) console.error('Audit log failed for kyc_reject:', auditErr)

  return { success: true }
}
