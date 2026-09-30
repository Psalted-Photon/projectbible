-- =============================================================================
-- ProjectBible: Devotional reminders
-- Migration 015: devotional_reminders table with RLS
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Same reason as the wake alarm (007): a web app cannot wake a phone, so the
-- scheduled sender (016 + the devotional-reminder-send function) reads these
-- rows every minute and sends a push when a morning or evening time arrives.
-- Safe to run more than once. Written without any $ sign on purpose: pasted
-- from a phone, dollar signs can be mangled into a syntax error.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.devotional_reminders (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'HH:MM' 24-hour wall-clock times, interpreted in `timezone`. TEXT, like the
  -- wake alarm, so they round-trip into <input type="time"> exactly.
  morning_enabled BOOLEAN NOT NULL DEFAULT false,
  morning_time TEXT NOT NULL DEFAULT '07:00'
    CHECK (length(morning_time) = 5 AND morning_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'),
  evening_enabled BOOLEAN NOT NULL DEFAULT false,
  evening_time TEXT NOT NULL DEFAULT '20:00'
    CHECK (length(evening_time) = 5 AND evening_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'),

  -- IANA name, e.g. 'America/Chicago'.
  timezone TEXT NOT NULL DEFAULT 'UTC',

  -- Local date of each slot's most recent send, so a once-a-minute sweep can
  -- only send each reminder once a day.
  last_morning_on DATE,
  last_evening_on DATE,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.devotional_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can CRUD their own devotional reminders" ON public.devotional_reminders;
CREATE POLICY "Users can CRUD their own devotional reminders"
  ON public.devotional_reminders
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- The sender scans only rows with a reminder switched on.
CREATE INDEX IF NOT EXISTS idx_devotional_reminders_armed
  ON public.devotional_reminders(user_id)
  WHERE morning_enabled OR evening_enabled;

-- Should show the new table with RLS on.
SELECT tablename, rowsecurity AS "RLS on"
  FROM pg_tables
 WHERE schemaname = 'public' AND tablename = 'devotional_reminders';
