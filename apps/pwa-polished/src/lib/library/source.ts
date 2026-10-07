/**
 * A reference work, described in the terms the contents list needs.
 *
 * IndexList doesn't know what an ISBE entry is, or a Nave's topic, or a person
 * — it knows how to draw an alphabet, a letter's worth of rows and a set of
 * filter chips. Each work supplies one of these and gets the whole browsing
 * shell for free, which is why the three lists come out identical rather than
 * merely similar.
 */

import type { LibrarySource } from '../../stores/libraryPrefsStore';
import {
  type LibraryRow,
  getIsbeLetterCounts,
  getIsbeEntriesForLetter,
  annotateLibraryBadges,
  getIsbeEntriesInChapter,
  searchIsbeEntries,
  getPeopleLetterCounts,
  getPeopleForLetter,
  getPeopleInChapter,
  searchPeople,
  getNavesLetterCounts,
  getNavesForLetter,
  getNavesInChapter,
  searchNaves,
} from '../../adapters/lexicon-lookup.js';

export type { LibraryRow };

/**
 * The packs behind word study, in the order the Get packs card lists them:
 * the encyclopedia and Nave's (one pack), the people, and the dictionary.
 */
export const WORD_STUDY_PACKS = ['encyclotopical', 'people-biblical-v1', 'dictionary-en'];

/** One chip above the list. `test` runs against a row already in hand. */
export interface LibraryFilter {
  key: string;
  label: string;
  test: (row: LibraryRow) => boolean;
}

/** Which source dots a row in this list can usefully show. A person list has
 *  no reason to mark every row "has a bio". */
export type LibraryBadge = 'place' | 'bio' | 'entry' | 'topic' | 'dict';

export interface LibrarySourceAdapter {
  key: LibrarySource;
  /** The catalog pack this work comes from. */
  pack: string;
  /** Shown in the header when browsing rather than reading an entry. */
  label: string;
  /** The line under the title while browsing — what this work actually is. */
  subtitle: string;
  searchPlaceholder: string;
  getLetterCounts(): Promise<Record<string, number>>;
  getRowsForLetter(letter: string): Promise<LibraryRow[]>;
  /** Fills in which other packs cover these names. Optional per source. */
  annotateBadges?(rows: LibraryRow[], letter: string): Promise<LibraryRow[]>;
  search(query: string): Promise<LibraryRow[]>;
  /** Rows that turn up in one chapter, for the "in this chapter" button. */
  getRowsInChapter?(book: string, chapter: number): Promise<LibraryRow[]>;
  filters: LibraryFilter[];
  badges: LibraryBadge[];

  // A list that isn't filed A–Z (Strong's, by number or by Greek letter)
  // describes its own sections. Left out, the list is the A–Z it always was.

  /** Every section in order, for the side rail. Empty ones are shown dimmed. */
  letters?: string[];
  /** A section as the rail shows it, where the key itself won't do. */
  railLabel?(letter: string): string;
  /** A section as its heading names it. */
  sectionLabel?(letter: string): string;
  /** Which section a typed prefix (or a row's sort key) falls in. */
  letterOf?(sortKey: string): string;
  /** Which section holds a row, by id — for opening on the entry you came from. */
  locate?(id: string | number): Promise<string | null>;
  /** What the list offers when its pack isn't installed. Left out, it offers
   *  every word-study pack. */
  missingPacks?: { title: string; note: string };
}

export const isbeSource: LibrarySourceAdapter = {
  key: 'isbe',
  pack: 'encyclotopical',
  label: 'Encyclopedia',
  subtitle: 'International Standard Bible Encyclopedia',
  searchPlaceholder: 'Search the encyclopedia…',
  getLetterCounts: getIsbeLetterCounts,
  getRowsForLetter: getIsbeEntriesForLetter,
  annotateBadges: annotateLibraryBadges,
  search: searchIsbeEntries,
  getRowsInChapter: getIsbeEntriesInChapter,
  filters: [
    { key: 'all', label: 'All', test: () => true },
    { key: 'places', label: 'Places', test: (r) => r.isPlace },
    // Everything that isn't geography: people, customs, plants, coins, doctrine.
    { key: 'articles', label: 'Articles', test: (r) => !r.isPlace },
  ],
  badges: ['place', 'bio', 'topic', 'dict'],
};

export const navesSource: LibrarySourceAdapter = {
  key: 'naves',
  pack: 'encyclotopical',
  label: 'Topical',
  subtitle: "Nave's Topical Bible",
  searchPlaceholder: 'Search topics…',
  getLetterCounts: getNavesLetterCounts,
  getRowsForLetter: getNavesForLetter,
  annotateBadges: annotateLibraryBadges,
  search: searchNaves,
  getRowsInChapter: getNavesInChapter,
  filters: [{ key: 'all', label: 'All', test: () => true }],
  badges: ['entry', 'bio', 'dict'],
};

export const peopleSource: LibrarySourceAdapter = {
  key: 'people',
  pack: 'people-biblical-v1',
  label: 'People',
  subtitle: 'Every named person in the Bible',
  searchPlaceholder: 'Search people…',
  getLetterCounts: getPeopleLetterCounts,
  getRowsForLetter: getPeopleForLetter,
  annotateBadges: annotateLibraryBadges,
  search: searchPeople,
  getRowsInChapter: getPeopleInChapter,
  // Everyone here is a person, so there is nothing useful to filter on beyond
  // the chapter button the shell adds itself.
  filters: [{ key: 'all', label: 'All', test: () => true }],
  badges: ['entry', 'topic', 'dict'],
};
