-- Add completed_at to payouts for accurate cooldown calculation.
-- Previously Guard H used created_at as a proxy for completion time,
-- which is slightly conservative but incorrect for payouts that spend
-- time in PENDING/PROCESSING before completing.
-- completed_at is set by the application when status transitions to COMPLETED.
-- Rows created before this migration will have completed_at = NULL and fall
-- back to created_at in the cooldown calculation (PR 5-B wires the setter).
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS completed_at timestamptz;
