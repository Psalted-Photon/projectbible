/**
 * Getting the voices to say names right, without the page ever seeing it.
 *
 * Two steps, both from the fixes made in the Name Lab (pronunciationData.ts):
 * a name can be swapped for a hidden spelling before the text is turned into
 * sounds, and the sounds can then have their stress moved, for long names a
 * spelling alone won't change. The screen, the highlighting and the stored
 * Bible text only ever see the real name.
 */

import { SPELLINGS, STRONG_UK, STRONG_US } from './pronunciationData.js';

const LETTER = String.raw`\p{L}\p{M}`;
// Whole words with their capitals, so "job" would stay job. A hyphen is an edge,
// so the KJV's Baal-peor gets the same Baal as the WEB's Baal Peor.
const NAMES = Object.keys(SPELLINGS).sort((a, b) => b.length - a.length);
const NAMES_RE = NAMES.length ? new RegExp(`(^|[^${LETTER}])(${NAMES.join('|')})(?![${LETTER}])`, 'gu') : null;

/** Text with every fixed name in its hidden spelling. English only: Greek and Hebrew have their own sounds. */
export function respellNames(text: string): string {
  return NAMES_RE ? text.replace(NAMES_RE, (_m, edge: string, name: string) => edge + SPELLINGS[name]) : text;
}

const STRESS_MARKS = /[ˈˌ]/g;
/** How espeak writes word edges in its sounds. */
const WORD_EDGE = /( |[.,;:!?—…])/;
/** What a verse can add to the end of a name: a possessive ("Absalom's"), or the r a UK voice links to a next vowel. */
const WORD_ENDINGS = ['', 'z', 's', 'ᵻz', 'ɪz', 'ɹ'];

function strongFor(espeakVoice: string): Record<string, string> | null {
  if (espeakVoice === 'en-us') return STRONG_US;
  return espeakVoice.startsWith('en-gb') ? STRONG_UK : null;
}

/**
 * A verse's sounds with fixed names leaning on the right syllable. Words are
 * found by their sounds with stress ignored, because a sentence can lean on a
 * word differently from the word alone. Comes back unchanged if nothing fits.
 */
export function moveNameStress(sounds: string, espeakVoice: string): string {
  const strong = strongFor(espeakVoice);
  if (!strong || Object.keys(strong).length === 0) return sounds;
  const parts = sounds.split(WORD_EDGE);
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const plain = parts[i].replace(STRESS_MARKS, '');
    const ending = WORD_ENDINGS.find((e) => plain.endsWith(e) && strong[plain.slice(0, plain.length - e.length)]);
    if (ending === undefined) continue;
    parts[i] = strong[plain.slice(0, plain.length - ending.length)] + ending;
    changed = true;
  }
  return changed ? parts.join('') : sounds;
}
