-- Fix payout cooldown index to target completed_at instead of created_at.
-- Guard H (24h cooldown) orders by completed_at — index must match to avoid in-memory sort.

DROP INDEX IF EXISTS idx_payouts_user_completed;
CREATE INDEX idx_payouts_user_completed
  ON payouts(user_id, completed_at DESC NULLS LAST)
  WHERE status = 'COMPLETED';
-- Replaces the original index which targeted created_at.
