/**
 * The one "English" switch: whether Greek and Hebrew previews carry the same
 * verse in English beneath them. Flipping it anywhere flips it everywhere,
 * here and, through settings sync, on the account's other devices.
 */

import { writable } from 'svelte/store';
import { getSettings, updateSettings } from '../adapters/settings';

const read = () => getSettings().englishCompanion !== false;

const store = writable(true);

let watching = false;
function watch() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  store.set(read());
  window.addEventListener('settingsUpdated', () => store.set(read()));
}

export const englishCompanion = {
  subscribe(run: (on: boolean) => void) {
    watch();
    return store.subscribe(run);
  },
  set(on: boolean) {
    updateSettings({ englishCompanion: on });
    store.set(on);
    window.dispatchEvent(new CustomEvent('settingsUpdated'));
  },
};
