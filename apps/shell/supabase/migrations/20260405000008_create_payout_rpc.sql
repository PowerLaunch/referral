-- PR 3-D: Payout workflow — atomic create_payout RPC
--
-- Atomically deducts CASH_BALANCE and inserts the payout row in one transaction.
-- If any step fails, all roll back. No funds disappear without a payout record.
-- This function does the deduction inline (not via deduct_credits RPC) because
-- calling one Supabase RPC from another requires PERFORM which cannot capture
-- the FOUND check cleanly for the balance guard.

CREATE OR REPLACE FUNCTION create_payout(
  p_user_id uuid,
  p_amount integer,
  p_method text,
  p_is_first boolean,
  p_reason text DEFAULT 'payout_request'
) RETURNS uuid AS $$
DECLARE
  v_payout_id uuid;
  v_status text;
BEGIN
  -- Determine status based on first-payout flag
  IF p_is_first THEN
    v_status := 'PENDING_MANUAL_APPROVAL';
  ELSE
    v_status := 'PENDING';
  END IF;

  -- Step 1: Deduct from CASH_BALANCE (this checks sufficient funds)
  -- Read current balance, verify, deduct — all in this transaction
  UPDATE user_credits
  SET amount = amount - p_amount, updated_at = now()
  WHERE user_id = p_user_id
    AND type = 'CASH_BALANCE'
    AND amount >= p_amount;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient CASH_BALANCE for user %', p_user_id;
  END IF;

  -- Step 2: Insert ledger entry (negative for deduction)
  INSERT INTO credit_transactions (id, user_id, amount, type, reason, created_at)
  VALUES (gen_random_uuid(), p_user_id, -p_amount, 'CASH_BALANCE', p_reason, now());

  -- Step 3: Insert payout row
  INSERT INTO payouts (user_id, amount, method, status, is_first_payout, created_at)
  VALUES (p_user_id, p_amount, p_method, v_status, p_is_first, now())
  RETURNING id INTO v_payout_id;

  RETURN v_payout_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION create_payout(uuid, integer, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_payout(uuid, integer, text, boolean, text) TO service_role;
