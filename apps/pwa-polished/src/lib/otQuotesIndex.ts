/**
 * Old-Testament-quotes index — lookup.
 *
 * Pure and stateless. The data is built by scripts/build-ot-quotes-index.mjs
 * from the "Quoting Passages" rows shipping inside commentaries.sqlite, and is
 * keyed by verse only: no character offsets, no per-translation data. That is
 * deliberate and is what makes the gutter mark appear in exactly the same
 * places whichever translation a pane is showing.
 *
 * The Septuagint coordinates are precomputed at build time, so nothing here
 * does versification arithmetic — see lxxPsalms.ts for why that is not as
 * simple as subtracting one.
 */

import indexData from '../data/ot-quotes-index.json';

/**
 * How firmly the source ties the New Testament verse to the Old.
 *
 * "quote" is the source's own Refs/Fulfilled-in grade, "allusion" its
 * Alludes-to/Possibly-alludes-to/Related-to. A verse carrying both takes the
 * stronger. The reader draws the two at different weights rather than
 * different glyphs.
 */
export type OtQuoteGrade = 'quote' | 'allusion';

/** An Old Testament reference in the numbering an English Bible uses. */
export interface OtQuoteRef {
  book: string;
  chapter: number;
  verse: number;
  /** Absent when the reference is a single verse. */
  endVerse?: number;
}

/** The same reference in Septuagint numbering, or null where lxx2012 has none. */
export interface LxxTarget {
  book: string;
  chapter: number;
  verse: number;
}

export interface OtQuoteEntry {
  grade: OtQuoteGrade;
  refs: OtQuoteRef[];
  /** Parallel to refs, entry for entry. A null means "no Septuagint for this". */
  lxx: (LxxTarget | null)[];
}

interface OtQuotesIndex {
  version: number;
  /** "Hebrews|1" -> { "7": entryIndex } */
  byChapter: Record<string, Record<string, number>>;
  entries: OtQuoteEntry[];
}

const index = indexData as unknown as OtQuotesIndex;

/**
 * The index stores the pack's spelling of every book, which for the Psalter is
 * the plural "Psalms". bibleData.ts declares the canonical name as the singular
 * "Psalm", so a reader asking about the book it is displaying can arrive here
 * with either. Normalising on the way in costs one comparison and avoids
 * silently dropping the single largest source of Old Testament quotations.
 */
function packBook(book: string): string {
  return book === 'Psalm' ? 'Psalms' : book;
}

/**
 * Every marked verse in a chapter, keyed by verse number.
 *
 * Returns an empty map for a chapter with none, so callers can use the result
 * without a null check. Built fresh per call — a chapter has at most a few
 * dozen entries and the reader builds this once per chapter render, alongside
 * the TSK and art lookups it already does.
 */
export function otQuotesForChapter(
  book: string,
  chapter: number,
): Map<number, OtQuoteEntry> {
  const bucket = index.byChapter[`${packBook(book)}|${chapter}`];
  const out = new Map<number, OtQuoteEntry>();
  if (!bucket) return out;

  for (const [verse, entryIndex] of Object.entries(bucket)) {
    const entry = index.entries[entryIndex];
    if (entry) out.set(Number(verse), entry);
  }
  return out;
}

/** One verse's entry, or null when it carries no Old Testament quotation. */
export function otQuoteForVerse(
  book: string,
  chapter: number,
  verse: number,
): OtQuoteEntry | null {
  const entryIndex = index.byChapter[`${packBook(book)}|${chapter}`]?.[String(verse)];
  return entryIndex === undefined ? null : (index.entries[entryIndex] ?? null);
}

/** "Psalm 104:4", or "Psalm 40:6-8" for a range. Display form, singular book. */
export function formatOtRef(ref: OtQuoteRef): string {
  const book = ref.book === 'Psalms' ? 'Psalm' : ref.book;
  const range = ref.endVerse && ref.endVerse !== ref.verse ? `-${ref.endVerse}` : '';
  return `${book} ${ref.chapter}:${ref.verse}${range}`;
}
