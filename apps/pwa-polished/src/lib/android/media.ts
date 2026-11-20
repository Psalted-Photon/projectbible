/**
 * Read Aloud on Android's own media controls.
 *
 * The web view inside the app has no working Media Session, and on its own it
 * would be put to sleep soon after the screen goes off. The IrisMedia plugin
 * (IrisMediaPlugin.java) runs ReadAloudService for as long as something is
 * playing or paused: it keeps the app and the processor awake, and shows what
 * is being read on the lock screen and in the notification shade with
 * working controls.
 *
 * Reached only through lib/tts/mediaSession.ts, behind IS_ANDROID_APP.
 */

import { callNative, onNative } from './bridge';

export interface AppNowPlaying {
  /** "buffering" is speech being made before it can start; "none" ends it. */
  state: 'playing' | 'buffering' | 'paused' | 'none';
  title?: string;
  subtitle?: string;
  album?: string;
  /** Seconds; 0 while unknown. */
  duration?: number;
  position?: number;
  /** How fast the position moves while playing (the Read Aloud speed). */
  speed?: number;
}

export type AppMediaAction = 'play' | 'pause' | 'next' | 'previous' | 'stop';

/**
 * Android moves the progress bar along by itself, so a new position is only
 * worth sending when it has strayed this far, in seconds, from where Android
 * thinks it is (a jump, a pause, a slow start).
 */
const DRIFT_SECONDS = 2;

let last: (AppNowPlaying & { at: number }) | null = null;

function worthSending(now: AppNowPlaying): boolean {
  if (!last) return now.state !== 'none';
  if (
    now.state !== last.state ||
    now.title !== last.title ||
    now.subtitle !== last.subtitle ||
    now.album !== last.album ||
    now.speed !== last.speed
  ) {
    return true;
  }
  if (now.state === 'none') return false;
  if (Math.abs((now.duration ?? 0) - (last.duration ?? 0)) > DRIFT_SECONDS) return true;
  const moved = last.state === 'playing' ? ((performance.now() - last.at) / 1000) * (last.speed ?? 1) : 0;
  return Math.abs((now.position ?? 0) - ((last.position ?? 0) + moved)) > DRIFT_SECONDS;
}

/** Tells Android what is being read. Repeats and small clock ticks are skipped. */
export function appNowPlaying(now: AppNowPlaying): void {
  if (!worthSending(now)) return;
  last = { ...now, at: performance.now() };
  void callNative<void>('IrisMedia', 'update', { ...now }).catch(() => {});
}

/** A control pressed on the lock screen, in the notification or on a headset. */
export function onAppMediaAction(handler: (action: AppMediaAction) => void): void {
  onNative<{ action: AppMediaAction }>('IrisMedia', 'action', (data) => handler(data.action));
}
