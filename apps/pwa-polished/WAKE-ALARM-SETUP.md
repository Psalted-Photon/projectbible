# Wake Alarm — setup

The alarm has a part on the phone and a part on the server. The phone part ships
with the app. The server part needs the four manual steps below, once.

Why a server is involved at all: a web app cannot wake a sleeping phone. There is
no permission for it. So the app registers the phone with a push service, and
Supabase sends a push at the set time. The push wakes the phone with the app
fully closed; tapping it opens the app, and you press start.

## 1. Tables

Run in Dashboard → SQL Editor, in order:

- `supabase/migrations/007_wake_alarms.sql` — the schedule
- `supabase/migrations/008_push_subscriptions.sql` — one row per device

"Success. No rows returned" is the expected result for both.

## 2. Deploy the Edge Function

Dashboard → Edge Functions → Deploy a new function, named exactly
**`wake-alarm-send`**. Paste the contents of
`supabase/functions/wake-alarm-send/index.ts`.

Leave "Verify JWT" **on** (the default). Both callers present a valid token: the
cron job uses the service_role key, and the test button uses your own login.

## 3. Set the function's secrets

Dashboard → Edge Functions → wake-alarm-send → Secrets. Four values:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | `BOMwzIMb574wuRHg-HEtqIYRCoBBsMArY-tYSxzgJqSckWQILqP-9Mb8Y7aF-MKXixmTDzsrQLthcP8NkXKd8zA` |
| `VAPID_PRIVATE_KEY` | *the private key — see below* |
| `VAPID_SUBJECT` | `mailto:marlowescotts@gmail.com` |

Three secrets, that's all. Do **not** try to add `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY` — Supabase reserves the `SUPABASE_` name prefix and
will refuse to create them. Both are injected into every function automatically.

The **private key** is deliberately not in this repo. It is in the scratchpad
file `vapid-keys.txt` from the session that generated it. It must never go into
a `VITE_` variable or any file under `apps/`, because those ship to browsers.

The public key is already in `apps/pwa-polished/.env.local` and baked into the
build — that one is safe to publish.

## 4. Schedule it

Run `supabase/migrations/009_wake_alarm_cron.sql`. **One edit first:** replace
`<SERVICE_ROLE_KEY>` with your service_role key from Settings → API.

This enables `pg_cron` and `pg_net` and registers a job that calls the function
every minute. The function, not the schedule, decides what is due — it compares
each alarm against the wall clock in that user's own timezone.

## Testing

The alarm pane (Settings → Read Aloud → Wake Alarm) has two buttons:

- **Preview the look** — shows the notification from the app itself. Proves
  permission, icon and name. Does not involve the server.
- **Send a real test alarm** — asks the server to push to your devices now. This
  is the one that matters. Lock the phone and close the app first.

## When it doesn't work

Check in this order:

```sql
-- Is the cron job registered and active?
SELECT jobid, jobname, schedule, active FROM cron.job;

-- Are the runs succeeding? ('succeeded' = the HTTP call was made.)
SELECT start_time, status, return_message
FROM cron.job_run_details
WHERE jobname = 'wake-alarm-every-minute'
ORDER BY start_time DESC LIMIT 10;

-- What did the function actually reply?
SELECT created, status_code, content
FROM net._http_response
ORDER BY created DESC LIMIT 10;

-- Is this phone registered, and did it get marked dead?
SELECT endpoint, user_agent, expired_at FROM push_subscriptions;

-- Did the alarm already fire today? (last_fired_on blocks a second send.)
SELECT user_id, enabled, time_local, days, timezone, last_fired_on FROM wake_alarms;
```

The function's own logs are under Edge Functions → wake-alarm-send → Logs.

Common causes:

- **`expired_at` is set** — that browser install is gone. Save the alarm again on
  the phone to re-register it.
- **`sent: 0`** — the alarm was due but no live device was registered.
- **Nothing fires but cron succeeds** — check `last_fired_on`; an alarm only
  fires once per local date. Clear it to retest:
  `UPDATE wake_alarms SET last_fired_on = NULL;`
- **iPhone gets nothing** — the app must be installed to the home screen. Push
  does not work in a Safari tab.
- **It fires but doesn't wake you** — the notification uses your phone's normal
  notification sound and we cannot make it louder. Fix by hand, once: on Android
  set this app's notification channel to an alarm tone; on iPhone allow
  ProjectBible through Sleep Focus.

## Turning it off

```sql
SELECT cron.unschedule('wake-alarm-every-minute');
```

Individual users turn their own alarm off in the app, which sets
`wake_alarms.enabled = false`.
