-- Idempotency indexes for fraud_flags (PR 4-B/4-C)
-- Ensures each rule fires at most once per user per UTC day.
-- R4 is global (user_id = null) so requires separate index.

-- Drop old indexes if they exist (from earlier iterations of this PR)
DROP INDEX IF EXISTS idx_fraud_flags_idempotent;
DROP INDEX IF EXISTS idx_fraud_flags_idempotency;

-- User-specific flags (R1–R6): one per user per rule per UTC day
CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_flags_user_rule_day
  ON fraud_flags(user_id, rule_triggered, CAST(timezone('UTC', created_at) AS date))
  WHERE user_id IS NOT NULL AND is_resolved = false;

-- Global flags (R4): one per rule per UTC day
CREATE UNIQUE INDEX IF NOT EXISTS idx_fraud_flags_global_rule_day
  ON fraud_flags(rule_triggered, CAST(timezone('UTC', created_at) AS date))
  WHERE user_id IS NULL AND is_resolved = false;
