-- PR 4-A: Device fingerprints table
-- Stores basic browser fingerprints for device clustering (fraud rule R2).
-- Basic browser fingerprint for MVP. FingerprintJS Pro deferred post-MVP.

CREATE TABLE device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  fingerprint_hash text NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE device_fingerprints ENABLE ROW LEVEL SECURITY;
-- No user policies. Admin/service role only.

-- Index for deduplication check (same user + hash in recent window)
CREATE INDEX idx_device_fp_user_hash_recent
  ON device_fingerprints(user_id, fingerprint_hash, created_at DESC);

-- Index for R2 rule: cluster detection (group by fingerprint_hash, count distinct users)
CREATE INDEX idx_device_fp_hash ON device_fingerprints(fingerprint_hash);
