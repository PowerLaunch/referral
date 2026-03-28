-- Auth trigger for automatic profile creation
-- Creates a profile row when a new user signs up via Supabase Auth

-- Referral code generation happens here for atomicity.
-- PR 1-D may refine the code format but must keep the trigger approach.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  new_code TEXT;
  retries INTEGER := 0;
  max_attempts INTEGER := 5;
  constraint_name TEXT;
BEGIN
  -- Retry up to 5 times in case of referral_code collision
  LOOP
    retries := retries + 1;

    -- Generate 8-char hex referral code
    new_code := encode(gen_random_bytes(4), 'hex');

    BEGIN
      INSERT INTO public.profiles (id, email, referral_code)
      VALUES (NEW.id, NEW.email, new_code);

      -- Success — exit loop
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        -- Only retry for referral_code collisions, not PK or other
        -- unique constraint violations
        GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
        IF constraint_name != 'profiles_referral_code_key' THEN
          RAISE; -- Re-raise immediately for non-referral_code violations
        END IF;
        IF retries >= max_attempts THEN
          RAISE EXCEPTION 'Failed to generate unique referral code after % attempts', max_attempts;
        END IF;
        -- Continue loop to retry
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- No INSERT policy on profiles. The handle_new_user() trigger runs as
-- SECURITY DEFINER (postgres superuser) and bypasses RLS automatically.
-- Direct client inserts to profiles are intentionally blocked.
