/**
 * repeatsStore.ts
 *
 * Persistent, global "Repeats" study overlay. Holds up to MAX_REPEAT_GROUPS
 * words the user is tracking; each renders as a colored navbar pill and as
 * soft in-text highlights everywhere in the Bible. State survives navigation
 * and app restarts via localStorage — modeled on navigationStore.
 */

import { writable } from 'svelte/store';
import { MAX_REPEAT_GROUPS } from '../lib/repeatColors';

export interface RepeatGroup {
  /** Normalized matching key (lowercase, punctuation stripped). */
  word: string;
  /** Original-casing label shown on the pill. */
  label: string;
  /** Index into REPEAT_COLORS. */
  colorIndex: number;
}

const REPEATS_STORAGE_KEY = 'projectbible_repeats';

/** Normalize a word for repeat matching — mirrors the in-text match logic. */
export function normalizeRepeatWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim();
}

function loadPersisted(): RepeatGroup[] {
  try {
    const raw = localStorage.getItem(REPEATS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (g) =>
              g &&
              typeof g.word === 'string' &&
              typeof g.label === 'string' &&
              typeof g.colorIndex === 'number',
          )
          .slice(0, MAX_REPEAT_GROUPS);
      }
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function persist(groups: RepeatGroup[]): void {
  try {
    localStorage.setItem(REPEATS_STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // ignore quota / private-browsing errors
  }
}

/** Smallest color index in [0, MAX) not already used. */
function nextFreeColorIndex(groups: RepeatGroup[]): number {
  const used = new Set(groups.map((g) => g.colorIndex));
  for (let i = 0; i < MAX_REPEAT_GROUPS; i++) {
    if (!used.has(i)) return i;
  }
  return 0;
}

function createRepeatsStore() {
  const { subscribe, set, update } = writable<RepeatGroup[]>(loadPersisted());

  return {
    subscribe,

    /** Add a word (no-op if already present or at capacity). Returns the new group or null. */
    add(rawWord: string): RepeatGroup | null {
      const word = normalizeRepeatWord(rawWord);
      if (!word) return null;
      let added: RepeatGroup | null = null;
      update((groups) => {
        if (groups.some((g) => g.word === word)) return groups;
        if (groups.length >= MAX_REPEAT_GROUPS) return groups;
        added = { word, label: rawWord.trim(), colorIndex: nextFreeColorIndex(groups) };
        const next = [...groups, added];
        persist(next);
        return next;
      });
      return added;
    },

    /** Toggle a word on/off — used by the selection toast "Repeats" action. */
    toggle(rawWord: string): void {
      const word = normalizeRepeatWord(rawWord);
      if (!word) return;
      update((groups) => {
        const existing = groups.some((g) => g.word === word);
        let next: RepeatGroup[];
        if (existing) {
          next = groups.filter((g) => g.word !== word);
        } else {
          if (groups.length >= MAX_REPEAT_GROUPS) return groups;
          next = [...groups, { word, label: rawWord.trim(), colorIndex: nextFreeColorIndex(groups) }];
        }
        persist(next);
        return next;
      });
    },

    remove(rawWord: string): void {
      const word = normalizeRepeatWord(rawWord);
      update((groups) => {
        const next = groups.filter((g) => g.word !== word);
        persist(next);
        return next;
      });
    },

    clear(): void {
      persist([]);
      set([]);
    },
  };
}

export const repeatsStore = createRepeatsStore();
