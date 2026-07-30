/**
 * Mirrors the wake alarm schedule to Supabase.
 *
 * Unlike settings sync, this is not a convenience — the scheduled sender on the
 * server is the only thing that can wake a sleeping phone, so it has to know
 * the schedule. An alarm that exists only in localStorage will never fire.
 *
 * Saves are pushed immediately (not debounced): the user pressed Save on an
 * alarm and expects it to be armed.
 */

import { supabase } from '../supabase/client';
import { upsertWakeAlarm, fetchWakeAlarm } from '../supabase/wakeAlarm';
import {
  getWakeAlarmSettings,
  updateWakeAlarmSettings,
  getEffectiveTimezone,
  type WakeAlarmSettings,
} from '../../adapters/settings';

export type AlarmPushResult =
  | { ok: true }
  | { ok: false; reason: 'signed-out' | 'offline' | 'error'; message: string };

async function currentUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/**
 * Send the current local alarm settings to the server. Callers should surface
 * the failure reason — a silently unsaved alarm is a missed morning.
 */
export async function pushAlarm(settings?: WakeAlarmSettings): Promise<AlarmPushResult> {
  const alarm = settings ?? getWakeAlarmSettings();

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reason: 'offline', message: 'No internet — the alarm was saved on this device but is not armed yet.' };
  }

  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? 'Could not reach your account.' };
  }
  if (!userId) {
    return { ok: false, reason: 'signed-out', message: 'Sign in to arm the alarm — the reminder is sent from your account.' };
  }

  try {
    await upsertWakeAlarm({
      user_id: userId,
      enabled: alarm.enabled,
      time_local: alarm.time,
      days: alarm.days,
      timezone: getEffectiveTimezone(),
      source: alarm.source,
      book: alarm.source === 'chapter' ? (alarm.book ?? null) : null,
      chapter: alarm.source === 'chapter' ? (alarm.chapter ?? null) : null,
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? 'Could not save the alarm to your account.' };
  }
}

/**
 * Adopt the account's alarm on a fresh device. Only applied when this device
 * has no alarm of its own, so a local edit is never silently overwritten.
 */
export async function pullAlarmIfUnset(): Promise<void> {
  try {
    if (getSettingsHasAlarm()) return;
    const userId = await currentUserId();
    if (!userId) return;

    const row = await fetchWakeAlarm(userId);
    if (!row) return;

    updateWakeAlarmSettings({
      enabled: row.enabled,
      time: row.time_local,
      days: row.days ?? [],
      source: row.source,
      book: row.book ?? undefined,
      chapter: row.chapter ?? undefined,
    });
  } catch (err) {
    console.warn('[WakeAlarm] Pull failed:', err);
  }
}

/**
 * Ask the server to push a test alarm to this account's devices right now.
 *
 * This exercises the real path — Edge Function, VAPID signing, the browser
 * vendor's push service, and the service worker — everything except waiting for
 * the scheduled minute. The only way to know the alarm truly works.
 */
export async function sendTestAlarm(): Promise<AlarmPushResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reason: 'offline', message: 'No internet — a test alarm has to come from the server.' };
  }

  try {
    const userId = await currentUserId();
    if (!userId) {
      return { ok: false, reason: 'signed-out', message: 'Sign in first — the test push is sent from your account.' };
    }

    const { data, error } = await supabase.functions.invoke('wake-alarm-send', { body: {} });
    if (error) {
      return {
        ok: false,
        reason: 'error',
        message: `The sender rejected the request: ${error.message}. Check the function is deployed and its secrets are set.`,
      };
    }

    const sent = (data as { sent?: number } | null)?.sent ?? 0;
    if (sent === 0) {
      return {
        ok: false,
        reason: 'error',
        message: 'The sender ran but found no device to push to. Save the alarm once on this phone to register it.',
      };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? 'Could not reach the sender.' };
  }
}

function getSettingsHasAlarm(): boolean {
  // getWakeAlarmSettings() always returns defaults, so ask the raw blob
  // whether this device has ever saved an alarm.
  try {
    const raw = localStorage.getItem('projectbible_settings');
    return !!raw && JSON.parse(raw).wakeAlarm !== undefined;
  } catch {
    return false;
  }
}
