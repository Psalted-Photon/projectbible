/**
 * The Connections window's data, read out of the installed Connections pack.
 *
 * Every cross-reference in Scripture — 344,799 of them — as four number
 * columns rather than rows: where the link starts, where its target begins and
 * ends, and how many votes readers gave it. Built by
 * scripts/build-connections-pack.mjs from OpenBible.info's set.
 *
 * Positions are absolute verse numbers counted from Gen 1:1 = 0 through to
 * Rev 22:21 = 31101, which is what makes one picture of the whole Bible
 * possible: an arc needs two places on a line, and a number already is one. The
 * tables below turn a number back into a reference when the reader needs one,
 * and the other way when the window is asked about a book or a chapter.
 *
 * Four gzipped blobs inflate to about 4.6 MB of typed arrays, read once when
 * something first needs them and dropped when the last thing holding them lets
 * go — the same discipline as lib/timeline/data.ts and
 * lib/atlas/place-index.ts. The window and the reader strip each hold them
 * while they are up, so closing the window does not pull the data out from
 * under the strip.
 */

import { readTransaction } from '../../adapters/db';
import { VERSE_COUNTS } from '@projectbible/core';
import { BIBLE_BOOKS } from '../bibleData';

const STORE = 'connection_columns';

/** One cross-reference, as the window holds it. */
export interface ConnectionLink {
  /** The source verse, counted from Gen 1:1 = 0. */
  from: number;
  /** The first verse of the target. */
  toStart: number;
  /** The last verse of the target, equal to `toStart` for a single verse. */
  toEnd: number;
  /** Reader votes. Negative where readers voted the link down. */
  votes: number;
}

/** Where a book sits on the line, for the labels and the hit-testing. */
export interface ConnectionBook {
  name: string;
  /** Its first verse, counted from Gen 1:1 = 0. */
  start: number;
  /** One past its last verse, so a book covers [start, end). */
  end: number;
  chapters: number;
  /** Its first chapter's index into `chapterStarts`. */
  firstChapter: number;
}

export interface ConnectionsData {
  /** How many links there are; the length of every column. */
  count: number;
  /** Source verse of each link, ascending — so a range of sources is a binary search. */
  from: Int32Array;
  toStart: Int32Array;
  toEnd: Int32Array;
  votes: Int16Array;
  /** The 66 books in canonical order. */
  books: ConnectionBook[];
  /** The first verse of each of the 1,189 chapters, ascending. */
  chapterStarts: Int32Array;
  /** Every verse in the canon: 31,102. */
  totalVerses: number;
  /** The highest vote any link carries, which the brightness scale is built on. */
  maxVotes: number;
}

/* --------------------------------------------------------------------------- *
 * The numbering
 * ------------------------------------------------------------------------- */

/**
 * The verse-count table spells Psalms in the plural and the app says Psalm.
 * The same translation bibleRefs.ts makes, for the same reason: translate
 * rather than rename the generated data.
 */
function verseCountKey(book: string): string {
  if (VERSE_COUNTS[book]) return book;
  if (book === 'Psalm') return 'Psalms';
  return book;
}

/** Built once per session — it is the same 66 books whatever is installed. */
let geometry: { books: ConnectionBook[]; chapterStarts: Int32Array; totalVerses: number } | null = null;

/**
 * Where every book and chapter begins on the one long line.
 *
 * This has to agree exactly with scripts/build-connections-pack.mjs, which
 * numbers the links from the same table. Both count Gen 1:1 as 0.
 */
function buildGeometry() {
  if (geometry) return geometry;

  const books: ConnectionBook[] = [];
  const starts: number[] = [];
  let running = 0;

  for (const info of BIBLE_BOOKS) {
    const counts = VERSE_COUNTS[verseCountKey(info.name)] ?? [];
    const start = running;
    const firstChapter = starts.length;
    for (const verses of counts) {
      starts.push(running);
      running += verses;
    }
    books.push({
      name: info.name,
      start,
      end: running,
      chapters: counts.length,
      firstChapter,
    });
  }

  geometry = { books, chapterStarts: new Int32Array(starts), totalVerses: running };
  return geometry;
}

