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
import { openDB } from '../../adapters/db';
import { firstForm } from './collate';

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

/**
 * A number as Strong's printed it: G26, not the pack's padded G0026. A split
 * keeps its letter (G2424G).
 */
export function displayId(id: string): string {
  return id.replace(/^([GH])0+(?=\d)/i, '$1');
}

/** The number the list files an id under: its classic number, splits folded in. */
export function classicId(id: string): string {
  const m = /^([GH])0*(\d{1,4})[A-Za-z]?$/i.exec(id ?? '');
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : id;
}

/** One meaning of a number STEPBible split — or, with `all`, the number itself. */
export interface Meaning {
  id: string;
  lemma: string;
  gloss: string;
  all: boolean;
}

/**
 * The meanings a number was split into, led by the number itself, for the
 * entry to list. Empty when there is nothing to choose between: no split, or
 * splits that only repeat their number (H0001G is "father", like H0001).
 */
export async function loadMeanings(id: string): Promise<Meaning[]> {
  const base = classicId(id);
  const storeName = /^H/i.test(base) ? 'hebrew_strongs_entries' : 'greek_strongs_entries';
  const db = await openDB();
  if (!db.objectStoreNames.contains(storeName)) return [];
  const rows = await new Promise<any[]>((resolve) => {
    const req = db
      .transaction(storeName, 'readonly')
      .objectStore(storeName)
      .getAll(IDBKeyRange.bound(base, `${base}￿`));
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => resolve([]);
  });
  const own = rows.find((r) => r.id === base);
  const splits = rows.filter((r) => r.id !== base && /^[GH]\d{4}[A-Za-z]$/.test(r.id));
  const sameAsOwn = (r: any) =>
    (r.shortDefinition ?? '') === (own?.shortDefinition ?? '') &&
    firstForm(r.lemma ?? '') === firstForm(own?.lemma ?? '');
  if (!splits.length || splits.every(sameAsOwn)) return [];
  const meaning = (r: any, all: boolean): Meaning => ({
    id: r.id,
    lemma: firstForm(r.lemma ?? ''),
    gloss: String(r.shortDefinition ?? ''),
    all,
  });
  return [...(own ? [meaning(own, true)] : []), ...splits.sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => meaning(r, false))];
}

/** How an entry is named on the Starred and Recently viewed shelves. */
export function shelfName(id: string, lemma: string, gloss: string | undefined): string {
  const head = `${displayId(id)} ${lemma}`;
  return gloss ? `${head} · ${gloss}` : head;
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
