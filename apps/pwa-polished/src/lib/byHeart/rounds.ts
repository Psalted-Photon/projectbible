/**
 * By Heart: what a verse's game asks for, one round at a time. Each round is a
 * stretch of the words to say, and whether the reference has to be said with it.
 *
 * Focus, Recital, Call and Response and Flashcards are one round over the whole
 * verse. Build goes phrase by phrase, split at punctuation, hiding more each
 * round, and its last round is always the whole verse from memory, which is its
 * score. Weak Spots is the one phrase around a word that keeps getting missed.
 */

import type { FlashSide, GameMode, SpokenRefMode } from './game';

export interface Round {
  /** The words to say, as positions in the verse. */
  from: number;
  to: number;
  /** Words clear from the start of the round, said or not. */
  shown: number[];
  /** The reference is said before the words, after them, or neither. */
  refStart: boolean;
  refEnd: boolean;
  /** Nothing clears until the end. */
  hidden: boolean;
  /** Where this round is, for the screen. */
  label: string;
}

export interface RoundOptions {
  mode: GameMode;
  words: string[];
  reference: SpokenRefMode;
  side?: FlashSide;
  /** Weak Spots: the word to drill around. */
  word?: number;
}

/** A word that ends a phrase. */
const PHRASE_END = /[,;:.!?—–]["'”’)\]]*$/;
/** A phrase is at least this long, or it joins the next. */
const SHORTEST = 3;
/** And at most this long, with or without punctuation. */
const LONGEST = 12;

/** The verse in phrases, split at punctuation. */
export function phrasesOf(words: string[]): { from: number; to: number }[] {
  const phrases: { from: number; to: number }[] = [];
  let from = 0;
  words.forEach((word, i) => {
    const length = i + 1 - from;
    if ((PHRASE_END.test(word) && length >= SHORTEST) || length >= LONGEST) {
      phrases.push({ from, to: i + 1 });
      from = i + 1;
    }
  });
  if (from < words.length) {
    const last = phrases[phrases.length - 1];
    if (last && words.length - from < SHORTEST) last.to = words.length;
    else phrases.push({ from, to: words.length });
  }
  return phrases;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

function buildRounds(words: string[]): Round[] {
  const phrases = phrasesOf(words);
  const rounds: Round[] = [];
  const round = (from: number, to: number, shown: number[], label: string): Round => ({
    from,
    to,
    shown,
    refStart: false,
    refEnd: false,
    hidden: false,
    label,
  });
  phrases.forEach(({ from, to }, p) => {
    const part = phrases.length > 1 ? `Phrase ${p + 1} of ${phrases.length}: ` : '';
    rounds.push(round(from, to, range(from, to), `${part}read it out`));
    // Every other word goes, then all of them. A short phrase goes straight to all.
    if (to - from > SHORTEST) {
      rounds.push(round(from, to, range(from, to).filter((i) => (i - from) % 2 === 0), `${part}fill in the gaps`));
    }
    rounds.push(round(from, to, [], `${part}from memory`));
  });
  if (phrases.length > 1) rounds.push(round(0, words.length, [], 'The whole verse, from memory'));
  return rounds;
}

/** How many opening words a flashcard gives: to the first phrase's end, if that is near. */
function openingCount(words: string[]): number {
  const first = phrasesOf(words)[0]?.to ?? 0;
  return Math.max(1, Math.min(first >= 3 && first <= 7 ? first : 5, words.length - 1));
}

/** Which way a flashcard goes. A very short verse only goes one way. */
export function pickSide(words: string[]): FlashSide {
  return words.length > 3 && Math.random() < 0.5 ? 'words' : 'verse';
}

/** The rounds of a game. */
export function roundsFor({ mode, words, reference, side, word }: RoundOptions): Round[] {
  const whole: Round = {
    from: 0,
    to: words.length,
    shown: [],
    refStart: reference === 'start' || reference === 'both',
    refEnd: reference === 'end' || reference === 'both',
    hidden: false,
    label: '',
  };
  switch (mode) {
    case 'build':
      return buildRounds(words);
    case 'recital':
      return [{ ...whole, hidden: true }];
    case 'flashcards':
      // The reference is the prompt, or the opening words are and the reference comes first.
      if (side === 'words') return [{ ...whole, from: openingCount(words), refStart: true, refEnd: false }];
      return [{ ...whole, refStart: false, refEnd: false }];
    case 'weak': {
      const at = word ?? 0;
      const phrase = phrasesOf(words).find((p) => at >= p.from && at < p.to) ?? { from: 0, to: words.length };
      return [{ ...whole, ...phrase, shown: range(phrase.to, words.length), refStart: false, refEnd: false }];
    }
    default:
      return [whole];
  }
}
