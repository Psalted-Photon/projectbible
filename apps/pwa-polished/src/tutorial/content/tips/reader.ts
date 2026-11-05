/**
 * Dots in the text itself: the words, and the little markers beside verses.
 * Also the English line under Greek or Hebrew, and Read Aloud's floating
 * players and its button on commentary and devotionals.
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
    id: 'reader-verse-number',
    area,
    target: '.verse-number',
    title: 'Tap a verse number',
    body: 'Selects the whole verse. The ring then adds Translation, to read it in another Bible, and Connections. Tap Extend and then another number to add that verse too.',
  },
  {
    id: 'reader-ot-quote',
    area,
    target: '.ot-quote-mark',
    title: 'From the Old Testament',
    body: 'Gold means this verse quotes the Old Testament, and silver means it echoes it. Tap to read that passage in the Septuagint, the Greek Old Testament.',
  },
  {
    id: 'reader-english-line',
    area,
    target: '.verse-english, .companion-line',
    title: 'The verse in English',
    body: 'The same verse in English, under the Greek or Hebrew. In the reader, it’s switched by the arrow beside Interlinear. In a list of verses, it’s switched by the English button.',
  },
  {
    id: 'english-chip',
    area,
    target: '.english-chip',
    title: 'English',
    body: 'Shows each Greek or Hebrew verse in English underneath. It’s one switch for every list.',
  },
  {
    id: 'reader-read-this-aloud',
    area,
    target: '.rat-btn',
    title: 'Read this aloud',
    body: 'Hear this commentary or devotional in your Read Aloud voice. A small player comes up with the controls.',
  },
  {
    id: 'player-floating',
    area,
    target: '.fbp .grip',
    corner: 'top-left',
    title: 'The player, pulled out',
    body: 'Every Read Aloud control, out of the top bar. Drag it by anything that isn’t a button and leave it anywhere, and it stays out for your next reading too. Drag these dots back to the bar to put it away.',
  },
  {
    id: 'player-floating-text',
    area,
    target: '.ftp .grip',
    corner: 'top-left',
    title: 'The reading player',
    body: 'Step back or forward a paragraph, pause, or stop. Drag it by anything that isn’t a button, and it stays where you leave it.',
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
    id: 'reader-book-intro-info',
    area,
    target: '.chapter-tools .book-intro-info',
    title: 'About this book',
    body: 'The book’s introduction, from any chapter: who wrote it, when, and why.',
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
