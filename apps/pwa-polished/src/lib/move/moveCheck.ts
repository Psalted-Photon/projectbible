/**
 * Decides, at launch on the old address, what the move looks like for this
 * device: straight to the new address, the moving screen, or nothing yet.
 *
 * A device with nothing to lose is signed out and holds no notes, journal,
 * highlights, bookmarks, plans or changed settings. For it there is nothing to
 * carry over, so it is forwarded to the same page on the new address and
 * shared links keep working. Every other device sees the moving screen.
 *
 * Nothing in here deletes or changes anything on the device.
 */

import { writable } from 'svelte/store';
import { supabase } from '../supabase/client';
import {
  ACTIVE_PLANS_KEY, PLAN_HISTORY_KEY, allRows, readJson,
} from '../backup/backupFile';
import { newAddressFor, onOldAddress } from './address';

/** Whether the moving screen is showing. */
export const movingScreenOpen = writable(false);

const SNOOZE_KEY = 'irisbible_move_snooze_until';
const SNOOZE_MS = 24 * 60 * 60 * 1000;
/** Where the app keeps its settings once any have been changed. */
const SETTINGS_KEY = 'projectbible_settings';
const REPEATS_KEY = 'projectbible_repeats';

/** "Not now" hides the screen for a day; it comes back on a later launch. */
export function snoozeMove(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* private mode: the screen simply asks again next launch */
  }
}

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

const PERSONAL_STORES = [
  'user_notes', 'user_highlights', 'user_word_highlights', 'user_bookmarks',
  'notebooks', 'notebook_pages', 'journal_entries', 'plan_metadata', 'reading_progress',
] as const;

/**
 * Whether this device holds anything personal: saved work in any store, a
 * reading plan, or settings the person changed.
 */
export async function deviceHoldsData(): Promise<boolean> {
  try {
    if (localStorage.getItem(SETTINGS_KEY) !== null) return true;
    if (readJson<unknown[]>(ACTIVE_PLANS_KEY, []).length > 0) return true;
    if (readJson<unknown[]>(PLAN_HISTORY_KEY, []).length > 0) return true;
    if (readJson<unknown[]>(REPEATS_KEY, []).length > 0) return true;
  } catch {
    return true; // can't tell, so assume there is something
  }
  try {
    for (const store of PERSONAL_STORES) {
      if ((await allRows<unknown>(store)).length > 0) return true;
    }
    return (await allRows<unknown>('sync_queue')).length > 0;
  } catch {
    return true;
  }
}

/** Whether somebody is signed in on this device. */
export async function isSignedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session?.user);
  } catch {
    return true; // can't tell, so protect the account's work
  }
}

/**
 * Run once at launch. On the new address this does nothing, so it costs the
 * new site nothing. `?moving=1` opens the screen on any address, for testing.
 */
export async function checkMove(): Promise<void> {
  const params = new URLSearchParams(window.location.search);

  if (params.get('moving') === '1') {
    movingScreenOpen.set(true);
    return;
  }
  if (!onOldAddress()) return;

  // A tap on an alarm or reminder notification needs the app, not a detour.
  if (params.has('alarm') || params.has('devo')) return;
  if (snoozed()) return;

  // Forwarding needs the new site to be reachable; offline, stay and show the screen.
  if (navigator.onLine && !(await isSignedIn()) && !(await deviceHoldsData())) {
    window.location.replace(newAddressFor());
    return;
  }
  movingScreenOpen.set(true);
}
