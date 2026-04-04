-- PR 3-C: Add frozen_at column to referrals table
-- This column tracks when a referral's lock timer was frozen (e.g., when referrer cancelled subscription).
-- Must exist before freeze/unfreeze RPC migrations (000007 and 000008) run.

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
