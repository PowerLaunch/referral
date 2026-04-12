import type { SupabaseClient } from '@supabase/supabase-js'
import { hashKycId } from './kycHash'

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
 * Approve a KYC submission: hash the ID number, check for Sybil clusters,
 * and update the submission + profile.
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

  // Attempt to set verified_kyc_hash on profile
  // UNIQUE constraint on verified_kyc_hash detects Sybil (R7)
  const { error: profileErr } = await admin
    .from('profiles')
    .update({ verified_kyc_hash: kycHash })
    .eq('id', userId)

  let sybilDetected = false
  let matchedUserId: string | undefined

  if (profileErr) {
    if (profileErr.code === '23505') {
      // Sybil detected — another user has the same KYC hash
      sybilDetected = true

      // Find the matching user
      const { data: match } = await admin
        .from('profiles')
        .select('id')
        .eq('verified_kyc_hash', kycHash)
        .neq('id', userId)
        .limit(1)
        .maybeSingle()

      matchedUserId = (match?.id as string) ?? undefined

      // Place both accounts in REVIEW_HOLD — but never downgrade a BANNED user.
      // A malicious actor could exploit Sybil detection to unban an account by
      // submitting a KYC document with a banned user's ID number.
      for (const flagUserId of [userId, matchedUserId].filter((id): id is string => id !== undefined)) {
        const { error: holdErr } = await admin
          .from('profiles')
          .update({ trust_level: 'SUSPICIOUS', status: 'REVIEW_HOLD' })
          .eq('id', flagUserId)
          .neq('trust_level', 'BANNED')

        if (holdErr) {
          console.error(`Failed to set REVIEW_HOLD for ${flagUserId}:`, holdErr)
        }

        // Insert CRITICAL fraud flag
        const { error: flagErr } = await admin.from('fraud_flags').insert({
          user_id: flagUserId,
          rule_triggered: 'R7_SYBIL',
          severity: 'CRITICAL',
          details: {
            kyc_hash_collision: true,
            submission_id: submissionId,
            matched_user_id: flagUserId === userId ? matchedUserId : userId,
          },
        })
        if (flagErr && flagErr.code !== '23505') {
          console.error(`Sybil fraud flag insert failed for ${flagUserId}:`, flagErr)
        }
      }
    } else {
      console.error('Failed to update profile KYC hash:', profileErr)
      return { success: false, sybilDetected: false, error: 'Failed to update profile' }
    }
  }

  // Update submission to APPROVED — must succeed, otherwise roll back profile hash.
  // This approximates atomicity: if submission update fails, we clear the profile
  // hash so the payout gate doesn't pass on a stuck-PENDING submission.
  // A proper Postgres RPC would be ideal (CLAUDE.md §4.12) but is deferred to a
  // follow-up migration to keep this PR scoped to the application layer.
  // Use .select('id') so Supabase returns the matched rows — without it,
  // a zero-row update (e.g., concurrent rejection) returns error: null,
  // and the rollback never triggers.
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
    // Rollback: clear the profile hash so payout gate doesn't pass on a
    // stuck-PENDING or concurrently-rejected submission.
    await admin.from('profiles').update({ verified_kyc_hash: null }).eq('id', userId)
    return { success: false, sybilDetected: false, error: 'Submission was already processed or failed — please retry' }
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
