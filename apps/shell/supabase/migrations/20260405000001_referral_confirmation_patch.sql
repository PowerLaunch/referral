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

-- Current CHECK allows: PENDING, CONFIRMED, REJECTED (from 20260404000001)
-- Adding: VOIDED for fraud-voided referrals

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
  CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'VOIDED'));

-- Note: Only adds VOIDED to the original set (PENDING, CONFIRMED, REJECTED).
-- ACTIVE and FROZEN are not valid referral statuses in this schema and must
-- not be introduced here. The original constraint from 20260404000001 only
-- included PENDING, CONFIRMED, REJECTED.

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

-- ==============================================================================
-- PART 4: Recreate confirm_referral RPC with atomic credit award
-- ==============================================================================

-- Recreate confirm_referral RPC with atomic credit award (PR 3-B-patch)
-- This replaces the version from 20260404000009 which did not award credits.
-- Using CREATE OR REPLACE so this is safe to run on any environment.

-- Drop old overload from 20260404000009 (signature: uuid, uuid, text).
-- CREATE OR REPLACE only replaces identical signatures. Without this DROP,
-- both overloads coexist and PostgREST cannot resolve which to call (PGRST203).
DROP FUNCTION IF EXISTS confirm_referral(uuid, uuid, text);

CREATE OR REPLACE FUNCTION confirm_referral(p_referral_id uuid)
RETURNS void AS $$
DECLARE
  v_referrer_id uuid;
BEGIN
  -- Guard: only confirm if still PENDING (prevents race with voidPendingCredits)
  UPDATE referrals
  SET status = 'CONFIRMED', confirmed_at = now()
  WHERE id = p_referral_id AND status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Referral % is not in PENDING status', p_referral_id;
  END IF;

  -- Get referrer_id for credit award
  SELECT referrer_id INTO v_referrer_id
  FROM referrals WHERE id = p_referral_id;

  -- Award $2 (200 credits) to referrer using upsert to handle missing balance row
  INSERT INTO user_credits (id, user_id, amount, type, updated_at)
  VALUES (gen_random_uuid(), v_referrer_id, 200, 'CASH_BALANCE', now())
  ON CONFLICT (user_id, type)
  DO UPDATE SET amount = user_credits.amount + 200, updated_at = now();

  -- Insert credit ledger entry
  INSERT INTO credit_transactions (id, user_id, amount, type, reason, created_at)
  VALUES (
    gen_random_uuid(),
    v_referrer_id,
    200,
    'CASH_BALANCE',
    'referral_confirmed:' || p_referral_id,
    now()
  );

  -- Insert audit log
  INSERT INTO referral_audit_logs (id, referral_id, action, reason, triggered_by, created_at)
  VALUES (
    gen_random_uuid(),
    p_referral_id,
    'CONFIRM',
    'Referral confirmed by cron',
    null,
    now()
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION confirm_referral(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_referral(uuid) TO service_role;

-- Comment: Credits awarded via INSERT ... ON CONFLICT (upsert) so first-ever
-- CASH_BALANCE rows are created correctly. Plain UPDATE would silently award
-- nothing if no row exists yet.
