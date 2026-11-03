/**
 * By Heart: is what was heard the word the user is on?
 *
 * Only that word is checked, in order, so a false pass is the user's own
 * business and nothing here tries to catch one. Sound-alikes count as right,
 * because the recognizer can only guess which one was meant. If it drops a
 * small word and the next word is right, the small word is let go.
 *
 * walkWords goes through everything heard so far from the start, every time.
 * Words are never counted twice however often they are heard again, so "holy,
 * holy, holy" takes three holies, not one heard three times over.
 */

import { editDistance, soundKey } from '../fuzzy';
import { soundsAlike } from '../voice/soundAlikes';

/** How a word got passed. */
export type WordPass = 'exact' | 'alike' | 'joined' | 'dropped' | 'tapped' | 'silent';

/** Small words the recognizer may drop. */
const SMALL = new Set(`a an the and or but of to in on at by for from with as is it be am are was were that this his her
  he she they them we you i my me our us your so not no if`.split(/\s+/));

/** How many small words in a row may be let go. */
const MAX_DROPPED = 2;

const NUMBERS: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  '11': 'eleven',
  '12': 'twelve',
  '20': 'twenty',
  '30': 'thirty',
  '40': 'forty',
  '50': 'fifty',
  '100': 'hundred',
  '1000': 'thousand',
};

/** Lower case, letters and digits only: "LORD," is "lord", "don't" is "dont", "3" is "three". */
export function plainWord(word: string): string {
  const plain = word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return NUMBERS[plain] ?? plain;
}

/** A string of heard words as a list. */
export const splitWords = (text: string | null | undefined): string[] => (text ?? '').trim().split(/\s+/).filter(Boolean);

export const isSmallWord = (plain: string): boolean => SMALL.has(plain);

/** Both plain already. 'exact', 'alike' for one that sounds the same or nearly is, or null. */
function sameWord(heard: string, word: string): 'exact' | 'alike' | null {
  if (heard === word) return 'exact';
  if (soundsAlike(heard, word)) return 'alike';
  const apart = editDistance(heard, word);
  if (apart <= 2 && word.length >= 3 && soundKey(heard) === soundKey(word)) return 'alike';
  return apart <= 1 && word.length >= 6 ? 'alike' : null;
}

/** How many heard words from `at` spell out one word ("for ever", "well pleased"), or 0. */
function spellsOut(heard: string[], at: number, word: string): number {
  let sofar = '';
  for (let i = at; i < heard.length && i < at + 3; i++) {
    sofar += heard[i];
    if (sofar === word) return i - at + 1;
    if (!word.startsWith(sofar)) return 0;
  }
  return 0;
}

export interface Walk {
  /** How many words from the start are done. */
  cursor: number;
  /** How each done word got passed. */
  how: WordPass[];
  /** Which heard word passed each done word, -1 when none did. */
  by: number[];
  /** Heard words that weren't the word the user was on. */
  wrong: { heard: string; on: number }[];
}

/**
 * Everything heard so far, against the words. `tapped` holds the words the
 * user passed by hand ("I said it"), which take nothing heard.
 */
export function walkWords(words: string[], heard: string[], tapped?: ReadonlySet<number>): Walk {
  const want = words.map(plainWord);
  const got = heard.map(plainWord);
  const n = want.length;
  const walk: Walk = { cursor: 0, how: [], by: [], wrong: [] };
  // Passed without hearing anything: tapped by hand, or a lone dash nobody can say.
  const passFree = () => {
    while (walk.cursor < n && (tapped?.has(walk.cursor) || !want[walk.cursor])) {
      walk.how[walk.cursor] = want[walk.cursor] ? 'tapped' : 'silent';
      walk.by[walk.cursor] = -1;
      walk.cursor++;
    }
  };
  const pass = (how: WordPass, by: number) => {
    walk.how[walk.cursor] = how;
    walk.by[walk.cursor] = by;
    walk.cursor++;
    passFree();
  };
  passFree();

  for (let i = 0; i < got.length && walk.cursor < n; i++) {
    const w = got[i];
    if (!w) continue;
    const on = want[walk.cursor];
    const same = sameWord(w, on);
    if (same) {
      pass(same, i);
      continue;
    }
    const parts = spellsOut(got, i, on);
    if (parts) {
      i += parts - 1;
      pass('joined', i);
      continue;
    }
    // Two words heard as one: "forever" for "for ever".
    if (walk.cursor + 1 < n && w === on + want[walk.cursor + 1]) {
      pass('joined', i);
      pass('joined', i);
      continue;
    }
    let skip = 0;
    for (let s = 1; s <= MAX_DROPPED && walk.cursor + s < n && isSmallWord(want[walk.cursor + s - 1]); s++) {
      if (sameWord(w, want[walk.cursor + s])) {
        skip = s;
        break;
      }
    }
    if (skip) {
      for (let s = 0; s < skip; s++) pass('dropped', -1);
      if (walk.cursor < n) pass(sameWord(w, want[walk.cursor]) ?? 'alike', i);
      continue;
    }
    walk.wrong.push({ heard: heard[i], on: walk.cursor });
  }
  return walk;
}

/** The next words for the recognizer to favor, one per line, or null for none. */
export function upcomingWords(words: string[], cursor: number, count: number): string | null {
  const out: string[] = [];
  for (const word of words.slice(cursor, cursor + Math.max(0, count))) {
    let clean = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    // "LORD" is said "Lord".
    if (clean.length > 1 && clean === clean.toUpperCase()) clean = clean[0] + clean.slice(1).toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.length ? out.join('\n') : null;
}
