/**
 * The browser's Back on the website and the installed web app.
 *
 * A web page can't catch Back directly. What it can do is add history steps
 * of its own: Back then moves to the step below instead of leaving, and the
 * page hears about it (popstate). So this keeps one history step for each
 * entry in the Back list (lib/back/backList.ts). Each Back the page hears
 * undoes one entry with goBackOne(), the same as the Android app does, and
 * once the list is empty there is no spare step left, so the next Back leaves
 * the site as it always has.
 *
 * Kept in line both ways:
 * - Something opened: a step is added.
 * - Something closed another way (its ×, a tap away): its spare step is taken
 *   off quietly, with nothing undone.
 * - Back at a wall does nothing, so the step it used is put straight back.
 *
 * Chrome skips history steps a page added before anyone touched it, so no
 * step is added until the first tap or key press.
 *
 * Each step carries its place (irisBack: 1, 2, 3...; the page's own entry is
 * 0), so a run of quick presses that arrive together is still counted right.
 *
 * Started from App.svelte on the website only; the Android app catches Back
 * natively (lib/android/back.ts).
 */

import { backListSize, goBackOne } from './backList';

const KEY = 'irisBack';

let started = false;
/** Pointer down or a key pressed at least once: steps may be added. */
let armed = false;
/** Where history stands now: 0 is the page's own entry, n is our nth step. */
let pos = 0;
/** How many steps the Back list wants. */
let want = 0;
/** A quiet move back is under way, and the place it is headed. */
let quietTo: number | null = null;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let queued = false;
/** The app is reloading: history is on its way back to the start. */
let leaving = false;

function placeOf(state: unknown): number {
  const n = (state as Record<string, unknown> | null)?.[KEY];
  return typeof n === 'number' && n > 0 ? n : 0;
}

function withPlace(n: number): Record<string, unknown> {
  const state = history.state;
  const base = state && typeof state === 'object' ? { ...(state as Record<string, unknown>) } : {};
  base[KEY] = n;
  return base;
}

function schedule(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    settle();
  });
}

/** Bring the number of our history steps in line with the Back list. */
function settle(): void {
  if (leaving || quietTo !== null) return;
  if (want > pos) {
    if (!armed) return;
    while (pos < want) {
      pos++;
      history.pushState(withPlace(pos), '');
    }
  } else if (want < pos) {
    const target = want;
    quietTo = target;
    // Should the move never be heard, trust where history says it is.
    quietTimer = setTimeout(() => {
      quietTimer = null;
      if (quietTo === null) return;
      quietTo = null;
      pos = placeOf(history.state);
      schedule();
    }, 1000);
    history.go(target - pos);
  }
}

function onPopState(event: PopStateEvent): void {
  if (leaving) {
    location.reload();
    return;
  }
  const now = placeOf(event.state);

  if (quietTo !== null) {
    const expected = quietTo;
    quietTo = null;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
    // Our own move, plus any presses that slipped in around it.
    const presses = Math.max(0, expected - now);
    pos = now;
    press(presses);
    schedule();
    return;
  }

  // Back moves down (one step per press, or several when quick presses
  // arrive together). Forward moves up and undoes nothing; settle takes off
  // whatever steps the list doesn't want.
  const presses = Math.max(0, pos - now);
  pos = now;
  press(presses);
  schedule();
}

function press(times: number): void {
  for (let i = 0; i < times; i++) {
    try {
      // False means the list had emptied: nothing more to undo.
      if (!goBackOne()) break;
    } catch (err) {
      console.warn('[back] press failed', err);
    }
  }
}

function arm(): void {
  if (armed) return;
  armed = true;
  window.removeEventListener('pointerdown', arm, true);
  window.removeEventListener('keydown', arm, true);
  schedule();
}

export function startWebHistory(): void {
  if (started || typeof window === 'undefined' || !('pushState' in history)) return;
  started = true;

  // A reload by hand (F5) can land on one of our old steps. The ones below it
  // belong to the page before the reload, so this entry becomes the start.
  if (placeOf(history.state) > 0) {
    try {
      history.replaceState(withPlace(0), '');
    } catch {
      // Leave it; Back still works, it just starts one place off.
    }
  }
  pos = 0;

  window.addEventListener('popstate', onPopState);
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation?.hasBeenActive) {
    armed = true;
  } else {
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
  }

  backListSize.subscribe((n) => {
    want = n;
    schedule();
  });
}

/**
 * Reload the app. Its own reloads (an update, Restart) come here: history is
 * first stepped back to the page's own entry, so no stale steps survive into
 * the reloaded page. Before the web history has started, or in the Android
 * app, this is a plain reload.
 */
export function reloadApp(): void {
  if (!started || leaving) {
    location.reload();
    return;
  }
  const back = placeOf(history.state);
  if (back === 0) {
    location.reload();
    return;
  }
  leaving = true;
  // Should the move never be heard, reload anyway.
  setTimeout(() => location.reload(), 700);
  history.go(-back);
}
