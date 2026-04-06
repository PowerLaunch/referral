-- PR 3-C: Atomic unfreeze referral RPC
-- When a referrer resubscribes, their PENDING frozen referrals resume their lock timers.
-- The new payout_eligible_at is calculated from the remaining lock period at time of freeze.
-- Atomicity: referral update + audit log insert in single transaction.

CREATE OR REPLACE FUNCTION unfreeze_referral(
  p_referral_id uuid,
  p_new_payout_date timestamptz,
  p_reason text
) RETURNS void AS $$
DECLARE
  v_referral referrals%ROWTYPE;
BEGIN
  -- Lock the row to prevent concurrent unfreeze (SELECT FOR UPDATE)
  SELECT * INTO v_referral
  FROM referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral % does not exist', p_referral_id;
  END IF;

  IF v_referral.lock_timer_frozen IS NOT TRUE THEN
    RAISE EXCEPTION 'Referral % is not currently frozen (lock_timer_frozen = %)',
      p_referral_id, v_referral.lock_timer_frozen;
  END IF;

  IF v_referral.status != 'PENDING' THEN
    RAISE EXCEPTION 'Referral % is not PENDING (status = %), cannot unfreeze',
      p_referral_id, v_referral.status;
  END IF;

  -- Atomic: update referral + insert audit log in same transaction
  UPDATE referrals SET
    lock_timer_frozen = false,
    frozen_at = null,
    payout_eligible_at = p_new_payout_date
  WHERE id = p_referral_id;

  INSERT INTO referral_audit_logs (referral_id, action, reason, triggered_by, created_at)
  VALUES (p_referral_id, 'UNFREEZE', p_reason, null, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION unfreeze_referral(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION unfreeze_referral(uuid, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION unfreeze_referral(uuid, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION unfreeze_referral(uuid, timestamptz, text) TO service_role;
