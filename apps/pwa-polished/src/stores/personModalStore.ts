import { writable } from 'svelte/store';
import type { PersonLookupResult } from '../adapters/lexicon-lookup';

/**
 * Drives the People (bio) modal.
 *
 * People used to be the odd one out of the four works: a bio could only reach
 * the screen riding lexicalModalStore.characterData — that is, as a word study
 * of a word that happened to be a person — so nothing could navigate *to* a
 * bio. This gives it the same standing as the encyclopedia and topical stores
 * so all four bridge to each other symmetrically.
 *
 * Opens either way PersonContent accepts: by id from the library and the work
 * tabs, or with a whole resolution when a clicked word matched several people
 * and the homonyms have to be offered.
 */
export interface PersonModalState {
  isOpen: boolean;
  personId: string | null;
  primaryName: string;
  /** A click resolution, when there are homonyms to choose between. */
  lookup: PersonLookupResult | null;
  /** The word that was clicked, for the "several people named X" wording. */
  clickedWord: string;
}

const empty: PersonModalState = {
  isOpen: false,
  personId: null,
  primaryName: '',
  lookup: null,
  clickedWord: '',
};

function createPersonModalStore() {
  const { subscribe, set } = writable<PersonModalState>({ ...empty });

  return {
    subscribe,
    open: (data: Partial<Omit<PersonModalState, 'isOpen'>>) =>
      set({ ...empty, ...data, isOpen: true }),
    close: () => set({ ...empty }),
  };
}

export const personModalStore = createPersonModalStore();
