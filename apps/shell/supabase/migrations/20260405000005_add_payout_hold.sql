-- PR 4-A: Add payout_hold column to profiles
-- Idempotent migration: checks if column exists before adding.
-- PR 4-B's fraud rules reference this column.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'payout_hold'
  ) THEN
    ALTER TABLE profiles ADD COLUMN payout_hold boolean NOT NULL DEFAULT false;
  END IF;
END $$;
