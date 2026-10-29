/**
 * The search's word list: every word of one translation and the verses that
 * use it, like a concordance. The search worker builds one per translation,
 * and a search looks up only the words typed instead of reading every verse.
 *
 * A word here is what the bar's matcher treats as one (lib/searchWords): a
 * run of letters, marks and digits in the verse as it reads, lower case. So a
 * word's verses are exactly the verses its pattern finds, and the word forms
 * the matcher accepts are looked up one by one.
 *
 * Verses are numbered in Bible order, so every list of verses comes out in
 * Bible order. Each word's verses are kept as the gaps between them, seven
 * bits a byte, which keeps all nine translations to a few megabytes.
 */

import { BIBLE_BOOKS, normalizeBookName } from '../bibleData';
import { cleanVersePreviewText } from '../verseRendering';
import type { WordLookup } from '../searchWords';

/** Bumped whenever what is built changes, so a list saved by an older app is built again. */
export const INDEX_FORMAT = 1;

/** A verse as the database stores it. */
export interface VerseRow {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface WordIndex {
  translation: string;
  /** What the translation's verses were when this was built; a different one means build it again. */
  signature: string;
  /** Book names as the database spells them. */
  books: string[];
  /** Each verse's book (into `books`), chapter and verse, in Bible order. */
  bookOf: Uint8Array;
  chapterOf: Uint16Array;
  verseOf: Uint16Array;
  /** The few verse keys that aren't translation:book:chapter:verse, by verse number. */
  oddIds: Record<number, string>;
  /** Every word, sorted. */
  words: string[];
  /** How many verses use each word. */
  counts: Uint32Array;
  /** Where each word's verses start in `postings`. */
  starts: Uint32Array;
  postings: Uint8Array;
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const WORD_ONLY = /^[\p{L}\p{M}\p{N}]+$/u;

/**
 * A word as the list keeps it. Lower case, plus the two letters a case-blind
 * pattern also takes as another: the long s, and the Greek final sigma.
 */
export function foldWord(word: string): string {
  return word.toLowerCase().replace(/ſ/g, 's').replace(/ς/g, 'σ');
}

const bookOrder = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));

/** Bible order: book, chapter, verse. Books the app doesn't list go last, by name. */
export function compareVerses(
  a: { book: string; chapter: number; verse: number },
  b: { book: string; chapter: number; verse: number },
): number {
  const ba = bookOrder.get(normalizeBookName(a.book)) ?? 999;
  const bb = bookOrder.get(normalizeBookName(b.book)) ?? 999;
  if (ba !== bb) return ba - bb;
  if (a.book !== b.book) return a.book < b.book ? -1 : 1;
  return a.chapter - b.chapter || a.verse - b.verse;
}

/**
 * Build one translation's list. `pause` is awaited now and then, so the
 * worker can answer other requests (suggestions while typing) mid-build.
 */
export async function buildWordIndex(
  translation: string,
  signature: string,
  rows: VerseRow[],
  pause: () => Promise<void> = async () => {},
): Promise<WordIndex> {
  rows.sort(compareVerses);

  const books: string[] = [];
  const bookIds = new Map<string, number>();
  const bookOf = new Uint8Array(rows.length);
  const chapterOf = new Uint16Array(rows.length);
  const verseOf = new Uint16Array(rows.length);
  const oddIds: Record<number, string> = {};
  const lists = new Map<string, number[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let b = bookIds.get(row.book);
    if (b === undefined) {
      b = books.length;
      books.push(row.book);
      bookIds.set(row.book, b);
    }
    bookOf[i] = b;
    chapterOf[i] = row.chapter;
    verseOf[i] = row.verse;
    if (row.id !== `${translation}:${row.book}:${row.chapter}:${row.verse}`) oddIds[i] = row.id;

    for (const m of cleanVersePreviewText(row.text).matchAll(WORD)) {
      const word = foldWord(m[0]);
      const list = lists.get(word);
      if (!list) lists.set(word, [i]);
      else if (list[list.length - 1] !== i) list.push(i);
    }
    if (i % 2000 === 1999) await pause();
  }

  const words = [...lists.keys()].sort();
  const counts = new Uint32Array(words.length);
  const starts = new Uint32Array(words.length + 1);
  let total = 0;
  for (const list of lists.values()) total += list.length;
  // A gap below 2^21 takes at most three bytes; no translation has two million verses.
  let postings = new Uint8Array(total * 3);
  let at = 0;
  for (let w = 0; w < words.length; w++) {
    const list = lists.get(words[w])!;
    counts[w] = list.length;
    starts[w] = at;
    let prev = -1;
    for (const v of list) {
      let gap = v - prev;
      prev = v;
      while (gap >= 0x80) {
        postings[at++] = (gap & 0x7f) | 0x80;
        gap >>>= 7;
      }
      postings[at++] = gap;
    }
  }
  starts[words.length] = at;
  postings = postings.slice(0, at);

  return { translation, signature, books, bookOf, chapterOf, verseOf, oddIds, words, counts, starts, postings };
}

