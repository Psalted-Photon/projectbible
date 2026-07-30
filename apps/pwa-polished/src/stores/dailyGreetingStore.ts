import { writable } from 'svelte/store';
import { localDateStr } from './clockStore';

const STORAGE_KEY = 'pb_daily_seen';

/** Controls whether the daily greeting modal is visible. */
export const dailyGreetingOpen = writable<boolean>(false);

/**
 * Called on app mount (and on midnight rollover via todayStore subscription).
 * Compares today's date to the last-seen localStorage value.
 * Opens the modal if today's greeting has not been dismissed yet.
 *
 * Deliberately does NOT write the marker — that happens on dismiss, so a page
 * reload (notably the service-worker auto-update reload) brings an unread
 * greeting back instead of silently burning it for the day.
 */
export function checkAndShowDailyGreeting(): void {
  const today = localDateStr(new Date());
  const lastSeen = localStorage.getItem(STORAGE_KEY);
  if (lastSeen !== today) {
    dailyGreetingOpen.set(true);
  }
}

/**
 * Closes the modal and marks today's greeting as seen, so it will not reopen
 * on the next mount. Every user-initiated close path goes through here.
 */
export function dismissDailyGreeting(): void {
  localStorage.setItem(STORAGE_KEY, localDateStr(new Date()));
  dailyGreetingOpen.set(false);
}

/**
 * Opens the modal manually (e.g. from the navbar icon).
 * Does not write to localStorage — next-open check is unaffected.
 */
export function openDailyGreeting(): void {
  dailyGreetingOpen.set(true);
}
