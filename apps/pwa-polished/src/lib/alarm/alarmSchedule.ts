/**
 * Pure time math and labels for the wake alarm.
 *
 * The alarm fires in the user's chosen timezone, which is not necessarily the
 * one this device is in. Rather than constructing Dates in a foreign zone
 * (fragile), we ask Intl what the wall clock currently reads there and do
 * plain arithmetic on hours and minutes.
 *
 * The countdown these produce is a display label ("rings in about 8 hr"), not
 * the trigger — the server decides when to actually send.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface WallClock {
  weekday: number; // 0=Sunday
  hour: number;
  minute: number;
}

/** What the wall clock currently reads in the given timezone. */
export function wallClockIn(timezone: string, now: Date = new Date()): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // 'hour' can come back as '24' at midnight in some engines.
  const hour = parseInt(get('hour'), 10) % 24;

  return {
    weekday: WEEKDAY_TO_INDEX[get('weekday')] ?? 0,
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: parseInt(get('minute'), 10) || 0,
  };
}

/** Parse 'HH:MM' into minutes since midnight, or null if malformed. */
export function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Minutes from now until the alarm next fires, or null if it never will.
 * An empty `days` means every day. Approximate across a DST boundary, which
 * is fine for a countdown label.
 */
export function minutesUntilAlarm(
  time: string,
  days: number[],
  timezone: string,
  now: Date = new Date()
): number | null {
  const target = parseTimeToMinutes(time);
  if (target === null) return null;

  const clock = wallClockIn(timezone, now);
  const nowMinutes = clock.hour * 60 + clock.minute;

  // Check today first, then each of the next 7 days, so a weekly alarm that
  // already passed today rolls to next week rather than reporting nothing.
  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (clock.weekday + offset) % 7;
    if (days.length > 0 && !days.includes(weekday)) continue;

    const minutes = offset * 24 * 60 + target - nowMinutes;
    if (minutes > 0) return minutes;
  }
  return null;
}

/** '06:00' → '6:00 AM' */
export function formatTime12h(time: string): string {
  const total = parseTimeToMinutes(time);
  if (total === null) return time;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** 500 → 'about 8 hr 20 min' */
export function formatCountdown(minutes: number): string {
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `in about ${hours} hr`;
  return `in about ${hours} hr ${rest} min`;
}

/** [] → 'Every day'; [1,2,3,4,5] → 'Weekdays'; [0,3] → 'Sun, Wed' */
export function formatDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Every day';
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(',') === '1,2,3,4,5') return 'Weekdays';
  if (sorted.join(',') === '0,6') return 'Weekends';
  return sorted.map((d) => DAY_SHORT[d]).join(', ');
}

export { DAY_NAMES, DAY_SHORT };
