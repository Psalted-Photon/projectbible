import { writable } from 'svelte/store';
import type { HarmonyPassage } from '@projectbible/core';
import type { HarmonySectionProgress } from './ReadingProgressStore';

export interface HarmonyNavState {
  planId: string;
  dayNumber: number;
  /** Flat ordered list of all passages for this day */
  allPassages: HarmonyPassage[];
  /** Index in allPassages of the passage currently being read */
  passageIndex: number;
  /** Section-level progress objects for this day (for marking complete) */
  allSectionsForDay: HarmonySectionProgress[];
}

function createHarmonyNavStore() {
  const { subscribe, set, update } = writable<HarmonyNavState | null>(null);

  return {
    subscribe,

    setSession(state: HarmonyNavState) {
      set(state);
    },

    /**
     * Advance to the next passage.
     * Returns the next HarmonyPassage, or null if already on the last one.
     */
    advance(): HarmonyPassage | null {
      let next: HarmonyPassage | null = null;
      update(state => {
        if (!state) return state;
        const nextIndex = state.passageIndex + 1;
        if (nextIndex >= state.allPassages.length) return state;
        next = state.allPassages[nextIndex];
        return { ...state, passageIndex: nextIndex };
      });
      return next;
    },

    clearSession() {
      set(null);
    },
  };
}

export const harmonyNavStore = createHarmonyNavStore();
