/**
 * Sword Drill: a phrase from any saved verse appears, and the user says the next
 * 3 words before the clock runs out. It doesn't count toward any verse's schedule
 * and it keeps its own best.
 */

import type { DBByHeartVerse } from '../../adapters/db';
import { cardWords } from '../shareCard';
import { isOriginalLanguage } from '../translationKind';
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

export interface DrillPrompt {
  verseId: string;
  reference: string;
  translation: string;
  /** The words shown. */
  phrase: string;
  /** The words to say. */
  answer: string[];
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
    translation: verse.translation,
    phrase: words.slice(Math.max(0, at - LEAD_WORDS), at).join(' '),
    answer: words.slice(at, at + ANSWER_WORDS),
  };
}
