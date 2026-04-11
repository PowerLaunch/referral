-- Phase 10-D: Signup funnel anomaly detection
-- Adds signup_telemetry JSONB column to profiles for storing client-side timing signals.
-- Schema: { link_click_at, signup_submit_at, form_fill_ms, input_corrections }
-- Note: scroll_events is reserved in the JSONB schema for future use if the signup page grows beyond one viewport.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS signup_telemetry jsonb;

COMMENT ON COLUMN profiles.signup_telemetry IS 'Client-side signup funnel telemetry: timing, scroll, correction signals for fraud detection';

-- Partial unique indexes on trust_score_events for telemetry reason idempotency.
-- Matches the pattern used by datacenter_ip_signup and vip_signup_bonus indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_fast_signup
  ON trust_score_events (user_id) WHERE reason = 'fast_signup';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_fast_form_fill
  ON trust_score_events (user_id) WHERE reason = 'fast_form_fill';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_no_corrections
  ON trust_score_events (user_id) WHERE reason = 'no_corrections_signup';
