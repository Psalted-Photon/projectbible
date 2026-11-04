/**
 * By Heart: what a verse's game asks for, one round at a time. Each round is a
 * stretch of the words to say, and whether the reference has to be said with it.
 */

import type { GameMode, SpokenRefMode } from './game';

export interface Round {
  /** The words to say, as positions in the verse. */
  from: number;
  to: number;
  /** Words clear from the start of the round, said or not. */
  shown: number[];
  /** The reference is said before the words, after them, or neither. */
  refStart: boolean;
  refEnd: boolean;
}

export interface RoundOptions {
  mode: GameMode;
  count: number;
  reference: SpokenRefMode;
}

/** The rounds of a game. Whole-verse modes have one. */
export function roundsFor({ count, reference }: RoundOptions): Round[] {
  return [
    {
      from: 0,
      to: count,
      shown: [],
      refStart: reference === 'start' || reference === 'both',
      refEnd: reference === 'end' || reference === 'both',
    },
  ];
}
