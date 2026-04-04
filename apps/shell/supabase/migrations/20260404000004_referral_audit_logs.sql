-- PR 3-B: Referral audit logs table (append-only)
-- Tracks all state changes to referrals for audit trail and admin dashboard

CREATE TABLE referral_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id),
  action text NOT NULL CHECK (action IN ('FREEZE','UNFREEZE','CONFIRM','REJECT','HOLD','RELEASE')),
  reason text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only: no updates or deletes ever
REVOKE UPDATE, DELETE ON referral_audit_logs FROM authenticated, anon;

-- RLS: enable but no user policies. Only service role (admin client) can read/write.
ALTER TABLE referral_audit_logs ENABLE ROW LEVEL SECURITY;
-- No policies added = no user access. Admin client bypasses RLS.

-- Index for the cron query: find audit logs by referral_id (used in admin dashboard later)
CREATE INDEX idx_referral_audit_logs_referral_id ON referral_audit_logs(referral_id);
