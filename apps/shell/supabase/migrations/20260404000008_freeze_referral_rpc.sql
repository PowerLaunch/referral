-- PR 3-C: Atomic freeze referral RPC
-- When a referrer's subscription lapses, their PENDING referrals' lock timers freeze.
-- The freeze is IDEMPOTENT: calling it on an already-frozen referral is a no-op.
-- This handles duplicate webhooks from payment providers.
-- Atomicity: referral update + audit log insert in single transaction.

CREATE OR REPLACE FUNCTION freeze_referral(
  p_referral_id uuid,
  p_reason text
) RETURNS void AS $$
DECLARE
  v_referral referrals%ROWTYPE;
BEGIN
  SELECT * INTO v_referral
  FROM referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral % does not exist', p_referral_id;
  END IF;

  IF v_referral.lock_timer_frozen IS TRUE THEN
    -- Already frozen — silently return. This is not an error.
    -- A duplicate webhook could trigger this. Idempotent behavior.
    RETURN;
  END IF;

  IF v_referral.status != 'PENDING' THEN
    -- Only PENDING referrals can be frozen. Others are already finalized.
    RETURN;
  END IF;

  UPDATE referrals SET
    lock_timer_frozen = true,
    frozen_at = now()
  WHERE id = p_referral_id;

  INSERT INTO referral_audit_logs (referral_id, action, reason, triggered_by, created_at)
  VALUES (p_referral_id, 'FREEZE', p_reason, null, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION freeze_referral(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION freeze_referral(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION freeze_referral(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION freeze_referral(uuid, text) TO service_role;
