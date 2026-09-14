/**
 * Dots in the text itself: the words, and the little markers beside verses.
 */

import type { Tip } from '../types';

const area = 'Reader';

export const READER_TIPS: Tip[] = [
  {
    id: 'reader-tap-a-word',
    area,
    target: '.verse-text',
    title: 'Tap a word',
    body: 'Tap any word to look it up, highlight it, add a note or share the verse. To pick several words, press and drag across them, or tap one and then Extend.',
  },
  {
    id: 'reader-book-intro',
    area,
    target: '.book-intro-btn',
    needs: 'commentaries',
    title: 'Book introduction',
    body: 'An introduction to the whole book, from KingComments.',
  },
  {
    id: 'reader-intro-repeat',
    area,
    target: '.intro-repeat-pill',
    title: 'A word you’re tracking',
    body: 'Tap to highlight every time it appears in this chapter or book, or to clear it.',
  },
  {
    id: 'reader-read-aloud',
    area,
    target: '.tts-play-btn',
    title: 'Read Aloud',
    body: 'Hear the chapter read to you. It can carry on into the next chapter by itself.',
  },
  {
    id: 'reader-commentary-badge',
    area,
    target: '.anno-icon',
    needs: 'commentaries',
    title: 'Commentary badge',
    body: 'That commentator wrote about this verse, in their own color. Tap to read it.',
  },
  {
    id: 'reader-cross-reference',
    area,
    target: '.anno-ref',
    needs: 'tsk-references',
    title: 'Cross-references',
    body: 'Tap to see the passages this verse links to.',
  },
  {
    id: 'reader-art',
    area,
    target: '.art-icon',
    needs: 'biblical-art',
    title: 'A painting',
    body: 'An old master painted this scene. Tap to see it full screen.',
  },
  {
    id: 'reader-footnote',
    area,
    target: '.inline-footnote',
    title: 'Footnote',
    body: 'The translators’ note on this spot. Tap to read it.',
  },
  {
    id: 'reader-note-reference',
    area,
    target: '.inline-xref',
    title: 'Related passage',
    body: 'A passage the translators point to from here. Tap to read it without losing your place.',
  },
  {
    id: 'reader-your-note',
    area,
    target: '.verse-note-icon',
    title: 'Your note',
    body: 'You wrote a note on this verse. Tap to open it.',
  },
  {
    id: 'reader-plan',
    area,
    target: '.plan-continue-row, .harmony-btn-row',
    title: 'Your reading plan',
    body: 'This is today’s reading. Tick it off here, or carry straight on to the next passage.',
  },
];
