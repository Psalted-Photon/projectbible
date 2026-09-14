/**
 * Dots on the windows that slide out from the screen edges: their frame, and
 * the tiles a new window offers before it has anything in it.
 */

import type { Tip } from '../types';

const area = 'Windows';

function tile(type: string, title: string, body: string, needs?: string): Tip {
  return { id: `tile-${type}`, area, target: `.content-selector .content-button.${type}`, title, body, needs };
}

export const WINDOW_TIPS: Tip[] = [
  {
    id: 'window-resize',
    area,
    // The grip runs along the window's inner edge, and covers the title bar on
    // a window docked at the bottom.
    target: '.panel > .resize-handle',
    corner: 'center',
    title: 'Resize',
    body: 'Drag this edge to make the window bigger or smaller. Keep dragging past its smallest size to close it.',
  },
  {
    id: 'window-dock',
    area,
    target: '.panel .edge-buttons',
    title: 'Move it',
    body: 'Dock the window to another side of the screen.',
  },

  tile('bible', 'Bible', 'Another Bible beside this one: a different translation, or a second passage to compare.'),
  tile('map', 'Map', 'The Historical Map: every place the Bible names, across sixteen eras.', 'atlas-map'),
  tile('commentaries', 'Commentary', 'Read the commentators on the chapter you’re in. It can follow along as you read.', 'commentaries'),
  tile('notes', 'Notes', 'All your notes on verses, in one place.'),
  tile('journal', 'Journal', 'A dated journal with a calendar. Verse references you type become links.'),
  tile('isbe', 'Encyclopedia', 'The Bible encyclopedia, A–Z: people, places, customs and ideas.', 'encyclotopical'),
  tile('naves', 'Topical', 'Nave’s topical index: every passage on a subject, from mercy to fasting.', 'encyclotopical'),
  tile('person', 'People', 'Every named person in the Bible, with their family, dates and verses.', 'people-biblical-v1'),
  tile('art', 'Art', 'Paintings of Bible scenes by the old masters.', 'biblical-art'),
];
