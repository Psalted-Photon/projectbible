/**
 * Parallel-passage index — lookup and fraction maths.
 *
 * Pure and stateless: everything here is a function of the index data and the
 * arguments handed in, with nothing cached and nothing read from the DOM. The
 * sync engine calls into this on every scroll tick with four readers on screen,
 * so it stays cheap and keeps no state that could go stale between panes.
 *
 * The data is built by scripts/build-parallel-index.mjs from the BSB
 * publisher's own parallel markers and the Robertson-Broadus gospel harmony.
 */

import indexData from '../data/parallel-index.json';

/** One book's stretch of text within a group. */
export interface ParallelPassage {
  book: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  /** Total verses across the whole passage, chapter breaks included. */
  verseCount: number;
  /**
   * Per-chapter breakdown, present only when the passage crosses a chapter
   * break. Read it through chapterSpansOf, never directly — for the ~99% of
   * passages that sit inside one chapter it is absent rather than false.
   */
  chapterSpans?: ChapterSpan[];
}

export interface ChapterSpan {
  ch: number;
  from: number;
  count: number;
}

/** A set of passages that tell the same event. */
export interface ParallelGroup {
  id: number;
  source: 'robertson' | 'bsb';
  /** Robertson sections are titled; BSB markers are not. */
  title?: string;
  robertsonSection?: number | string;
  part?: string;
  part_title?: string;
  /** A Robertson section only one Gospel carries — the "only in Luke" case. */
  soloRobertson?: boolean;
  passages: ParallelPassage[];
}

interface ParallelIndex {
  version: number;
  groups: ParallelGroup[];
  byChapter: Record<string, number[]>;
}

const index = indexData as unknown as ParallelIndex;

/** Groups by id. Built once at module load; ids are dense, so an array does. */
const groupsById: ParallelGroup[] = [];
for (const group of index.groups) groupsById[group.id] = group;

export const parallelGroups: readonly ParallelGroup[] = index.groups;

// ---------------------------------------------------------------------------
// Position within a passage
// ---------------------------------------------------------------------------

/**
 * The per-chapter breakdown of a passage, reconstructed when the build left it
 * out. A passage inside a single chapter has exactly one span, and that span is
 * just the passage's own start, end and count, so storing it would have been
 * ~112 KB of the file repeating fields the object already carries.
 */
export function chapterSpansOf(passage: ParallelPassage): ChapterSpan[] {
  if (passage.chapterSpans) return passage.chapterSpans;
  return [
    { ch: passage.startChapter, from: passage.startVerse, count: passage.verseCount },
  ];
}

/** True when the reference falls inside the passage. */
export function passageContains(
  passage: ParallelPassage,
  chapter: number,
  verse: number,
): boolean {
  if (chapter < passage.startChapter || chapter > passage.endChapter) return false;
  if (chapter === passage.startChapter && verse < passage.startVerse) return false;
  if (chapter === passage.endChapter && verse > passage.endVerse) return false;
  return true;
}

/** How many verses a passage spans. Never zero, so it is safe to divide by. */
function spanOf(passage: ParallelPassage): number {
  return Math.max(1, passage.verseCount);
}

/**
 * How far through the passage the reference sits, 0 at the first verse and 1 at
 * the last. Counted in verses rather than chapter:verse arithmetic, so a
 * passage crossing a chapter break advances smoothly across it instead of
 * jumping.
 *
 * Out-of-range references clamp rather than returning null: the engine calls
 * this while the master is scrolling out of a passage, and a clamped 0 or 1 is
 * the right answer at that moment.
 */
export function fractionWithin(
  passage: ParallelPassage,
  chapter: number,
  verse: number,
): number {
  let passed = 0;

  for (const span of chapterSpansOf(passage)) {
    if (chapter === span.ch) {
      const within = Math.min(Math.max(verse - span.from, 0), span.count - 1);
      return clamp01((passed + within) / (spanOf(passage) - 1 || 1));
    }
    if (chapter < span.ch) break;
    passed += span.count;
  }

  return chapter < passage.startChapter ? 0 : 1;
}

/**
 * The inverse: which verse sits that far through the passage. This is what the
 * follower scrolls to — the master's fraction of its own passage, read off the
 * follower's, which is what lets a 15-verse telling track a 53-verse one.
 */
export function verseAtFraction(
  passage: ParallelPassage,
  fraction: number,
): { chapter: number; verse: number } {
  const target = Math.round(clamp01(fraction) * (spanOf(passage) - 1));

  let passed = 0;
  for (const span of chapterSpansOf(passage)) {
    if (target < passed + span.count) {
      return { chapter: span.ch, verse: span.from + (target - passed) };
    }
    passed += span.count;
  }

  return { chapter: passage.endChapter, verse: passage.endVerse };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** The passage a group holds for a given book, if it has one. */
export function passageFor(
  group: ParallelGroup,
  book: string,
): ParallelPassage | null {
  return group.passages.find((p) => p.book === book) ?? null;
}

/**
 * Every group covering this verse, narrowest first.
 *
 * The chapter bucket does the real work: it cuts ~1,360 groups down to the
 * handful touching this chapter, and only those get the range test. Ordering by
 * total span puts the most specific reading first — where a BSB marker covering
 * a few verses and a Robertson section covering a whole discourse both match,
 * the tighter one describes where the reader actually is.
 */
export function lookupParallels(
  book: string,
  chapter: number,
  verse: number,
): ParallelGroup[] {
  const ids = index.byChapter[`${book}|${chapter}`];
  if (!ids) return [];

  const matches: ParallelGroup[] = [];
  for (const id of ids) {
    const group = groupsById[id];
    const passage = group && passageFor(group, book);
    if (passage && passageContains(passage, chapter, verse)) matches.push(group);
  }

  return matches.sort((a, b) => totalSpan(a) - totalSpan(b));
}

/**
 * The single best group for a verse: the narrowest match, but preferring a
 * titled Robertson section when one covers the same ground, since it can name
 * what is being shown and a bare BSB marker cannot.
 */
export function bestParallel(
  book: string,
  chapter: number,
  verse: number,
): ParallelGroup | null {
  const matches = lookupParallels(book, chapter, verse);
  if (matches.length === 0) return null;

  const narrowest = matches[0];
  const titled = matches.find(
    (g) => g.source === 'robertson' && !g.soloRobertson && totalSpan(g) <= totalSpan(narrowest) * 2,
  );
  return titled ?? narrowest;
}

function totalSpan(group: ParallelGroup): number {
  let total = 0;
  for (const p of group.passages) total += p.verseCount;
  return total;
}

/** The group with this id, or null. */
export function groupById(id: number): ParallelGroup | null {
  return groupsById[id] ?? null;
}
