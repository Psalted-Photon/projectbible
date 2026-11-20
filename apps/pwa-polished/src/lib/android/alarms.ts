/**
 * The Auto-Read Alarm and devotional reminders in the Android app.
 *
 * On the web a server sends both as pushes (lib/alarm/pushSubscription.ts),
 * because a web page cannot wake a sleeping phone. The app sets them on the
 * phone instead, through the IrisAlarms plugin (IrisAlarmsPlugin.java and
 * PhoneAlarms.java): Android's own alarm clock rings them on the minute, with
 * no server, no internet and no sign-in. The account still gets a copy when
 * signed in, so the website and other devices keep the same times.
 *
 * The phone keeps the whole schedule and sets the next alarm itself after
 * each one rings, after a restart and after a time zone change. The page only
 * sends it again when the settings change (watchPhoneSchedule).
 *
 * Every word a notification shows, and the link its tap opens, is set here,
 * the same as the server's (supabase/functions/*-send). A tap comes back as
 * that link, and App.svelte opens it as it opens ?alarm=1 and ?devo= on the web.
 */

import { callNative, onNative } from './bridge';
import {
  getDevotionalSettings,
  getSettings,
  getWakeAlarmSettings,
  type WakeAlarmSettings,
} from '../../adapters/settings';
import { remindersInEffect } from '../devotionals/slot';

export interface PhoneAlarmStatus {
  /** "prompt": not asked yet, so asking will show Android's question. */
  notifications: 'granted' | 'denied' | 'prompt';
  /** Whether "Alarms & reminders" is allowed. Without it Android may ring late. */
  exact: boolean;
  /** When the Auto-Read Alarm next rings (ms), or 0 when it is off. */
  nextAlarm: number;
}

/** What the alarm's notification says, as the server's wake-alarm-send words it. */
function alarmBody(alarm: WakeAlarmSettings): string {
  if (alarm.source === 'chapter' && alarm.book) return `Tap to read ${alarm.book} ${alarm.chapter ?? 1}.`;
  if (alarm.source === 'plan') return "Tap to read today's plan.";
  return 'Tap to pick up where you left off.';
}

function buildSchedule() {
  const alarm = getWakeAlarmSettings();
  const reminders = remindersInEffect(getDevotionalSettings());
  return {
    // Empty follows the phone's own zone, so the times stay local after travel.
    timezone: getSettings().timezone || '',
    alarm: {
      enabled: alarm.enabled,
      time: alarm.time,
      days: alarm.days,
      title: 'irisBible',
      body: alarmBody(alarm),
      open: '/?alarm=1',
    },
    morning: {
      enabled: reminders.morning_enabled,
      time: reminders.morning_time,
      title: 'irisBible',
      body: 'Your morning devotional is ready.',
      open: '/?devo=today&s=morning',
    },
    evening: {
      enabled: reminders.evening_enabled,
      time: reminders.evening_time,
      title: 'irisBible',
      body: 'Your evening devotional is ready.',
      open: '/?devo=today&s=evening',
    },
    test: {
      title: 'irisBible',
      body: 'Test alarm. This is how your Auto-Read Alarm will look and sound.',
      open: '/?alarm=1&test=1',
    },
  };
}

/** The schedule last handed to the phone, so unrelated settings changes send nothing. */
let lastSent = '';

/**
 * Hands the current alarm and reminder settings to the phone, which sets
 * every alarm again. Skipped when nothing changed since the last send, unless
 * `force`. Returns the phone's answer, or null when skipped or it failed.
 */
export async function syncPhoneSchedule(force = false): Promise<PhoneAlarmStatus | null> {
  const schedule = buildSchedule();
  const json = JSON.stringify(schedule);
  if (!force && json === lastSent) return null;
  try {
    const status = await callNative<PhoneAlarmStatus>('IrisAlarms', 'setSchedule', { schedule });
    lastSent = json;
    return status;
  } catch (err) {
    console.warn('[Alarms] could not set the phone alarms:', err);
    return null;
  }
}

/**
 * Sends the schedule once at launch, which also covers a new app version,
 * and again whenever settings are saved or arrive from another device.
 */
export function watchPhoneSchedule(): void {
  void syncPhoneSchedule();
  window.addEventListener('settingsUpdated', () => void syncPhoneSchedule());
}

export function phoneAlarmStatus(): Promise<PhoneAlarmStatus> {
  return callNative<PhoneAlarmStatus>('IrisAlarms', 'status');
}

/** Android's notification question, when it can still be asked. Must follow a tap. */
export function askPhoneNotifications(): Promise<PhoneAlarmStatus> {
  return callNative<PhoneAlarmStatus>('IrisAlarms', 'askNotifications');
}

/** The phone's notification settings for irisBible, or its "Alarms & reminders" switch. */
export function openPhoneSettings(which: 'notifications' | 'exact'): Promise<void> {
  return callNative<void>('IrisAlarms', 'openSettings', { which });
}

/** Shows the alarm's notification now: its look and its sound. */
export async function previewPhoneAlarm(): Promise<PhoneAlarmStatus> {
  await syncPhoneSchedule();
  return callNative<PhoneAlarmStatus>('IrisAlarms', 'preview');
}

/** Rings the alarm once, `seconds` from now, through the same path a real one takes. */
export async function testPhoneAlarm(seconds: number): Promise<PhoneAlarmStatus & { at: number }> {
  await syncPhoneSchedule();
  return callNative<PhoneAlarmStatus & { at: number }>('IrisAlarms', 'test', { seconds });
}

/**
 * The link of the alarm or reminder notification that started the app, or
 * null. Asked once at launch; gives up after a moment rather than hold the
 * app back.
 */
export async function takeLaunchTap(): Promise<string | null> {
  try {
    const result = await Promise.race([
      callNative<{ url?: string }>('IrisAlarms', 'takeLaunch'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    return result?.url || null;
  } catch {
    return null;
  }
}

/** A notification tapped while the app was already running. */
export function onPhoneAlarmTap(handler: (url: string) => void): void {
  onNative<{ url?: string }>('IrisAlarms', 'opened', (data) => {
    if (data.url) handler(data.url);
  });
}
