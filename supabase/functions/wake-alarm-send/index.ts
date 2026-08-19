/**
 * wake-alarm-send — the thing that can actually wake a sleeping phone.
 *
 * A web app cannot schedule itself awake, so this runs on Supabase instead.
 * pg_cron calls it once a minute (migration 009); it finds alarms whose local
 * wall-clock time has just arrived and posts an encrypted Web Push to every
 * device that user has registered. The push wakes the phone even with the app
 * fully closed.
 *
 * Two callers, distinguished by the token they present:
 *
 *   the admin key  → scheduled sweep. Checks every armed alarm.
 *   a user's JWT   → immediate test push to that user's own devices only.
 *                    Used by the "Send a real test alarm" button so the whole
 *                    path can be verified without waiting for 6am.
 *
 * "The admin key" means literally whatever Supabase injects as
 * SUPABASE_SERVICE_ROLE_KEY — compared here as a string, not decoded. On a
 * project using the newer API keys that is the `sb_secret_…` key, not the
 * legacy `service_role` JWT sitting next to it in the dashboard. The cron job
 * must carry that exact value; anything else lands in the user branch below and
 * is refused.
 *
 * Deliberately does not decide what to read. The app resolves that when it
 * opens, so a chapter finished at 11pm is reflected at 6am.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * How many minutes late a cron run may be and still fire the alarm. A skipped
 * minute should not silently cost the user their morning; `last_fired_on`
 * guarantees it still only fires once per day.
 */
const CATCH_UP_MINUTES = 2;

interface WakeAlarmRow {
  user_id: string;
  enabled: boolean;
  time_local: string;
  days: number[] | null;
  timezone: string;
  source: 'continue' | 'chapter' | 'plan';
  book: string | null;
  chapter: number | null;
  last_fired_on: string | null;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

// ── time helpers ────────────────────────────────────────────────────────────

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * The wall clock and calendar date in a given IANA timezone.
 *
 * en-CA gives the ISO-shaped date we want, but it abbreviates weekdays with a
 * trailing period — "Fri." — which matches nothing in WEEKDAY_TO_INDEX and used
 * to silently resolve every day to Sunday. The weekday is asked for separately
 * in en-US, which does not punctuate, and the period is stripped anyway in case
 * a runtime disagrees.
 */
function localNow(timezone: string, now: Date): { weekday: number; minutes: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = parseInt(get('hour'), 10) % 24; // some engines report 24 at midnight

  const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .format(now)
    .replace(/\./g, '');

  return {
    weekday: WEEKDAY_TO_INDEX[weekdayName] ?? 0,
    minutes: (Number.isNaN(hour) ? 0 : hour) * 60 + (parseInt(get('minute'), 10) || 0),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Two-digit clock time, for log lines. */
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Whether this alarm should fire on this run.
 *
 * `reason` explains the verdict in the log. Without it a sweep that skips every
 * alarm is indistinguishable from one that never ran.
 */
function isDue(
  alarm: WakeAlarmRow,
  now: Date
): { due: boolean; localDate: string; reason: string } {
  let local: { weekday: number; minutes: number; date: string };
  try {
    local = localNow(alarm.timezone, now);
  } catch {
    // An unusable timezone must not take down the whole sweep.
    console.error(`[wake-alarm] bad timezone ${alarm.timezone} for user ${alarm.user_id}`);
    return { due: false, localDate: '', reason: `unusable timezone ${alarm.timezone}` };
  }

  const target = parseTimeToMinutes(alarm.time_local);
  if (target === null) {
    return { due: false, localDate: local.date, reason: `unreadable time "${alarm.time_local}"` };
  }

  const clock = `local ${local.date} ${formatMinutes(local.minutes)} vs target ${alarm.time_local}`;

  // Already fired today.
  if (alarm.last_fired_on === local.date) {
    return { due: false, localDate: local.date, reason: `already fired today — ${clock}` };
  }

  // An empty day list means every day.
  const days = alarm.days ?? [];
  if (days.length > 0 && !days.includes(local.weekday)) {
    return {
      due: false,
      localDate: local.date,
      reason: `day ${local.weekday} not in [${days.join(',')}] — ${clock}`,
    };
  }

  const drift = local.minutes - target;
  const due = drift >= 0 && drift <= CATCH_UP_MINUTES;
  return { due, localDate: local.date, reason: `${due ? 'due' : 'not due'}, drift ${drift}m — ${clock}` };
}

// ── payload ─────────────────────────────────────────────────────────────────

function buildPayload(alarm: Pick<WakeAlarmRow, 'source' | 'book' | 'chapter'>): NotificationPayload {
  let body: string;
  if (alarm.source === 'chapter' && alarm.book) {
    body = `Tap to read ${alarm.book} ${alarm.chapter ?? 1}.`;
  } else if (alarm.source === 'plan') {
    body = "Tap to read today's plan.";
  } else {
    body = 'Tap to pick up where you left off.';
  }

  return {
    title: 'Hexapla',
    body,
    url: '/?alarm=1',
    tag: 'projectbible-wake-alarm',
  };
}

// ── sending ─────────────────────────────────────────────────────────────────

/**
 * Push to every live device for one user. Per-device failures are isolated:
 * one dead phone must not stop the others from ringing.
 */
async function sendToUser(
  admin: SupabaseClient,
  userId: string,
  payload: NotificationPayload
): Promise<{ sent: number; failed: number; expired: number }> {
  const { data, error } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
    .is('expired_at', null);

  if (error) throw error;

  const subscriptions = (data ?? []) as SubscriptionRow[];
  let sent = 0;
  let failed = 0;
  let expired = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        // Tell the push service to hold it briefly, but never deliver a stale
        // alarm — an alarm an hour late is worse than none.
        { TTL: 300, urgency: 'high' }
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        // The browser install is gone for good. Mark it rather than delete it,
        // so a dead device is visible in the dashboard instead of just absent.
        await admin
          .from('push_subscriptions')
          .update({ expired_at: new Date().toISOString() })
          .eq('endpoint', sub.endpoint);
        expired++;
      } else {
        failed++;
        console.error(`[wake-alarm] send failed (${status ?? 'no status'}) for user ${userId}:`, err);
      }
    }
  }

