-- =============================================================================
-- ProjectBible: Wake Alarm diagnostic
-- =============================================================================
-- Paste the whole file into Dashboard > SQL Editor and press Run.
--
-- This only LOOKS. It changes nothing, sends nothing, and deletes nothing.
--
-- The result is a small table. Paste it back as-is — the service_role key is
-- deliberately masked, so there is no secret in the output.
-- =============================================================================

DROP TABLE IF EXISTS wake_alarm_check;
CREATE TEMP TABLE wake_alarm_check (step int, item text, result text);

DO $do$
DECLARE
  n       int;
  r       record;
  cmd     text;
  found   boolean := false;
  v_jobid bigint;
BEGIN

  -- 1 & 2 ── the every-minute timer, and the password it carries ─────────────
  IF to_regclass('cron.job') IS NULL THEN
    INSERT INTO wake_alarm_check VALUES
      (1, 'Timer set up?', 'NO - pg_cron is not even installed. Migration 009 was never run.'),
      (2, 'Password filled in?', 'n/a - no timer to check');
  ELSE
    FOR r IN EXECUTE
      'SELECT jobid, schedule, active, command FROM cron.job WHERE jobname = ''wake-alarm-every-minute'''
    LOOP
      found := true;
      cmd := r.command;
      v_jobid := r.jobid;

      INSERT INTO wake_alarm_check VALUES
        (1, 'Timer set up?', 'YES - runs "' || r.schedule || '", switched on = ' || r.active);

      IF cmd LIKE '%PUT_THE_KEY_HERE%' OR cmd LIKE '%<SERVICE_ROLE_KEY>%' THEN
        INSERT INTO wake_alarm_check VALUES
          (2, 'Key filled in?', 'NO - the placeholder was never replaced. THIS IS THE BUG.');
      ELSIF cmd LIKE '%Bearer sb_secret_%' THEN
        INSERT INTO wake_alarm_check VALUES
          (2, 'Key filled in?', 'YES - new-format secret key. This is the one that works here.');
      ELSIF cmd LIKE '%Bearer eyJ%' THEN
        INSERT INTO wake_alarm_check VALUES
          (2, 'Key filled in?', 'PROBABLY WRONG - a legacy JWT. This project needs the sb_secret_ key. Check step 4.');
      ELSE
        INSERT INTO wake_alarm_check VALUES
          (2, 'Key filled in?', 'UNCLEAR - no recognisable key after "Bearer". Did the paste swallow the word Bearer?');
      END IF;
    END LOOP;

    IF NOT found THEN
      INSERT INTO wake_alarm_check VALUES
        (1, 'Timer set up?', 'NO - pg_cron is installed but there is no job called wake-alarm-every-minute.'),
        (2, 'Password filled in?', 'n/a - no timer to check');
    END IF;
  END IF;

  -- 3 ── is the timer actually running each minute? ──────────────────────────
  -- job_run_details identifies the job by id, not by name.
  IF to_regclass('cron.job_run_details') IS NULL THEN
    INSERT INTO wake_alarm_check VALUES (3, 'Timer running?', 'n/a - pg_cron not installed');
  ELSIF v_jobid IS NULL THEN
    INSERT INTO wake_alarm_check VALUES (3, 'Timer running?', 'n/a - no timer to look up');
  ELSE
    EXECUTE format(
      'SELECT count(*) FROM cron.job_run_details
        WHERE jobid = %s AND start_time > now() - interval ''1 hour''', v_jobid)
      INTO n;
    INSERT INTO wake_alarm_check VALUES
      (3, 'Timer running?', n || ' runs in the last hour (should be about 60)');

    FOR r IN EXECUTE format(
      'SELECT status, coalesce(return_message, ''-'') AS msg, count(*) AS c
         FROM cron.job_run_details
        WHERE jobid = %s AND start_time > now() - interval ''1 hour''
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 3', v_jobid)
    LOOP
      INSERT INTO wake_alarm_check VALUES
        (3, 'Run outcome', r.c || ' x ' || r.status || ' - ' || left(r.msg, 120));
    END LOOP;
  END IF;

  -- 4 ── what did the server reply? the decisive one ─────────────────────────
  IF to_regclass('net._http_response') IS NULL THEN
    INSERT INTO wake_alarm_check VALUES (4, 'Server reply', 'n/a - pg_net not installed');
  ELSE
    EXECUTE 'SELECT count(*) FROM net._http_response' INTO n;
    IF n = 0 THEN
      INSERT INTO wake_alarm_check VALUES
        (4, 'Server reply', 'NOTHING - the database has never received a reply. Nothing is being called.');
    ELSE
      FOR r IN EXECUTE
        'SELECT created, coalesce(status_code::text, ''no status'') AS code,
                left(coalesce(content, coalesce(error_msg, ''(empty)'')), 160) AS body
           FROM net._http_response ORDER BY created DESC LIMIT 5'
      LOOP
        INSERT INTO wake_alarm_check VALUES
          (4, 'Server reply ' || to_char(r.created, 'HH24:MI:SS'), r.code || ' -> ' || r.body);
      END LOOP;
    END IF;
  END IF;

  -- 5 ── is the alarm actually armed, and set to the right time? ─────────────
  IF to_regclass('public.wake_alarms') IS NULL THEN
    INSERT INTO wake_alarm_check VALUES (5, 'Alarm saved?', 'NO - the wake_alarms table does not exist. Migration 007 was never run.');
  ELSE
    EXECUTE 'SELECT count(*) FROM public.wake_alarms' INTO n;
    IF n = 0 THEN
      INSERT INTO wake_alarm_check VALUES
        (5, 'Alarm saved?', 'NO - the table is empty. The alarm was never saved to the account.');
    ELSE
      FOR r IN EXECUTE
        'SELECT enabled, time_local, coalesce(nullif(array_to_string(days, '',''), ''''), ''(every day)'') AS d,
                timezone, coalesce(last_fired_on::text, ''never'') AS lf
           FROM public.wake_alarms'
      LOOP
        INSERT INTO wake_alarm_check VALUES
          (5, 'Alarm saved?', 'switched on = ' || r.enabled || ', time = ' || r.time_local
              || ', days = ' || r.d || ', timezone = ' || r.timezone || ', last fired = ' || r.lf);
      END LOOP;
    END IF;
  END IF;

  -- 6 ── is this phone still registered? ─────────────────────────────────────
  IF to_regclass('public.push_subscriptions') IS NULL THEN
    INSERT INTO wake_alarm_check VALUES (6, 'Devices', 'NO - the push_subscriptions table does not exist. Migration 008 was never run.');
  ELSE
    EXECUTE 'SELECT count(*) FILTER (WHERE expired_at IS NULL) AS live, count(*) AS total FROM public.push_subscriptions'
      INTO r;
    INSERT INTO wake_alarm_check VALUES
      (6, 'Devices', r.live || ' live, ' || r.total || ' total');
  END IF;

  -- 7 ── the clock, for comparison against the alarm time ────────────────────
  INSERT INTO wake_alarm_check VALUES
    (7, 'Time right now (UTC)', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'));

END
$do$;

SELECT step, item, result FROM wake_alarm_check ORDER BY step, item;
