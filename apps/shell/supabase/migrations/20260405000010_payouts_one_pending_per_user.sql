-- Partial unique index: only one non-terminal payout per user at a time.
-- Prevents concurrent requests from creating multiple in-flight payouts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_one_pending_per_user
  ON payouts(user_id)
  WHERE status IN ('PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING');
-- When a second concurrent request hits create_payout RPC, the INSERT
-- violates this index and raises a 23505 error, rolling back the transaction.
-- The first request's payout row is preserved.
