/**
 * Chrome's "install this app" offer, caught and kept.
 *
 * The browser fires beforeinstallprompt once, early, and only if it is willing
 * to install the app at all. Miss it and there is no way to ask for it back, so
 * the listener is registered from main.ts at load and the event is parked here
 * until something wants it -- the tutorial's install step, minutes later.
 *
 * Safari never fires it. On iOS the only way onto the home screen is Share ->
 * Add to Home Screen by hand, so anything using this has to have words ready
 * for the case where `canInstall` stays false.
 */

import { writable, get } from 'svelte/store';

/** The event, which is not in TypeScript's DOM library. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const saved = writable<InstallPromptEvent | null>(null);

/** True while the browser is willing to show its install dialog. */
export const canInstall = writable(false);

let listening = false;

/** Called once from main.ts, before anything that might await. */
export function watchForInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this Chrome shows its own mini-infobar and never hands the
    // event over, so the offer could not be put where it makes sense.
    event.preventDefault();
    saved.set(event as InstallPromptEvent);
    canInstall.set(true);
  });

  window.addEventListener('appinstalled', () => {
    saved.set(null);
    canInstall.set(false);
  });
}

/**
 * Show the browser's install dialog. Resolves once the person has answered.
 * A saved event is good for one use, so it is dropped either way.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = get(saved);
  if (!event) return 'unavailable';
  saved.set(null);
  canInstall.set(false);
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    // Already used, or the page lost the gesture that allowed it.
    return 'unavailable';
  }
}
