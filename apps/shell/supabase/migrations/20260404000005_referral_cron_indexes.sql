-- PR 3-B: Indexes for referral confirmation cron query
-- Without these, the daily cron would perform full table scans

-- The cron queries referrals by status + payout_eligible_at + lock_timer_frozen.
-- Without an index, this is a full table scan on every daily run.
CREATE INDEX IF NOT EXISTS idx_referrals_pending_eligible
  ON referrals(status, payout_eligible_at)
  WHERE status = 'PENDING' AND lock_timer_frozen = false;

-- The monthly cap check queries referrals by referrer_id + status + created_at.
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_confirmed_monthly
  ON referrals(referrer_id, status, created_at)
  WHERE status = 'CONFIRMED';
