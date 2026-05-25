import { writable } from 'svelte/store';
import { localDateStr } from './clockStore';

const STORAGE_KEY = 'pb_daily_seen';

/** Controls whether the daily greeting modal is visible. */
export const dailyGreetingOpen = writable<boolean>(false);

/**
 * Called on app mount (and on midnight rollover via todayStore subscription).
 * Compares today's date to the last-seen localStorage value.
 * Opens the modal if this is the first open of a new day.
 */
export function checkAndShowDailyGreeting(): void {
  const today = localDateStr(new Date());
  const lastSeen = localStorage.getItem(STORAGE_KEY);
  if (lastSeen !== today) {
    localStorage.setItem(STORAGE_KEY, today);
    dailyGreetingOpen.set(true);
  }
}

/**
 * Opens the modal manually (e.g. from the navbar icon).
 * Does not write to localStorage — next-open check is unaffected.
 */
export function openDailyGreeting(): void {
  dailyGreetingOpen.set(true);
}
