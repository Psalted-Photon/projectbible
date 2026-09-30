/**
 * Which devotional reading to show, and the Devotionals settings as a store.
 *
 * openDevotional() is the one way in from anywhere — the Verse of the Day
 * link, a shared link, a reminder, a search result, the crumb back from the
 * reader. It sets the target and opens the Reading Plan window, which switches
 * to its Devotionals tab when a target is waiting. If the pack isn't installed
 * the tab shows its install card and keeps the target until the install ends.
 */

import { writable } from 'svelte/store';
import { readingPlanModalStore } from './readingPlanModalStore';
import {
  getDevotionalSettings,
  updateDevotionalSettings,
  type DevotionalSettings,
} from '../adapters/settings';
import type { DevotionalSlot } from '../lib/devotionals/devotionalsData';

export interface DevotionalTarget {
  workId: string;
  month: number;
  day: number;
  slot: DevotionalSlot;
  /** Where the reading was scrolled to, when coming back from the reader. */
  scrollTop?: number;
}

export const devotionalTarget = writable<DevotionalTarget | null>(null);

export function openDevotional(target: DevotionalTarget): void {
  devotionalTarget.set(target);
  readingPlanModalStore.open();
}

function createDevotionalSettingsStore() {
  const { subscribe, set } = writable<DevotionalSettings>(getDevotionalSettings());
  return {
    subscribe,
    update(updates: Parameters<typeof updateDevotionalSettings>[0]) {
      set(updateDevotionalSettings(updates));
    },
    /** Re-read from storage — after a settings pull from another device. */
    refresh() {
      set(getDevotionalSettings());
    },
  };
}

export const devotionalSettings = createDevotionalSettingsStore();
