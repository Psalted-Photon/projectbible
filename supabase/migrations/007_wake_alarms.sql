-- =============================================================================
-- ProjectBible: Wake Alarm schedule
-- Migration 007: wake_alarms table with RLS
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Why this lives on the server: a web app cannot wake a sleeping phone. The
-- scheduled sender (migration 009) reads these rows every minute and sends a
-- push notification when one is due, so the server has to know the schedule.
-- An alarm that exists only in localStorage will never fire.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wake_alarms (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,

  -- 'HH:MM' 24-hour wall-clock time, interpreted in `timezone`.
  -- Kept as TEXT (not TIME) so it round-trips into <input type="time"> exactly
  -- as written, with no '06:00' vs '06:00:00' surprises.
  time_local TEXT NOT NULL DEFAULT '06:00'
    CHECK (time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),

  -- 0=Sunday … 6=Saturday. An empty array means every day.
  days INTEGER[] NOT NULL DEFAULT '{}',

  -- IANA name, e.g. 'America/Chicago'. The sender converts with this, so a
  -- 6:00 alarm stays 6:00 after the user travels or DST shifts.
  timezone TEXT NOT NULL DEFAULT 'UTC',

  source TEXT NOT NULL DEFAULT 'continue'
    CHECK (source IN ('continue', 'chapter', 'plan')),
  book TEXT,
  chapter INTEGER,

  -- Local date (YYYY-MM-DD) of the most recent send, written by the sender so
  -- a once-a-minute scan cannot fire the same alarm twice in one morning.
  last_fired_on DATE,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wake_alarms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own wake alarm"
  ON public.wake_alarms
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- The sender scans only armed alarms, once a minute.
CREATE INDEX IF NOT EXISTS idx_wake_alarms_enabled
  ON public.wake_alarms(enabled)
  WHERE enabled;
