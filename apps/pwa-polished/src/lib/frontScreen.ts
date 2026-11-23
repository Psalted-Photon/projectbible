/**
 * Settings → General → "Jump to the front screen", in the Android app on
 * phones that fold.
 *
 * Closing a Galaxy Flip puts the phone to sleep whatever app is open, so the
 * app watches the hinge and, when the phone is shut with irisBible open,
 * reopens itself on the front screen (FrontScreen.java). The fresh copy comes
 * back where you were through lib/resume.ts and lib/sessionRestore.ts, with
 * no splash. The Fold carries apps over by itself and never needs it.
 *
 * On by default, and per device (not in SYNCED_KEYS). The phone acts on it at
 * the moment of the close, with no page to ask, so it keeps its own copy:
 * handed over at launch and on every change.
 */

import { getSettings, updateSettings } from '../adapters/settings';
import { IS_ANDROID_APP } from './platform';
import { appFoldable, appSetFrontScreenJump } from './android/screen';

export function frontScreenJumpOn(): boolean {
  return getSettings().frontScreenJump !== false;
}

/** Hands the setting to the phone. */
export function syncFrontScreenJump(): void {
  if (!IS_ANDROID_APP) return;
  void appSetFrontScreenJump(frontScreenJumpOn()).catch(() => {});
}

export function setFrontScreenJump(on: boolean): void {
  updateSettings({ frontScreenJump: on });
  syncFrontScreenJump();
}

let foldsAnswer: Promise<boolean> | null = null;

/** Whether this phone folds, so the switch only shows where it means something. False on the website. */
export function phoneFolds(): Promise<boolean> {
  if (!IS_ANDROID_APP) return Promise.resolve(false);
  foldsAnswer ??= appFoldable().then((r) => r?.foldable === true).catch(() => false);
  return foldsAnswer;
}
