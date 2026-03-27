-- Phase 1 Row Level Security Policies
-- Enables RLS on all Phase 1 tables and defines access policies

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_config ENABLE ROW LEVEL SECURITY;

-- profiles: users read and update own row only
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT is_admin FROM profiles WHERE id = auth.uid())
    AND trust_level = (SELECT trust_level FROM profiles WHERE id = auth.uid())
    AND verified_kyc_hash IS NOT DISTINCT FROM
        (SELECT verified_kyc_hash FROM profiles WHERE id = auth.uid())
    AND device_fingerprint IS NOT DISTINCT FROM
        (SELECT device_fingerprint FROM profiles WHERE id = auth.uid())
    AND referral_code = (SELECT referral_code FROM profiles WHERE id = auth.uid())
    AND email = (SELECT email FROM profiles WHERE id = auth.uid())
  );

-- subscriptions: users read own rows only
CREATE POLICY "subscriptions_select_own" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- user_credits: users read own rows only
CREATE POLICY "user_credits_select_own" ON user_credits
  FOR SELECT USING (auth.uid() = user_id);

-- credit_transactions: users read own rows only
CREATE POLICY "credit_transactions_select_own" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- game_config: all authenticated users can read
DROP POLICY IF EXISTS "game_config_select_authenticated" ON game_config;

CREATE POLICY "game_config_select_authenticated" ON game_config
  FOR SELECT TO authenticated USING (true);

-- game_config: only admins can update
CREATE POLICY "game_config_update_admin" ON game_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Prevent any direct user writes to the append-only ledger.
-- All credit_transactions inserts go through service role in server code.
-- With RLS enabled and no INSERT policy defined, authenticated users
-- cannot insert directly. This REVOKE is an extra safety layer.
REVOKE INSERT, UPDATE, DELETE ON credit_transactions FROM anon, authenticated;
