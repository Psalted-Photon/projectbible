/**
 * The Android app unpacks every pack on its first launch, with the reader
 * already open in front of it. Run flat out, that left the phone laggy and
 * slow to answer a tap, so while an install holds the lock the pack writes
 * work about three quarters of the time and rest for the remainder.
 *
 * Android app only: db.ts and packInstaller.ts call in here behind
 * IS_ANDROID_APP, so none of it ships in the web build.
 */

/** Share of the time an install spends working. */
const WORK_SHARE = 0.75;
/** No rest after less work than this, so a few quick batches go together. */
const MIN_WORK_MS = 40;
/** The longest single rest, so one slow batch can't stall the install. */
const MAX_REST_MS = 1000;

let pacing = false;
let workingSince = 0;

/** On while an install holds the lock (installBusy). */
export function paceInstalls(on: boolean): void {
  pacing = on;
  workingSince = performance.now();
}

/**
 * Called after each batch of pack rows lands. Returns a rest in proportion to
 * the work done since the last one, or null when there is nothing to wait for.
 */
export function restAfterBatch(): Promise<void> | null {
  if (!pacing) return null;
  // With the app in the background nobody is waiting on the screen, and the
  // WebView stretches timers there, which would turn short rests into long
  // stalls.
  if (document.visibilityState === 'hidden') return null;
  const worked = performance.now() - workingSince;
  if (worked < MIN_WORK_MS) return null;
  const rest = Math.min(MAX_REST_MS, (worked * (1 - WORK_SHARE)) / WORK_SHARE);
  return new Promise((resolve) =>
    setTimeout(() => {
      workingSince = performance.now();
      resolve();
    }, rest),
  );
}
