import { writable } from 'svelte/store';

function createReadingPlanModalStore() {
  const { subscribe, set } = writable(false);

  return {
    subscribe,
    open: () => set(true),
    close: () => set(false),
    set,
  };
}

export const readingPlanModalStore = createReadingPlanModalStore();
