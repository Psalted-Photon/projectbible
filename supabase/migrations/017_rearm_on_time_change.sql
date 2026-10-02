-- =============================================================================
-- ProjectBible: A changed time goes off the same day
-- Migration 017: re-arm a reminder or alarm when its time is changed
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor). Safe to run
-- more than once. Written without any $ sign, like 015.
--
-- The senders send each reminder once a day, and remember the day in
-- last_morning_on / last_evening_on / last_fired_on. Changing the time did not
-- clear that, so a new time set after today's had already gone out was skipped
-- until tomorrow (seen 2026-10-01: an evening reminder moved from 7:00 to 9:10 PM
-- never came). Now, saving a different time, or switching one back on, clears
-- that day for that one only.
--
-- Only those two changes clear it. Saving the same time again (the app does
-- this when the timezone moves) leaves it alone, so a reminder that has just
-- gone out is never sent twice. A new time that has already passed today
-- still waits for tomorrow, because the senders only send within two minutes
-- of the set time.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.devotional_reminders_rearm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS '
BEGIN
  IF NEW.morning_time IS DISTINCT FROM OLD.morning_time
     OR (NEW.morning_enabled AND NOT OLD.morning_enabled) THEN
    NEW.last_morning_on := NULL;
  END IF;
  IF NEW.evening_time IS DISTINCT FROM OLD.evening_time
     OR (NEW.evening_enabled AND NOT OLD.evening_enabled) THEN
    NEW.last_evening_on := NULL;
  END IF;
  RETURN NEW;
END;
';

DROP TRIGGER IF EXISTS devotional_reminders_rearm ON public.devotional_reminders;
CREATE TRIGGER devotional_reminders_rearm
  BEFORE UPDATE ON public.devotional_reminders
  FOR EACH ROW EXECUTE FUNCTION public.devotional_reminders_rearm();

CREATE OR REPLACE FUNCTION public.wake_alarms_rearm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS '
BEGIN
  IF NEW.time_local IS DISTINCT FROM OLD.time_local
     OR (NEW.enabled AND NOT OLD.enabled) THEN
    NEW.last_fired_on := NULL;
  END IF;
  RETURN NEW;
END;
';

DROP TRIGGER IF EXISTS wake_alarms_rearm ON public.wake_alarms;
CREATE TRIGGER wake_alarms_rearm
  BEFORE UPDATE ON public.wake_alarms
  FOR EACH ROW EXECUTE FUNCTION public.wake_alarms_rearm();

-- Should show both triggers.
SELECT event_object_table AS "table", trigger_name
  FROM information_schema.triggers
 WHERE trigger_name IN ('devotional_reminders_rearm', 'wake_alarms_rearm');