  return { sent, failed, expired };
}

/** The once-a-minute sweep over every armed alarm. */
async function runScheduledSweep(admin: SupabaseClient, now: Date) {
  const { data, error } = await admin
    .from('wake_alarms')
    .select('user_id, enabled, time_local, days, timezone, source, book, chapter, last_fired_on')
    .eq('enabled', true);

  if (error) throw error;

  const alarms = (data ?? []) as WakeAlarmRow[];
  const fired: string[] = [];
  let totalSent = 0;

  for (const alarm of alarms) {
    const { due, localDate, reason } = isDue(alarm, now);
    if (!due) {
      console.log(`[wake-alarm] skipping user ${alarm.user_id}: ${reason}`);
      continue;
    }
    console.log(`[wake-alarm] user ${alarm.user_id} is ${reason}`);

    // Mark the alarm fired before sending, so a slow send cannot let the next
    // minute's sweep fire it a second time — isDue rejects any alarm whose
    // last_fired_on already matches today's local date.
    //
    // The filter here is deliberately just user_id. Adding a condition on
    // last_fired_on while also assigning it produces a query PostgREST builds
    // wrong, and it fails with "column wake_alarms.last_fired_on does not
    // exist" — which is what stopped every alarm from firing until 2026-07-31.
    const { error: claimError } = await admin
      .from('wake_alarms')
      .update({ last_fired_on: localDate })
      .eq('user_id', alarm.user_id);

    if (claimError) {
      console.error(`[wake-alarm] claim failed for user ${alarm.user_id}:`, claimError);
      continue;
    }

    try {
      const result = await sendToUser(admin, alarm.user_id, buildPayload(alarm));
      totalSent += result.sent;
      fired.push(alarm.user_id);
      if (result.sent === 0) {
        console.warn(`[wake-alarm] user ${alarm.user_id} was due but has no live devices`);
      } else {
        console.log(`[wake-alarm] sent to ${result.sent} device(s) for user ${alarm.user_id}`);
      }
    } catch (err) {
      console.error(`[wake-alarm] send threw for user ${alarm.user_id}:`, err);
    }
  }

  console.log(`[wake-alarm] sweep done — checked ${alarms.length}, fired ${fired.length}, sent ${totalSent}`);
  return { mode: 'scheduled', checked: alarms.length, fired: fired.length, sent: totalSent };
}

// ── entry point ─────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');

  const missing = [
    ['SUPABASE_URL', supabaseUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey],
    ['VAPID_PUBLIC_KEY', vapidPublic],
    ['VAPID_PRIVATE_KEY', vapidPrivate],
    ['VAPID_SUBJECT', vapidSubject],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    console.error('[wake-alarm] missing secrets:', missing.join(', '));
    return json({ error: `Missing secrets: ${missing.join(', ')}` }, 500);
  }

  webpush.setVapidDetails(vapidSubject!, vapidPublic!, vapidPrivate!);
  const admin = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false },
  });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    console.error('[wake-alarm] rejected: no Authorization header');
    return json({ error: 'Missing Authorization header' }, 401);
  }

  try {
    // Scheduled sweep — only pg_cron holds this key.
    if (token === serviceRoleKey) {
      return json(await runScheduledSweep(admin, new Date()));
    }

    // Otherwise it must be a signed-in user asking to test their own alarm.
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      // Never log the tokens themselves. Their shapes are enough to tell a
      // mis-keyed cron job from a genuinely signed-out user, and the absence of
      // this line is what made a broken cron job look identical to a healthy
      // one for a whole night.
      const shape = (t: string) => `${t.length} chars starting ${t.slice(0, 3)}`;
      console.error(
        `[wake-alarm] rejected: token is neither the service-role key nor a signed-in user. ` +
        `Sent ${shape(token)}; expected ${shape(serviceRoleKey!)} for the scheduled sweep.`
      );
      return json({ error: 'Not signed in' }, 401);
    }

    const { data: alarm } = await admin
      .from('wake_alarms')
      .select('source, book, chapter')
      .eq('user_id', user.id)
      .maybeSingle();

    const payload = buildPayload(
      (alarm as Pick<WakeAlarmRow, 'source' | 'book' | 'chapter'>) ?? {
        source: 'continue',
        book: null,
        chapter: null,
      }
    );
    payload.body = `Test alarm — ${payload.body}`;
    payload.tag = 'projectbible-wake-alarm-test';

    const result = await sendToUser(admin, user.id, payload);
    return json({ mode: 'test', ...result });
  } catch (err) {
    console.error('[wake-alarm] unhandled error:', err);
    return json({ error: (err as Error)?.message ?? 'Unknown error' }, 500);
  }
});
