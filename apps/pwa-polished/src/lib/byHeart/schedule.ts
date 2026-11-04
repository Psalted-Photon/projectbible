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
import type { GameMode, GameStep } from './game';
import { isDue } from './verse';
import { isOriginalLanguage } from '../translationKind';

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
  if (verse.score === null) return 'new';
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
  { silent = false, today = localDateStr(new Date()) }: { silent?: boolean; today?: string } = {},
): Partial<NewByHeartVerse> {
  const p = progressOf(verse);
  const progress: VerseProgress = { ...p, silent, plays: (p.plays ?? 0) + 1, lastRound: today };
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

/** How a verse is played in Today, by its stage. */
export function formatFor(_verse: DBByHeartVerse): GameMode {
  return 'focus';
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
