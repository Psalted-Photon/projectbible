import { writable } from 'svelte/store';
import type { WorkKey } from '../lib/openWork';

/**
 * Which of the four reference works the lookup card is showing — or null when
 * there is no card up.
 *
 * There is one card, not four. Each work still keeps its own state in its own
 * store; this only says which of them is on top. That separation is what makes
 * the tabs behave like tabs: switching changes this, the card itself never
 * unmounts, and the work you left keeps its place for when you come back.
 */
function createLookupStore() {
  const { subscribe, set } = writable<WorkKey | null>(null);

  return {
    subscribe,
    /** Bring a work to the front, opening the card if it isn't up. */
    show: (work: WorkKey) => set(work),
    close: () => set(null),
  };
}

export const lookupStore = createLookupStore();
