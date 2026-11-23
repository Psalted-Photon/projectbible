/**
 * The phone's Back in the Android app.
 *
 * The IrisBack plugin (IrisBackPlugin.java) catches Back only while the Back
 * list (lib/back/backList.ts) has something in it, so this keeps it told.
 * Each caught press comes here, undoes one step, and answers. An empty list
 * means Back isn't caught at all: Android leaves the app as it always has,
 * with its own go-home preview.
 *
 * Reached only from App.svelte, behind IS_ANDROID_APP.
 */

import { callNative, onNative } from './bridge';
import { backListActive, goBackOne } from '../back/backList';

let started = false;

export function startAppBack(): void {
  if (started) return;
  started = true;

  backListActive.subscribe((on) => {
    void callNative('IrisBack', 'setActive', { on }).catch(() => {});
  });

  onNative<{ id: number }>('IrisBack', 'back', ({ id }) => {
    let handled = false;
    try {
      handled = goBackOne();
    } catch (err) {
      console.warn('[back] press failed', err);
      handled = true;
    }
    // Not handled: the list had emptied, so Android takes the press and leaves.
    void callNative('IrisBack', 'answer', { id, handled }).catch(() => {});
  });
}
