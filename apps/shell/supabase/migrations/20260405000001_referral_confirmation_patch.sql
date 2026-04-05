-- PR 3-B-patch: Payment collateralization and credit voiding improvements
-- Part 1: Add payment_event_id column to referrals
-- Part 2: Update referrals.status CHECK to include VOIDED
-- Part 3: Update referral_audit_logs.action CHECK to include VOIDED

-- ==============================================================================
-- PART 1: Payment collateralization
-- ==============================================================================

-- Links a referral to the referee's subscription payment event.
-- Confirmation cron checks this payment is settled before confirming.

-- Add payment_event_id column (nullable, FK added conditionally)
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS payment_event_id uuid;

-- Add FK only if payment_events table exists (created in PR 5-A):
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'payment_events'
  ) THEN
    ALTER TABLE referrals
      ADD CONSTRAINT fk_referrals_payment_event
      FOREIGN KEY (payment_event_id) REFERENCES payment_events(id);
  END IF;
END $$;

-- Comment: If payment_events doesn't exist yet, this column is a nullable uuid
-- with no FK. PR 5-A adds the FK when creating payment_events. The confirmation
-- cron gracefully handles null payment_event_id.

-- Index for the confirmation cron join
CREATE INDEX IF NOT EXISTS idx_referrals_payment_event
  ON referrals(payment_event_id)
  WHERE payment_event_id IS NOT NULL;

-- ==============================================================================
-- PART 2: Add VOIDED to referrals.status CHECK constraint
-- ==============================================================================

-- Current CHECK allows: PENDING, ACTIVE, CONFIRMED, REJECTED, FROZEN
-- Add VOIDED for fraud-voided referrals.

-- Drop existing status check constraint:
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'referrals'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE referrals DROP CONSTRAINT ' || constraint_name;
  END IF;
END $$;

-- Recreate with VOIDED added:
ALTER TABLE referrals ADD CONSTRAINT referrals_status_check
  CHECK (status IN ('PENDING', 'ACTIVE', 'CONFIRMED', 'REJECTED', 'FROZEN', 'VOIDED'));

-- ==============================================================================
-- PART 3: Add VOIDED to referral_audit_logs.action CHECK constraint
-- ==============================================================================

-- Update referral_audit_logs action CHECK to include VOIDED
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'referral_audit_logs'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%action%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE referral_audit_logs DROP CONSTRAINT ' || constraint_name;
  END IF;
END $$;

ALTER TABLE referral_audit_logs ADD CONSTRAINT referral_audit_logs_action_check
  CHECK (action IN ('FREEZE','UNFREEZE','CONFIRM','REJECT','HOLD','RELEASE','VOIDED'));
