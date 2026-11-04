/**
 * By Heart: has the verse's reference been said?
 *
 * Whistle can write it several ways ("John 3:16", "John three sixteen", "John 3.
 * 16"), so what was heard goes through the app's own reference reader, the one
 * Voice Control uses, and is compared with where the verse really is.
 */

import { findRefs, tidyRefs } from '../voice/rules';

export interface RefTarget {
  book: string;
  chapter: number;
  startVerse: number;
  /** More than one verse: a chapter said alone is near enough. */
  several: boolean;
}

const bookKey = (book: string) => book.toLowerCase().replace(/\s+/g, '').replace(/^psalms$/, 'psalm');

/** The longest a reference runs, in heard words, and how far in it may start. */
const LONGEST = 8;
const LEAD_IN = 3;

function isThisRef(text: string, target: RefTarget): boolean {
  const clean = text.replace(/,/g, ' ').replace(/(\d)\.\s*(\d)/g, '$1:$2');
  return findRefs(tidyRefs(clean)).some((ref) => {
    const m = /^(.+?) (\d+)(?::(\d+))?/.exec(ref.text);
    if (!ref.valid || !m || bookKey(m[1]) !== bookKey(target.book) || +m[2] !== target.chapter) return false;
    return m[3] ? +m[3] === target.startVerse : target.several;
  });
}

/** Where the reference ends in what was heard from `from` on, or null if it hasn't been said. */
export function findSpokenRef(heard: string[], from: number, target: RefTarget): { end: number } | null {
  for (let start = from; start < heard.length && start <= from + LEAD_IN; start++) {
    for (let end = start + 1; end <= heard.length && end <= start + LONGEST; end++) {
      if (isThisRef(heard.slice(start, end).join(' '), target)) return { end };
    }
  }
  return null;
}
