/**
 * Sword Drill: a phrase from any saved verse appears, and the user says the next
 * 3 words before the clock runs out. It doesn't count toward any verse's schedule
 * and it keeps its own top scores.
 */

import type { DBByHeartVerse } from '../../adapters/db';
import { cardWords } from '../shareCard';
import { isOriginalLanguage } from '../translationKind';
import { scoreOf } from './scoring';
import { referenceOf } from './verse';

/** The clock, in seconds. Tuned by hand. */
export const DRILL_CLOCK = { start: 45, right: 5, miss: 3 };

/** How many words the user says, and how many lead up to them at most. */
const ANSWER_WORDS = 3;
const LEAD_WORDS = 6;
/** How many words before the answer there has to be, to go on. */
const LEAST_LEAD = 3;
/** A verse needs this many words to give a prompt. */
const SHORTEST_VERSE = LEAST_LEAD + ANSWER_WORDS;
/** How many runs the top scores hold. */
const TOP_SCORES = 10;

export interface DrillPrompt {
  verseId: string;
  reference: string;
  book: string;
  translation: string;
  /** The words shown. */
  phrase: string;
  /** The words to say. */
  answer: string[];
}

/** One phrase as it went. */
export interface DrillResult extends DrillPrompt {
  /** How many of its words were said, from the first. */
  said: number;
  /** The clock ran out on it, so the words not reached weren't missed. */
  cutOff: boolean;
}

/** One run in the top scores. A best from before lists has no percent or date. */
export interface DrillScore {
  right: number;
  percent?: number;
  /** The local day, as YYYY-MM-DD. */
  date?: string;
}

/** A finished run, as its end screen shows it. */
export interface DrillRun {
  results: DrillResult[];
  right: number;
  /** Null if nothing was said or missed. */
  percent: number | null;
  /** The line under the score. Empty when there is nothing to compare it with. */
  line: string;
  /** Where it landed in the top scores, from 0. Null if it isn't there. */
  place: number | null;
}

const fits = (verse: DBByHeartVerse) =>
  !isOriginalLanguage(verse.translation) && cardWords(verse.passage).length >= SHORTEST_VERSE;

export const canDrill = (verses: DBByHeartVerse[]) => verses.some(fits);

/** A new prompt from any saved verse, not the same verse twice running where there's a choice. */
export function drillPrompt(verses: DBByHeartVerse[], lastId: string | null): DrillPrompt | null {
  const usable = verses.filter(fits);
  const choices = usable.length > 1 ? usable.filter((v) => v.id !== lastId) : usable;
  const verse = choices[Math.floor(Math.random() * choices.length)];
  if (!verse) return null;
  const words = cardWords(verse.passage);
  const at = LEAST_LEAD + Math.floor(Math.random() * (words.length - SHORTEST_VERSE + 1));
  return {
    verseId: verse.id,
    reference: referenceOf(verse),
    book: verse.book,
    translation: verse.translation,
    phrase: words.slice(Math.max(0, at - LEAD_WORDS), at).join(' '),
    answer: words.slice(at, at + ANSWER_WORDS),
  };
}

/**
 * Green words out of green and red, so it matches the tiles. Words the clock cut
 * off aren't counted, or a run could never reach 100. Null if there is nothing to
 * count, rather than a false 100.
 */
export function drillPercent(results: DrillResult[]): number | null {
  let counted = 0;
  let missed = 0;
  for (const result of results) {
    if (result.cutOff) {
      counted += result.said;
    } else {
      counted += result.answer.length;
      missed += result.answer.length - result.said;
    }
  }
  return counted ? scoreOf(counted, missed) : null;
}

/** Higher first by right answers, the game's score, then by percent. No percent goes last among equals. */
const outranks = (a: DrillScore, b: DrillScore) =>
  a.right > b.right || (a.right === b.right && (a.percent ?? -1) > (b.percent ?? -1));

/** The top scores with this run in them, and where it landed. A run with 0 right isn't listed. */
export function rankDrillScore(top: DrillScore[], score: DrillScore): { top: DrillScore[]; place: number | null } {
  if (score.right <= 0) return { top, place: null };
  const ahead = top.findIndex((other) => outranks(score, other));
  const place = ahead < 0 ? top.length : ahead;
  if (place >= TOP_SCORES) return { top, place: null };
  return { top: [...top.slice(0, place), score, ...top.slice(place)].slice(0, TOP_SCORES), place };
}

/** The line under a finished run's score. `best` is the best before this run. */
export function drillLine(best: number, right: number, place: number | null): string {
  if (right > best) return 'That is your new best.';
  if (right > 0 && right === best) return 'That ties your best.';
  if (place !== null) {
    const nth = place + 1;
    return `That is your ${nth === 2 ? '2nd' : nth === 3 ? '3rd' : `${nth}th`} best.`;
  }
  return best ? `Your best is ${best} right.` : '';
}

/** "Nov 4", with the year if it isn't this one. */
export function drillDateLabel(date: string): string {
  const when = new Date(`${date}T12:00:00`);
  const sameYear = when.getFullYear() === new Date().getFullYear();
  return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
