-- =============================================================================
-- ProjectBible: Wake Alarm scheduled sender
-- Migration 009: pg_cron job that calls the wake-alarm-send Edge Function
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- BEFORE RUNNING: deploy the Edge Function and set its secrets, otherwise the
-- cron job will call a URL that does not exist yet (harmless, but pointless).
--
-- ONE EDIT REQUIRED: replace <SERVICE_ROLE_KEY> below with your project's
-- service_role key from Dashboard > Settings > API. It is the key that lets the
-- sender read every user's alarm, so it must never appear in the app bundle —
-- only here, and in the database.
--
-- Note on where that key ends up: it is stored as plain text inside the
-- cron.job table. Only the database owner can read that table, which is the
-- normal Supabase pattern. If you ever rotate the key, re-run this file.
-- =============================================================================

-- pg_cron runs the schedule; pg_net lets a SQL statement make an HTTP call.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Re-running this file should replace the job, not add a second one that makes
-- every alarm fire twice.
SELECT cron.unschedule('wake-alarm-every-minute')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wake-alarm-every-minute');

-- Every minute. The function itself decides what is due — it compares each
-- alarm's time against the wall clock in that user's own timezone, and marks
-- last_fired_on so a given morning can only fire once.
SELECT cron.schedule(
  'wake-alarm-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzfavctrqaqcatmjdfxk.supabase.co/functions/v1/wake-alarm-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- =============================================================================
-- Checking on it afterwards
-- =============================================================================
-- Is the job registered?
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--
-- Did the last few runs succeed? ('succeeded' here means the HTTP call was
-- made, not that a push was delivered.)
--   SELECT start_time, status, return_message
--   FROM cron.job_run_details
--   WHERE jobname = 'wake-alarm-every-minute'
--   ORDER BY start_time DESC
--   LIMIT 10;
--
-- What did the function actually reply?
--   SELECT created, status_code, content
--   FROM net._http_response
--   ORDER BY created DESC
--   LIMIT 10;
--
-- To stop the alarm system entirely:
--   SELECT cron.unschedule('wake-alarm-every-minute');
-- =============================================================================
