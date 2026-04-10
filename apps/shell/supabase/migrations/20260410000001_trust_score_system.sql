-- Phase 10-A: Graduated Trust Score System
-- Adds trust_score (0-1000) and trust_tier to profiles.
-- Creates append-only trust_score_events ledger.
-- Adds tier-based payout staging configuration to game_config.
-- Creates atomic RPC for trust score adjustment.

-- 1a. New columns on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trust_score integer NOT NULL DEFAULT 200;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trust_tier text NOT NULL DEFAULT 'STANDARD';
ALTER TABLE profiles ADD CONSTRAINT profiles_trust_score_range CHECK (trust_score >= 0 AND trust_score <= 1000);
ALTER TABLE profiles ADD CONSTRAINT profiles_trust_tier_valid CHECK (trust_tier IN ('PROBATION', 'STANDARD', 'TRUSTED', 'VETERAN'));

-- 1b. New columns on game_config (trust tier thresholds — admin-configurable)
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS trust_tier_probation_max integer NOT NULL DEFAULT 199;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS trust_tier_standard_max integer NOT NULL DEFAULT 499;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS trust_tier_trusted_max integer NOT NULL DEFAULT 799;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS payout_staging_probation_hours integer NOT NULL DEFAULT 240;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS payout_staging_standard_hours integer NOT NULL DEFAULT 72;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS payout_staging_trusted_hours integer NOT NULL DEFAULT 24;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS payout_staging_veteran_hours integer NOT NULL DEFAULT 1;
ALTER TABLE game_config ADD COLUMN IF NOT EXISTS vip_referral_cap integer NOT NULL DEFAULT 200;

-- 1c. Append-only trust_score_events ledger
CREATE TABLE trust_score_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  delta integer NOT NULL,
  reason text NOT NULL,
  rule_triggered text,
  score_before integer NOT NULL,
  score_after integer NOT NULL,
  tier_before text NOT NULL,
  tier_after text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE trust_score_events ENABLE ROW LEVEL SECURITY;
REVOKE UPDATE, DELETE ON trust_score_events FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY "service_role_insert" ON trust_score_events FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "service_role_select" ON trust_score_events FOR SELECT TO service_role USING (true);
CREATE INDEX idx_trust_score_events_user_id ON trust_score_events(user_id);
CREATE INDEX idx_trust_score_events_reason ON trust_score_events(reason);

-- 1d. Partial unique indexes for one-time trust bonuses (idempotency)
-- Prevents duplicate referral_longevity bonuses: one per referral
CREATE UNIQUE INDEX idx_trust_score_events_unique_reason
  ON trust_score_events(user_id, reason)
  WHERE reason LIKE 'referral_longevity:%';

-- Prevents duplicate monthly subscription bonuses: one per user per month
CREATE UNIQUE INDEX idx_trust_score_events_unique_subscription
  ON trust_score_events(user_id, reason)
  WHERE reason LIKE 'monthly_subscription:%';

-- Prevents duplicate monthly gameplay bonuses: one per user per month
CREATE UNIQUE INDEX idx_trust_score_events_unique_gameplay
  ON trust_score_events(user_id, reason)
  WHERE reason LIKE 'monthly_gameplay_bonus:%';

-- Prevents duplicate VIP signup bonus: one per user ever
CREATE UNIQUE INDEX idx_trust_score_events_unique_vip_bonus
  ON trust_score_events(user_id, reason)
  WHERE reason = 'vip_signup_bonus';

-- 1e. Payouts table additions for staging
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS staged_until timestamptz;

-- Update the payouts status CHECK constraint to include STAGED.
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('STAGED', 'PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'));

-- Update partial unique index to include STAGED — prevents concurrent payout double-spend.
DROP INDEX IF EXISTS idx_payouts_one_pending_per_user;
CREATE UNIQUE INDEX idx_payouts_one_pending_per_user ON payouts(user_id)
  WHERE status IN ('STAGED', 'PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING');

-- 1f. RPC function for atomic trust score adjustment
CREATE OR REPLACE FUNCTION public.adjust_trust_score(
  p_user_id uuid,
  p_delta integer,
  p_reason text,
  p_rule_triggered text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_score_before integer;
  v_score_after integer;
  v_tier_before text;
  v_tier_after text;
  v_probation_max integer;
  v_standard_max integer;
  v_trusted_max integer;
BEGIN
  -- Read current score (FOR UPDATE prevents lost updates from concurrent calls)
  SELECT trust_score, trust_tier INTO v_score_before, v_tier_before
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  -- Clamp new score to 0-1000
  v_score_after := GREATEST(0, LEAST(1000, v_score_before + p_delta));

  -- Read tier thresholds from game_config
  SELECT trust_tier_probation_max, trust_tier_standard_max, trust_tier_trusted_max
  INTO v_probation_max, v_standard_max, v_trusted_max
  FROM public.game_config WHERE singleton = true;

  -- Compute new tier
  IF v_score_after <= v_probation_max THEN
    v_tier_after := 'PROBATION';
  ELSIF v_score_after <= v_standard_max THEN
    v_tier_after := 'STANDARD';
  ELSIF v_score_after <= v_trusted_max THEN
    v_tier_after := 'TRUSTED';
  ELSE
    v_tier_after := 'VETERAN';
  END IF;

  -- Update profile
  UPDATE public.profiles
  SET trust_score = v_score_after, trust_tier = v_tier_after
  WHERE id = p_user_id;

  -- Insert ledger event
  INSERT INTO public.trust_score_events (user_id, delta, reason, rule_triggered, score_before, score_after, tier_before, tier_after)
  VALUES (p_user_id, p_delta, p_reason, p_rule_triggered, v_score_before, v_score_after, v_tier_before, v_tier_after);

  RETURN jsonb_build_object(
    'score_before', v_score_before,
    'score_after', v_score_after,
    'tier_before', v_tier_before,
    'tier_after', v_tier_after
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.adjust_trust_score(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_trust_score(uuid, integer, text, text) TO service_role;
