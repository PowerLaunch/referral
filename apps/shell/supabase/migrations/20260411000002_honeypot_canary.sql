-- Phase 10-F: Honeypot & canary fraud detection
-- Honeypot accounts have referral codes that are leaked on suspicious forums.
-- Anyone who signs up using a honeypot code is tagged with a CRITICAL fraud flag.
-- Canary accounts are seeded into the system as fake referees. Anyone who refers
-- a canary account is flagged as running a referral farm.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_honeypot boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_canary boolean NOT NULL DEFAULT false;

-- Partial indexes for filtering test accounts in admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_honeypot ON profiles (is_honeypot) WHERE is_honeypot = true;
CREATE INDEX IF NOT EXISTS idx_profiles_canary ON profiles (is_canary) WHERE is_canary = true;

-- Idempotency indexes for trust_score_events (one honeypot/canary penalty per user)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_honeypot_signup ON trust_score_events (user_id) WHERE reason = 'honeypot_signup';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_canary_referral ON trust_score_events (user_id) WHERE reason = 'canary_referral';
