/**
 * Dots in the Connections window, and on the small picture of a chapter's links
 * under its title in the reader.
 *
 * The bar's buttons are told apart only by their labels.
 */

import type { Tip } from '../types';

const area = 'Connections';

function button(id: string, label: string | string[], title: string, body: string): Tip {
  return { id, area, target: '.connections .nav .btn', text: label, exact: true, title, body };
}

export const CONNECTIONS_TIPS: Tip[] = [
  {
    id: 'connections-tabs',
    area,
    target: '.connections .tabs',
    corner: 'top-left',
    title: 'Four pictures',
    body: 'The same cross-references, four ways. Arcs sweeps them across the whole Bible. Grid sets every book against every other. Detail opens two books or groups, chapter by chapter. Chord puts the books in a ring, with ribbons between them.',
  },
  button(
    'connections-range',
    'Select range',
    'Select range',
    'Turn this on, then drag along the line to light a stretch of chapters and their arcs.',
  ),
  button(
    'connections-sets',
    ['Sets', 'View'],
    'Sets and View',
    'On Arcs, Sets are groups of passages you build or pick ready-made, each in its own color. On the other tabs, View changes how the lines look. Both can save a view to come back to.',
  ),
  button('connections-image', 'Image', 'Image', 'Save or share this picture as an image.'),
  button('connections-whole', ['Whole Bible', 'Whole'], 'Whole Bible', 'Zoom back out to the whole picture.'),
  {
    id: 'connections-strip',
    area,
    target: '.connections-strip',
    needs: 'connections',
    title: 'This chapter’s connections',
    body: 'A small picture of this chapter’s cross-references. Tap it to open them in Connections. You can turn it off in Reader settings.',
  },
];
