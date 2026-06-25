/**
 * bookRepeatHighlightsStore.ts
 *
 * Records which repeat words have been permanently highlighted in which book,
 * so their pill can relocate from the navbar to sit beside that book's
 * "Introduction" button. localStorage-backed (like repeatsStore).
 *
 * This is only the association metadata — the highlights themselves live in
 * IndexedDB and sync. Keeping this layer local avoids a synced `word` column /
 * backend migration; the tradeoff is the relocated pill is device-local
 * (the underlying highlights still appear everywhere).
 *
 * Reconciled against real highlights via prune(): if a record's highlightIds
 * no longer exist, it's dropped — so removing the highlights by any path makes
 * the pill vanish.
 */

import { writable } from 'svelte/store';

export interface BookRepeatRecord {
  book: string;
  /** Normalized matching key. */
  word: string;
  /** Original-casing label for the pill. */
  label: string;
  /** The chosen highlight color (the pill renders in this). */
  color: string;
  /** IDs of the word-highlights created for this word in this book. */
  highlightIds: string[];
}

const STORAGE_KEY = 'projectbible_book_repeats';

function load(): BookRepeatRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (r) =>
            r &&
            typeof r.book === 'string' &&
            typeof r.word === 'string' &&
            typeof r.label === 'string' &&
            typeof r.color === 'string' &&
            Array.isArray(r.highlightIds),
        );
      }
    }
  } catch {
    // ignore
  }
  return [];
}

function persist(records: BookRepeatRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // ignore quota / private-browsing
  }
}

function createStore() {
  const { subscribe, update, set } = writable<BookRepeatRecord[]>(load());

  return {
    subscribe,

    /** Add or merge a record for (book, word). Merges highlight IDs if it exists. */
    add(rec: BookRepeatRecord): void {
      update((records) => {
        const existing = records.find((r) => r.book === rec.book && r.word === rec.word);
        let next: BookRepeatRecord[];
        if (existing) {
          const merged: BookRepeatRecord = {
            ...existing,
            label: rec.label,
            color: rec.color,
            highlightIds: Array.from(new Set([...existing.highlightIds, ...rec.highlightIds])),
          };
          next = records.map((r) => (r === existing ? merged : r));
        } else {
          next = [...records, rec];
        }
        persist(next);
        return next;
      });
    },

    /** Remove the record for (book, word) entirely. */
    remove(book: string, word: string): void {
      update((records) => {
        const next = records.filter((r) => !(r.book === book && r.word === word));
        persist(next);
        return next;
      });
    },

    /**
     * Reconcile every record for a book against the set of highlight IDs that
     * still exist. Drops missing IDs; drops the record if none remain.
     */
    prune(book: string, existingIds: Set<string>): void {
      update((records) => {
        let changed = false;
        const next: BookRepeatRecord[] = [];
        for (const r of records) {
          if (r.book !== book) {
            next.push(r);
            continue;
          }
          const keptIds = r.highlightIds.filter((id) => existingIds.has(id));
          if (keptIds.length === 0) {
            changed = true; // drop record
            continue;
          }
          if (keptIds.length !== r.highlightIds.length) {
            changed = true;
            next.push({ ...r, highlightIds: keptIds });
          } else {
            next.push(r);
          }
        }
        if (changed) persist(next);
        return changed ? next : records;
      });
    },

    clear(): void {
      persist([]);
      set([]);
    },
  };
}

export const bookRepeatHighlightsStore = createStore();
