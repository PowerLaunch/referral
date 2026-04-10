-- PR #29: Cashout review + fraud management (7-D + 7-E)
-- Adds admin_notes column to payouts table for rejection reasons.
-- Adds REJECTED to payouts status CHECK constraint.

ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check CHECK (status IN ('PENDING', 'PENDING_MANUAL_APPROVAL', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'));

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS admin_notes text;
