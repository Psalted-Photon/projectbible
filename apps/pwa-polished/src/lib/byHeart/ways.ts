/**
 * What By Heart calls things, and the words that say what each one is. Every
 * screen reads its names from here, so a name only ever changes in one place.
 * The mode ids stay as they were, since a saved game is stored under them.
 */

import type { GameMode } from './game';
import type { Stage } from './schedule';

export const STAGE_NAMES: Record<Stage, string> = { new: 'New', learning: 'Learning', known: 'Known' };

export interface Way {
  name: string;
  line: string;
}

/** A way of playing a verse. `how` is its card, up the first time it is played and from its name after that. */
export interface GameWay extends Way {
  how: string;
}

export const WAYS: Record<GameMode, GameWay> = {
  build: {
    name: 'Phrase by Phrase',
    line: 'Learn it in pieces: read a phrase, fill in the gaps, then say it from memory.',
    how:
      'Go one phrase at a time. Read it out, fill in the missing words, then say it with nothing showing. At the end ' +
      'you say the whole verse from memory, and that part is your score. You just saw the words, so it doesn’t count ' +
      'toward Known or Overall.',
  },
  focus: {
    name: 'Clear the Blur',
    line: 'The words are blurred and sharpen as you say them.',
    how:
      'Every word starts blurred. Tap the mic and say the verse, and each word clears as you get it. If a word won’t ' +
      'take, tap it. Show me is a quick peek that lowers your score, and I said it counts as right.',
  },
  flashcards: {
    name: 'Flashcards',
    line: 'See the reference and say the verse, or see the first words and finish it.',
    how:
      'You get one of two sides. See the reference and say the whole verse, or see the first few words, then say the ' +
      'reference and the rest. Tap the mic when you’re ready.',
  },
  call: {
    name: 'Call and Response',
    line: 'A voice reads part of the verse, then you say all of it.',
    how: 'A voice reads part of the verse, and the mic stays off while it speaks. Then tap the mic and say the whole verse, start to finish.',
  },
  recital: {
    name: 'Recital',
    line: 'Nothing shows. Say it all from memory and see how you did at the end.',
    how:
      'Nothing clears as you go. Tap the mic and say the whole verse from memory. At the end you’ll see any words it ' +
      'missed, and you can tap one if you did say it.',
  },
  weak: {
    name: 'Weak Spots',
    line: 'Just the words you miss most, across all your verses.',
    how: 'You get the phrase around a word you’ve missed. Each time you say it without Show me, that word gets closer to coming off your list.',
  },
  silent: {
    name: 'In Your Head',
    line: 'No mic needed. Think it through, reveal it, and rate yourself.',
    how: 'Go through the verse in your head, then tap Reveal and check yourself. Pick how it went, from Missed to Got It, and that’s your score.',
  },
};

/** The ways to practice one verse, from the most help to the least. */
export const PRACTICE_ORDER: GameMode[] = ['build', 'focus', 'flashcards', 'call', 'recital', 'silent'];

export const STUDY: Way = {
  name: 'Study',
  line: 'Read it and listen to it. No score.',
};

export const PRACTICE: Way = {
  name: 'Practice',
  line: 'Test yourself and get a score, which decides when the verse comes back.',
};

export const TODAYS_PRACTICE: Way = {
  name: "Today's Practice",
  line: 'The app picks the right practice for each verse due.',
};

export const SWORD_DRILL: Way = {
  name: 'Sword Drill',
  line: "A timed game using all your verses. Doesn't change your verse scores.",
};

export const ADD_VERSE = 'Add verse';

/** Beside a score that was rated by the user rather than heard by the mic. */
export const SILENT_MARK = 'Scored in your head';
