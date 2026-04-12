-- Phase 5-C: Manual KYC upload + approval

CREATE TABLE kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  storage_path text,
  id_hash_hmac text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  admin_notes text,
  reviewed_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT timezone('UTC', now()),
  reviewed_at timestamptz
);

ALTER TABLE kyc_submissions ENABLE ROW LEVEL SECURITY;

-- Users can read their own submissions
CREATE POLICY "kyc_select_own" ON kyc_submissions
  FOR SELECT USING (auth.uid() = user_id);

-- No direct user writes — all via service role
REVOKE INSERT, UPDATE, DELETE ON kyc_submissions FROM anon, authenticated;

-- Service role full access
CREATE POLICY "service_role_all" ON kyc_submissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_kyc_submissions_user_id ON kyc_submissions(user_id);
CREATE INDEX idx_kyc_submissions_status ON kyc_submissions(status) WHERE status = 'PENDING';

-- Idempotency: one pending submission per user at a time
CREATE UNIQUE INDEX idx_kyc_one_pending_per_user ON kyc_submissions(user_id) WHERE status = 'PENDING';
