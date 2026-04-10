-- Phase 10-B: IP Infrastructure Classification
-- Creates ip_classifications table for tracking IP types at signup and session time.
-- Used by R19 datacenter cluster detection.

-- IP classification cache table
CREATE TABLE ip_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  ip_address text NOT NULL,
  ip_range_24 text NOT NULL,
  classification text NOT NULL,
  provider_name text,
  context text NOT NULL DEFAULT 'SIGNUP',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ip_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON ip_classifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_ip_class_user_id ON ip_classifications(user_id);
CREATE INDEX idx_ip_class_ip_range_24 ON ip_classifications(ip_range_24);
CREATE INDEX idx_ip_class_classification ON ip_classifications(classification);
CREATE INDEX idx_ip_class_context ON ip_classifications(context);

-- Constraint on classification values
ALTER TABLE ip_classifications ADD CONSTRAINT ip_class_valid
  CHECK (classification IN ('RESIDENTIAL', 'MOBILE', 'DATACENTER', 'VPN_PROXY', 'UNKNOWN'));
ALTER TABLE ip_classifications ADD CONSTRAINT ip_class_context_valid
  CHECK (context IN ('SIGNUP', 'SESSION'));
