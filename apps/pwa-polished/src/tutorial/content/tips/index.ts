/**
 * Every dot, in the order they claim a spot: when two would land on top of
 * each other, the one listed first wins. Popups and the ring come first
 * because they sit over everything else.
 */

import type { Tip } from '../types';
import { SELECTION_TIPS } from './selection';
import { POPUP_TIPS } from './popups';
import { NAVBAR_TIPS } from './navbar';
import { READER_TIPS } from './reader';

export const ALL_TIPS: Tip[] = [...POPUP_TIPS, ...SELECTION_TIPS, ...NAVBAR_TIPS, ...READER_TIPS];

/** The one dot that isn't on an element: slide a window out from an edge. */
export const EDGE_TIP: Tip = {
  id: 'edge-window',
  area: 'Edges',
  target: '',
  title: 'Slide out a window',
  body: 'Drag in from a glowing edge to open a window beside the text: a second Bible, notes, a map, commentary and more.',
};
