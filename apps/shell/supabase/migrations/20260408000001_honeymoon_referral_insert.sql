-- Atomic honeymoon check + referral insert (PR 19 — TOCTOU fix)
-- Uses advisory lock to prevent race condition where two concurrent
-- signups with the same referrer both see length === 0 and both insert.
CREATE OR REPLACE FUNCTION public.create_referral_with_honeymoon(
  p_referrer_id UUID,
  p_referee_id UUID,
  p_referral_code TEXT,
  p_lock_period_days INT,
  p_country_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_count INT;
  v_first_created TIMESTAMPTZ;
  v_payout_eligible_at TIMESTAMPTZ;
BEGIN
  -- Advisory lock on referrer to serialize concurrent signups
  PERFORM pg_advisory_xact_lock(hashtext('honeymoon_' || p_referrer_id::text));

  -- Count existing PENDING/CONFIRMED referrals for this referrer
  SELECT COUNT(*), MIN(created_at)
  INTO v_existing_count, v_first_created
  FROM referrals
  WHERE referrer_id = p_referrer_id
    AND status IN ('PENDING', 'CONFIRMED');

  -- Honeymoon logic:
  -- 0 existing = first referral, allow
  -- 1 existing = check 14-day window
  -- 2+ existing = honeymoon passed, allow
  IF v_existing_count = 1
     AND v_first_created + INTERVAL '14 days' > timezone('UTC', now())
  THEN
    RETURN jsonb_build_object(
      'created', false,
      'reason', 'honeymoon_cooldown',
      'unlocks_at', (v_first_created + INTERVAL '14 days')::text
    );
  END IF;

  -- Calculate payout_eligible_at from lock period
  v_payout_eligible_at := timezone('UTC', now())
    + (p_lock_period_days || ' days')::INTERVAL;

  -- Insert the referral
  INSERT INTO referrals (
    referrer_id,
    referee_id,
    referral_code,
    status,
    payout_eligible_at,
    country_code,
    lock_timer_frozen
  ) VALUES (
    p_referrer_id,
    p_referee_id,
    p_referral_code,
    'PENDING',
    v_payout_eligible_at,
    p_country_code,
    false
  );

  RETURN jsonb_build_object('created', true);
END;
$$;

-- Restrict to service_role only
REVOKE ALL ON FUNCTION public.create_referral_with_honeymoon(UUID, UUID, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_referral_with_honeymoon(UUID, UUID, TEXT, INT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.create_referral_with_honeymoon(UUID, UUID, TEXT, INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_referral_with_honeymoon(UUID, UUID, TEXT, INT, TEXT) TO service_role;
