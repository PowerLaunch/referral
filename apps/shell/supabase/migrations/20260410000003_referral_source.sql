-- Referral source attribution (PR 10-C)
-- Tracks where referral signups originate (social media, micro-task sites, etc.)

-- Add source tracking columns to referrals table
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referral_source text;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS source_classification text;
ALTER TABLE referrals ADD CONSTRAINT referrals_source_class_valid
  CHECK (source_classification IS NULL OR source_classification IN ('GREEN', 'YELLOW', 'RED'));

-- Admin-managed source blocklist
CREATE TABLE source_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  added_by uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE source_blocklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON source_blocklist FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_source_blocklist_domain ON source_blocklist(domain);

-- Seed initial red-flagged domains known for referral farming
INSERT INTO source_blocklist (domain, added_by, notes) VALUES
  ('picoworkers.com', NULL, 'Micro-task platform — referral farming'),
  ('microworkers.com', NULL, 'Micro-task platform'),
  ('rapidworkers.com', NULL, 'Micro-task platform'),
  ('clickworker.com', NULL, 'Micro-task platform'),
  ('beermoney.ph', NULL, 'PH beermoney forum'),
  ('beermoneyforum.com', NULL, 'Beermoney forum');
