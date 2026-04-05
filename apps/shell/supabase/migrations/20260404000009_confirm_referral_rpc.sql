-- PR 3-B: Atomic referral confirmation RPC
-- The confirmation must update the referral status AND insert an audit log
-- in a single atomic transaction. If either fails, neither should commit.
-- Using two separate Supabase client calls is NOT atomic — a crash between
-- them leaves the referral CONFIRMED with no audit trail.

CREATE OR REPLACE FUNCTION confirm_referral(
  p_referral_id uuid,
  p_triggered_by uuid,
  p_reason text DEFAULT 'All confirmation criteria passed'
) RETURNS void AS $$
BEGIN
  -- Update referral status and set confirmed_at timestamp
  UPDATE referrals
  SET status = 'CONFIRMED', confirmed_at = now()
  WHERE id = p_referral_id AND status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral % is not PENDING', p_referral_id;
  END IF;

  -- Insert audit log in same transaction
  INSERT INTO referral_audit_logs (referral_id, action, reason, triggered_by)
  VALUES (p_referral_id, 'CONFIRM', p_reason, p_triggered_by);

  -- Award $2 CASH_BALANCE to referrer (atomic with status change)
  -- $2 = 200 credits per spec (100 credits = $1 USD)
  UPDATE user_credits
  SET amount = amount + 200, updated_at = now()
  WHERE user_id = (SELECT referrer_id FROM referrals WHERE id = p_referral_id)
    AND type = 'CASH_BALANCE';

  -- Insert credit ledger entry
  INSERT INTO credit_transactions (id, user_id, amount, type, reason, created_at)
  SELECT
    gen_random_uuid(),
    referrer_id,
    200,
    'CASH_BALANCE',
    'referral_confirmed:' || p_referral_id,
    now()
  FROM referrals WHERE id = p_referral_id;

  -- Credits awarded inside RPC so they are atomic with the PENDING → CONFIRMED
  -- status change. If referral is VOIDED before this runs, the earlier guard
  -- (WHERE status = 'PENDING') raises an exception and rolls everything back.
  -- This prevents orphaned credits from the voidPendingCredits race condition.
  -- The unique index on credit_transactions (user_id, reason) where reason LIKE
  -- 'referral_confirmed:%' prevents double-awarding if RPC is called twice.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION confirm_referral(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_referral(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION confirm_referral(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION confirm_referral(uuid, uuid, text) TO service_role;
