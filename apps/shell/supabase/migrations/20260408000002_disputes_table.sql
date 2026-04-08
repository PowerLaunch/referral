-- PR 6-D: Disputes table for user-submitted referral disputes
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referral_id UUID REFERENCES referrals(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_disputes_user_id ON disputes(user_id);
CREATE INDEX idx_disputes_status ON disputes(status);

-- RLS: users can INSERT their own rows and SELECT their own rows.
-- No UPDATE or DELETE for users.
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "disputes_select_own" ON disputes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "disputes_insert_own" ON disputes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
