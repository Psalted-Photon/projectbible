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

// ---------------------------------------------------------------------------
// Robertson's sections as a sequence
// ---------------------------------------------------------------------------

/**
 * The 185 Robertson sections in his own order, solo ones included.
 *
 * This is the spine the strip's arrows step along. It is built once at module
 * load from the index's own ordering, which the build script emits in section
 * order — verified rather than assumed, and re-sorted here anyway so a future
 * change to the script's emit order cannot silently scramble the arrows.
 *
 * The solo sections stay in. They are 78 of the 185, and skipping them would
 * mean stepping through the harmony jumped over most of Luke's infancy
 * narrative and all of John's prologue — the arrows are a way of reading
 * through the life of Jesus, and "only Luke tells this" is part of that
 * reading rather than a gap in it.
 */
export const robertsonSequence: readonly ParallelGroup[] = index.groups
  .filter((g) => g.source === 'robertson')
  .slice()
  .sort((a, b) => sectionNumber(a) - sectionNumber(b));

/**
 * A section number as something sortable.
 *
 * Robertson's numbering is mostly integers but carries a handful of letter
 * suffixes, so it is parsed leniently rather than coerced: parseFloat takes the
 * leading digits and ignores the rest, which keeps 42a and 42b adjacent and in
 * the order the data lists them, since the sort is stable.
 */
