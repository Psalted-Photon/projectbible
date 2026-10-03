import { writable, type Readable } from 'svelte/store';

/**
 * Dev Options: a hidden section at the bottom of Settings, unlocked by tapping
 * the Storage & Updates header ten times within ten seconds.
 *
 * Both switches are per device, kept in localStorage outside the settings
 * blob so they never sync. Clear Cache leaves localStorage alone, so a device
 * that was unlocked stays unlocked through one.
 */

const UNLOCKED_KEY = 'projectbible_dev_options';
const ERUDA_KEY = 'projectbible_show_eruda';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the switch still works until the app closes.
  }
}

interface FlagStore extends Readable<boolean> {
  set(on: boolean): void;
}

function flagStore(key: string): FlagStore {
  const store = writable(readFlag(key));
  return {
    subscribe: store.subscribe,
    set(on: boolean) {
      writeFlag(key, on);
      store.set(on);
    },
  };
}

/** Whether the Dev Options section shows in Settings. */
export const devOptionsUnlocked = flagStore(UNLOCKED_KEY);

/**
 * Whether eruda's floating button shows. Eruda itself always loads at launch,
 * so its console has been catching logs all along; this only decides whether
 * the button to open it is on screen. Off by default.
 */
export const showEruda = flagStore(ERUDA_KEY);

/** Hiding Dev Options also puts the eruda button away, so nothing is left on screen that the hidden section controls. */
export function hideDevOptions(): void {
  showEruda.set(false);
  devOptionsUnlocked.set(false);
}

/** Taps needed, and the window they must land in. */
export const UNLOCK_TAPS = 10;
export const UNLOCK_WINDOW_MS = 10_000;
