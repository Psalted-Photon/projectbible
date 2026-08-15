import { writable } from 'svelte/store';
import { lookupStore } from './lookupStore';

/**
 * Drives the ISBE encyclopedia / place modal. Opened with a lightweight
 * resolution (entryId / placeId + display name); the modal fetches the full
 * article body, coordinates and verse list itself.
 */
export type IsbeTab = 'overview' | 'article' | 'verses' | 'map';

export interface IsbeModalState {
  isOpen: boolean;
  kind: 'place' | 'entry';
  entryId: number | null;
  placeId: string | null;
  primaryName: string;
  /** Tab to land on. Omitted for a normal open, which starts on Overview;
   *  set when the back arrow restores the modal after a verse jump. */
  tab?: IsbeTab | null;
}

const empty: IsbeModalState = {
  isOpen: false,
  kind: 'entry',
  entryId: null,
  placeId: null,
  primaryName: '',
  tab: null,
};

function createIsbeModalStore() {
  const { subscribe, set } = writable<IsbeModalState>({ ...empty });

  // There is one lookup card holding all four works; lookupStore says which of
  // them is on top. Opening a work sets its own state here and brings it to the
  // front, which is what lets the tabs switch without the card going away.
  return {
    subscribe,
    open: (data: Omit<IsbeModalState, 'isOpen'>) => {
      set({ ...data, isOpen: true });
      lookupStore.show('encyclopedia');
    },
    /** Open by ISBE entry id (used by internal cross-reference links). */
    openEntry: (entryId: number, primaryName: string) => {
      set({ ...empty, kind: 'entry', entryId, primaryName, isOpen: true });
      lookupStore.show('encyclopedia');
    },
    close: () => {
      set({ ...empty });
      lookupStore.close();
    },
  };
}

export const isbeModalStore = createIsbeModalStore();
