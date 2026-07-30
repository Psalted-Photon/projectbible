/**
 * Sleep timer for Read Aloud.
 *
 * Lives in a module-level store rather than inside TtsPlayer because
 * auto-continue destroys and remounts the player on every chapter. A 30-minute
 * timer has to outlive several of those, so component state is the wrong home.
 *
 * The timer fades and stops; it never navigates. Where you fell asleep is where
 * you wake up.
 */

import { get, writable } from 'svelte/store';
import { getSharedTtsAudio } from '../../adapters/tts';

/** Seconds of fade-out before silence, so it tapers rather than cutting off. */
const FADE_SECONDS = 20;

/** Wall-clock deadline (epoch ms) for a duration timer, or null when unarmed. */
const endsAt = writable<number | null>(null);

/** Seconds remaining, for display. null when no duration timer is armed. */
export const sleepRemaining = writable<number | null>(null);

/** Stop when the current chapter finishes instead of advancing. */
export const stopAtChapterEnd = writable<boolean>(false);

/**
 * Bumped when the timer decides playback should end. TtsPlayer watches this and
 * runs its own stopReading, because only the player can tear down its queue,
 * caches and object URLs correctly.
 */
export const sleepStopNonce = writable<number>(0);

let ticker: ReturnType<typeof setInterval> | null = null;

function restoreVolume(): void {
  try {
    getSharedTtsAudio().volume = 1;
  } catch {
    // No audio element yet; nothing to restore.
  }
}

function tick(): void {
  const deadline = get(endsAt);
  if (deadline === null) return;

  const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  sleepRemaining.set(remaining);

  if (remaining <= 0) {
    restoreVolume();
    clearTimer();
    sleepStopNonce.update((n) => n + 1);
    return;
  }

  if (remaining <= FADE_SECONDS) {
    // Note: iOS ignores volume on HTMLAudioElement, so there the timer simply
    // stops at zero rather than tapering. The stop itself still works.
    try {
      getSharedTtsAudio().volume = Math.max(0, remaining / FADE_SECONDS);
    } catch {
      // Ignore — the fade is a nicety, the stop is the contract.
    }
  }
}

function clearTimer(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  endsAt.set(null);
  sleepRemaining.set(null);
}

/** Arm a duration timer. Replaces any existing timer. */
export function startSleepTimer(minutes: number): void {
  cancelSleepTimer();
  endsAt.set(Date.now() + minutes * 60_000);
  sleepRemaining.set(minutes * 60);
  // Every second so the fade is smooth; the readout only shows minutes.
  ticker = setInterval(tick, 1000);
}

/** Stop when this chapter ends, however long that takes. */
export function setStopAtChapterEnd(): void {
  cancelSleepTimer();
  stopAtChapterEnd.set(true);
}

/** Disarm everything and undo any in-progress fade. */
export function cancelSleepTimer(): void {
  clearTimer();
  stopAtChapterEnd.set(false);
  restoreVolume();
}

/** Whether any form of sleep timer is currently armed. */
export function sleepTimerArmed(): boolean {
  return get(endsAt) !== null || get(stopAtChapterEnd);
}

/** Minutes remaining, rounded up so 1–59s still reads as "1" rather than "0". */
export function remainingMinutes(seconds: number | null): number | null {
  if (seconds === null) return null;
  return Math.max(1, Math.ceil(seconds / 60));
}
