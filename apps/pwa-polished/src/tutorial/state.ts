/**
 * Tutorial Mode's whole memory: whether it is on, and how far the tour got.
 *
 * Deliberately tiny and separate from everything else. It has its own storage
 * key rather than a field in the settings blob, so it never syncs (a new phone
 * gets its own tour) and the settings code never has to know it exists. It does
 * not remember which tips someone has seen: while the tutorial is on, every tip
 * shows, and turning it off and on again replays the tour from the start.
 *
 * On by default for everyone. No key yet means nobody has turned it off.
 */

import { writable } from 'svelte/store';

const STORAGE_KEY = 'pb_tutorial';

/**
 * Where the tour is.
 * - start    the Welcome splash has not been dismissed yet
 * - part1    the tour's first half, which needs no packs
 * - waiting  part 1 is done and packs are still installing
 * - part2    the half that shows what the packs switched on
 * - done     tour over; only the dots remain
 */
export type TourStage = 'start' | 'part1' | 'waiting' | 'part2' | 'done';

export interface TutorialState {
  on: boolean;
  stage: TourStage;
}

const STAGES: TourStage[] = ['start', 'part1', 'waiting', 'part2', 'done'];
const DEFAULT_STATE: TutorialState = { on: true, stage: 'start' };

function load(): TutorialState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return {
      on: parsed?.on !== false,
      stage: STAGES.includes(parsed?.stage) ? parsed.stage : 'start',
    };
  } catch {
    // Unreadable or blocked storage: behave like a first visit.
    return { ...DEFAULT_STATE };
  }
}

function save(state: TutorialState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing or a full quota. The tutorial still works this session.
  }
}

function createTutorialStore() {
  const { subscribe, update } = writable<TutorialState>(load());

  const commit = (fn: (s: TutorialState) => TutorialState) =>
    update((s) => {
      const next = fn(s);
      save(next);
      return next;
    });

  return {
    subscribe,

    /** The Settings toggle. Switching on replays the tour from the splash. */
    setOn(on: boolean) {
      commit((s) => (on ? { on: true, stage: s.on ? s.stage : 'start' } : { ...s, on: false }));
    },

    setStage(stage: TourStage) {
      commit((s) => ({ ...s, stage }));
    },
  };
}

export const tutorial = createTutorialStore();
