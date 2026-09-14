/**
 * Dots in the Commentary window.
 */

import type { Tip } from '../types';

const area = 'Commentary';

export const COMMENTARY_TIPS: Tip[] = [
  {
    id: 'commentary-author',
    area,
    target: '.commentary-navigation-bar .author-dropdown-trigger .nav-button',
    title: 'Which commentator',
    body: 'Read one commentator, or all of them together. The Book of Enoch is in this list too.',
  },
  {
    id: 'commentary-anchor',
    area,
    target: '.commentary-navigation-bar .pill-anchor',
    title: 'Follow the reader',
    body: 'Tap to keep this commentary on whatever you’re reading. Teal means it’s following, a pulse means it has wandered off (tap to bring it back), and tapping it while teal unlocks it.',
  },
  {
    id: 'commentary-reference',
    area,
    target: '.commentary-reader .commentary-ref',
    title: 'A reference',
    body: 'Tap to open that passage in the reader. The trail in the top bar brings you back.',
  },
  {
    id: 'commentary-enoch-pages',
    area,
    target: '.commentary-reader .enoch-nav',
    title: 'Chapter by chapter',
    body: 'Step through the Book of Enoch a chapter at a time.',
  },
];
