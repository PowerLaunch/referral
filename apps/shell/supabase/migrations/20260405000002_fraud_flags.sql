-- PR 4-A: Fraud flags table
-- Stores fraud rule violations (R1-R7). Never deleted — is_resolved marks admin review.
-- All flags count toward risk score regardless of is_resolved.

CREATE TABLE fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  rule_triggered text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  details jsonb,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fraud_flags ENABLE ROW LEVEL SECURITY;
-- No user policies. Admin/service role only.

-- Idempotency index: prevents the same rule from firing twice on the same user
-- on the same calendar day. The cron runs every 15 minutes, so without this,
-- R1-R6 would create duplicate flags on every run.
-- CRITICAL: Use timezone 'UTC' explicitly. DATE(created_at) without timezone
-- uses the server's local timezone, which could differ between Supabase regions.
CREATE UNIQUE INDEX idx_fraud_flags_idempotent
  ON fraud_flags(user_id, rule_triggered, (created_at AT TIME ZONE 'UTC')::date)
  WHERE is_resolved = false;

-- The WHERE clause means resolved flags don't block new flags for the same rule.
-- If a flag is resolved by admin and the same behavior recurs, a new flag can be created.

-- Index for risk score calculation (queries all flags for a user)
CREATE INDEX idx_fraud_flags_user_id ON fraud_flags(user_id);

-- All flags count toward risk score regardless of is_resolved.
