/**
 * App-Wide Clock
 *
 * Single source of truth for "what day is it?" across the entire app.
 * Uses Intl.DateTimeFormat with the user-configured IANA timezone so that
 * DST transitions, leap years, and timezone offsets are all handled by the
 * platform — not by hand-rolled arithmetic.
 *
 * Consumers should call localDateStr() for any "today vs stored date"
 * comparison, and subscribe to todayStore for reactive UI that updates at
 * midnight automatically.
 */

import { readable } from 'svelte/store';
import { getSettings } from '../adapters/settings';

// ---------------------------------------------------------------------------
// Core helper: format any Date as YYYY-MM-DD in the user's local timezone.
// Uses formatToParts with explicit year/month/day fields so the result is
// always exactly YYYY-MM-DD regardless of browser locale quirks (some
// Chromium builds append time to .format() output without explicit fields).
// ---------------------------------------------------------------------------
export function localDateStr(d: Date | number): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  const tz = getSettings().timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// ---------------------------------------------------------------------------
// sameLocalDay: equality check for two dates in the user's local timezone.
// Delegates to localDateStr so timezone selection is respected.
// ---------------------------------------------------------------------------
export function sameLocalDay(a: Date | number, b: Date | number): boolean {
  return localDateStr(a) === localDateStr(b);
}

// ---------------------------------------------------------------------------
// Returns milliseconds until next local midnight + a small buffer.
// Used to schedule the midnight store refresh.
// ---------------------------------------------------------------------------
function msUntilNextMidnight(): number {
  const now = new Date();

  // Find tomorrow's YYYY-MM-DD string using the fixed localDateStr
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = localDateStr(tomorrow);

  // Binary search for the first ms that renders as tomorrowStr
  let lo = now.getTime();
  let hi = lo + 26 * 60 * 60 * 1000; // 26 hours out is always tomorrow or beyond

  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDateStr(new Date(mid)) >= tomorrowStr) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  // hi is approximately next local midnight in ms. Add 250ms buffer.
  return hi - now.getTime() + 250;
}

// ---------------------------------------------------------------------------
// todayStore: a Svelte readable that holds today as 'YYYY-MM-DD'.
// Refreshes via two strategies:
//   1. setTimeout aimed at next local midnight (precise)
//   2. setInterval every 60 seconds (safety net for drift / browser throttling)
// ---------------------------------------------------------------------------
export const todayStore = readable<string>(localDateStr(new Date()), (set) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  let intervalId: ReturnType<typeof setInterval>;

  function checkDate() {
    set(localDateStr(new Date()));
    // Re-schedule the midnight timeout each time we update
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      checkDate();
    }, msUntilNextMidnight());
  }

  // Primary: fire at next midnight
  timeoutId = setTimeout(checkDate, msUntilNextMidnight());

  // Safety net: poll every 60 seconds in case setTimeout was throttled
  intervalId = setInterval(checkDate, 60_000);

  return () => {
    clearTimeout(timeoutId);
    clearInterval(intervalId);
  };
});
