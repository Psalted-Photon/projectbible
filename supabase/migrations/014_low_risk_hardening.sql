-- =============================================================================
-- ProjectBible: Low-risk hardening
-- Migration 014: two small items from the 2026-09-26 health check
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor). Safe to run
-- more than once. Run it before redeploying the wake-alarm-send function; the
-- function still works without it, just without the limit.
--
--   1. Shared-notebook join codes were drawn with random(), which is built for
--      speed, not secrets. They now come from the same strong source Postgres
--      uses for gen_random_uuid(). Codes look exactly as before, and codes
--      already handed out keep working.
--   2. The wake alarm's "Send a real test alarm" button had no limit, so a
--      stuck finger or a script could keep the push service busy. One test per
--      user per minute is now allowed; the claim is recorded here.
-- =============================================================================

-- =============================================================================
-- 1. Join codes from a strong random source
--
-- Same alphabet and length as migration 012. Each code character takes one
-- random byte. Bytes of 240 and above are skipped, since 240 is the largest
-- multiple of 30 under 256 and keeping them would make the first 16 characters
-- slightly more likely than the rest. Bytes 6 and 8 of a UUID carry its fixed
-- version and variant bits, so those two are skipped as well.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.new_shared_notebook_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  pool BYTEA;
  pos INT;
  b INT;
  candidate TEXT;
BEGIN
  LOOP
    candidate := '';
    pos := 16;
    WHILE length(candidate) < 8 LOOP
      IF pos >= 16 THEN
        pool := uuid_send(gen_random_uuid());
        pos := 0;
      END IF;
      IF pos NOT IN (6, 8) THEN
        b := get_byte(pool, pos);
        IF b < 240 THEN
          candidate := candidate || substr(alphabet, 1 + b % 30, 1);
        END IF;
      END IF;
      pos := pos + 1;
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.shared_notebooks WHERE join_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$fn$;

-- =============================================================================
-- 2. One test alarm per user per minute
--
-- Only the wake-alarm-send function (running with the service key) touches
-- this. RLS is on with no policies, and the claim function is not callable by
-- signed-in or signed-out users, so nobody can reset their own limit.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wake_alarm_tests (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.wake_alarm_tests ENABLE ROW LEVEL SECURITY;

-- True when this user may send a test now, and records it; false when their
-- last one was under a minute ago. One statement, so two taps at once cannot
-- both get through.
CREATE OR REPLACE FUNCTION public.claim_wake_alarm_test(p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  claimed BOOLEAN;
BEGIN
  INSERT INTO public.wake_alarm_tests AS t (user_id, last_sent_at)
  VALUES (p_user, now())
  ON CONFLICT (user_id) DO UPDATE
    SET last_sent_at = now()
    WHERE t.last_sent_at < now() - INTERVAL '60 seconds'
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_wake_alarm_test(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wake_alarm_test(UUID) TO service_role;
