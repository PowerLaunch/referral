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
  attempt_count INT := 0;
  max_attempts INT := 3;
  new_code TEXT;
BEGIN
  -- Retry up to 3 times in case of referral_code collision
  LOOP
    attempt_count := attempt_count + 1;

    -- Generate 8-char hex referral code
    new_code := encode(gen_random_bytes(4), 'hex');

    BEGIN
      INSERT INTO public.profiles (id, email, referral_code)
      VALUES (NEW.id, NEW.email, new_code);

      -- Success — exit loop
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        -- Collision on referral_code — retry if attempts remain
        IF attempt_count >= max_attempts THEN
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

-- Allow the trigger (SECURITY DEFINER) to insert into profiles
CREATE POLICY "profiles_insert_trigger" ON profiles
  FOR INSERT WITH CHECK (true);