/** How many verses the list covers. */
export function verseTotal(index: WordIndex): number {
  return index.bookOf.length;
}

/** Where a verse is, and its key in the database. */
export function verseAt(index: WordIndex, n: number): { id: string; book: string; chapter: number; verse: number } {
  const book = index.books[index.bookOf[n]];
  const chapter = index.chapterOf[n];
  const verse = index.verseOf[n];
  return { id: index.oddIds[n] ?? `${index.translation}:${book}:${chapter}:${verse}`, book, chapter, verse };
}

/** The word's place in `words`, or -1. */
export function findWord(index: WordIndex, word: string): number {
  const { words } = index;
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid];
    if (w === word) return mid;
    if (w < word) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** The first word at or after `prefix` in sorted order, for walking every word that starts with it. */
export function firstWordFrom(index: WordIndex, prefix: string): number {
  const { words } = index;
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Mark every verse that uses word number `w`. */
function markVerses(index: WordIndex, w: number, into: Uint8Array): void {
  const { postings } = index;
  let at = index.starts[w];
  const end = index.starts[w + 1];
  let v = -1;
  while (at < end) {
    let gap = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = postings[at++];
      gap |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    v += gap;
    into[v] = 1;
  }
}

function markWord(index: WordIndex, word: string, into: Uint8Array): void {
  const w = findWord(index, foldWord(word));
  if (w !== -1) markVerses(index, w, into);
}

/**
 * The verses one typed word finds, marked. Null when the list can't say: a
 * Greek or Hebrew word typed with punctuation inside it can run across two
 * words, so only reading the verses will do.
 */
function markLookup(index: WordIndex, lookup: WordLookup, into: Uint8Array): boolean {
  if (lookup.kind === 'forms') {
    for (const form of lookup.forms) markWord(index, form, into);
    return true;
  }
  if (lookup.kind === 'inside') {
    if (!WORD_ONLY.test(lookup.word)) return false;
    const re = new RegExp(lookup.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
    for (let w = 0; w < index.words.length; w++) if (re.test(index.words[w])) markVerses(index, w, into);
    return true;
  }
  // Every part of it, somewhere in the verse; whether they are together is checked after.
  const n = verseTotal(index);
  let all: Uint8Array | null = null;
  for (const part of lookup.parts) {
    const one = new Uint8Array(n);
    markWord(index, part, one);
    if (all) for (let v = 0; v < n; v++) all[v] &= one[v];
    else all = one;
  }
  if (all) for (let v = 0; v < n; v++) into[v] |= all[v];
  return true;
}

/**
 * The verses that hold every typed word (each word or one of its stand-ins),
 * in Bible order. `exact` says these are the verses the matcher finds; when it
 * is false (lord's, well-pleased: words that must sit together), each has to
 * be checked against its text. Null when the list can't answer at all.
 */
export function matchVerses(
  index: WordIndex,
  lookups: WordLookup[],
  also: Record<string, WordLookup[]> = {},
): { verses: number[]; exact: boolean } | null {
  const n = verseTotal(index);
  let acc: Uint8Array | null = null;
  let exact = true;
  for (const lookup of lookups) {
    const hit = new Uint8Array(n);
    for (const one of [lookup, ...(also[lookup.word] ?? [])]) {
      if (!markLookup(index, one, hit)) return null;
      if (one.kind === 'whole' && one.parts.length > 1) exact = false;
    }
    if (acc) for (let v = 0; v < n; v++) acc[v] &= hit[v];
    else acc = hit;
  }
  const verses: number[] = [];
  if (acc) for (let v = 0; v < n; v++) if (acc[v]) verses.push(v);
  return { verses, exact };
}

// ── Saving ──────────────────────────────────────────────────────────────────
// One file per translation: a short header, then each part in turn, every
// part starting on a four-byte boundary.

const MAGIC = 0x50425749; // "PBWI"

interface SavedHeader {
  format: number;
  translation: string;
  signature: string;
  books: string[];
  oddIds: Record<number, string>;
}

export function encodeWordIndex(index: WordIndex): Blob {
  const header: SavedHeader = {
    format: INDEX_FORMAT,
    translation: index.translation,
    signature: index.signature,
    books: index.books,
    oddIds: index.oddIds,
  };
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [
    enc.encode(JSON.stringify(header)),
    enc.encode(index.words.join('\n')),
    index.bookOf,
    new Uint8Array(index.chapterOf.buffer, index.chapterOf.byteOffset, index.chapterOf.byteLength),
    new Uint8Array(index.verseOf.buffer, index.verseOf.byteOffset, index.verseOf.byteLength),
    new Uint8Array(index.counts.buffer, index.counts.byteOffset, index.counts.byteLength),
    new Uint8Array(index.starts.buffer, index.starts.byteOffset, index.starts.byteLength),
    index.postings,
  ];
  const pieces: BlobPart[] = [new Uint32Array([MAGIC, parts.length])];
  for (const part of parts) {
    pieces.push(new Uint32Array([part.byteLength]));
    pieces.push(part as unknown as BlobPart);
    const pad = (4 - (part.byteLength % 4)) % 4;
    if (pad) pieces.push(new Uint8Array(pad));
  }
  return new Blob(pieces);
}

/** A saved list, or null when it is damaged or from another format. */
export function decodeWordIndex(buffer: ArrayBuffer): WordIndex | null {
  try {
    const head = new Uint32Array(buffer, 0, 2);
    if (head[0] !== MAGIC || head[1] !== 8) return null;
    let at = 8;
    const parts: ArrayBuffer[] = [];
    for (let i = 0; i < 8; i++) {
      const length = new Uint32Array(buffer, at, 1)[0];
      at += 4;
      if (at + length > buffer.byteLength) return null;
      // A copy, so each typed array starts on its own aligned buffer.
      parts.push(buffer.slice(at, at + length));
      at += length + ((4 - (length % 4)) % 4);
    }
    const dec = new TextDecoder();
    const header = JSON.parse(dec.decode(parts[0])) as SavedHeader;
    if (header.format !== INDEX_FORMAT) return null;
    const wordsText = dec.decode(parts[1]);
    const index: WordIndex = {
      translation: header.translation,
      signature: header.signature,
      books: header.books,
      oddIds: header.oddIds ?? {},
      words: wordsText ? wordsText.split('\n') : [],
      bookOf: new Uint8Array(parts[2]),
      chapterOf: new Uint16Array(parts[3]),
      verseOf: new Uint16Array(parts[4]),
      counts: new Uint32Array(parts[5]),
      starts: new Uint32Array(parts[6]),
      postings: new Uint8Array(parts[7]),
    };
    const n = index.bookOf.length;
    if (index.chapterOf.length !== n || index.verseOf.length !== n) return null;
    if (index.counts.length !== index.words.length || index.starts.length !== index.words.length + 1) return null;
    return index;
  } catch {
    return null;
  }
}
