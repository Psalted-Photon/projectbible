/**
 * Dots on the top bar: the reading controls on the left, the tools on the right.
 */

import type { Tip } from '../types';

const area = 'Navbar';

export const NAVBAR_TIPS: Tip[] = [
  {
    id: 'nav-translation',
    area,
    target: '.translation-dropdown-trigger .pill-btn',
    title: 'Translations',
    body: 'Switch which Bible you’re reading. Every window can read a different one.',
  },
  {
    id: 'nav-reference',
    area,
    target: '.pill-btn-reference',
    title: 'Books and chapters',
    body: 'Jump to any book and chapter. The books come in ten color families, and each keeps its color all through the app.',
    extra: 'colors',
  },
  {
    id: 'nav-trail',
    area,
    target: '.crumb-btn',
    title: 'Your trail',
    body: 'Every place you jumped from on the way here, each in its book’s color. Tap one to go back to it; the first is where you started.',
  },
  {
    id: 'nav-split',
    area,
    target: '.pill-btn[aria-label="Open in split view"]',
    title: 'Split view',
    body: 'Opens where you came from in a window, beside where you are now.',
  },
  {
    id: 'nav-cross-references',
    area,
    target: '.pill-refs',
    needs: 'tsk-references',
    title: 'Cross-references',
    body: 'Puts a ◆ by every verse that links to other passages. Tap a ◆ to see them.',
  },
  {
    id: 'nav-commentary',
    area,
    target: '.pill-comm',
    needs: 'commentaries',
    title: 'Commentary',
    body: 'Pick commentators, and their colored badges show up by the verses they wrote about.',
  },
  {
    id: 'nav-word-study',
    area,
    target: '.pill-wordstudy',
    needs: 'encyclotopical',
    title: 'Word study',
    body: 'The dictionary, topical index, encyclopedia and Bible people in one place, starting from the encyclopedia’s A–Z.',
  },
  {
    id: 'nav-interlinear',
    area,
    target: '.nav-il-toggle',
    needs: 'ancient-languages',
    title: 'Interlinear',
    body: 'Shows the English meaning under each Greek or Hebrew word. The arrow beside it picks which layers show.',
  },
  {
    id: 'nav-read-aloud',
    area,
    target: '.nav-tts',
    title: 'Read Aloud controls',
    body: 'Pause, jump to a verse, stop, carry on into the next chapter, or set a sleep timer.',
  },
  {
    id: 'nav-repeats',
    area,
    target: '.repeat-pill',
    title: 'A word you’re tracking',
    body: 'Counts how often the word comes up. Tap to highlight every time it appears in the chapter or book, or to clear it.',
  },
  {
    id: 'nav-search',
    area,
    target: '.pill-search-icon-btn',
    title: 'Search',
    body: 'Search the Bible, your notes and journal, people, the encyclopedia and the commentaries, all at once.',
  },
  {
    id: 'nav-power-search',
    area,
    target: '.pill-powersearch',
    title: 'Advanced search',
    body: 'Search with patterns, words near each other, and filters like book and testament.',
  },
  {
    id: 'nav-reading-plans',
    area,
    target: '.pill-readingplan',
    title: 'Reading plans',
    body: 'Pick a plan (a year, the Gospels, chronological) and tick off each day as you go.',
  },
  {
    id: 'nav-verse-of-the-day',
    area,
    target: '.pill-votd',
    title: 'Verse of the Day',
    body: 'Today’s verse, whenever you want to see it again.',
  },
  {
    id: 'nav-settings',
    area,
    target: '.pill-settings',
    title: 'Settings',
    body: 'Themes, fonts, packs and the wake alarm. Tutorial Mode’s switch is under General.',
  },
  {
    id: 'nav-profile',
    area,
    target: '.pill-profile',
    title: 'Your account',
    body: 'Sign in to keep notes, highlights, your journal and plans in step across devices. Entirely optional.',
  },
];
