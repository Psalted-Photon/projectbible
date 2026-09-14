/**
 * Dots inside the reader's popups: highlight, share, a note, a footnote, the
 * annotation sheet and the interlinear layers. They only show while that popup
 * is open, because only then is there anything on top to put them on.
 */

import type { Tip } from '../types';

const area = 'Popups';

export const POPUP_TIPS: Tip[] = [
  // Highlight
  {
    id: 'highlight-repeats',
    area,
    target: '.hl-modal .hl-repeat-toggle',
    title: 'One word, or every repeat',
    body: 'Mark just this word, or every time it repeats.',
  },
  {
    id: 'highlight-marker',
    area,
    target: '.hl-modal .hl-swatch-marker',
    title: 'Marker',
    body: 'Paint behind the words, like a highlighter pen.',
  },
  {
    id: 'highlight-text-color',
    area,
    target: '.hl-modal .hl-swatch-text',
    title: 'Text color',
    body: 'Color the letters themselves instead.',
  },
  {
    id: 'highlight-underline',
    area,
    target: '.hl-modal .hl-swatch-underline',
    title: 'Underline',
    body: 'Underline or box the words, in any color. Mix it with a marker if you like.',
  },
  {
    id: 'highlight-remove',
    area,
    target: '.hl-modal .hl-btn-remove',
    title: 'Remove',
    body: 'Clears the marking from these words.',
  },

  // Share
  {
    id: 'share-include',
    area,
    target: '.sh-modal .sh-toggles',
    title: 'What goes with it',
    body: 'Add the translation’s name, and a link that opens the verse in Hexapla.',
  },
  {
    id: 'share-copy',
    area,
    target: '.sh-modal .sh-btn-copy',
    title: 'Copy',
    body: 'Copies it, ready to paste anywhere.',
  },
  {
    id: 'share-send',
    area,
    target: '.sh-modal .sh-btn-share',
    title: 'Share',
    body: 'Sends it with your device’s own share menu: messages, email and your other apps.',
  },

  // A note
  {
    id: 'note-move',
    area,
    target: '.note-popup .note-header',
    title: 'Move it',
    body: 'Drag this bar to put the note wherever suits you.',
  },
  {
    id: 'note-resize',
    area,
    target: '.note-popup .corner-se',
    corner: 'top-left',
    title: 'Resize it',
    body: 'Drag a bottom corner or a side to make the note bigger or smaller.',
  },

  // Footnotes
  {
    id: 'footnote-go-there',
    area,
    target: '.footnote-card .fc-goto',
    title: 'Go there',
    body: 'Jump to this passage. The trail in the top bar brings you back.',
  },

  // The cross-reference and commentary sheet
  {
    id: 'sheet-tabs',
    area,
    target: '.annotation-panel.open .panel-tabs',
    title: 'Two tabs',
    body: 'Switch between cross-references and commentary for this verse.',
  },
  {
    id: 'sheet-passage',
    area,
    target: '.annotation-panel.open .ref-link-btn',
    title: 'A linked passage',
    body: 'Tap to preview it, and tap the preview to read the whole chapter here.',
  },
  {
    id: 'sheet-back',
    area,
    target: '.panel-back-btn',
    title: 'Back',
    body: 'Returns to where you were in this sheet.',
  },

  // Interlinear layers
  {
    id: 'interlinear-presets',
    area,
    target: '.interlinear-popover .il-presets',
    title: 'Presets',
    body: 'Ready-made sets of layers: Minimal, Study and Scholar.',
  },
  {
    id: 'interlinear-layers',
    area,
    target: '.interlinear-popover .il-layers',
    title: 'Layers',
    body: 'Pick exactly what shows under each word: the English meaning, how it sounds, its dictionary form, its Strong’s number and its grammar.',
  },
];
