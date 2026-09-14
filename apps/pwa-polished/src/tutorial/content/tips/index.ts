/**
 * Every dot, in the order they claim a spot: when two would land on top of
 * each other, the one listed first wins. Popups and the ring come first
 * because they sit over everything else, then panes and windows, which sit
 * over the reader.
 */

import type { Tip } from '../types';
import { SELECTION_TIPS } from './selection';
import { POPUP_TIPS } from './popups';
import { NAVBAR_TIPS } from './navbar';
import { READER_TIPS } from './reader';
import { PANE_TIPS } from './panes';
import { WINDOW_TIPS } from './windows';
import { COMMENTARY_TIPS } from './commentary';
import { MAP_TIPS } from './map';
import { WRITING_TIPS } from './writing';
import { LIBRARY_TIPS } from './library';
import { ART_TIPS } from './art';
import { MODAL_TIPS } from './modals';

export const ALL_TIPS: Tip[] = [
  ...POPUP_TIPS,
  ...MODAL_TIPS,
  ...SELECTION_TIPS,
  ...PANE_TIPS,
  ...WINDOW_TIPS,
  ...COMMENTARY_TIPS,
  ...MAP_TIPS,
  ...WRITING_TIPS,
  ...LIBRARY_TIPS,
  ...ART_TIPS,
  ...NAVBAR_TIPS,
  ...READER_TIPS,
];

/** The one dot that isn't on an element: slide a window out from an edge. */
export const EDGE_TIP: Tip = {
  id: 'edge-window',
  area: 'Edges',
  target: '',
  title: 'Slide out a window',
  body: 'Drag in from a glowing edge to open a window beside the text: a second Bible, notes, a map, commentary and more.',
};
