-- PR 3-B: Indexes for referral confirmation cron query
-- Without these, the daily cron would perform full table scans

-- Add confirmed_at column (BugBot fix: must exist before indexes reference it)
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- The cron queries referrals by status + payout_eligible_at + lock_timer_frozen.
-- Without an index, this is a full table scan on every daily run.
CREATE INDEX IF NOT EXISTS idx_referrals_pending_eligible
  ON referrals(status, payout_eligible_at)
  WHERE status = 'PENDING' AND lock_timer_frozen = false;

-- The monthly cap check queries referrals by referrer_id + confirmed_at.
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_confirmed_monthly
  ON referrals(referrer_id, confirmed_at)
  WHERE status = 'CONFIRMED';

-- Idempotency guard: prevent duplicate credit awards on cron retry
CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_referral_bonus_idempotency
  ON credit_transactions (user_id, reason)
  WHERE reason LIKE 'referral_confirmed:%';
