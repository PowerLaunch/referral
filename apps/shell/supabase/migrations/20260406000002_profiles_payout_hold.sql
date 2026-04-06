-- Add payout_hold column to profiles (PR 4-B/4-C)
-- Set by R1 (spike detection) to block payouts pending manual review
-- Idempotent: safe to re-run if column already exists

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'payout_hold'
  ) THEN
    ALTER TABLE profiles ADD COLUMN payout_hold boolean NOT NULL DEFAULT false;
  END IF;
END $$;
