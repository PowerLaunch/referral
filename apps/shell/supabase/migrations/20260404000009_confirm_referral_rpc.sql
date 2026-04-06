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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION confirm_referral(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_referral(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION confirm_referral(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION confirm_referral(uuid, uuid, text) TO service_role;
