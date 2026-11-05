/**
 * Dots in the By Heart window and on its game screen.
 */

import type { Tip } from '../types';

const area = 'By Heart';

export const BY_HEART_TIPS: Tip[] = [
  {
    id: 'byheart-today',
    area,
    target: '.bh-pane .today',
    title: 'Today',
    body:
      'One button for every verse due, shuffled. A new verse is built up phrase by phrase, one you are learning is ' +
      'recited with its words blurred, and one you know takes turns through Flashcards, Call and Response and Recital.',
  },
  {
    id: 'byheart-new',
    area,
    target: '.bh-pane .new',
    title: 'Add a verse',
    body:
      'Pick a passage in the simple reader or from the Verse of the Day list, then design its card, the same way as ' +
      'sharing a verse. A longer passage is saved in parts of about 150 words.',
  },
  {
    id: 'byheart-weak',
    area,
    target: '.bh-pane .drill',
    text: 'Weak Spots',
    title: 'Weak Spots',
    body: 'Drills the phrases around the words you miss most, across all your verses. Each clean pass makes that word one less to drill.',
  },
  {
    id: 'byheart-sword',
    area,
    target: '.bh-pane .drill',
    text: 'Sword Drill',
    title: 'Sword Drill',
    body:
      'The one timed game. A phrase from any saved verse appears and you say the next 3 words. Right answers add ' +
      'seconds and misses take them away. At the end, every phrase shows the words you said in green and the ones ' +
      'you missed in red, with a % score, and your top 10 runs are kept.',
  },
  {
    id: 'byheart-more',
    area,
    target: '.bh-pane .more',
    title: 'Other ways to play',
    body:
      'Tapping a verse recites it in Focus. This menu has the rest: Build, Recital, Flashcards, Call and Response and ' +
      'Silent study, plus editing or sharing its card, and your saved recital if you have one.',
  },
  {
    id: 'byheart-game-card',
    area,
    target: '.bh-game .card',
    corner: 'top-left',
    title: 'Say it out loud',
    body:
      'Words clear as you say them, and only the word you are on is checked. Tap a word it won’t take: Show me is a ' +
      'quick peek and counts as a hint, and I said it counts as right and teaches this verse that mishearing.',
  },
  {
    id: 'byheart-game-settings',
    area,
    target: '.bh-game .tool',
    corner: 'bottom-right',
    title: 'Game settings',
    body:
      'At the top, Out loud or Silent study, for when you can’t speak out loud. Then how blurry the covers are, or ' +
      'black boxes instead. Whether the reference has to be said. Your Own Voice, which keeps your best recital on ' +
      'this device if you turn it on.',
  },
  {
    id: 'byheart-game-mic',
    area,
    target: '.fmic.in-game .mic',
    title: 'The VC button in a game',
    body:
      'A quick tap leaves the mic on until you tap it again. A longer press closes it when you let go. It also closes ' +
      'by itself when the verse ends, on the red X, when you leave the app, or after about 20 seconds of silence.',
  },
];
