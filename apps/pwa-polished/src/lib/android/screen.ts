/**
 * Screen direction and keeping the screen on in the Android app.
 *
 * The web view inside the app cannot lock the screen's direction or hold a
 * screen wake lock, so the IrisScreen plugin (IrisScreenPlugin.java) does
 * both with Android's own controls. Full screen needs no call: the app opens
 * that way (MainActivity).
 *
 * Reached only through lib/orientation.ts, lib/installAwake.ts and
 * lib/frontScreen.ts, each behind IS_ANDROID_APP.
 */

import { callNative } from './bridge';

/**
 * Upright, or turning with the phone. `remember` saves it for the next
 * launch; a short hold (Connections asking for the phone sideways) leaves
 * that alone.
 */
export function appSetOrientation(mode: 'portrait' | 'free', remember: boolean): Promise<void> {
  return callNative<void>('IrisScreen', 'setOrientation', { mode, remember });
}

/** Keeps the screen from timing out while the app is on screen, or lets it. */
export function appKeepScreenOn(on: boolean): Promise<void> {
  return callNative<void>('IrisScreen', 'keepAwake', { on });
}

/** "Jump to the front screen" on or off. The phone keeps its own copy (FrontScreen.java). */
export function appSetFrontScreenJump(on: boolean): Promise<void> {
  return callNative<void>('IrisScreen', 'setFrontScreenJump', { on });
}

/** Whether this phone folds (has a hinge). */
export function appFoldable(): Promise<{ foldable: boolean }> {
  return callNative<{ foldable: boolean }>('IrisScreen', 'foldable');
}