/** A reference, as the rest of the app passes one around. */
export interface ConnectionRef {
  book: string;
  chapter: number;
  verse: number;
}

/** An absolute verse number as a reference, or null when it is off the line. */
export function refAt(position: number): ConnectionRef | null {
  const { books, chapterStarts, totalVerses } = buildGeometry();
  if (!Number.isFinite(position) || position < 0 || position >= totalVerses) return null;

  // Binary search for the book, then walk its chapters — a book has 150 at
  // most, and this runs once per tap rather than once per arc.
  let lo = 0;
  let hi = books.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (books[mid].start <= position) lo = mid;
    else hi = mid - 1;
  }
  const book = books[lo];

  for (let c = book.chapters; c >= 1; c--) {
    const start = chapterStarts[book.firstChapter + c - 1];
    if (start <= position) {
      return { book: book.name, chapter: c, verse: position - start + 1 };
    }
  }
  return null;
}

/** A reference as an absolute verse number, or null when the book is unknown. */
export function positionOf(book: string, chapter: number, verse = 1): number | null {
  const { books, chapterStarts } = buildGeometry();
  const info = books.find((b) => b.name === book);
  if (!info || chapter < 1 || chapter > info.chapters) return null;
  return chapterStarts[info.firstChapter + chapter - 1] + Math.max(1, verse) - 1;
}

/** The half-open span a whole book covers, or null when the book is unknown. */
export function bookSpan(book: string): { start: number; end: number } | null {
  const info = buildGeometry().books.find((b) => b.name === book);
  return info ? { start: info.start, end: info.end } : null;
}

/** The half-open span a chapter covers, or null when it does not exist. */
export function chapterSpan(book: string, chapter: number): { start: number; end: number } | null {
  const { books, chapterStarts, totalVerses } = buildGeometry();
  const info = books.find((b) => b.name === book);
  if (!info || chapter < 1 || chapter > info.chapters) return null;
  const index = info.firstChapter + chapter - 1;
  const start = chapterStarts[index];
  const end = index + 1 < chapterStarts.length ? chapterStarts[index + 1] : totalVerses;
  return { start, end };
}

/* --------------------------------------------------------------------------- *
 * Loading the pack
 * ------------------------------------------------------------------------- */

let dataPromise: Promise<ConnectionsData> | null = null;
/** How many windows and strips are holding the data right now. */
let holders = 0;

/**
 * Say the data is in use, and get back the call that lets it go.
 *
 * When the last holder lets go, what is in memory is dropped: four and a half
 * megabytes of arrays should not be carried for the rest of the session
 * because the window was opened once. Letting go twice counts once.
 */
export function holdConnections(): () => void {
  holders++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders = Math.max(0, holders - 1);
    if (holders === 0) dataPromise = null;
  };
}

/** Is the Connections pack installed? */
export async function connectionsInstalled(): Promise<boolean> {
  try {
    // A count, not a read: the reader strip asks this on every launch, and the
    // rows are megabytes of compressed columns.
    const rows = await readTransaction<number>(STORE, (store) => store.count());
    // Four columns, or the install did not finish.
    return (rows ?? 0) >= 4;
  } catch {
    return false;
  }
}

