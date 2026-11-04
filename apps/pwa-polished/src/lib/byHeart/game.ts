/**
 * By Heart's game screen: which game is up, the place in it, and the settings
 * the games share.
 *
 * Back goes to Android and unfolding a phone relaunches the app, so a game can
 * end at any word. The place is written to this device after every word, and
 * opening the same verse again picks up from it. It stays on the device: only a
 * finished round is worth syncing.
 */

import { writable } from 'svelte/store';
import { getSettings, updateSettings } from '../../adapters/settings';

/** The game on screen. Null is none, and nothing of it is loaded. */
export const byHeartGame = writable<{ verseId: string } | null>(null);

export function openGame(verseId: string): void {
  byHeartGame.set({ verseId });
}

export function closeGame(): void {
  byHeartGame.set(null);
}

// ── The place in a game ─────────────────────────────────────────────────────

/** Cleared on sign-out with the rest of the account's work (clearPersonalData.ts). */
export const RUN_KEY = 'projectbible_byheart_run';

export interface GameRun {
  verseId: string;
  /** How many words are done. */
  cursor: number;
}

/** The saved place in this verse, if the last game was on it. */
export function readRun(verseId: string): GameRun | null {
  try {
    const run = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as GameRun | null;
    return run?.verseId === verseId && Number.isInteger(run.cursor) && run.cursor >= 0 ? run : null;
  } catch {
    return null;
  }
}

export function saveRun(run: GameRun): void {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    // Blocked storage: the game goes on, and a relaunch starts it over.
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    // As above.
  }
}

// ── The covers ──────────────────────────────────────────────────────────────

export type GameCover = 'wordblur' | 'box';

/**
 * How blurry covered words are, as a share of the text size, so one number
 * means the same at every size. Words turn readable at about 0.12; 0.29 is just
 * past that, as a cover needs no more than it takes to hide the word.
 */
export const DEFAULT_BLUR = 0.29;
export const BLUR_RANGE = { min: 0, max: 0.6 };

export interface GamePrefs {
  blur: number;
  cover: GameCover;
}

export function gamePrefs(): GamePrefs {
  const saved = getSettings().byHeartGame;
  return {
    blur:
      typeof saved?.blur === 'number'
        ? Math.max(BLUR_RANGE.min, Math.min(BLUR_RANGE.max, saved.blur))
        : DEFAULT_BLUR,
    cover: saved?.cover === 'box' ? 'box' : 'wordblur',
  };
}

export function setGamePrefs(prefs: GamePrefs): void {
  updateSettings({ byHeartGame: prefs });
}
