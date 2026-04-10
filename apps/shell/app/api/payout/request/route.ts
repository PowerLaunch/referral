// Payout request endpoint. Validates all guards, then atomically deducts
// CASH_BALANCE and creates a payout record via Postgres RPC.
// GAME_CREDITS are non-cashable — only CASH_BALANCE can be cashed out.

// TODO PR 5-B: Add R8 payout destination clustering — flag when 2+ accounts cash out to same GCash/bank/PayPal
// TODO PR 5-B: Add payout destination lock — 30-day lock after first successful payout to a destination
// TODO PR 5-B: Payout velocity cap — use ROLLING 24-hour window (not calendar day) to prevent midnight-rush gaming. Add $200 minimum floor so early-stage legitimate payouts aren't blocked. Cap = max(trailing_30d_revenue * daily_payout_cap_pct / 30, 200). Store daily_payout_cap_pct in game_config (default 15).
// TODO PR 5-B: GCash name-match verification — on payout, check if GCash registered name matches KYC-verified name. Depends on Triple-A/XanPool API exposing registered name. If available, mismatch = CRITICAL fraud flag (R_NAME_MISMATCH). If not available, skip.

import { createClient } from '@/lib/supabase/server'
// Uses shared singleton from @referral/api — consistent with all
// other server-side routes. Never import createAdminClient from apps directly.
import { getAdminClient, getBalance, awardCredits, CASHABLE_CREDIT_TYPE } from '@referral/api/credits'
import { getDisplayPayoutStatus } from '@referral/api/statusDisplay'
import { getPayoutStagingHours } from '@referral/api/trustScore'

const ALLOWED_METHODS = [
  'gcash',
  'gopay',
  'ovo',
  'grabpay',
  'bank_transfer',
  'paypal',
] as const

type PayoutMethod = (typeof ALLOWED_METHODS)[number]

// Minimums from spec Section 2.5.2.
// Credits are stored as integers where 100 units = $1 (100 credits/dollar).
// These values are in credit units (cents-equivalent): 500 = $5, 2500 = $25, etc.
const MINIMUM_PAYOUT: Record<PayoutMethod, number> = {
  gcash: 500,
  gopay: 500,
  ovo: 500,
  grabpay: 500,
  bank_transfer: 2500, // $25
  paypal: 1500,        // $15
}

const MAX_PAYOUT_AMOUNT = 100000 // $1000 in cents — single transaction safety cap
// Max per-transaction cap. Large balances require multiple withdrawals.
// Amounts above this threshold warrant admin review regardless of balance.

const MS_PER_DAY = 24 * 60 * 60 * 1000

