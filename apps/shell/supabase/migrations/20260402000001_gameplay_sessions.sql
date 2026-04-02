-- Gameplay sessions table for tracking daily puzzle engagement
-- Stores cumulative active gameplay minutes per user for referral heartbeat validation

CREATE TABLE IF NOT EXISTS public.gameplay_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_minutes integer NOT NULL DEFAULT 0,
  last_heartbeat_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gameplay_sessions_user_id_key UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.gameplay_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: users can read their own row
CREATE POLICY "gameplay_sessions_read_own"
  ON public.gameplay_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT, UPDATE, or DELETE policies for authenticated users
-- All writes go through the service role admin client which bypasses RLS

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gameplay_sessions_user_id
  ON public.gameplay_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_gameplay_sessions_last_heartbeat
  ON public.gameplay_sessions(last_heartbeat_at);

-- Postgres RPC function: increment gameplay minute (atomic UPSERT with increment)
CREATE OR REPLACE FUNCTION public.increment_gameplay_minute(p_user_id uuid)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  INSERT INTO public.gameplay_sessions (user_id, total_minutes, last_heartbeat_at, updated_at)
  VALUES (p_user_id, 1, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    total_minutes = gameplay_sessions.total_minutes + 1,
    last_heartbeat_at = now(),
    updated_at = now()
  RETURNING total_minutes;
$$;

-- Postgres RPC function: ping gameplay (inactive heartbeat, no increment)
CREATE OR REPLACE FUNCTION public.ping_gameplay(p_user_id uuid)
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $$
  INSERT INTO public.gameplay_sessions (user_id, total_minutes, last_heartbeat_at, updated_at)
  VALUES (p_user_id, 0, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    last_heartbeat_at = now(),
    updated_at = now()
  RETURNING total_minutes;
$$;
