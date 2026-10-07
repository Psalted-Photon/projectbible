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
import { pendingRestore } from './navigationStore';
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
  /** Whether the words-and-phrases panel was open, and where it was scrolled. */
  notesOpen?: boolean;
  notesScrollTop?: number;
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

/**
 * The BookBookmark crumb walking back to a reading. The crumb's origin carries
 * the reading and where it was scrolled; whoever recognizes a pending restore
 * clears it. Lives here, not in the tab, because the tab isn't mounted while
 * the Reading Plan window is shut, which is exactly when the crumb is tapped.
 */
pendingRestore.subscribe((pending) => {
  const p = pending as ({ surface?: string } & Partial<DevotionalTarget>) | null;
  if (p?.surface !== 'devotional' || !p.workId || !p.month || !p.day || !p.slot) return;
  const target: DevotionalTarget = {
    workId: p.workId,
    month: p.month,
    day: p.day,
    slot: p.slot,
    scrollTop: p.scrollTop,
    notesOpen: p.notesOpen,
    notesScrollTop: p.notesScrollTop,
  };
  // Out of the subscriber before writing back to the store it's subscribed to.
  queueMicrotask(() => {
    pendingRestore.set(null);
    openDevotional(target);
  });
});
