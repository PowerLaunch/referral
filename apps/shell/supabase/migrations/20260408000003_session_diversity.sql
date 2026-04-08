-- Session diversity: require multiple distinct gameplay sessions for referral confirmation.
-- A "session" = any gameplay activity separated by 30+ minutes of inactivity.

-- 1. Add session_count to gameplay_sessions
ALTER TABLE public.gameplay_sessions
  ADD COLUMN IF NOT EXISTS session_count integer NOT NULL DEFAULT 0;

-- 2. Add min_session_count to game_config
ALTER TABLE public.game_config
  ADD COLUMN IF NOT EXISTS min_session_count integer NOT NULL DEFAULT 3;

-- 2b. Add monthly_referral_cap to game_config (was hardcoded as 50)
ALTER TABLE public.game_config
  ADD COLUMN IF NOT EXISTS monthly_referral_cap integer NOT NULL DEFAULT 50;

-- 3. Update increment_gameplay_minute to track session boundaries.
--    If last_heartbeat_at was 30+ minutes ago (or NULL), this is a new session.
CREATE OR REPLACE FUNCTION public.increment_gameplay_minute(p_user_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_last_heartbeat timestamptz;
  v_total_minutes integer;
  v_session_count integer;
  v_seconds_since integer;
BEGIN
  -- Acquire advisory lock to serialize concurrent requests for the same user
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Read current state with FOR UPDATE lock to prevent concurrent execution
  SELECT last_heartbeat_at, total_minutes, session_count
  INTO v_last_heartbeat, v_total_minutes, v_session_count
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

  -- Determine if this is a new session (30+ minutes since last heartbeat, or first ever)
  -- New session: last_heartbeat_at IS NULL or gap >= 1800 seconds (30 minutes)
  IF v_last_heartbeat IS NULL OR
     EXTRACT(EPOCH FROM (now() - v_last_heartbeat))::integer >= 1800 THEN
    -- New session detected
    INSERT INTO public.gameplay_sessions (user_id, total_minutes, session_count, last_heartbeat_at, updated_at)
    VALUES (p_user_id, 1, 1, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      total_minutes = gameplay_sessions.total_minutes + 1,
      session_count = gameplay_sessions.session_count + 1,
      last_heartbeat_at = now(),
      updated_at = now()
    RETURNING total_minutes, session_count INTO v_total_minutes, v_session_count;
  ELSE
    -- Same session — only increment minutes
    INSERT INTO public.gameplay_sessions (user_id, total_minutes, session_count, last_heartbeat_at, updated_at)
    VALUES (p_user_id, 1, 1, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      total_minutes = gameplay_sessions.total_minutes + 1,
      last_heartbeat_at = now(),
      updated_at = now()
    RETURNING total_minutes, session_count INTO v_total_minutes, v_session_count;
  END IF;

  RETURN jsonb_build_object('ok', true, 'total_minutes', v_total_minutes);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.increment_gameplay_minute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_gameplay_minute(uuid) TO service_role;

-- 4. Update ping_gameplay to also detect session boundaries.
--    If last_heartbeat_at was 30+ minutes ago (or NULL), this is a new session.
--    Without this, an inactive ping after a long gap would silently close the gap
--    before an active heartbeat arrives, swallowing the session boundary.
CREATE OR REPLACE FUNCTION public.ping_gameplay(p_user_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_last_heartbeat timestamptz;
  v_total_minutes integer;
  v_session_count integer;
  v_seconds_since integer;
BEGIN
  -- Acquire advisory lock to serialize concurrent requests for the same user
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT last_heartbeat_at, total_minutes, session_count
  INTO v_last_heartbeat, v_total_minutes, v_session_count
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

  -- Detect new session (30+ min gap or first ever) — same logic as increment_gameplay_minute
  IF v_last_heartbeat IS NULL OR
     EXTRACT(EPOCH FROM (now() - v_last_heartbeat))::integer >= 1800 THEN
    -- New session detected: increment session_count, no minute increment
    INSERT INTO public.gameplay_sessions (user_id, total_minutes, session_count, last_heartbeat_at, updated_at)
    VALUES (p_user_id, 0, 1, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      session_count = gameplay_sessions.session_count + 1,
      last_heartbeat_at = now(),
      updated_at = now()
    RETURNING total_minutes, session_count INTO v_total_minutes, v_session_count;
  ELSE
    -- Same session — just update heartbeat timestamp
    INSERT INTO public.gameplay_sessions (user_id, total_minutes, session_count, last_heartbeat_at, updated_at)
    VALUES (p_user_id, 0, 0, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      last_heartbeat_at = now(),
      updated_at = now()
    RETURNING total_minutes, session_count INTO v_total_minutes, v_session_count;
  END IF;

  RETURN jsonb_build_object('ok', true, 'total_minutes', COALESCE(v_total_minutes, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.ping_gameplay(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ping_gameplay(uuid) TO service_role;
