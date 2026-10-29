/**
 * Open a journal day from anywhere: a journal recording's row in Recordings,
 * or a transcript's "Open". An open Journal window turns to the day
 * (JournalWriter listens for OPEN_JOURNAL_DAY, and the window remembers it
 * for when the lock screen gives way); with none open, a new one opens on it.
 */

import { get } from 'svelte/store';
import { windowStore } from './stores/windowStore';
import { openWindowOfType } from './windowTypes';

export const OPEN_JOURNAL_DAY = 'openJournalDay';

export function openJournalDay(date: string): void {
  const open = get(windowStore).find((w) => w.contentType === 'journal');
  if (open) {
    windowStore.updateContentState(open.id, { date });
    window.dispatchEvent(new CustomEvent<string>(OPEN_JOURNAL_DAY, { detail: date }));
    return;
  }
  openWindowOfType('journal', { date });
}