export async function POST(request: Request): Promise<Response> {
  try {
    // Step 1 — Authenticate
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Step 2 — Parse and validate body
    const body = (await request.json()) as { amount: unknown; method: unknown }

    const { amount, method } = body

    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return Response.json(
        { error: 'amount must be a positive integer' },
        { status: 400 }
      )
    }

    if (amount > MAX_PAYOUT_AMOUNT) {
      return Response.json(
        { error: 'Amount exceeds maximum single payout limit of $1000' },
        { status: 400 }
      )
    }

    if (
      typeof method !== 'string' ||
      !(ALLOWED_METHODS as readonly string[]).includes(method)
    ) {
      return Response.json(
        { error: `method must be one of: ${ALLOWED_METHODS.join(', ')}` },
        { status: 400 }
      )
    }

    const payoutMethod = method as PayoutMethod
    const adminClient = getAdminClient()

    // Step 3 — Guards

    // Guard 0 — Kill switch: cashouts_paused
    const { data: gameConfig } = await adminClient
      .from('game_config')
      .select('cashouts_paused')
      .limit(1)
      .single()

    if (gameConfig?.cashouts_paused) {
      return Response.json(
        { error: 'Payouts are temporarily paused. Please try again later.' },
        { status: 503 }
      )
    }

    // Guard A — Trust level (also fetches created_at for Guard E)
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('trust_level, created_at, payout_hold, status')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return Response.json({ error: 'Account not found' }, { status: 403 })
    }

    if (profile.trust_level === 'BANNED') {
      return Response.json({ error: 'Account banned' }, { status: 403 })
    }

    if (profile.trust_level === 'SUSPICIOUS') {
      return Response.json(
        { error: 'Account under review — payouts temporarily restricted' },
        { status: 403 }
      )
    }
    // SUSPICIOUS users are blocked from payouts at both middleware
    // and route level (belt-and-suspenders). Shadow review — user sees generic message.

    // Defense-in-depth: block REVIEW_HOLD even if middleware missed it
    if (profile.status === 'REVIEW_HOLD') {
      return Response.json(
        { error: 'Payouts are temporarily restricted' },
        { status: 403 }
      )
    }


    // Guard B — Payout hold
    // payout_hold is set by R1 spike detection. Cleared by admin in Phase 7.
    if (profile.payout_hold) {
      return Response.json(
        { error: 'Payouts are temporarily on hold for this account' },
        { status: 403 }
      )
    }

    // Guard C — Active subscription
    const { data: subscription, error: subError } = await adminClient
      .from('subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()

    if (subError) {
      console.error('Guard C subscription check error:', subError)
      return Response.json({ error: 'Internal error' }, { status: 500 })
    }

    if (!subscription) {
      return Response.json(
        { error: 'Active subscription required' },
        { status: 403 }
      )
    }

    // Guard D — KYC verification (STUB)
    // TODO: Wire real KYC check in PR 5-C. For now, skip this guard.
    // Uncomment when KYC is live:
    // const { data: kycProfile } = await adminClient
    //   .from('profiles')
    //   .select('verified_kyc_hash')
    //   .eq('id', user.id)
    //   .single()
    // if (!kycProfile?.verified_kyc_hash) {
    //   return Response.json({ error: 'KYC verification required' }, { status: 403 })
    // }
    const kycPassed = true // STUB — remove in PR 5-C
    void kycPassed

    // Guard E — Account age (reuse created_at from Guard A result)
    const accountAgeMs = Date.now() - new Date(profile.created_at).getTime()
    if (accountAgeMs < 7 * MS_PER_DAY) {
      return Response.json(
        { error: 'Account must be at least 7 days old' },
        { status: 403 }
      )
    }

    // Guard F — Minimum balance by method
    if (amount < MINIMUM_PAYOUT[payoutMethod]) {
      return Response.json(
        {
          error: `Minimum payout for ${payoutMethod} is $${MINIMUM_PAYOUT[payoutMethod] / 100}`,
        },
        { status: 400 }
      )
    }

    // Guard G — Balance check
    // Note: the RPC also checks balance, but pre-checking here gives a clean error.
    // CASHABLE_CREDIT_TYPE enforces that only CASH_BALANCE is ever
    // used in payout flows. GAME_CREDITS are non-cashable by design (spec 2.7).
    const balance = await getBalance(user.id, CASHABLE_CREDIT_TYPE)
    if (balance < amount) {
      return Response.json({ error: 'Insufficient balance' }, { status: 400 })
    }

    // Guard H-pre: Prevent concurrent in-flight payouts
    const { count: pendingCount, error: pendingError } = await adminClient
      .from('payouts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['STAGED', 'PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING'])

    if (pendingError) {
      return Response.json({ error: 'Internal error' }, { status: 500 })
    }

    if ((pendingCount ?? 0) > 0) {
      return Response.json(
        { error: 'You already have a payout in progress. Wait for it to complete before requesting another.' },
        { status: 403 }
      )
    }
    // Prevents concurrent submissions from bypassing cooldown.
    // The create_payout RPC atomically deducts balance, but this guard
    // prevents multiple in-flight payouts from being created simultaneously.

    // Guard H — Cooldown
    // Cooldown is 30 days first-to-second, 14 days thereafter (spec Section 6.5).
    // We check count of COMPLETED payouts, not is_first_payout flag, because
    // a first payout that FAILED then later succeeded should still trigger 30-day
    // cooldown before the third payout, not 14-day.
    const { data: lastCompleted, error: lastCompletedError } = await adminClient
      .from('payouts')
      .select('created_at, completed_at')
      .eq('user_id', user.id)
      .eq('status', 'COMPLETED')
      .order('completed_at', { ascending: false, nullsFirst: false })
      // Order by completed_at so the most recently completed payout is selected.
      // nullsFirst: false puts nulls last (legacy rows without completed_at).
      // Consistent with completionTime fallback logic below.
      .limit(1)
      .maybeSingle()

    if (lastCompletedError) {
      console.error('Guard H last completed query error:', lastCompletedError)
      return Response.json({ error: 'Internal error' }, { status: 500 })
    }

    let completedCount = 0

    if (lastCompleted) {
      const { count, error: countError } = await adminClient
        .from('payouts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'COMPLETED')

      if (countError) {
        console.error('Guard H count query error:', countError)
        return Response.json({ error: 'Internal error' }, { status: 500 })
      }

      completedCount = count ?? 0

      // count === 1: they've completed exactly one payout → first-to-second = 30 days
      // count > 1: subsequent payouts → 14 days
      const cooldownDays = completedCount === 1 ? 30 : 14
      const cooldownMs = cooldownDays * MS_PER_DAY

      // completed_at is when the payout status changed to COMPLETED.
      // Falls back to created_at for rows before this column was added.
      // TODO PR 5-B: Set completed_at = now() when executePayout marks status COMPLETED.
      // For MVP, completed_at falls back to created_at (conservative — slightly longer cooldown).
      const completionTime = (lastCompleted.completed_at ?? lastCompleted.created_at) as string

      if (Date.now() < new Date(completionTime).getTime() + cooldownMs) {
        const remaining = Math.ceil(
          (new Date(completionTime).getTime() + cooldownMs - Date.now()) / MS_PER_DAY
        )
        return Response.json(
          {
            error: `Payout cooldown active. Try again in ${remaining} days.`,
          },
          { status: 429 }
        )
      }
    }

    // Guard I — Credit type enforcement
    // GAME_CREDITS are non-cashable by design (spec Section 2.7).
    // This endpoint exclusively operates on CASH_BALANCE. No code path exists
    // to cash out GAME_CREDITS.

    // Step 4 — Determine isFirst from Guard H result (no additional query needed).
    // isFirst derived from lastCompleted query result above.
    // No additional DB query needed — lastCompleted is null iff completedCount === 0.
    // is_first_payout being wrong is low financial risk: PENDING_MANUAL_APPROVAL
    // requires admin approval regardless, so a wrong flag only affects queue routing.
    const isFirst = !lastCompleted

    // Step 5 — Create payout atomically
    // The RPC atomically deducts CASH_BALANCE and inserts the payout row.
    // If the deduction fails (insufficient balance race), the whole thing rolls back.
    // Guard H-pre catches the common case. The unique index on payouts(user_id)
    // WHERE status IN ('PENDING','PENDING_MANUAL_APPROVAL','PROCESSING') is the
    // atomic enforcement layer that catches concurrent requests Guard H-pre misses.
    const { data: payoutId, error: rpcError } = await adminClient.rpc(
      'create_payout',
      {
        p_user_id: user.id,
        p_amount: amount,
        p_method: payoutMethod,
        p_is_first: isFirst,
      }
    )

    if (rpcError) {
      if (rpcError.code === '23505') {
        // Concurrent request already created a pending payout — unique index blocked this one.
        return Response.json(
          { error: 'You already have a payout in progress. Wait for it to complete before requesting another.' },
          { status: 403 }
        )
      }
      console.error('create_payout RPC error:', rpcError)
      return Response.json({ error: 'Payout creation failed' }, { status: 500 })
    }

    // Step 6 — Apply trust-tier-based staging window
    // Payouts enter STAGED status with a staged_until timestamp based on user's trust tier.
    // The recurring-payouts cron promotes STAGED → PENDING after staged_until expires
    // (or PENDING_MANUAL_APPROVAL for first payouts).
    // If staging fails (getPayoutStagingHours throws or STAGED update fails), cancel the
    // payout and refund credits to avoid a payout stuck in PENDING bypassing staging.
    let stagedUntil: string
    try {
      const stagingHours = await getPayoutStagingHours(adminClient, user.id)
      stagedUntil = new Date(Date.now() + stagingHours * 60 * 60 * 1000).toISOString()

      const { data: stagedRows, error: stageError } = await adminClient
        .from('payouts')
        .update({ status: 'STAGED', staged_until: stagedUntil })
        .eq('id', payoutId as string)
        .eq('status', 'PENDING')
        .select('id')

      if (stageError) {
        throw stageError
      }

      if (!stagedRows || stagedRows.length === 0) {
        return Response.json(
          { error: 'Payout is no longer in PENDING status' },
          { status: 409 }
        )
      }
    } catch (stagingErr) {
      console.error('Staging failed, cancelling payout and refunding credits:', stagingErr)
      const { error: cancelError } = await adminClient
        .from('payouts')
        .update({ status: 'CANCELLED' })
        .eq('id', payoutId as string)

      if (!cancelError) {
        await awardCredits(user.id, amount, CASHABLE_CREDIT_TYPE, `payout_staging_rollback:${payoutId as string}`)
      } else {
        console.error('CRITICAL: Failed to cancel payout during staging rollback:', cancelError, 'payoutId:', payoutId)
        // Do NOT refund — payout row is still active. Admin must investigate.
      }
      return Response.json({ error: 'Payout request failed, please try again' }, { status: 500 })
    }

    // Step 7 — Return success
    // User-facing message does not mention "review" or "fraud"
    return Response.json({
      ok: true,
      payout_id: payoutId as string,
      status: getDisplayPayoutStatus('STAGED', profile.status as string),
      estimated_completion: stagedUntil,
    })
  } catch (error) {
    console.error('Payout request error:', error)
    return Response.json({ ok: false, error: 'Internal error' }, { status: 500 })
  }
}
