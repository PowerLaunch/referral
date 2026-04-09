-- Add status column to profiles (PR 4-B/4-C)
-- trust_level = fraud assessment (CLEAN/SUSPICIOUS/BANNED)
-- status = operational state (ACTIVE/REVIEW_HOLD/FROZEN/BANNED)
-- A user can be SUSPICIOUS + ACTIVE simultaneously.
-- REVIEW_HOLD = shadow review (user sees 'Verifying', not 'Under Review')
-- Idempotent: safe to re-run if column and constraint already exist

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'status'
  ) THEN
    ALTER TABLE profiles ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE';
    ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
      CHECK (status IN ('ACTIVE', 'REVIEW_HOLD', 'FROZEN', 'BANNED'));
  END IF;
END $$;

-- Index for non-ACTIVE statuses (most queries filter for active users)
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status)
  WHERE status != 'ACTIVE';
