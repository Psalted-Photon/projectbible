/**
 * Word links: which English words in a verse translate which Greek or Hebrew
 * word, from the Word Links pack (scripts/build-word-links.mjs).
 *
 * Each verse's links are offsets into its clean text, the same text
 * companionText() in verseRendering.ts builds, so a link's span drops straight
 * into renderCompanionHtml. A translation the pack doesn't cover answers null,
 * and the caller falls back to gloss matching (glossMatch.ts).
 */

import { readTransaction } from '../../adapters/db';
import { normalizeBookName } from '../bibleData';
import { installedThisSession, updatedThisSession } from '../packUpdates';
import { classicId } from '../strongs/entry';
import { isNeverMarked, type Span } from './glossMatch';

export interface WordLink {
  s: number;
  e: number;
  /** Classic Strong's numbers (G0025, H3068). */
  ids: string[];
}

const STORE = 'word_links';
const VERSE_CACHE = 400;
const verses = new Map<string, Promise<WordLink[] | null>>();
/** Translations known to be in the pack. Only a yes is kept; a no is asked again. */
const covered = new Set<string>();

// A pack installed or updated mid-session changes the answers.
const forget = () => {
  verses.clear();
  covered.clear();
};
installedThisSession.subscribe(forget);
updatedThisSession.subscribe(forget);

/** The pack keys books by the packs' names, which say "Psalms". */
function packBook(book: string): string {
  const name = normalizeBookName(book);
  return name === 'Psalm' ? 'Psalms' : name;
}

function parseLinks(raw: string): WordLink[] {
  const out: WordLink[] = [];
  for (const part of raw.split(';')) {
    const [s, len, ids] = part.split(',');
    const start = Number(s);
    const length = Number(len);
    if (!ids || !Number.isFinite(start) || !Number.isFinite(length)) continue;
    out.push({ s: start, e: start + length, ids: ids.split('+') });
  }
  return out;
}

async function isCovered(translation: string): Promise<boolean> {
  if (covered.has(translation)) return true;
  const key = await readTransaction<IDBValidKey | undefined>(STORE, (store) =>
    store.getKey(IDBKeyRange.bound([translation], [translation, []])),
  );
  if (key !== undefined) covered.add(translation);
  return key !== undefined;
}

/**
 * One verse's links, or null when the pack doesn't cover the translation (or
 * isn't installed). A covered verse with nothing tagged is an empty list.
 */
export function getVerseLinks(
  translation: string,
  book: string,
  chapter: number,
  verse: number,
): Promise<WordLink[] | null> {
  const t = translation.toLowerCase();
  const b = packBook(book);
  const key = `${t}|${b}|${chapter}|${verse}`;
  let found = verses.get(key);
  if (!found) {
    found = (async () => {
      try {
        const row = await readTransaction<{ links: string } | undefined>(STORE, (store) =>
          store.get([t, b, chapter, verse]),
        );
        if (row) {
          covered.add(t);
          return parseLinks(row.links);
        }
        return (await isCovered(t)) ? [] : null;
      } catch {
        return null;
      }
    })();
    verses.set(key, found);
    if (verses.size > VERSE_CACHE) verses.delete(verses.keys().next().value!);
  }
  return found;
}

/**
 * Where a number's English sits among a verse's links, inside [start, end):
 * the part of the verse its row shows. Split meanings fold to their classic
 * number (G2424G is G2424). Words with no English of their own never mark.
 */
export function spansForStrongs(
  links: WordLink[],
  strongsId: string,
  range: { start: number; end: number } = { start: 0, end: Infinity },
): Span[] {
  const id = classicId(strongsId);
  if (isNeverMarked(id)) return [];
  return links
    .filter((l) => l.s >= range.start && l.e <= range.end && l.ids.includes(id))
    .map(({ s, e }) => ({ s, e }));
}

/** The link under a clean-text offset, if any. */
export function linkAtOffset(links: WordLink[], offset: number): WordLink | null {
  return links.find((l) => l.s <= offset && offset < l.e) ?? null;
}
