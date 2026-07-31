-- =============================================================================
-- ProjectBible: Wake Alarm scheduled sender
-- Migration 009: pg_cron job that calls the wake-alarm-send Edge Function
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- BEFORE RUNNING: deploy the Edge Function and set its secrets, otherwise the
-- cron job will call a URL that does not exist yet (harmless, but pointless).
--
-- ONE EDIT REQUIRED: on the marked line below, paste your admin key between the
-- two quotes. Nothing else lives on that line — the word "Bearer" is written by
-- this file, further down, so a stray selection cannot swallow it.
--
-- WHICH KEY: Settings > API Keys shows two systems at once. You want the
-- **sb_secret_...** key from the *new* keys screen, not the legacy service_role
-- JWT next to it. Supabase injects one of the two into the function as
-- SUPABASE_SERVICE_ROLE_KEY and the sender compares against it character by
-- character; on this project that is the new-format key. The check at the bottom
-- of this file will tell you if you grabbed the wrong one.
--
-- Note on where that key ends up: it is stored as plain text inside the
-- cron.job table. Only the database owner can read that table, which is the
-- normal Supabase pattern. If you ever rotate the key, re-run this file.
-- =============================================================================

-- pg_cron runs the schedule; pg_net lets a SQL statement make an HTTP call.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $do$
DECLARE
  -- ─────────────────────────── PASTE HERE ───────────────────────────
  admin_key text := 'PUT_THE_KEY_HERE';
  -- ──────────────────────────────────────────────────────────────────
  project_url text := 'https://tzfavctrqaqcatmjdfxk.supabase.co';
BEGIN
  IF admin_key = 'PUT_THE_KEY_HERE' OR admin_key = '' THEN
    RAISE EXCEPTION 'No key was pasted — nothing has been changed. See the notes at the top of this file.';
  END IF;

  IF admin_key <> btrim(admin_key) OR admin_key ~ '\s' THEN
    RAISE EXCEPTION 'The key contains a space or line break. Re-copy it with the dashboard''s copy button; nothing has been changed.';
  END IF;

  -- Re-running this file should replace the job, not add a second one that makes
  -- every alarm fire twice.
  PERFORM cron.unschedule('wake-alarm-every-minute')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wake-alarm-every-minute');

  -- Every minute. The function itself decides what is due — it compares each
  -- alarm's time against the wall clock in that user's own timezone, and marks
  -- last_fired_on so a given morning can only fire once.
  PERFORM cron.schedule('wake-alarm-every-minute', '* * * * *', format(
    $job$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer %s'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
    $job$, project_url || '/functions/v1/wake-alarm-send', admin_key));
END
$do$;

-- Did the right key land? Reports only the shape of it — the key itself is never
-- printed. A legacy JWT is reported as such so you can tell the two apart.
SELECT
  CASE
    WHEN k LIKE 'sb_secret_%' THEN 'Looks right — new-format secret key.'
    WHEN k LIKE 'eyJ%'        THEN 'Probably WRONG — this is a legacy JWT. Most projects need the sb_secret_ key.'
    ELSE                           'UNRECOGNISED key format.'
  END AS "did it work?",
  length(k) AS "key length"
FROM (
  SELECT substring(command from $re$'Bearer ([^']*)'$re$) AS k
    FROM cron.job WHERE jobname = 'wake-alarm-every-minute'
) t;

-- =============================================================================
-- Checking on it afterwards
-- =============================================================================
-- Run supabase/wake-alarm-diagnose.sql — it covers everything below in one pass.
--
-- Is the job registered?
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--
-- Did the last few runs succeed? ('succeeded' here means the HTTP call was
-- made, not that a push was delivered.) Note job_run_details keys off jobid,
-- not jobname, and re-scheduling assigns a new jobid.
--   SELECT d.start_time, d.status, d.return_message
--   FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--   WHERE j.jobname = 'wake-alarm-every-minute'
--   ORDER BY d.start_time DESC
--   LIMIT 10;
--
-- What did the function actually reply? This is the decisive one.
--   SELECT created, status_code, content
--   FROM net._http_response
--   ORDER BY created DESC
--   LIMIT 10;
--
-- To stop the alarm system entirely:
--   SELECT cron.unschedule('wake-alarm-every-minute');
-- =============================================================================
