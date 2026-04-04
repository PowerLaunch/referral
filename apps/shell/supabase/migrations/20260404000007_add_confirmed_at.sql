-- PR 3-B (BugBot fix): Add confirmed_at column to referrals table
-- Monthly cap must filter on when the referral was confirmed, not when it was created.
-- A referral created in month N but confirmed in month N+1 should count toward month N+1's cap.

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
