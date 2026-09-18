/**
 * The sets offered in the Harmonies picker, and how a chosen one becomes panes.
 *
 * The plan's ask was a "single 4-way split button": the user should never drag
 * four windows into place and then navigate each of them. So a set is a named
 * list of books in a fixed order, plus where to open — and the view arranges
 * itself from that.
 *
 * Order is meaningful in two ways. The first book is the master, because the
 * master sits at the top of the screen and drives the ones below it, and the
 * first book is the one you would naturally read from. And the rest keep their
 * canonical order, so the Gospels read Matthew, Mark, Luke, John down the screen
 * rather than in whatever order the index happened to list them.
 *
 * The book pair counts in the comments are from the built index and are what
 * justify each set existing: a set whose books rarely appear in a group together
 * would be four readers that spend most of their time dimmed.
 */

import {
  parallelGroups,
  passageFor,
  type ParallelGroup,
} from './parallelIndex';

export interface ParallelSet {
  id: string;
  label: string;
  /** One line under the label in the picker, saying what it is for. */
  blurb: string;
  /** Master first, then followers in reading order. */
  books: string[];
  /** Where to open, when the user has not come from somewhere specific. */
  start: { book: string; chapter: number };
}

/**
 * The standing sets.
 *
 * Four is the ceiling everywhere, phone included, but a set is free to be
 * smaller — most of these are pairs, and a pair is the honest shape for Kings
 * and Chronicles. Offering a padded-out four would mean two panes dimmed from
 * the moment it opened.
 */
export const PARALLEL_SETS: ParallelSet[] = [
  {
    id: 'gospels',
    label: 'The Gospels',
    blurb: 'All four accounts of the life of Jesus, side by side.',
    books: ['Matthew', 'Mark', 'Luke', 'John'],
    start: { book: 'Matthew', chapter: 1 },
  },
  {
    id: 'synoptics',
    label: 'The Synoptics',
    // 270 Matthew/Luke, 229 Mark/Matthew, 201 Luke/Mark — by a distance the
    // densest three books in the index.
    blurb: 'Matthew, Mark and Luke, who tell the same story in the same order.',
    books: ['Matthew', 'Mark', 'Luke'],
    start: { book: 'Matthew', chapter: 3 },
  },
  {
    id: 'kings-chronicles',
    label: 'Kings & Chronicles',
    // 84 groups shared with 2 Kings, 73 with 1 Kings.
    blurb: 'The same reigns told twice — once as history, once for the temple.',
    books: ['2 Kings', '2 Chronicles'],
    start: { book: '2 Kings', chapter: 18 },
  },
  {
    id: 'samuel-chronicles',
    label: 'Samuel & Chronicles',
    // 50 groups.
    blurb: "David's reign in both tellings.",
    books: ['2 Samuel', '1 Chronicles'],
    start: { book: '2 Samuel', chapter: 5 },
  },
  {
    id: 'david-psalms',
    label: 'David & the Psalms',
    // 27 groups link a Samuel chapter to the psalm written out of it.
    blurb: 'The events, beside the psalms written out of them.',
    books: ['2 Samuel', 'Psalms'],
    start: { book: '2 Samuel', chapter: 12 },
  },
  {
    id: 'law-restated',
    label: 'The Law restated',
    // 31 groups with Numbers, 27 with Exodus.
    blurb: 'Deuteronomy going back over what Exodus and Numbers first gave.',
    books: ['Deuteronomy', 'Exodus', 'Numbers'],
    start: { book: 'Deuteronomy', chapter: 5 },
  },
  {
    id: 'isaiah-kings',
    label: 'Isaiah & Kings',
    // 19 groups — Sennacherib's invasion, and Hezekiah's illness.
    blurb: "Hezekiah's reign, from the palace and from the prophet.",
    books: ['2 Kings', 'Isaiah'],
    start: { book: '2 Kings', chapter: 18 },
  },
];

export function setById(id: string): ParallelSet | null {
  return PARALLEL_SETS.find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Robertson sections
// ---------------------------------------------------------------------------

/** One entry in the harmony contents list. */
export interface HarmonyEntry {
  group: ParallelGroup;
  section: number | string;
  title: string;
  /** Which Gospels carry it, in canonical order. */
  books: string[];
}

/** A run of sections under one of Robertson's fourteen part titles. */
export interface HarmonyPart {
  title: string;
  entries: HarmonyEntry[];
}

const GOSPELS = ['Matthew', 'Mark', 'Luke', 'John'];

/**
 * Robertson's 185 titled sections, grouped by his own parts.
 *
 * Built once at module load rather than per open: it is a pure function of data
 * that ships with the app, and the contents list is opened from a modal where a
 * frame spent rebuilding it would be visible.
 */
export const HARMONY_PARTS: HarmonyPart[] = buildParts();

function buildParts(): HarmonyPart[] {
  const parts: HarmonyPart[] = [];
  let current: HarmonyPart | null = null;

  for (const group of parallelGroups) {
    if (group.source !== 'robertson') continue;

    const title = group.part_title ?? group.part ?? 'The Harmony';
    // Consecutive runs rather than a map keyed on the title: the sections are
    // already in Robertson's order, and grouping by key would silently reorder
    // them if a part title were ever repeated later in the book.
    if (!current || current.title !== title) {
      current = { title, entries: [] };
      parts.push(current);
    }

    current.entries.push({
      group,
      section: group.robertsonSection ?? group.id,
      title: group.title ?? `Section ${group.robertsonSection ?? group.id}`,
      books: GOSPELS.filter((b) => passageFor(group, b)),
    });
  }

  return parts;
}

/**
 * The panes for a Robertson section: the Gospels that carry it, each opened at
 * its own first chapter in that section.
 *
 * Only the books that carry it. A section three Gospels tell would otherwise
 * open a fourth pane dimmed from the start, which says nothing the strip does
 * not already say and costs a whole reader on a phone. The solo sections — the
 * eighty that only one Gospel has — are still openable, and are simply one
 * reader; that is the "only in Luke" case, and it is a legitimate thing to want
 * to look at.
 */
export function panesForSection(group: ParallelGroup): Array<{ book: string; chapter: number }> {
  const panes: Array<{ book: string; chapter: number }> = [];
  for (const book of GOSPELS) {
    const passage = passageFor(group, book);
    if (passage) panes.push({ book, chapter: passage.startChapter });
  }
  return panes;
}
