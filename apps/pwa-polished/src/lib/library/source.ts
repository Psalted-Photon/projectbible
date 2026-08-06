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
}

export const isbeSource: LibrarySourceAdapter = {
  key: 'isbe',
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
