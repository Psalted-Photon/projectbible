/**
 * What the Bubbles and the book word clouds are drawn on: Dark (black) or
 * Light (the app's cream). One setting covers both, saved and synced like the
 * Connections Black/Cream switch (settings.bubbleGround). Until it is flipped
 * it follows the reader theme: a pale theme gets Light, the rest Dark.
 */

import { getSettings, updateSettings } from '../../adapters/settings';
import { palette } from '../connections/palette';
import { CREAM } from '../wordmark';

export type BubbleGround = 'dark' | 'light';

export interface GroundColors {
  /** Behind everything. */
  bg: string;
  /** Text that is not a book's color: names, verse numbers. */
  neutral: string;
  /** True on cream, where colors are darkened rather than lightened. */
  light: boolean;
}

export const GROUNDS: Record<BubbleGround, GroundColors> = {
  dark: { bg: '#000000', neutral: '#bdb4a4', light: false },
  light: { bg: CREAM, neutral: '#3a3226', light: true },
};

/** The reader's pick, or the reader theme's when they have not picked. */
export function bubbleGround(): BubbleGround {
  const picked = getSettings().bubbleGround;
  if (picked === 'dark' || picked === 'light') return picked;
  return palette().pale ? 'light' : 'dark';
}

export function setBubbleGround(ground: BubbleGround): void {
  updateSettings({ bubbleGround: ground });
}
