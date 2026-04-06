-- PR 3-D: Payout workflow — recurring reward deduplication log
--
-- UNIQUE(referral_id, reward_month) is the deduplication mechanism.
-- If the cron runs twice in April, the second run's INSERT hits a UNIQUE
-- violation on (referral_id, '2026-04') and that referral is skipped.
-- This is cheaper and more reliable than checking "did I already award this
-- month" with a SELECT.

CREATE TABLE recurring_reward_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id),
  referrer_id uuid NOT NULL,
  reward_month text NOT NULL,  -- format: 'YYYY-MM' e.g. '2026-04'
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referral_id, reward_month)  -- prevents double-award per referral per month
);

ALTER TABLE recurring_reward_logs ENABLE ROW LEVEL SECURITY;
-- No user policies — admin/service role only.
