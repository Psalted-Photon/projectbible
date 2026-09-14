/**
 * Dots on the word ring (and the classic toolbar, for people who picked it in
 * Settings).
 *
 * The ring's seats are told apart only by their labels. The two layouts share
 * most of them; where they differ ("Mark" and "Highlight"), both are listed.
 */

import type { Tip } from '../types';

const area = 'Selection';
const BUTTONS = '.toast .seat, .toast .action-btn';

export const SELECTION_TIPS: Tip[] = [
  {
    id: 'ring-define',
    area,
    target: BUTTONS,
    text: 'Define',
    needs: 'dictionary-en',
    title: 'Define',
    body: 'Looks the word up in the dictionary.',
  },
  {
    id: 'ring-bio',
    area,
    target: BUTTONS,
    text: 'Bio',
    needs: 'people-biblical-v1',
    title: 'Bio',
    body: 'This word is a person. See who they were, their family, and every verse they appear in.',
  },
  {
    id: 'ring-info',
    area,
    target: BUTTONS,
    text: 'Info',
    needs: 'encyclotopical',
    title: 'Info',
    body: 'The encyclopedia has an article on this: a place, a custom or a topic.',
  },
  {
    id: 'ring-map',
    area,
    target: BUTTONS,
    text: 'Map',
    needs: 'atlas-map',
    title: 'Map',
    body: 'Shows this place on the Historical Map.',
  },
  {
    id: 'ring-speak',
    area,
    target: BUTTONS,
    text: 'Speak',
    title: 'Speak',
    body: 'Hear the word said aloud in the original language.',
  },
  {
    id: 'ring-search',
    area,
    target: BUTTONS,
    text: 'Search',
    title: 'Search',
    body: 'Search for these words everywhere.',
  },
  {
    id: 'ring-mark',
    area,
    target: BUTTONS,
    text: ['Mark', 'Highlight'],
    title: 'Highlight',
    body: 'Color the words like a highlighter, change their color, or underline them. Highlights are kept with your account.',
  },
  {
    id: 'ring-notes',
    area,
    target: BUTTONS,
    text: 'Notes',
    title: 'Notes',
    body: 'Write a note on this verse. Notes are kept with your account, so it asks you to sign in first.',
  },
  {
    id: 'ring-share',
    area,
    target: BUTTONS,
    text: 'Share',
    title: 'Share',
    body: 'Copy or send the verse, with its translation and a link back to it.',
  },
  {
    id: 'ring-repeats',
    area,
    target: BUTTONS,
    text: 'Repeats',
    title: 'Repeats',
    body: 'Track this word. A pill in the top bar counts it, and can highlight every time it comes up.',
  },
  {
    id: 'ring-extend',
    area,
    target: BUTTONS,
    text: ['Extend', 'Tap'],
    title: 'Extend',
    body: 'Tap this, then tap another word, and the selection stretches to it. You can also press and drag across words before the ring comes up.',
  },
  {
    id: 'ring-word-or-verse',
    area,
    target: '.toast .mode-seat, .toast .toggle-btn',
    title: 'Word or verse',
    body: 'Switch between the words you picked and the whole verse.',
  },
];
