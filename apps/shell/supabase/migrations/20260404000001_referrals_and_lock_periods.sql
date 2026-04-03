-- Referrals table with lock period support
-- PR 2-D: Lock periods and signup bonus

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  payout_eligible_at timestamptz,
  country_code text,
  lock_timer_frozen boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Prevent self-referral
  CHECK (referrer_id != referee_id),

  -- One referral per referee (referee can only be referred once)
  UNIQUE (referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_payout_eligible_at ON public.referrals(payout_eligible_at);

-- Enable RLS
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Policy: users can read referrals where they are the referrer
CREATE POLICY "referrals_read_own"
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (referrer_id = auth.uid());

-- No INSERT, UPDATE, or DELETE policies for authenticated users
-- All referral writes happen via service role (signup flow, admin panel)

-- Auto-update updated_at on referrals
CREATE TRIGGER handle_updated_at_referrals
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE PROCEDURE extensions.moddatetime(updated_at);

-- Add unique constraint on (user_id, type) for user_credits if not exists
-- This ensures atomic credit operations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_credits_user_type_unique'
  ) THEN
    ALTER TABLE public.user_credits
      ADD CONSTRAINT user_credits_user_type_unique UNIQUE (user_id, type);
  END IF;
END $$;

-- RPC function for atomic credit increment
-- Used in signup bonus flow (will be replaced by awardCredits() in PR 3-A)
CREATE OR REPLACE FUNCTION public.increment_user_credits(
  p_user_id uuid,
  p_type text,
  p_amount integer
)
RETURNS void AS $$
BEGIN
  UPDATE public.user_credits
  SET amount = amount + p_amount, updated_at = now()
  WHERE user_id = p_user_id AND type = p_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.increment_user_credits(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_user_credits(uuid, text, integer) TO service_role;
