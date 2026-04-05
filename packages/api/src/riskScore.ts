import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Risk score is always computed fresh from fraud_flags — never cached or stored
// as a column. This ensures score reflects current state after admin resolutions.
// All flags count toward score regardless of is_resolved status.

// Service role client — this module is server-side only. Never import from client components.
// Lazy initialization to avoid build-time errors when env vars aren't available.
let adminClient: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing Supabase environment variables for risk scoring (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)'
      )
    }

    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return adminClient
}

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
  if (score <= 100) return 'HIGH'
  return 'CRITICAL'
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
  targetId: string
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
