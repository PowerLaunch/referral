-- Partial unique index on credit_transactions for payout failure refunds.
-- Prevents duplicate refund entries for the same payout failure.
-- The reason column includes the payout ID (e.g. 'payout_failed_refund:<uuid>'),
-- making each refund unique per payout even under concurrent webhook retries.
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_payout_refund_idempotent
  ON credit_transactions(user_id, reason)
  WHERE reason LIKE 'payout_failed_refund:%';
