/**
 * Opening and sealing whole journal entries, for the journal store.
 *
 * Opening is driven by the data: a field is unscrambled only if it carries
 * the scramble tag, so readable old entries and scrambled new ones can sit
 * side by side while the lock is being switched on or off.
 */

import type { JournalEntry } from '@projectbible/core';
import { isScrambled, scrambleField, unscrambleField } from './crypto';
import { currentLockView, getContentKey, noteScrambledSeen } from './lockState';

export interface OpenedJournalEntry extends JournalEntry {
  /** Scrambled, and the journal is locked. Title and text are left empty. */
  locked?: boolean;
  /** Scrambled, and the key in memory couldn't open it. Must not be saved over. */
  unreadable?: boolean;
}

export class JournalLockedError extends Error {
  constructor() {
    super('The journal is locked.');
    this.name = 'JournalLockedError';
  }
}

export function entryIsScrambled(entry: { title?: string | null; text?: string | null }): boolean {
  return isScrambled(entry.title) || isScrambled(entry.text);
}

export async function openEntry(entry: JournalEntry): Promise<OpenedJournalEntry> {
  if (!entryIsScrambled(entry)) return entry;
  const key = getContentKey();
  if (!key) {
    noteScrambledSeen();
    // Locked if unlocking is possible; otherwise (lock off, no slots left)
    // it's simply an entry that can't be opened.
    return currentLockView().needsUnlock
      ? { ...entry, title: undefined, text: '', locked: true }
      : { ...entry, title: undefined, text: '', unreadable: true };
  }
  try {
    const title = await unscrambleField(key, entry.id, entry.date, 'title', entry.title);
    const text = await unscrambleField(key, entry.id, entry.date, 'text', entry.text);
    return { ...entry, title: title || undefined, text };
  } catch {
    return { ...entry, title: undefined, text: '', unreadable: true };
  }
}

/** Scramble an entry's title and text for storage. Throws while locked. */
export async function sealFields(
  id: string,
  date: string,
  title: string | undefined,
  text: string,
): Promise<{ title: string | undefined; text: string }> {
  const key = getContentKey();
  if (!key) throw new JournalLockedError();
  return {
    title: (await scrambleField(key, id, date, 'title', title)) || undefined,
    text: await scrambleField(key, id, date, 'text', text),
  };
}
