-- Atomically increments retry_count on a payout row and returns the new value.
-- Called from handlePayoutFailure instead of client-side math to prevent lost
-- updates when two concurrent failure webhooks both read the same retry_count.

CREATE OR REPLACE FUNCTION increment_payout_retry(p_payout_id uuid)
RETURNS integer AS $$
DECLARE
  v_new_count integer;
BEGIN
  UPDATE payouts
  SET retry_count = retry_count + 1
  WHERE id = p_payout_id
  RETURNING retry_count INTO v_new_count;
  RETURN v_new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION increment_payout_retry(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_payout_retry(uuid) TO service_role;
