import { writable } from 'svelte/store';
import { lookupStore } from './lookupStore';

/**
 * Drives the Nave's Topical modal. Opened with just an id and a display name;
 * the modal fetches the outline and verse list itself — same arrangement as
 * isbeModalStore, so the two bridge to each other symmetrically.
 */
export type NavesTab = 'outline' | 'verses';

export interface NavesModalState {
  isOpen: boolean;
  topicId: number | null;
  primaryName: string;
  /** Tab to land on. Omitted for a normal open, which starts on the outline. */
  tab?: NavesTab | null;
}

const empty: NavesModalState = {
  isOpen: false,
  topicId: null,
  primaryName: '',
  tab: null,
};

function createNavesModalStore() {
  const { subscribe, set } = writable<NavesModalState>({ ...empty });

  // One card holds all four works; lookupStore says which is on top.
  return {
    subscribe,
    open: (data: Omit<NavesModalState, 'isOpen'>) => {
      set({ ...data, isOpen: true });
      lookupStore.show('topical');
    },
    close: () => {
      set({ ...empty });
      lookupStore.close();
    },
  };
}

export const navesModalStore = createNavesModalStore();
