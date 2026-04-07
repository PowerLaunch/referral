-- Lock status and payout_hold columns in profiles RLS policy (PR 4-D)
-- These columns were added after the original RLS policy in PR 1-B.
-- Without this, users could set their own status back to ACTIVE via
-- direct Supabase REST API calls, bypassing middleware fraud checks.

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT is_admin FROM profiles WHERE id = auth.uid())
    AND trust_level = (SELECT trust_level FROM profiles WHERE id = auth.uid())
    AND verified_kyc_hash IS NOT DISTINCT FROM
        (SELECT verified_kyc_hash FROM profiles WHERE id = auth.uid())
    AND referral_code = (SELECT referral_code FROM profiles WHERE id = auth.uid())
    AND created_at = (SELECT created_at FROM profiles WHERE id = auth.uid())
    AND status = (SELECT status FROM profiles WHERE id = auth.uid())
    AND payout_hold = (SELECT payout_hold FROM profiles WHERE id = auth.uid())
  );
