/**
 * One Strong's entry, in the shape the Strong's card draws.
 *
 * The lexicon lookup hands back the pack's row; this turns it into the core
 * StrongEntry the card has always rendered, plus the sense groupings the
 * Greek rows carry. Shared by the card and the Dictionary, which both need to
 * name an entry and color its language the same way.
 */

import type { StrongEntry } from '@projectbible/core';
import { lookupStrongs, type RelatedWords } from '../../adapters/lexicon-lookup.js';
import { expandStepBiblePOS } from '../morphologyExpander';

export type StrongsEntryData = StrongEntry & { related?: RelatedWords };

/** The entry's own tabs, under its header. */
export type EntryTab = 'definition' | 'forms' | 'occurrences' | 'arc' | 'spread' | 'related';

/**
 * The entry for an id, kept under the id asked for. A split meaning with no
 * row of its own falls back to its number's row, but stays named as asked, so
 * its usage still counts that one meaning.
 */
export async function loadStrongsEntry(id: string): Promise<StrongsEntryData | null> {
  const result = await lookupStrongs(id);
  if (!result) return null;
  return {
    id,
    lemma: result.lemma ?? '',
    transliteration: result.transliteration ?? '',
    definition: result.definition ?? '',
    shortDefinition: result.shortDefinition ?? '',
    partOfSpeech: result.partOfSpeech ?? '',
    language: (result.language ?? 'greek') as StrongEntry['language'],
    derivation: result.derivation,
    kjvUsage: result.kjvUsage,
    pronunciation: result.phonetic ? { phonetic: result.phonetic } : undefined,
    related: result.related,
  };
}

/** Each original language's own color, used for its numbers and labels. */
export function languageColor(lang: string): string {
  switch (lang) {
    case 'greek':
      return '#4CAF50';
    case 'hebrew':
      return '#2196F3';
    case 'aramaic':
      return '#9C27B0';
    default:
      return '#757575';
  }
}

export function isRtl(lang: string | undefined): boolean {
  return lang === 'hebrew' || lang === 'aramaic';
}

/** Glosses often qualify themselves — "Abraham, the patriarch" — and only the
 *  head word stands a chance of resolving or of being a dictionary entry. */
export function glossHead(gloss: string): string {
  return String(gloss ?? '').split(/[,;(]/)[0].trim();
}

/**
 * The English word to ask the other works about. A verb's gloss is "to love",
 * and the works index "love"; STEPBible also qualifies glosses with a slash or
 * a colon ("to will/desire", "first: beginning"), and only the first word of
 * those stands a chance of resolving.
 */
export function glossTerm(gloss: string): string {
  return String(gloss ?? '')
    .split(/[,;(:/]/)[0]
    .trim()
    .replace(/^to\s+/i, '');
}

/**
 * The entry's language by name. Every Hebrew-side row is stored as "hebrew",
 * Aramaic included; only its part-of-speech code (A:…) says Aramaic.
 */
export function languageName(entry: Pick<StrongEntry, 'language' | 'partOfSpeech'>): string {
  if (/^A:/.test(entry.partOfSpeech ?? '')) return 'Aramaic';
  const lang = entry.language ?? '';
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

/**
 * The part of speech in words, without the language it opens with — the line
 * it sits in already names the language. "G:N-F" reads "Noun, Feminine".
 */
export function partOfSpeechText(pos: string): string {
  return expandStepBiblePOS(pos).replace(/^(Greek|Hebrew|Aramaic),\s*/, '');
}
