-- Email preferences table for managing user notification settings
-- One row per user with user_id as primary key

CREATE TABLE IF NOT EXISTS public.email_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_updates boolean NOT NULL DEFAULT true,
  payout_notifications boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: users can read their own row
CREATE POLICY "email_preferences_read_own"
  ON public.email_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy: users can update their own row
CREATE POLICY "email_preferences_update_own"
  ON public.email_preferences
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- No DELETE policy — users cannot delete their email preferences
-- No INSERT policy for authenticated users — preferences created via service role only

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_email_preferences_user_id
  ON public.email_preferences(user_id);
