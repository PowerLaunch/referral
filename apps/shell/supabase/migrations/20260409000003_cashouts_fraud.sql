-- PR #29: Cashout review + fraud management (7-D + 7-E)
-- Adds admin_notes column to payouts table for rejection reasons.

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS admin_notes text;
