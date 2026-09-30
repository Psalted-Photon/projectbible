-- =============================================================================
-- ProjectBible: Devotional reminders scheduled sender
-- Migration 016: pg_cron job that calls the devotional-reminder-send Edge Function
-- =============================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- BEFORE RUNNING: deploy the devotional-reminder-send Edge Function. It uses the
-- same three VAPID secrets the wake alarm already has, so none are new.
--
-- ONE EDIT REQUIRED: replace PUT_THE_KEY_HERE (on its own line below) with the
-- **sb_secret_...** key from Settings > API Keys — the same key the wake alarm's
-- job uses, not the legacy service_role JWT. Leave the quotes around it. Put
-- PUT_THE_KEY_HERE back before committing this file.
--
-- Unlike 009 this has no $ signs at all (no DO block, no dollar quoting): pasted
-- from a phone, dollar signs can be mangled into a syntax error.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Replace any earlier copy of the job, so a reminder never arrives twice.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'devotional-reminder-every-minute';

-- Every minute. The function decides what is due in each user's own timezone,
-- and last_morning_on / last_evening_on keep each reminder to once a day.
SELECT cron.schedule(
  'devotional-reminder-every-minute',
  '* * * * *',
  'SELECT net.http_post(url := ''https://tzfavctrqaqcatmjdfxk.supabase.co/functions/v1/devotional-reminder-send'', headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer '
  || 'PUT_THE_KEY_HERE'
  || '''), body := ''{}''::jsonb, timeout_milliseconds := 20000);'
);

-- Did the right key land? Reports only its shape, never the key.
SELECT CASE
    WHEN command LIKE '%Bearer sb_secret_%'   THEN 'Looks right — new-format secret key.'
    WHEN command LIKE '%Bearer eyJ%'          THEN 'Probably WRONG — this is a legacy JWT. Use the sb_secret_ key.'
    WHEN command LIKE '%PUT_THE_KEY_HERE%'    THEN 'No key pasted — paste it and run this again.'
    ELSE                                           'UNRECOGNISED key format.'
  END AS "did it work?"
FROM cron.job WHERE jobname = 'devotional-reminder-every-minute';

-- =============================================================================
-- Checking on it afterwards
-- =============================================================================
-- Last few runs:
--   SELECT d.start_time, d.status, d.return_message
--   FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--   WHERE j.jobname = 'devotional-reminder-every-minute'
--   ORDER BY d.start_time DESC LIMIT 10;
--
-- What the function replied:
--   SELECT created, status_code, content FROM net._http_response
--   ORDER BY created DESC LIMIT 10;
--
-- To stop devotional reminders entirely:
--   SELECT cron.unschedule('devotional-reminder-every-minute');
-- =============================================================================
