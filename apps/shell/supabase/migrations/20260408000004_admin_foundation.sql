-- PR #22: Admin foundation tables
-- is_admin column already exists on profiles (phase1_foundation).
-- cashouts_paused and referral_confirmations_paused already exist on game_config (20260406000001).
-- admin_audit_logs already exists (20260405000004).

-- 1. Add details jsonb column to admin_audit_logs for structured audit data
ALTER TABLE admin_audit_logs
  ADD COLUMN IF NOT EXISTS details jsonb;

-- 2. Explicit service_role policies on admin_audit_logs (service_role bypasses RLS
--    but explicit policies document intent)
CREATE POLICY "service_role_insert" ON admin_audit_logs
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "service_role_select" ON admin_audit_logs
  FOR SELECT TO service_role USING (true);

-- 3. Seed users table for admin-created demo accounts
CREATE TABLE seed_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by_admin uuid NOT NULL REFERENCES profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE seed_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON seed_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Cron health tracking table
CREATE TABLE cron_health (
  cron_name text PRIMARY KEY,
  last_success_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cron_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON cron_health
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Atomic toggle RPC for cashouts_paused (eliminates read-then-write race)
CREATE OR REPLACE FUNCTION public.toggle_cashouts_paused()
RETURNS boolean AS $$
DECLARE
  new_value boolean;
BEGIN
  UPDATE public.game_config
  SET cashouts_paused = NOT cashouts_paused
  WHERE singleton = true
  RETURNING cashouts_paused INTO new_value;
  RETURN new_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.toggle_cashouts_paused() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_cashouts_paused() TO service_role;

-- 6. Atomic toggle RPC for referral_confirmations_paused
CREATE OR REPLACE FUNCTION public.toggle_referral_confirmations_paused()
RETURNS boolean AS $$
DECLARE
  new_value boolean;
BEGIN
  UPDATE public.game_config
  SET referral_confirmations_paused = NOT referral_confirmations_paused
  WHERE singleton = true
  RETURNING referral_confirmations_paused INTO new_value;
  RETURN new_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.toggle_referral_confirmations_paused() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_referral_confirmations_paused() TO service_role;
