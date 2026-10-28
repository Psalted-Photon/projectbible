/**
 * Open a notebook page in Notes from anywhere: a transcript's "Open" button,
 * say. An open Notes window turns to the page (NotesPane listens for
 * OPEN_NOTES_PAGE); with none open, a new one opens on it.
 */

import { get } from 'svelte/store';
import { windowStore } from './stores/windowStore';
import { openWindowOfType } from './windowTypes';

export const OPEN_NOTES_PAGE = 'openNotesPage';

/** Sent when something other than the editor wrote on a page, so a Notes list showing it can refresh. */
export const NOTES_PAGE_WRITTEN = 'notesPageWritten';

export interface NotesPageRef {
  notebookId: string;
  pageId: string;
}

export function openNotesPage(page: NotesPageRef): void {
  if (get(windowStore).some((w) => w.contentType === 'notes')) {
    window.dispatchEvent(new CustomEvent<NotesPageRef>(OPEN_NOTES_PAGE, { detail: page }));
    return;
  }
  openWindowOfType('notes', { view: 'editor', target: { kind: 'page', ...page } });
}
