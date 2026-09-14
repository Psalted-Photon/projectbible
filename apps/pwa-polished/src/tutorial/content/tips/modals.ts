/**
 * Dots in the big dialogs: Reading Plan, Profile, Advanced Search and the Verse
 * of the Day. The reference works' lookup card is covered by the Library tips,
 * because it is the same view as their windows.
 *
 * Also the book color reminders on lists colored by book (reading plan rows,
 * search results), whose cards carry the color legend.
 */

import type { Tip } from '../types';

const area = 'Dialogs';

export const MODAL_TIPS: Tip[] = [
  // ── Reading Plan ─────────────────────────────────────────────────────────
  {
    id: 'plan-tabs',
    area,
    target: '.tabs .tab',
    text: 'Create Plan',
    exact: true,
    title: 'Three tabs',
    body: 'Make a new plan, follow the ones you’re on, or look back at the plans you’ve finished.',
  },
  {
    id: 'plan-preset',
    area,
    target: '.create-plan-tab #preset',
    title: 'Pick a plan',
    body: 'Ready-made plans, from the whole Bible in a year to a Gospel harmony. Custom lets you choose the books and the pace.',
  },
  {
    id: 'plan-books',
    area,
    target: '.create-plan-tab .book-row',
    title: 'Pick the books',
    body: 'Tick the books to include. Each wears its family color, the same as everywhere else in Hexapla.',
    extra: 'colors',
  },
  {
    id: 'plan-generate',
    area,
    target: '.create-plan-tab .generate-btn',
    title: 'Generate',
    body: 'Builds the day-by-day schedule.',
  },
  {
    id: 'plan-switch',
    area,
    target: '.active-plan-tab .plan-tab-strip',
    corner: 'top-left',
    title: 'Your plans',
    body: 'Follow more than one plan at once. Switch between them here, or see them all together.',
  },
  {
    id: 'plan-start',
    area,
    target: '.today-reading .start-reading-btn',
    title: 'Today’s reading',
    body: 'Opens the first chapter in the reader. At the end of each one there’s a button to carry on or tick the day off.',
  },
  {
    id: 'plan-mark-day',
    area,
    target: '.today-reading .mark-day-btn',
    title: 'Mark the day done',
    body: 'Marks all of today’s reading as read in one go.',
  },
  {
    id: 'plan-views',
    area,
    target: '.active-plan-tab .view-toggle',
    corner: 'top-left',
    title: 'Three views',
    body: 'A calendar, a day-by-day list, and Catch-up for when you’ve fallen behind.',
  },
  {
    id: 'plan-chapter',
    area,
    target: '.list-view .chapter-chip',
    title: 'A chapter',
    body: 'Tick it once you’ve read it, or tap its name to open it. It wears its book’s family color.',
    extra: 'colors',
  },
  {
    id: 'plan-whole-day',
    area,
    target: '.list-view .list-day-check',
    title: 'The whole day',
    body: 'Mark every chapter for that day read.',
  },
  {
    id: 'plan-catch-up',
    area,
    target: '.catchup-view .catchup-controls',
    title: 'Catch up',
    body: 'Spread the missed chapters over the days ahead, or set aside days just for catching up.',
  },
  {
    id: 'plan-export',
    area,
    target: '.plan-progress .progress-actions',
    title: 'Your progress',
    body: 'Save your progress as a file, or sync it to your account right now.',
  },

  // ── Profile ──────────────────────────────────────────────────────────────
  {
    id: 'profile-sign-in',
    area,
    target: '.auth-panel .primary-btn',
    text: 'Sign in',
    exact: true,
    title: 'Sign in',
    body: 'An account keeps your notes, highlights, journal and plans safe, and the same on every device.',
  },
  {
    id: 'profile-create-account',
    area,
    target: '.auth-panel .secondary-btn',
    text: 'Create Account',
    exact: true,
    title: 'New here?',
    body: 'Make an account with your email address.',
  },
  {
    id: 'profile-tabs',
    area,
    target: '.tabs button',
    text: 'Saved Verses/Notes',
    exact: true,
    title: 'Everything of yours',
    body: 'Your reading plan, the verses you’ve highlighted and noted, your journal calendar, and your account settings.',
  },
  {
    id: 'profile-sync',
    area,
    target: '.profile-actions .sync-btn',
    title: 'Sync now',
    body: 'Syncs notes, highlights, bookmarks, journal, notebooks, reading plans, reading progress, settings and the wake alarm across your devices.',
  },
  {
    id: 'profile-saved-verses',
    area,
    target: '.svp-root .svp-pills',
    corner: 'top-left',
    title: 'Saved verses and notes',
    body: 'Every verse you’ve highlighted, and every note. Tap one to go to it.',
  },
  {
    id: 'profile-journal-day',
    area,
    target: '.jc-root .cal-cell:not(.empty)',
    title: 'Your journal',
    body: 'A dot means you wrote that day. Tap any day to read the entry or start one.',
  },

  // ── Advanced search ──────────────────────────────────────────────────────
  {
    id: 'search-match-type',
    area,
    target: '.controls-panel select[title="How to match the search text"]',
    title: 'Match type',
    body: 'Anywhere in the verse, whole words only, or words that begin or end with your letters.',
  },
  {
    id: 'search-must',
    area,
    target: '.controls-panel .input-with-button',
    title: 'Must, and must not',
    body: 'Only find verses that also contain another word, or leave out verses that have one.',
  },
  {
    id: 'search-near',
    area,
    target: '.controls-panel .proximity-inputs',
    title: 'Words near each other',
    body: 'Find two words within a few words of each other.',
  },
  {
    id: 'search-help',
    area,
    target: '.controls-panel .help-btn',
    title: 'What’s this?',
    body: 'Every ? explains its option, with examples.',
  },
  {
    id: 'search-pattern',
    area,
    target: '.preview-panel .toggle-pattern',
    title: 'The pattern',
    body: 'See the exact search your choices add up to.',
  },
  {
    id: 'search-results-by-book',
    area,
    // Only book rows are colored; the rest carry an empty style attribute.
    target: '.tree-node .tree-label[style*="color"]',
    title: 'Results by book',
    body: 'Results are grouped by book, and each book wears its family color. Tap one to open its verses.',
    extra: 'colors',
  },

  // ── Verse of the Day ─────────────────────────────────────────────────────
  {
    id: 'votd-read',
    area,
    target: '.dg-card .dg-btn-primary',
    title: 'Read in context',
    body: 'Opens the verse in the reader, with the rest of its chapter around it.',
  },
];
