-- PR 4-A: Admin audit logs table
-- Append-only audit trail for admin actions. Never updated or deleted.

CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  before_value text,
  after_value text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only: no updates or deletes
REVOKE UPDATE, DELETE ON admin_audit_logs FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
-- No user policies. Admin/service role only.

-- Index for admin dashboard queries in Phase 7 (lookup by target)
CREATE INDEX idx_admin_audit_target ON admin_audit_logs(target_type, target_id);

-- Index for admin dashboard: recent actions feed
CREATE INDEX idx_admin_audit_recent ON admin_audit_logs(created_at DESC);
