-- Canonical credit ledger system — atomic RPC functions for all credit operations
-- PR 3-A: Replace inline credit logic with these RPCs

-- Award credits (positive ledger entry + balance update)
CREATE OR REPLACE FUNCTION award_credits(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_reason text
) RETURNS void AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive, got %', p_amount;
  END IF;

  -- Insert ledger entry
  INSERT INTO credit_transactions (id, user_id, amount, type, reason, created_at)
  VALUES (gen_random_uuid(), p_user_id, p_amount, p_type, p_reason, now());

  -- Upsert balance row (handles first-ever credit for this user+type)
  -- UNIQUE constraint on (user_id, type) exists from Phase 1 foundation migration
  INSERT INTO user_credits (id, user_id, amount, type, updated_at)
  VALUES (gen_random_uuid(), p_user_id, p_amount, p_type, now())
  ON CONFLICT (user_id, type) DO UPDATE
  SET amount = user_credits.amount + EXCLUDED.amount,
      updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Deduct credits (negative ledger entry + atomic balance check/update)
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id uuid,
  p_amount integer,
  p_type text,
  p_reason text
) RETURNS void AS $$
DECLARE
  rows_affected integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive, got %', p_amount;
  END IF;

  -- Atomic deduction with balance check in one statement (prevents race condition)
  UPDATE user_credits
  SET amount = amount - p_amount, updated_at = now()
  WHERE user_id = p_user_id AND type = p_type AND amount >= p_amount;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;

  IF rows_affected = 0 THEN
    RAISE EXCEPTION 'Insufficient % balance for user %', p_type, p_user_id;
  END IF;

  -- Insert ledger entry (negative amount for deduction)
  INSERT INTO credit_transactions (id, user_id, amount, type, reason, created_at)
  VALUES (gen_random_uuid(), p_user_id, -p_amount, p_type, p_reason, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute to service_role only (these are server-side operations)
REVOKE EXECUTE ON FUNCTION award_credits(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_credits(uuid, integer, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION deduct_credits(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION deduct_credits(uuid, integer, text, text) TO service_role;
