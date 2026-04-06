-- Verify credit system constraints and document architectural decisions
-- PR 3-A: Credit ledger integrity rules

-- Verify CHECK constraint exists on user_credits.amount (already exists from Phase 1)
-- If this migration fails, the CHECK constraint is missing and must be added:
-- ALTER TABLE user_credits ADD CONSTRAINT user_credits_amount_non_negative CHECK (amount >= 0);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_credits_amount_check'
    AND conrelid = 'user_credits'::regclass
  ) THEN
    RAISE NOTICE 'user_credits CHECK (amount >= 0) constraint verified';
  ELSE
    RAISE EXCEPTION 'CRITICAL: user_credits CHECK (amount >= 0) constraint is missing — do not proceed';
  END IF;
END $$;

-- credit_transactions is append-only. No UPDATE/DELETE ever.
-- Revoke any grants that might allow modification (defensive — none should exist)
REVOKE UPDATE, DELETE ON credit_transactions FROM PUBLIC, anon, authenticated, service_role;

-- GAME_CREDITS non-cashable rule enforced in application code (cashout routes), not via trigger.
-- Per project decision in scope Appendix A.1: "Application-layer logic with explicit RPCs (not SQL triggers)"
-- Comment added for clarity — no trigger is created here.
COMMENT ON TABLE credit_transactions IS 'Append-only ledger. No UPDATE/DELETE. GAME_CREDITS non-cashable rule enforced at application layer in cashout routes.';
