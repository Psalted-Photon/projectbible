/**
 * How a passage is split when it is too long for one saved By Heart item.
 */

import { cardWords } from '../shareCard';

/** About what one saved item holds: enough for Psalm 23. */
export const MAX_WORDS = 150;

/**
 * The passage in parts of up to MAX_WORDS. Each breaks at the end of a sentence
 * where one falls in its last third, or at the limit where none does.
 */
export function splitParts(passage: string): string[] {
  const words = cardWords(passage);
  const parts: string[] = [];
  let at = 0;
  while (at < words.length) {
    let end = Math.min(at + MAX_WORDS, words.length);
    if (end < words.length) {
      const earliest = at + Math.ceil((MAX_WORDS * 2) / 3);
      for (let i = end; i > earliest; i--) {
        if (/[.!?;:]["'”’)\]]*$/.test(words[i - 1])) {
          end = i;
          break;
        }
      }
    }
    parts.push(words.slice(at, end).join(' '));
    at = end;
  }
  return parts;
}
