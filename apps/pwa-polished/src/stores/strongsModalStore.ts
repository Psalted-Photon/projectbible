import { writable } from 'svelte/store';
import { lookupStore } from './lookupStore';

export interface StrongsModalState {
  isOpen: boolean;
  /** The entry to show — exact, split letter and all (G2424G is Jesus, G2424K
   *  Joshua). Null opens the contents. */
  strongsId: string | null;
}

function createStrongsModalStore() {
  const { subscribe, set } = writable<StrongsModalState>({ isOpen: false, strongsId: null });

  return {
    subscribe,
    // One card holds all five works; lookupStore says which is on top.
    open: (data: { strongsId: string | null }) => {
      set({ isOpen: true, strongsId: data.strongsId });
      lookupStore.show('strongs');
    },
    close: () => {
      set({ isOpen: false, strongsId: null });
      lookupStore.close();
    },
  };
}

export const strongsModalStore = createStrongsModalStore();
