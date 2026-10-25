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
import { testamentOf } from '../strongsUsage';
import { greekPartnerFor } from '../translationKind';
import { convertRef, schemeOf } from '../versification';
import { isNeverMarked, meansAt, type Span } from './glossMatch';

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

/** A whole chapter's links in one read, by verse. Empty when the pack doesn't cover it. */
export async function getChapterLinks(
  translation: string,
  book: string,
  chapter: number,
): Promise<Map<number, WordLink[]>> {
  const t = translation.toLowerCase();
  const b = packBook(book);
  const out = new Map<number, WordLink[]>();
  try {
    const rows = await readTransaction<{ verse: number; links: string }[]>(STORE, (store) =>
      store.getAll(IDBKeyRange.bound([t, b, chapter, 0], [t, b, chapter, 9999])),
    );
    for (const r of rows ?? []) out.set(r.verse, parseLinks(r.links));
  } catch {
    // No links is the safe answer.
  }
  return out;
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

/**
 * Where a spot in the reader's verse text falls in its clean text, read off
 * the reader's own markup: notes are left out and a plural "you" marker counts
 * as the one character it stands for. Also hands back the clean text, for
 * matching by meaning. Null when `node` isn't inside the verse.
 */
export function cleanOffsetOf(
  verseTextEl: Element,
  node: Node,
  offset: number,
): { offset: number; text: string } | null {
  let text = '';
  const found = { at: -1 };
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n === node) found.at = text.length + offset;
      text += n.nodeValue ?? '';
      return;
    }
    if (!(n instanceof Element)) return;
    if (n.classList.contains('inline-note')) {
      if (n.contains(node)) found.at = text.length;
      return;
    }
    if (n.classList.contains('plural-marker')) {
      if (n.contains(node)) found.at = text.length;
      text += '⌃';
      return;
    }
    n.childNodes.forEach((child, i) => {
      if (n === node && i === offset) found.at = text.length;
      walk(child);
    });
    if (n === node && offset >= n.childNodes.length) found.at = text.length;
  };
  walk(verseTextEl);
  return found.at < 0 ? null : { offset: found.at, text };
}

/**
 * The other way round from cleanOffsetOf, read off the same markup: each run
 * of the verse's clean text, with where it starts there (`clean`) and in the
 * element's textContent (`dom`). Notes and plural markers have no run.
 */
export function domPiecesOfClean(verseTextEl: Element): { clean: number; dom: number; length: number }[] {
  const pieces: { clean: number; dom: number; length: number }[] = [];
  let clean = 0;
  let dom = 0;
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const length = n.nodeValue?.length ?? 0;
      pieces.push({ clean, dom, length });
      clean += length;
      dom += length;
      return;
    }
    if (!(n instanceof Element)) return;
    if (n.classList.contains('inline-note')) {
      dom += n.textContent?.length ?? 0;
      return;
    }
    if (n.classList.contains('plural-marker')) {
      dom += n.textContent?.length ?? 0;
      clean += 1;
      return;
    }
    n.childNodes.forEach(walk);
  };
  walk(verseTextEl);
  return pieces;
}

/** The Strong's numbers tagged in one verse of an original-language text. */
function verseNumbers(source: string, book: string, chapter: number, verse: number): Promise<string[]> {
  return readTransaction<{ strongsId?: string }[]>('morphology', (store) =>
    store.index('verse_ref').getAll(IDBKeyRange.only([source, book, chapter, verse])),
  )
    .then((rows) => (rows ?? []).map((r) => r.strongsId ?? '').filter(Boolean))
    .catch(() => []);
}

/**
 * The numbers in the Greek or Hebrew behind an English verse: the Hebrew for
 * the Old Testament, the translation's own Greek for the New (any installed
 * Greek when that one isn't). The English Septuagint has none, since the
 * Septuagint has no word data.
 */
async function originalNumbers(translation: string, book: string, chapter: number, verse: number): Promise<string[]> {
  if (schemeOf(translation) === 'lxx2012') return [];
  const sources = testamentOf(book) === 'OT' ? ['hebrew-oshb'] : [...new Set([greekPartnerFor(translation), 'byz', 'tr'])];
  for (const source of sources) {
    const ids = new Set<string>();
    for (const ref of convertRef(translation, source, { book, chapter, verse })) {
      for (const id of await verseNumbers(source, packBook(ref.book), ref.chapter, ref.verse)) ids.add(id);
    }
    if (ids.size) return [...ids].filter((id) => !isNeverMarked(classicId(id)));
  }
  return [];
}

/**
 * The Greek or Hebrew word behind an English word: the number linked at
 * `at.offset` in the verse's clean text. A translation the Word Links pack
 * doesn't cover, or a word its links skip, falls back to meaning, and answers
 * only when exactly one number in the original verse means the word tapped.
 * Null when unsure.
 */
export async function originalAt(
  translation: string,
  book: string,
  chapter: number,
  verse: number,
  at: { offset: number; text: string },
): Promise<string | null> {
  const links = await getVerseLinks(translation, book, chapter, verse);
  const link = links ? linkAtOffset(links, at.offset) : null;
  if (link) return link.ids.find((id) => !isNeverMarked(id)) ?? null;
  const hits: string[] = [];
  for (const id of await originalNumbers(translation, book, chapter, verse)) {
    if (await meansAt(id, at.text, at.offset)) hits.push(id);
  }
  const distinct = new Set(hits.map(classicId));
  return distinct.size === 1 ? hits[0] : null;
}
