/**
 * Mirrors the devotional reminder times to Supabase, the way alarmSync does
 * the wake alarm: the server's sender is the only thing that can reach a
 * sleeping phone, so a reminder that exists only on the device never arrives.
 */

import { supabase } from '../supabase/client';
import { upsertDevotionalReminders } from '../supabase/devotionalReminders';
import { ensurePushSubscription } from '../alarm/pushSubscription';
import { getDevotionalSettings, getEffectiveTimezone, type DevotionalSettings } from '../../adapters/settings';
import { remindersInEffect as effective } from './slot';
import { IS_ANDROID_APP } from '../platform';
import { askPhoneNotifications, syncPhoneSchedule, type PhoneAlarmStatus } from '../android/alarms';

export type ReminderPushResult =
  | { ok: true }
  | { ok: false; reason: 'signed-out' | 'offline' | 'error'; message: string };

/** The timezone last sent to the server, so a signed-in start can tell when it moved. */
const TZ_KEY = 'projectbible_devo_reminder_tz';

async function currentUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** Whether a morning or evening reminder is on for this device. */
export function remindersOn(settings: DevotionalSettings = getDevotionalSettings()): boolean {
  const e = effective(settings);
  return e.morning_enabled || e.evening_enabled;
}

export async function pushReminders(settings: DevotionalSettings = getDevotionalSettings()): Promise<ReminderPushResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reason: 'offline', message: 'No internet — saved on this device, but the reminder is not set up yet.' };
  }
  let userId: string | null;
  try {
    userId = await currentUserId();
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? 'Could not reach your account.' };
  }
  if (!userId) {
    return { ok: false, reason: 'signed-out', message: 'Sign in to get reminders — they are sent from your account.' };
  }
  const timezone = getEffectiveTimezone();
  try {
    await upsertDevotionalReminders({ user_id: userId, timezone, ...effective(settings) });
    try { localStorage.setItem(TZ_KEY, timezone); } catch { /* next start tries again */ }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message ?? 'Could not save the reminder to your account.' };
  }
}

/**
 * Save the reminders and, when one is on, register this device for pushes.
 * Must be called from a tap (the permission prompt needs one). A push problem
 * comes back as `warning`; the times are still saved either way.
 */
export async function saveReminders(
  settings: DevotionalSettings,
): Promise<{ result: ReminderPushResult; warning?: string; phone?: PhoneAlarmStatus | null }> {
  const e = effective(settings);
  if (IS_ANDROID_APP) return savePhoneReminders(settings, e.morning_enabled || e.evening_enabled);
  let warning: string | undefined;
  if (e.morning_enabled || e.evening_enabled) {
    const push = await ensurePushSubscription();
    if (!push.ok && push.reason !== 'signed-out') warning = push.message.replace('the alarm cannot ring', 'the reminder cannot arrive');
  }
  return { result: await pushReminders(settings), warning };
}

/**
 * The Android app: the phone sets the reminders itself (lib/android/alarms.ts),
 * so they need no sign-in and no internet. The account still gets a copy when
 * signed in, quietly, so the times follow to the website.
 */
async function savePhoneReminders(
  settings: DevotionalSettings,
  anyOn: boolean,
): Promise<{ result: ReminderPushResult; warning?: string; phone?: PhoneAlarmStatus | null }> {
  let phone: PhoneAlarmStatus | null = null;
  try {
    if (anyOn) phone = await askPhoneNotifications();
  } catch (err) {
    console.warn('[Devotionals] notification question failed:', err);
  }
  phone = (await syncPhoneSchedule(true)) ?? phone;
  void pushReminders(settings);
  if (!phone) {
    return { result: { ok: false, reason: 'error', message: 'Could not set the reminder on this phone.' } };
  }
  const warning =
    anyOn && phone.notifications !== 'granted'
      ? 'Saved, but notifications are off for irisBible, so the reminder can’t show.'
      : undefined;
  return { result: { ok: true }, warning, phone };
}

/**
 * On a signed-in start: if a reminder is on and the timezone has moved since
 * the last save (travel, or the setting changed), send the new one so the
 * reminder still arrives at the same local time.
 */
export async function resyncReminderTimezone(): Promise<void> {
  try {
    const settings = getDevotionalSettings();
    const e = effective(settings);
    if (!e.morning_enabled && !e.evening_enabled) return;
    let last: string | null = null;
    try { last = localStorage.getItem(TZ_KEY); } catch { /* treat as changed */ }
    if (last === getEffectiveTimezone()) return;
    await pushReminders(settings);
  } catch (err) {
    console.warn('[Devotionals] reminder timezone resync failed:', err);
  }
}
