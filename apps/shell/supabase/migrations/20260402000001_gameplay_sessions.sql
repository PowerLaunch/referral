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

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_gameplay_sessions_last_heartbeat
  ON public.gameplay_sessions(last_heartbeat_at);

-- Postgres RPC function: increment gameplay minute (atomic UPSERT with increment)
-- Includes rate limit check inside the lock to prevent TOCTOU race conditions
CREATE OR REPLACE FUNCTION public.increment_gameplay_minute(p_user_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_last_heartbeat timestamptz;
  v_total_minutes integer;
  v_seconds_since integer;
BEGIN
  -- Acquire advisory lock to serialize concurrent requests for the same user
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Read current state with FOR UPDATE lock to prevent concurrent execution
  SELECT last_heartbeat_at, total_minutes
  INTO v_last_heartbeat, v_total_minutes
  FROM public.gameplay_sessions
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- Rate limit check inside the lock
  IF v_last_heartbeat IS NOT NULL THEN
    v_seconds_since := EXTRACT(EPOCH FROM (now() - v_last_heartbeat))::integer;
    IF v_seconds_since < 55 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Too soon',
        'total_minutes', COALESCE(v_total_minutes, 0)
      );
    END IF;
  END IF;

  -- Atomic upsert with increment
  INSERT INTO public.gameplay_sessions (user_id, total_minutes, last_heartbeat_at, updated_at)
  VALUES (p_user_id, 1, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    total_minutes = gameplay_sessions.total_minutes + 1,
    last_heartbeat_at = now(),
    updated_at = now()
  RETURNING total_minutes INTO v_total_minutes;

  RETURN jsonb_build_object('ok', true, 'total_minutes', v_total_minutes);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.increment_gameplay_minute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_gameplay_minute(uuid) TO service_role;

-- Postgres RPC function: ping gameplay (inactive heartbeat, no increment)
-- Includes rate limit check inside the lock to prevent TOCTOU race conditions
CREATE OR REPLACE FUNCTION public.ping_gameplay(p_user_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_last_heartbeat timestamptz;
  v_total_minutes integer;
  v_seconds_since integer;
BEGIN
  -- Acquire advisory lock to serialize concurrent requests for the same user
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT last_heartbeat_at, total_minutes
  INTO v_last_heartbeat, v_total_minutes
  FROM public.gameplay_sessions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_last_heartbeat IS NOT NULL THEN
    v_seconds_since := EXTRACT(EPOCH FROM (now() - v_last_heartbeat))::integer;
    IF v_seconds_since < 55 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Too soon',
        'total_minutes', COALESCE(v_total_minutes, 0)
      );
    END IF;
  END IF;

  INSERT INTO public.gameplay_sessions (user_id, total_minutes, last_heartbeat_at, updated_at)
  VALUES (p_user_id, 0, now(), now())
  ON CONFLICT (user_id) DO UPDATE SET
    last_heartbeat_at = now(),
    updated_at = now()
  RETURNING total_minutes INTO v_total_minutes;

  RETURN jsonb_build_object('ok', true, 'total_minutes', COALESCE(v_total_minutes, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.ping_gameplay(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ping_gameplay(uuid) TO service_role;
