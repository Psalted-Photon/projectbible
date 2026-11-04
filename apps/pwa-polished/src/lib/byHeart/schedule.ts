/**
 * By Heart's schedule. Each verse has one score, one color and one next date,
 * and its stage (New, Learning, Known) is worked out from what it has kept.
 *
 * These are due dates, not a round robin. A score of 90 or better grows the gap
 * (about 1, 3, 7, 16, then 35 days, so a strong verse drops to about monthly and
 * never fully leaves), 60 to 89 keeps the same gap, and under 60 comes back
 * tomorrow. Known takes passes on about 3 separate days. Only recalling a whole
 * verse from memory counts here.
 */

import type { DBByHeartVerse } from '../../adapters/db';
import type { NewByHeartVerse } from '../../adapters/SyncedByHeartStore';
import { localDateStr } from '../../stores/clockStore';
import { cardWords } from '../shareCard';
import { isOriginalLanguage } from '../translationKind';
import type { GameMode, GameStep } from './game';
import { isDue } from './verse';
import { plainWord } from './wordMatch';

/** What a verse's `progress` holds. Every field is absent until it has something to say. */
export interface VerseProgress {
  /** Which of GAPS it is on. */
  gap?: number;
  /** The separate days it passed on, the latest few. */
  passDays?: string[];
  /** The last day it was scored. */
  lastRound?: string;
  /** The score came from silent study, where voice is stricter. */
  silent?: boolean;
  /** How many rounds have been scored, which turns the rotation. */
  plays?: number;
  /** Mishearings accepted for this verse, by plain word. */
  heardAs?: Record<string, string[]>;
  /** Build has been through it, so it isn't New any more. */
  built?: boolean;
  /** How many times each word was missed, by its place in the verse. Weak Spots drills these. */
  missed?: Record<string, number>;
}

export const progressOf = (verse: Pick<DBByHeartVerse, 'progress'>): VerseProgress => (verse.progress ?? {}) as VerseProgress;

/** The days between reviews. */
const GAPS = [1, 3, 7, 16, 35];
/** A pass grows the gap. */
export const PASS_SCORE = 90;
/** Under this comes back tomorrow, and is tried again in the session. */
export const HOLD_SCORE = 60;
/** Passes on this many separate days make it Known. */
const KNOWN_DAYS = 3;

export type Stage = 'new' | 'learning' | 'known';

export function stageOf(verse: DBByHeartVerse): Stage {
  if (verse.score === null) return progressOf(verse).built ? 'learning' : 'new';
  const days = progressOf(verse).passDays?.length ?? 0;
  return days >= KNOWN_DAYS && verse.score >= HOLD_SCORE ? 'known' : 'learning';
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

/**
 * What a scored round changes. The first round on a day sets the schedule, and
 * another that day only updates the score. So does a good round before the verse
 * is due, though one under 60 still brings it back tomorrow.
 */
export function afterRound(
  verse: DBByHeartVerse,
  score: number,
  { silent = false, missed = [], today = localDateStr(new Date()) }: { silent?: boolean; missed?: number[]; today?: string } = {},
): Partial<NewByHeartVerse> {
  const p = progressOf(verse);
  const progress: VerseProgress = { ...p, silent, plays: (p.plays ?? 0) + 1, lastRound: today };
  if (missed.length) {
    progress.missed = { ...p.missed };
    for (const at of missed) progress.missed[at] = (progress.missed[at] ?? 0) + 1;
  }
  if (p.lastRound === today) return { score, progress: progress as Record<string, unknown> };
  if (score >= PASS_SCORE) progress.passDays = [...(p.passDays ?? []), today].slice(-KNOWN_DAYS);
  if (score >= HOLD_SCORE && !isDue(verse, today)) return { score, progress: progress as Record<string, unknown> };

  const gapNow = p.gap ?? 0;
  let gap = gapNow;
  if (score >= PASS_SCORE && p.gap !== undefined) gap = Math.min(gapNow + 1, GAPS.length - 1);
  // A slip steps back rather than starting over, so one bad day doesn't undo months.
  if (score < HOLD_SCORE) gap = Math.max(0, gapNow - 2);
  progress.gap = gap;
  return {
    score,
    nextDate: addDays(today, score < HOLD_SCORE ? 1 : GAPS[gap]),
    progress: progress as Record<string, unknown>,
  };
}

/** A mishearing this verse accepts from now on. */
export function withHeardAs(verse: Pick<DBByHeartVerse, 'progress'>, word: string, heard: string): Record<string, unknown> {
  const p = progressOf(verse);
  const known = p.heardAs?.[word] ?? [];
  if (known.includes(heard)) return p as Record<string, unknown>;
  return { ...p, heardAs: { ...p.heardAs, [word]: [...known, heard] } };
}

/**
 * Build has been through a verse: it isn't New any more and comes back tomorrow.
 * It doesn't count as recalling the verse, so no score, and a date already set stays.
 */
export function afterBuild(verse: DBByHeartVerse, today = localDateStr(new Date())): Partial<NewByHeartVerse> {
  const progress = { ...progressOf(verse), built: true } as Record<string, unknown>;
  return verse.nextDate === null ? { nextDate: addDays(today, 1), progress } : { progress };
}

/** A word got through Weak Spots without help: one less to drill. */
export function withoutMissed(verse: DBByHeartVerse, word: number): Record<string, unknown> {
  const p = progressOf(verse);
  const missed = { ...p.missed };
  const left = (missed[word] ?? 0) - 1;
  if (left > 0) missed[word] = left;
  else delete missed[word];
  return { ...p, missed };
}

/** The most-missed words across every verse, the phrase around each drilled once. */
const WEAK_SPOTS = 12;

export function weakSteps(verses: DBByHeartVerse[]): GameStep[] {
  const spots: { verseId: string; word: number; count: number }[] = [];
  for (const verse of verses) {
    if (isOriginalLanguage(verse.translation)) continue;
    const words = cardWords(verse.passage);
    for (const [at, count] of Object.entries(progressOf(verse).missed ?? {})) {
      const word = +at;
      if (count > 0 && plainWord(words[word] ?? '')) spots.push({ verseId: verse.id, word, count });
    }
  }
  return spots
    .sort((a, b) => b.count - a.count)
    .slice(0, WEAK_SPOTS)
    .map(({ verseId, word }) => ({ verseId, word, mode: 'weak' as const }));
}

/** Known verses take turns through these. */
const ROTATION: GameMode[] = ['flashcards', 'call', 'recital'];

/** How a verse is played in Today, by its stage. */
export function formatFor(verse: DBByHeartVerse): GameMode {
  const stage = stageOf(verse);
  if (stage === 'new') return 'build';
  if (stage === 'learning') return 'focus';
  return ROTATION[(progressOf(verse).plays ?? 0) % ROTATION.length];
}

/** Everything due, shuffled, each played the way its stage calls for. */
export function todaySteps(verses: DBByHeartVerse[], silent: boolean): GameStep[] {
  const due = verses.filter((v) => isDue(v));
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }
  return due.map((verse) => ({
    verseId: verse.id,
    mode: silent || isOriginalLanguage(verse.translation) ? 'silent' : formatFor(verse),
  }));
}