async function inflate(data: Blob | Uint8Array): Promise<Uint8Array> {
  const blob = data instanceof Blob ? data : new Blob([data as unknown as BlobPart]);
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface StoredColumn {
  name: string;
  kind: string;
  rawBytes: number;
  data: Blob | Uint8Array;
}

/** Everything the window draws. Throws when the pack is not installed. */
export async function loadConnections(): Promise<ConnectionsData> {
  if (dataPromise) return dataPromise;

  dataPromise = (async () => {
    const stored = await readTransaction<StoredColumn[]>(STORE, (store) =>
      store.getAll() as IDBRequest<StoredColumn[]>,
    );
    if (!stored?.length) throw new Error('The Connections pack is not installed');

    const raw = new Map<string, Uint8Array>();
    for (const row of stored) raw.set(row.name, await inflate(row.data));

    const typed = <T>(name: string, Ctor: new (buffer: ArrayBuffer, offset: number, length: number) => T): T => {
      const bytes = raw.get(name);
      if (!bytes) throw new Error(`The Connections pack is missing its "${name}" column`);
      // The stored buffer need not start on the element boundary a typed array
      // requires, so copy rather than view. One copy at load beats a surprise.
      const copy = bytes.slice();
      const width = (Ctor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
      return new Ctor(copy.buffer, copy.byteOffset, copy.length / width);
    };

    const from = typed('from', Int32Array);
    const toStart = typed('to_start', Int32Array);
    const toEnd = typed('to_end', Int32Array);
    const votes = typed('votes', Int16Array);

    // A column that arrived short would draw arcs from one link to another's
    // target, which looks like real data and is not.
    const count = from.length;
    if (toStart.length !== count || toEnd.length !== count || votes.length !== count) {
      throw new Error('The Connections pack is damaged — its columns are different lengths');
    }

    let maxVotes = 0;
    for (let i = 0; i < count; i++) if (votes[i] > maxVotes) maxVotes = votes[i];

    const { books, chapterStarts, totalVerses } = buildGeometry();
    return { count, from, toStart, toEnd, votes, books, chapterStarts, totalVerses, maxVotes };
  })();

  // A failed read should not be cached as the answer for the rest of the session.
  dataPromise.catch(() => {
    dataPromise = null;
  });
  return dataPromise;
}

/* --------------------------------------------------------------------------- *
 * Slicing
 * ------------------------------------------------------------------------- */

/**
 * The first link whose source is at or after `position`.
 *
 * The columns are sorted by source, so everything a book or a chapter reaches
 * is one binary search and a walk rather than a pass over all 344,799.
 */
export function firstLinkFrom(data: ConnectionsData, position: number): number {
  let lo = 0;
  let hi = data.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data.from[mid] < position) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Every link whose source falls in [start, end).
 *
 * Returns indexes into the columns, not copies: the caller is usually about to
 * read three numbers off each one and draw.
 */
export function linksFrom(data: ConnectionsData, start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = firstLinkFrom(data, start); i < data.count && data.from[i] < end; i++) out.push(i);
  return out;
}

/** One link, as an object, for the detail rows. */
export function linkAt(data: ConnectionsData, index: number): ConnectionLink {
  return {
    from: data.from[index],
    toStart: data.toStart[index],
    toEnd: data.toEnd[index],
    votes: data.votes[index],
  };
}

interface MaskCache {
  floor: number;
  cap: number;
  mask: Uint8Array;
  kept: number;
}
const maskCache = new WeakMap<ConnectionsData, MaskCache>();

/**
 * Which links are shown under a vote floor and a most-links cap: 1 for each
 * link kept, 0 for each left out.
 *
 * The cap keeps the most-voted links, as the arcs' does, and breaks ties the
 * same way (the earlier link wins), so the grid, the detail and the arcs agree
 * on which links a cap keeps. 0 is no cap.
 */
export function linkMask(data: ConnectionsData, floor: number, cap: number): { mask: Uint8Array; kept: number } {
  const cached = maskCache.get(data);
  if (cached && cached.floor === floor && cached.cap === cap) return cached;

  const mask = new Uint8Array(data.count);
  let kept = 0;
  if (cap > 0 && cap < data.count) {
    const passing: number[] = [];
    for (let i = 0; i < data.count; i++) if (data.votes[i] >= floor) passing.push(i);
    passing.sort((a, b) => data.votes[b] - data.votes[a] || a - b);
    kept = Math.min(cap, passing.length);
    for (let n = 0; n < kept; n++) mask[passing[n]] = 1;
  } else {
    for (let i = 0; i < data.count; i++) {
      if (data.votes[i] >= floor) {
        mask[i] = 1;
        kept++;
      }
    }
  }

  const entry = { floor, cap, mask, kept };
  maskCache.set(data, entry);
  return entry;
}
