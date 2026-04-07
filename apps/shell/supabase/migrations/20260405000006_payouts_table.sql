-- PR 3-D: Payout workflow — payouts table and RLS

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  amount integer NOT NULL CHECK (amount > 0),
  method text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PENDING_MANUAL_APPROVAL','PROCESSING','COMPLETED','FAILED')),
  is_first_payout boolean NOT NULL DEFAULT false,
  provider_error_code text,
  retry_count integer NOT NULL DEFAULT 0,
  retry_available_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: users can read their own payouts. No user writes.
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users can read own payouts"
  ON payouts FOR SELECT
  USING (user_id = auth.uid());

-- Index: cooldown check queries the most recent COMPLETED payout per user
CREATE INDEX idx_payouts_user_completed
  ON payouts(user_id, created_at DESC)
  WHERE status = 'COMPLETED';

-- Index: recurring cron needs to check for duplicate awards per month
CREATE INDEX idx_payouts_user_method_created
  ON payouts(user_id, created_at);
