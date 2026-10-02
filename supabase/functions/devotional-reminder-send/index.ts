// @ts-nocheck — runs on Supabase's Deno, which VS Code's checker doesn't understand.
/**
 * devotional-reminder-send — the morning and evening devotional reminders.
 *
 * A copy of wake-alarm-send in shape: pg_cron calls it once a minute
 * (migration 016) with the admin key, it finds reminders whose local time has
 * just arrived, and posts a Web Push to every device the user has registered.
 * Morning and evening are checked separately, each with its own "sent today"
 * date. There is no test path; the wake alarm's test button already proves the
 * device and VAPID side.
 *
 * "The admin key" is whatever Supabase injects as SUPABASE_SERVICE_ROLE_KEY,
 * compared as a string. On this project that is the `sb_secret_…` key, not the
 * legacy service_role JWT — see WAKE-ALARM-SETUP.md.
 *
 * The notification opens /?devo=today&s=<slot>; the app decides which work and
 * date that means when it opens.
 *
 * Written without a single dollar sign (no template strings) so it survives
 * being copied from a phone into the dashboard editor.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * How many minutes late a cron run may be and still send. A skipped minute
 * should not cost the reminder; the last_*_on dates still keep it to once a day.
 */
const CATCH_UP_MINUTES = 2;

type Slot = 'morning' | 'evening';

interface ReminderRow {
  user_id: string;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  timezone: string;
  last_morning_on: string | null;
  last_evening_on: string | null;
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
  /** A reminder, not an alarm: the service worker lets it go by itself and buzzes briefly. */
  gentle: boolean;
}

// ── time helpers (as in wake-alarm-send) ────────────────────────────────────

/** The wall clock (minutes since midnight) and calendar date in a given IANA timezone. */
function localNow(timezone: string, now: Date): { minutes: number; date: string } {
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

  return {
    minutes: (Number.isNaN(hour) ? 0 : hour) * 60 + (parseInt(get('minute'), 10) || 0),
    date: get('year') + '-' + get('month') + '-' + get('day'),
  };
}

function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?![\s\S])/.exec(time.trim());
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Which of this row's reminders are due right now, with the local date to claim them under. */
function dueSlots(row: ReminderRow, now: Date): { slots: Slot[]; localDate: string; reason: string } {
  let local: { minutes: number; date: string };
  try {
    local = localNow(row.timezone, now);
  } catch {
    return { slots: [], localDate: '', reason: 'unusable timezone ' + row.timezone };
  }

  const slots: Slot[] = [];
  const notes: string[] = [];
  const check = (slot: Slot, enabled: boolean, time: string, last: string | null) => {
    if (!enabled) return;
    const target = parseTimeToMinutes(time);
    if (target === null) { notes.push(slot + ': unreadable time "' + time + '"'); return; }
    if (last === local.date) { notes.push(slot + ': already sent today'); return; }
    const drift = local.minutes - target;
    const due = drift >= 0 && drift <= CATCH_UP_MINUTES;
    notes.push(slot + ': ' + (due ? 'due' : 'not due') + ', drift ' + drift + 'm');
    if (due) slots.push(slot);
  };
  check('morning', row.morning_enabled, row.morning_time, row.last_morning_on);
  check('evening', row.evening_enabled, row.evening_time, row.last_evening_on);

  return { slots, localDate: local.date, reason: notes.join('; ') + ' (local ' + local.date + ')' };
}

function buildPayload(slot: Slot): NotificationPayload {
  return {
    title: 'Hexapla',
    body: 'Your ' + slot + ' devotional is ready.',
    url: '/?devo=today&s=' + slot,
    tag: 'projectbible-devotional',
    gentle: true,
  };
}

// ── sending (as in wake-alarm-send) ─────────────────────────────────────────

/** Push to every live device for one user; one dead phone must not stop the others. */
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
        // High urgency, same as the alarm. Anything lower is held by the push
        // service while a locked phone sleeps and only arrives when it is
        // unlocked, which is what "normal" did until 2026-10-01. The reminder
        // stays gentle on the phone; this only decides when it is delivered.
        // TTL: a reminder can wait a little longer than an alarm, but not into the next slot.
        { TTL: 1800, urgency: 'high' }
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await admin
          .from('push_subscriptions')
          .update({ expired_at: new Date().toISOString() })
          .eq('endpoint', sub.endpoint);
        expired++;
      } else {
        failed++;
        console.error('[devotional] send failed (' + (status ?? 'no status') + ') for user ' + userId + ':', err);
      }
    }
  }

  return { sent, failed, expired };
}

async function runScheduledSweep(admin: SupabaseClient, now: Date) {
  const { data, error } = await admin
    .from('devotional_reminders')
    .select('user_id, morning_enabled, morning_time, evening_enabled, evening_time, timezone, last_morning_on, last_evening_on')
    .or('morning_enabled.eq.true,evening_enabled.eq.true');

  if (error) throw error;

  const rows = (data ?? []) as ReminderRow[];
  let fired = 0;
  let totalSent = 0;

  for (const row of rows) {
    const { slots, localDate, reason } = dueSlots(row, now);
    if (!slots.length) {
      console.log('[devotional] skipping user ' + row.user_id + ': ' + reason);
      continue;
    }
    console.log('[devotional] user ' + row.user_id + ': ' + reason);

    for (const slot of slots) {
      // Claim before sending, so a slow send cannot let the next minute's sweep
      // send it again. The filter is deliberately just user_id: filtering on the
      // column being assigned makes PostgREST build a query Postgres rejects
      // ("column … does not exist"), which is what broke the wake alarm until
      // 2026-07-31.
      const column = slot === 'morning' ? 'last_morning_on' : 'last_evening_on';
      const { error: claimError } = await admin
        .from('devotional_reminders')
        .update({ [column]: localDate })
        .eq('user_id', row.user_id);

      if (claimError) {
        console.error('[devotional] claim failed for user ' + row.user_id + ' (' + slot + '):', claimError);
        continue;
      }

      try {
        const result = await sendToUser(admin, row.user_id, buildPayload(slot));
        totalSent += result.sent;
        fired++;
        if (result.sent === 0) console.warn('[devotional] user ' + row.user_id + ' was due (' + slot + ') but has no live devices');
      } catch (err) {
        console.error('[devotional] send threw for user ' + row.user_id + ' (' + slot + '):', err);
      }
    }
  }

  console.log('[devotional] sweep done — checked ' + rows.length + ', fired ' + fired + ', sent ' + totalSent);
  return { mode: 'scheduled', checked: rows.length, fired, sent: totalSent };
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
    console.error('[devotional] missing secrets:', missing.join(', '));
    return json({ error: 'Missing secrets: ' + missing.join(', ') }, 500);
  }

  // Only pg_cron holds this key; there is no user-facing path.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (token !== serviceRoleKey) {
    const shape = (t: string) => t.length + ' chars starting ' + t.slice(0, 3);
    console.error('[devotional] rejected: sent ' + shape(token) + '; expected ' + shape(serviceRoleKey!));
    return json({ error: 'Not authorised' }, 401);
  }

  webpush.setVapidDetails(vapidSubject!, vapidPublic!, vapidPrivate!);
  const admin = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false },
  });

  try {
    return json(await runScheduledSweep(admin, new Date()));
  } catch (err) {
    console.error('[devotional] unhandled error:', err);
    return json({ error: (err as Error)?.message ?? 'Unknown error' }, 500);
  }
});
