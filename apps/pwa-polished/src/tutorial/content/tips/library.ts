/**
 * Dots in the reference works: the encyclopedia, the topical index, Bible
 * people and word study. The same views open as a window and as the lookup
 * card over the reader, so these tips serve both.
 */

import type { Tip } from '../types';

const area = 'Library';

const ENTRY = '.isbe-content, .naves-content, .person-content, .lexical-content';

function inEntry(selector: string): string {
  return ENTRY.split(', ')
    .map((root) => `${root} ${selector}`)
    .join(', ');
}

export const LIBRARY_TIPS: Tip[] = [
  {
    id: 'library-works',
    area,
    target: '.work-tabs',
    corner: 'top-left',
    title: 'Four reference works',
    body: 'Switch between the dictionary, topical index, encyclopedia and people. A greyed-out tab has nothing for this.',
  },
  {
    id: 'library-contents',
    area,
    target: '.nav-buttons .nav-btn[aria-label="Contents"], .nav-buttons .nav-btn[aria-label="Back to what you were reading"]',
    title: 'Contents',
    body: 'Flip between the A–Z contents and the entry you were reading.',
  },
  {
    id: 'library-back',
    area,
    target: '.nav-buttons .nav-btn[aria-label="Back"]',
    title: 'Back',
    body: 'Back to the entry you were on before.',
  },

  // The A–Z contents
  {
    id: 'index-this-chapter',
    area,
    target: '.index .chip.chapter',
    title: 'This chapter only',
    body: 'Show only the entries that turn up in the chapter you’re reading.',
  },
  {
    id: 'index-filters',
    area,
    target: '.index .chip:not(.chapter)',
    title: 'Filters',
    body: 'Narrow the list to one kind of entry.',
  },
  {
    id: 'index-search',
    area,
    target: '.index .search-icon-btn',
    title: 'Search',
    body: 'Search this work for a name or a word.',
  },
  {
    id: 'index-letters',
    area,
    target: '.index .rail',
    corner: 'top-left',
    title: 'A to Z',
    body: 'Tap or slide along the letters to jump through the list.',
  },
  {
    id: 'index-jump-across',
    area,
    target: '.index .badges .emoji',
    title: 'Jump across',
    body: 'Open this in another work: the map, a bio, the encyclopedia, the topical index or the dictionary.',
  },
  {
    id: 'index-star',
    area,
    target: '.index .star',
    corner: 'top-left',
    title: 'Star it',
    body: 'Starred entries wait for you at the top of the list, with the ones you opened lately.',
  },

  // An entry
  {
    id: 'entry-pin',
    area,
    target: inEntry('.pop-btn'),
    title: 'Pin it',
    body: 'Keep this open in a window beside the text.',
  },
  {
    id: 'entry-trail',
    area,
    target: inEntry('.trail .crumb'),
    title: 'Your trail',
    body: 'The entries you came through to get here. Tap one to go back to it.',
  },
  {
    id: 'entry-sections',
    area,
    target: inEntry('.tabs'),
    corner: 'top-left',
    title: 'Parts of this entry',
    body: 'Switch between the parts of this entry.',
  },
  {
    id: 'entry-verses-by-book',
    area,
    target: '.vb-header, .cv-book-header',
    title: 'Verses by book',
    body: 'Every verse, grouped by book and shown in each book’s family color. Tap a book to open its verses.',
  },
  {
    id: 'entry-all-verses',
    area,
    target: '.person-content .char-verses-toggle',
    title: 'Every verse',
    body: 'Show every verse this person appears in.',
  },
  {
    id: 'entry-family',
    area,
    target: '.person-content .rel',
    title: 'Family',
    body: 'Tap a relative to open their bio.',
  },
  {
    id: 'entry-expand-all',
    area,
    target: inEntry('.expand-all'),
    title: 'Open them all',
    body: 'Open every section at once, or fold them all away.',
  },
  {
    id: 'entry-open-map',
    area,
    target: '.isbe-content .map-pop',
    title: 'Open the map',
    body: 'Open this place in the Map window, with everything around it.',
  },
  {
    id: 'entry-next',
    area,
    target: inEntry('.turn-btn'),
    title: 'Next and previous',
    body: 'Step through the entries in A–Z order.',
  },
  {
    id: 'word-strongs',
    area,
    target: '.lexical-content .strongs-link',
    title: 'Strong’s number',
    body: 'Open the full entry for the original word: its definition, forms, and every place it’s used.',
  },
  {
    id: 'word-gloss',
    area,
    target: '.lexical-content .gloss',
    title: 'The English meaning',
    body: 'Look this meaning up in the English dictionary.',
  },
  {
    id: 'word-source-text',
    area,
    target: '.lexical-content .source-picker',
    title: 'Which text',
    body: 'Count the forms and occurrences in one Greek or Hebrew text, or all of them.',
  },
];
