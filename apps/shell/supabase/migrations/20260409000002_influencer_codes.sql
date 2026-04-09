-- Influencer codes table for custom referral tracking
-- PR 7-G: Influencer management

CREATE TABLE influencer_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  admin_created_by uuid NOT NULL REFERENCES profiles(id),
  payout_percentage integer NOT NULL DEFAULT 40
    CHECK (payout_percentage >= 1 AND payout_percentage <= 100),
  monthly_cap integer NOT NULL DEFAULT 200
    CHECK (monthly_cap >= 1 AND monthly_cap <= 500),
  instant_payout boolean NOT NULL DEFAULT false,
  lock_bypass boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE influencer_codes ENABLE ROW LEVEL SECURITY;

-- No user access to this table — admin only via service_role
CREATE POLICY "service_role_all"
  ON influencer_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
CREATE TRIGGER handle_updated_at_influencer_codes
  BEFORE UPDATE ON influencer_codes
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- Link referrals to influencer codes (nullable FK)
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS influencer_code_id uuid REFERENCES influencer_codes(id);

CREATE INDEX IF NOT EXISTS idx_referrals_influencer_code_id
  ON referrals(influencer_code_id)
  WHERE influencer_code_id IS NOT NULL;
