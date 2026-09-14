/**
 * Dots in the Notes and Journal windows, and in the writing area they share
 * with the note popup.
 */

import type { Tip } from '../types';

const area = 'Writing';

export const WRITING_TIPS: Tip[] = [
  // The shared writing area
  {
    id: 'editor-reference',
    area,
    target: '.lexical-editor .bible-ref',
    title: 'A verse reference',
    body: 'References you type, like John 3:16, turn into links. Tap one to read the verse right there, or go to it.',
  },
  {
    id: 'editor-toolbar',
    area,
    target: '.lexical-editor .toolbar',
    corner: 'top-left',
    title: 'Formatting',
    body: 'Bold, italics, alignment, text size, and the colors and typeface of this page.',
  },
  {
    id: 'editor-hide-toolbar',
    area,
    target: '.lexical-editor .bumper-pill',
    title: 'Hide the toolbar',
    body: 'Tuck the formatting bar away for more room to write. Tap again to bring it back.',
  },
  {
    id: 'reference-popover',
    area,
    target: '.ref-popover',
    title: 'The verse, right here',
    body: 'Show the verse’s text without leaving your page, or go to it in the reader.',
  },

  // Notes
  {
    id: 'sign-in-first',
    area,
    target: '.auth-wall-btn',
    title: 'Sign in first',
    body: 'This is kept with your account, so it follows you from device to device.',
  },
  {
    id: 'notes-new',
    area,
    target: '.notes-pane .primary-btn',
    title: 'New note',
    body: 'A note of your own, not tied to a verse. It goes in your Quick Notes notebook.',
  },
  {
    id: 'notes-verse-notes',
    area,
    target: '.notes-pane .section-label',
    text: 'Verse Notes',
    exact: true,
    title: 'Verse notes',
    body: 'Every note you’ve written on a verse, by book and chapter.',
  },
  {
    id: 'notes-notebooks',
    area,
    target: '.notes-pane .section-label',
    text: 'Notebooks',
    exact: true,
    title: 'Notebooks',
    body: 'Keep your own notes in notebooks, each with as many pages as you like.',
  },
  {
    id: 'notes-new-notebook',
    area,
    target: '.notes-pane .ghost-btn',
    title: 'New notebook',
    body: 'Start a notebook for a study, a sermon series, anything.',
  },
  {
    id: 'notes-new-page',
    area,
    target: '.notes-pane .row-btn[title="New page"]',
    title: 'New page',
    body: 'Add a page to this notebook.',
  },
  {
    id: 'notes-notebook-options',
    area,
    target: '.notes-pane .row-btn[title="Notebook options"]',
    title: 'Notebook options',
    body: 'Rename the notebook, or delete it.',
  },
  {
    id: 'notes-go-to-verse',
    area,
    target: '.notes-pane .icon-btn[title="Go to this verse"]',
    title: 'Go to the verse',
    body: 'Opens the verse this note is about in the reader.',
  },

  // Journal
  {
    id: 'journal-days',
    area,
    target: '.journal-nav button[aria-label="Previous day"]',
    title: 'Day by day',
    body: 'Each day has its own entry. The arrows step back and forward a day.',
  },
  {
    id: 'journal-date',
    area,
    target: '.journal-nav input[type="date"]',
    title: 'Pick a day',
    body: 'Jump to any day’s entry.',
  },
  {
    id: 'journal-today',
    area,
    target: '.journal-nav button[aria-label="Jump to today"]',
    title: 'Today',
    body: 'Back to today’s entry.',
  },
  {
    id: 'journal-title',
    area,
    target: '.journal-nav .title-input',
    title: 'A title',
    body: 'Give the day’s entry a title, if you like.',
  },
];
