import { writable } from 'svelte/store';

function createProfileModalStore() {
  const { subscribe, set } = writable(false);

  return {
    subscribe,
    open: () => set(true),
    close: () => set(false),
    set,
  };
}

export const profileModalStore = createProfileModalStore();
