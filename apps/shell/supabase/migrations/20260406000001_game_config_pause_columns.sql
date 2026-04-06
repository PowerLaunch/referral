-- Add circuit breaker columns to game_config (PR 4-B/4-C)
-- cashouts_paused: Set by R4 when payout spike detected
-- referral_confirmations_paused: Reserved for future use

ALTER TABLE game_config
  ADD COLUMN IF NOT EXISTS cashouts_paused boolean NOT NULL DEFAULT false;

ALTER TABLE game_config
  ADD COLUMN IF NOT EXISTS referral_confirmations_paused boolean NOT NULL DEFAULT false;
