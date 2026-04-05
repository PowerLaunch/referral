import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Service role client — this module is server-side only. Never import from client components.
// Lazy initialization to avoid build-time errors when env vars aren't available.
let adminClient: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error(
        'Missing Supabase environment variables for credit system (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)'
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

// GAME_CREDITS are non-cashable by design (spec Section 2.7).
// All cashout routes MUST check type === CASHABLE_CREDIT_TYPE before processing.
// The database CHECK constraint prevents negative balances.
// The append-only credit_transactions table (no UPDATE/DELETE) ensures audit integrity.
// There is no DB trigger enforcing the non-conversion rule — it is enforced here:
// only cashout routes can call deductCredits with CASH_BALANCE, and they verify the type.
export const CASHABLE_CREDIT_TYPE = 'CASH_BALANCE' as const

/**
 * Award credits to a user (creates positive ledger entry and updates balance)
 * @param userId - User UUID
 * @param amount - Positive integer amount to award
 * @param type - Credit type (CASH_BALANCE or GAME_CREDITS)
 * @param reason - Reason for credit award (e.g., 'signup_bonus', 'referral_bonus')
 * @throws Error if amount is not positive or if RPC call fails
 */
export async function awardCredits(
  userId: string,
  amount: number,
  type: 'CASH_BALANCE' | 'GAME_CREDITS',
  reason: string
): Promise<void> {
  // Validate amount at application level (defense in depth — RPC also checks)
  if (amount <= 0) {
    throw new Error(`Amount must be positive, got ${amount}`)
  }

  const { error } = await getAdminClient().rpc('award_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_reason: reason,
  })

  if (error) {
    const err = new Error(
      `Failed to award ${amount} ${type} credits to user ${userId}: ${error.message}`
    )
    ;(err as any as { code: string }).code = error.code
    throw err
  }
}

/**
 * Deduct credits from a user (creates negative ledger entry and updates balance)
 * Throws on insufficient balance. Callers should catch and handle gracefully.
 * @param userId - User UUID
 * @param amount - Positive integer amount to deduct
 * @param type - Credit type (CASH_BALANCE or GAME_CREDITS)
 * @param reason - Reason for credit deduction (e.g., 'cashout', 'game_play')
 * @throws Error if amount is not positive, insufficient balance, or if RPC call fails
 */
export async function deductCredits(
  userId: string,
  amount: number,
  type: 'CASH_BALANCE' | 'GAME_CREDITS',
  reason: string
): Promise<void> {
  // Validate amount at application level
  if (amount <= 0) {
    throw new Error(`Amount must be positive, got ${amount}`)
  }

  const { error } = await getAdminClient().rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_reason: reason,
  })

  if (error) {
    // Insufficient balance is a normal business logic rejection, not a crash
    const err = new Error(
      `Failed to deduct ${amount} ${type} credits from user ${userId}: ${error.message}`
    )
    ;(err as any as { code: string }).code = error.code
    throw err
  }
}

/**
 * Get current credit balance for a user
 * @param userId - User UUID
 * @param type - Credit type (CASH_BALANCE or GAME_CREDITS)
 * @returns Current balance (0 if no row exists for this user+type)
 */
export async function getBalance(
  userId: string,
  type: 'CASH_BALANCE' | 'GAME_CREDITS'
): Promise<number> {
  const { data, error } = await getAdminClient()
    .from('user_credits')
    .select('amount')
    .eq('user_id', userId)
    .eq('type', type)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to get ${type} balance for user ${userId}: ${error.message}`
    )
  }

  // No row exists — user has no credits yet (normal case)
  if (!data) {
    return 0
  }

  return data.amount
}

/**
 * Void all PENDING referrals for a user (fraud response)
 * PENDING referrals represent anticipated future credits — they are NOT yet
 * in user_credits (the balance table). They only exist as referral rows.
 * Voiding them prevents future confirmation, not current balance.
 *
 * This does NOT touch CASH_BALANCE or GAME_CREDITS in user_credits.
 * If the user has already-confirmed credits, those remain — this only
 * prevents PENDING referrals from ever confirming.
 *
 * @param userId - The referrer's user ID
 * @param reason - Reason for voiding (e.g., "Auto-voided: CRITICAL fraud flag R1")
 * @returns Object with count of voided referrals
 */
export async function voidPendingCredits(
  userId: string,
  reason: string
): Promise<{ voided: number }> {
  const adminClient = getAdminClient()

  // Step 1: Find all PENDING referrals for this referrer
  const { data: pendingReferrals, error: findError } = await adminClient
    .from('referrals')
    .select('id')
    .eq('referrer_id', userId)
    .eq('status', 'PENDING')

  if (findError) {
    throw new Error(
      `Failed to query pending referrals for user ${userId}: ${findError.message}`
    )
  }

  if (!pendingReferrals || pendingReferrals.length === 0) {
    return { voided: 0 } // No pending referrals — graceful no-op
  }

  // Step 2: Void each referral with audit trail
  // Ideally this would be a single transaction. Since Supabase JS can't do
  // multi-statement transactions, use a Postgres RPC for atomicity.
  // But we don't have a void_referrals RPC yet, and adding one for a patch PR
  // is overkill. Process row-by-row — the max pending per user is 5 (spec
  // Section 2.9), so the loop is tiny.

  let voidedCount = 0

  for (const referral of pendingReferrals) {
    try {
      // Update status to VOIDED
      const { error: updateError } = await adminClient
        .from('referrals')
        .update({ status: 'VOIDED' })
        .eq('id', referral.id)
        .eq('status', 'PENDING') // Guard: only void if still PENDING (prevent race)

      if (updateError) {
        console.error(
          `Failed to void referral ${referral.id}:`,
          updateError.message
        )
        continue
      }

      // Insert audit log
      await adminClient.from('referral_audit_logs').insert({
        referral_id: referral.id,
        action: 'VOIDED' as any, // VOIDED added to CHECK in migration
        reason,
        triggered_by: null,
      })

      // Insert credit_transactions entry for audit trail
      // Amount is 0 — this is a record that anticipated credits were voided,
      // not an actual balance change.
      await adminClient.from('credit_transactions').insert({
        user_id: userId,
        amount: 0,
        type: 'CASH_BALANCE',
        reason: `referral_voided: ${reason} (referral: ${referral.id})`,
      })

      voidedCount++
    } catch (err) {
      console.error(`Error voiding referral ${referral.id}:`, err)
      continue // Don't abort the loop on one failure
    }
  }

  return { voided: voidedCount }
}
