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
} from '../../adapters/lexicon-lookup.js';

export type { LibraryRow };

/** One chip above the list. `test` runs against a row already in hand. */
export interface LibraryFilter {
  key: string;
  label: string;
  test: (row: LibraryRow) => boolean;
}

export interface LibrarySourceAdapter {
  key: LibrarySource;
  /** Shown in the header when browsing rather than reading an entry. */
  label: string;
  searchPlaceholder: string;
  getLetterCounts(): Promise<Record<string, number>>;
  getRowsForLetter(letter: string): Promise<LibraryRow[]>;
  /** Fills in which other packs cover these names. Optional per source. */
  annotateBadges?(rows: LibraryRow[], letter: string): Promise<LibraryRow[]>;
  search(query: string): Promise<LibraryRow[]>;
  /** Rows that turn up in one chapter, for the "in this chapter" button. */
  getRowsInChapter?(book: string, chapter: number): Promise<LibraryRow[]>;
  filters: LibraryFilter[];
}

export const isbeSource: LibrarySourceAdapter = {
  key: 'isbe',
  label: 'Encyclopedia',
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
};
