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

/** How a verse is played. Silent study is the one with no voice. */
export type GameMode = 'focus' | 'build' | 'recital' | 'flashcards' | 'call' | 'weak' | 'silent';

/** Which way a flashcard goes: reference to verse, or opening words to reference. */
export type FlashSide = 'verse' | 'words';

/** One verse, played one way. */
export interface GameStep {
  verseId: string;
  mode: GameMode;
  /** A second try in the same session, after a score under 60. */
  retry?: boolean;
  /** Weak Spots: the word to drill around. */
  word?: number;
}

/** What is on the game screen: the steps it runs through, and which one it is on. */
export interface GameSession {
  id: number;
  steps: GameStep[];
  at: number;
  /** Today's run, which ends by saying so. */
  today?: boolean;
}

/** The game on screen. Null is none, and nothing of it is loaded. */
export const byHeartGame = writable<GameSession | null>(null);

export function openGame(verseId: string, mode: GameMode = 'focus'): void {
  byHeartGame.set({ id: Date.now(), steps: [{ verseId, mode }], at: 0 });
}

export function closeGame(): void {
  byHeartGame.set(null);
}

// ── The place in a game ─────────────────────────────────────────────────────

/** Cleared on sign-out with the rest of the account's work (clearPersonalData.ts). */
export const RUN_KEY = 'projectbible_byheart_run';

export interface GameRun {
  verseId: string;
  mode: GameMode;
  /** Which round of the game it is on, and how many of the round's words are done. */
  round: number;
  cursor: number;
  /** Whether the reference is being said, as it was when the game started. */
  reference: SpokenRefMode;
  /** A flashcard's way round. */
  side?: FlashSide;
  /** The reference is still to be said. */
  refStart: boolean;
  refEnd: boolean;
  /** What took a hint so far, and which of those were asked for with Show me. */
  hints: number[];
  shownMe: number[];
}

/** The saved place in this verse, if the last game was on it and played this way. */
export function readRun(verseId: string, mode: GameMode): GameRun | null {
  try {
    const run = JSON.parse(localStorage.getItem(RUN_KEY) ?? 'null') as GameRun | null;
    return run?.verseId === verseId && run.mode === mode && Number.isInteger(run.cursor) && run.cursor >= 0 ? run : null;
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
/** Under this a word can be read, so saying it counts as a hint. */
export const BLUR_LINE = 0.12;

/** Whether the reference has to be said, and when. */
export type SpokenRefMode = 'off' | 'start' | 'end' | 'both';

export interface GamePrefs {
  blur: number;
  cover: GameCover;
  reference: SpokenRefMode;
}

export function gamePrefs(): GamePrefs {
  const saved = getSettings().byHeartGame;
  return {
    blur:
      typeof saved?.blur === 'number'
        ? Math.max(BLUR_RANGE.min, Math.min(BLUR_RANGE.max, saved.blur))
        : DEFAULT_BLUR,
    cover: saved?.cover === 'box' ? 'box' : 'wordblur',
    reference: saved?.reference ?? 'off',
  };
}

export function setGamePrefs(prefs: Partial<GamePrefs>): void {
  updateSettings({ byHeartGame: { ...getSettings().byHeartGame, ...prefs } });
}