function sectionNumber(group: ParallelGroup): number {
  const raw = group.robertsonSection;
  if (typeof raw === 'number') return raw;
  const n = parseFloat(String(raw ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** Where a group sits in the sequence, or -1 if it is not a Robertson section. */
export function sequenceIndexOf(groupId: number): number {
  return robertsonSequence.findIndex((g) => g.id === groupId);
}

/**
 * The section before or after this one, or null at either end.
 *
 * Deliberately does not wrap. Stepping off the end of the harmony and landing
 * back at Luke's preface would look like the arrow had gone the wrong way; a
 * disabled arrow says "this is the end" without the user having to work it out
 * from where they ended up.
 */
export function stepSection(groupId: number, delta: 1 | -1): ParallelGroup | null {
  const at = sequenceIndexOf(groupId);
  if (at < 0) return null;
  return robertsonSequence[at + delta] ?? null;
}

/**
 * The Robertson section a reference falls in, for starting a step from a
 * position rather than from a known section.
 *
 * Needed because the strip's arrows have to work from the moment the view
 * opens, and currentGroupId is null until the first scroll tick has run — and
 * also whenever the master is sitting in a BSB-only parallel, which has no
 * place in the sequence at all. Narrowest wins, so a verse inside both a long
 * section and a short one steps from the short one, which is the one the
 * reader is actually in.
 */
export function robertsonSectionAt(
  book: string,
  chapter: number,
  verse: number,
): ParallelGroup | null {
  const matches = lookupParallels(book, chapter, verse);
  return matches.find((g) => g.source === 'robertson') ?? null;
}

// ---------------------------------------------------------------------------
// "Only in Luke" — material one Gospel alone carries
// ---------------------------------------------------------------------------

/** A stretch of a chapter that only this Gospel tells. */
export interface SoloRun {
  /** First and last verse of the run within this chapter. */
  from: number;
  to: number;
  title: string;
  section: number | string;
}

/**
 * The solo Robertson sections touching one chapter, as verse runs.
 *
 * Returned per chapter rather than per verse because the ordinary reader asks
 * once per rendered chapter and then tests verses against the result — 78 solo
 * sections tested against every verse of every chapter on screen would be the
 * kind of per-verse work the reader cannot afford with four panes up.
 *
 * Runs are clipped to the chapter asked for, so a section spanning a chapter
 * break yields a run in each of them and the marking does not stop dead at the
 * boundary. The array is almost always empty or a single entry, and callers can
 * treat an empty array as the common case.
 */
export function soloRunsIn(book: string, chapter: number): SoloRun[] {
  const ids = index.byChapter[`${book}|${chapter}`];
  if (!ids) return [];

  const runs: SoloRun[] = [];
  for (const id of ids) {
    const group = groupsById[id];
    if (!group?.soloRobertson) continue;

    const passage = passageFor(group, book);
    if (!passage) continue;

    const from = chapter === passage.startChapter ? passage.startVerse : 1;
    // Infinity rather than a chapter-length lookup: the caller is walking the
    // verses it actually has, so an open-ended top clips itself against real
    // data instead of against a table this module would have to carry.
    const to = chapter === passage.endChapter ? passage.endVerse : Infinity;

    runs.push({
      from,
      to,
      title: group.title ?? `Section ${group.robertsonSection}`,
      section: group.robertsonSection ?? group.id,
    });
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Targeting — where inside its own passage a follower should sit
// ---------------------------------------------------------------------------

/**
 * How close to an end a target has to be, in verses, before it snaps there.
 *
 * Deliberately a verse count and not a fraction. The plan specified fixed
 * fractions (below 0.12 snap to the start, above 0.88 to the end), which is
 * right for the median 7-verse passage but inverts on the long ones: passages
 * run from 1 verse to 805, and at 805 a 0.12 threshold is 97 verses, so the
 * follower would sit frozen at the passage start for the first ninety-seven
 * verses of Genesis 27 — exactly the lurching this phase exists to remove. The
 * Sermon on the Mount (111 verses) and the Olivet Discourse (97) are the
 * reachable Gospel cases; there are 12 passages of 60 verses or more.
 *
 * Converted per passage, this holds the snap zone at a near-constant ~3 verses
 * whatever the length, which is what "entering and leaving should feel
 * decisive" actually meant.
 */
const EDGE_VERSES = 2;

/**
 * The ceiling on that conversion, as a fraction of the passage.
 *
 * Without it the rule runs the other way on the short end: at 3 verses, 2
 * verses of edge is the entire passage and the middle verse can never be a
 * target. Passages of 5 verses or fewer are 37% of the data, so this is the
 * common case, not the corner. At the cap a 3-verse passage keeps its middle.
 */
const EDGE_MAX_FRACTION = 0.2;

/** How far from the computed target a heading may sit and still win, in verses. */
const HEADING_SNAP_VERSES = 2;

export interface ParallelTarget {
  chapter: number;
  verse: number;
  /** Why this verse, for the dim-reason strip and for debugging the feel. */
  reason: 'start' | 'end' | 'heading' | 'proportional';
}

/**
 * A heading lookup for the follower's book: the verse numbers that open a
 * section, by chapter.
 *
 * Passed in rather than read here, because headings are per translation and
 * live in IndexedDB behind an async read, while everything in this module is
 * pure and runs on every scroll tick. The caller hands over whatever it already
 * has in memory for the chapters on screen; a chapter it has no entry for is
 * treated as having no headings, which costs only the refinement.
 */
export type HeadingVerses = (chapter: number) => ReadonlySet<number> | undefined;

/**
 * Where a follower should sit, given how far the master is through its own
 * passage.
 *
 * Proportional first — the master's fraction read off the follower's passage,
 * which is what lets Matthew's compressed telling track Luke's expanded one —
 * then refined, because the raw fraction lands mid-pericope as often as not:
 *
 *  - Within EDGE_VERSES of either end, snap to that end.
 *  - Otherwise, if a section heading sits within HEADING_SNAP_VERSES, take the
 *    heading: it is where the eye rests and where the text itself says a new
 *    thing starts.
 *
 * The ends are tested before headings on purpose. A heading often sits a verse
 * or two inside a passage, and letting it win at the edges would mean entering
 * a parallel never quite reaching its first verse.
 *
 * Later upgrade, not built now: weight the fraction by rendered verse height
 * rather than verse count. Verse length varies enough between translations that
 * height tracks the eye better than index does — but it needs measured DOM from
 * a pane that may not have the chapter rendered yet, so it cannot live in a pure
 * function and is not worth the machinery until the count version is proven.
 */
export function targetWithin(
  passage: ParallelPassage,
  fraction: number,
  headings?: HeadingVerses,
): ParallelTarget {
  const span = spanOf(passage) - 1;

  // A single-verse passage has nowhere to interpolate to.
  if (span <= 0) {
    return { chapter: passage.startChapter, verse: passage.startVerse, reason: 'start' };
  }

  const f = clamp01(fraction);
  const edge = Math.min(EDGE_VERSES / span, EDGE_MAX_FRACTION);

  if (f <= edge) {
    return { chapter: passage.startChapter, verse: passage.startVerse, reason: 'start' };
  }
  if (f >= 1 - edge) {
    return { chapter: passage.endChapter, verse: passage.endVerse, reason: 'end' };
  }

  const at = verseAtFraction(passage, f);
  const heading = headings && nearestHeading(passage, at, headings);
  return heading
    ? { ...heading, reason: 'heading' }
    : { ...at, reason: 'proportional' };
}

/**
 * The nearest section heading to a target, within HEADING_SNAP_VERSES and
 * inside the passage.
 *
 * Searches outward from the target so the closest wins, and prefers the heading
 * above on a tie: a heading belongs to the text that follows it, so when the
 * target sits midway between two, the one already governing the verse is the
 * one the reader is under.
 *
 * Only the target's own chapter is searched. A heading two verses away across a
 * chapter break would have to be found by walking into the neighbouring
 * chapter's verse numbering, and the 20 passages in the whole index that cross
 * a break do not justify it — they fall through to the proportional target,
 * which is correct, just unrefined.
 */
function nearestHeading(
  passage: ParallelPassage,
  at: { chapter: number; verse: number },
  headings: HeadingVerses,
): { chapter: number; verse: number } | null {
  const inChapter = headings(at.chapter);
  if (!inChapter || inChapter.size === 0) return null;

  for (let d = 0; d <= HEADING_SNAP_VERSES; d++) {
    for (const verse of d === 0 ? [at.verse] : [at.verse - d, at.verse + d]) {
      if (inChapter.has(verse) && passageContains(passage, at.chapter, verse)) {
        return { chapter: at.chapter, verse };
      }
    }
  }

  return null;
}

/**
 * The whole journey in one call: where the master is, where the follower goes.
 * Returns null when the group has nothing for that book — the caller dims that
 * pane rather than scrolling it.
 */
export function followerTarget(
  group: ParallelGroup,
  masterBook: string,
  masterChapter: number,
  masterVerse: number,
  followerBook: string,
  headings?: HeadingVerses,
): ParallelTarget | null {
  const from = passageFor(group, masterBook);
  const to = passageFor(group, followerBook);
  if (!from || !to) return null;

  return targetWithin(to, fractionWithin(from, masterChapter, masterVerse), headings);
}
