/**
 * Keeping the phone awake while a pack installs, a recording runs or a
 * recording is transcribed.
 *
 * Two holds, both taken when an install starts and both let go when it ends
 * or fails:
 *
 * - A Screen Wake Lock, so a phone left on the table doesn't time out and lock
 *   halfway through. The browser drops it whenever the app leaves the screen,
 *   so it is taken again each time the app comes back to the front. Android
 *   Chrome and iPhone Safari both have it.
 * - A Web Lock for the whole install. It costs nothing, and Chrome is slower
 *   to freeze a page holding one -- though Android doesn't promise it.
 *
 * Either can be missing or refused (no support, low battery, a page that
 * isn't visible); the install simply runs without it.
 *
 * Each one holds on by name, and both holds stay until the last one lets go,
 * so a pack finishing can't let the screen sleep under a recording.
 */

type WakeLockSentinelLike = { release(): Promise<void> };

const holders = new Set<string>();
let active = false;
let wakeLock: WakeLockSentinelLike | null = null;
let requesting = false;
let releaseWebLock: (() => void) | null = null;

async function takeWakeLock(): Promise<void> {
  const api = (navigator as any).wakeLock;
  if (!api || wakeLock || requesting || document.visibilityState !== 'visible') return;
  requesting = true;
  try {
    const sentinel: WakeLockSentinelLike & EventTarget = await api.request('screen');
    // The install may have ended while the request was out.
    if (!active) {
      void sentinel.release().catch(() => {});
      return;
    }
    wakeLock = sentinel;
    // The browser lets go of it by itself when the app is hidden.
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) wakeLock = null;
    });
  } catch {
    // Refused: low battery mode, or the page lost focus in between.
  } finally {
    requesting = false;
  }
}

function onVisibility(): void {
  if (active && document.visibilityState === 'visible') void takeWakeLock();
}

function takeWebLock(): void {
  const locks = (navigator as any).locks;
  if (!locks?.request || releaseWebLock) return;
  // A name of its own each time, so an install in another tab never makes
  // this one wait in line for a lock it only holds to stay awake.
  const name = `irisbible-install-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const held = new Promise<void>((resolve) => (releaseWebLock = resolve));
  locks.request(name, () => held).catch(() => {});
}

/** Hold both while an install (or `who`) runs. Safe to call when already holding. */
export function stayAwake(who = 'install'): void {
  holders.add(who);
  if (active) return;
  active = true;
  takeWebLock();
  document.addEventListener('visibilitychange', onVisibility);
  void takeWakeLock();
}

/** Let go of both once nothing else holds them. Safe to call when not holding. */
export function allowSleep(who = 'install'): void {
  holders.delete(who);
  if (!active || holders.size) return;
  active = false;
  document.removeEventListener('visibilitychange', onVisibility);
  const sentinel = wakeLock;
  wakeLock = null;
  void sentinel?.release().catch(() => {});
  releaseWebLock?.();
  releaseWebLock = null;
}
