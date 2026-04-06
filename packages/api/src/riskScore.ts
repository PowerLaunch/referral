import { getAdminClient } from './credits'

// Risk score is always computed fresh from fraud_flags — never cached or stored
// as a column. This ensures score reflects current state after admin resolutions.
// All flags count toward score regardless of is_resolved status.

/**
 * Get risk score for a user by summing severity scores of all fraud flags.
 * Risk score is always computed fresh — never cached or stored as a column.
 * @param userId - User UUID
 * @returns Risk score (0 if no flags or on error)
 */
export async function getUserRiskScore(userId: string): Promise<number> {
  const { data: flags, error } = await getAdminClient()
    .from('fraud_flags')
    .select('severity')
    .eq('user_id', userId)

  if (error) {
    console.error(`Risk score query failed for user ${userId}:`, error.message)
    // Fail open — a DB error should not freeze a legitimate user.
    return 0
  }

  if (!flags || flags.length === 0) return 0

  const SEVERITY_SCORES: Record<string, number> = {
    INFO: 10,
    WARNING: 30,
    CRITICAL: 50,
  }

  let total = 0
  for (const flag of flags) {
    total += SEVERITY_SCORES[flag.severity] ?? 0
  }
  return total
}

/**
 * Get risk category from numeric risk score.
 * Spec Section 6.4: LOW 0-30, MEDIUM 31-60, HIGH 61-100, CRITICAL 100+
 * @param score - Numeric risk score
 * @returns Risk category
 */
export function getRiskCategory(
  score: number
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score <= 30) return 'LOW'
  if (score <= 60) return 'MEDIUM'
  if (score < 100) return 'HIGH'
  return 'CRITICAL'
  // Note: score of exactly 100 is CRITICAL per spec Section 6.4 (100+ = CRITICAL).
}

/**
 * Log an admin action to the audit trail.
 * Called by admin dashboard actions in Phase 7 and by fraud rules that change trust_level in Phase 4.
 * @param params - Admin action details
 */
export async function logAdminAction(params: {
  adminUserId: string | null
  action: string
  targetType: string
  targetId: string | null
  beforeValue?: string | null
  afterValue?: string | null
  reason?: string | null
}): Promise<void> {
  const { error } = await getAdminClient()
    .from('admin_audit_logs')
    .insert({
      admin_user_id: params.adminUserId,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      before_value: params.beforeValue ?? null,
      after_value: params.afterValue ?? null,
      reason: params.reason ?? null,
    })

  if (error) {
    // Log but do not throw — audit log failure should not block the action it's logging.
    console.error('Failed to write admin audit log:', error.message)
  }
}
