/**
 * openConnectionsWindow.ts
 *
 * Hand a chapter from the reader strip, or the verses selected in the reader,
 * to the Connections window, which shows them on the Arcs tab, lit, with their
 * card (roadmap Connections, Phase 8).
 *
 * The strip is a small picture of that same view, so tapping it opens the full
 * one. As with the map, there is only ever one window for it: a second tap
 * reuses the open window rather than spending another of the six slots on a
 * copy of a picture the reader has already set up.
 */

import { get } from 'svelte/store';
import { windowStore } from './stores/windowStore';
import { dockEdge, DOCK_SIZE } from './dockEdge';
import { showWindowLimitNotice } from './windowTypes';

/**
 * A chapter, or verses of one, sent to the window. The pane clears it once it
 * has lit them, so a reload never sends it again; `seq` tells two sends of the
 * same passage apart. The verses are in English numbering, the way the
 * connections are counted.
 */
export interface ConnectionsTarget {
  seq: number;
  book: string;
  chapter: number;
  verses?: number[];
}

/**
 * Show this chapter lit on the Connections window's Arcs tab, or just these
 * verses of it when some are given, opening the window if it isn't already up.
 * Returns false at the six-window cap, after saying so.
 */
export function openConnectionsWindow(book: string, chapter: number, verses?: number[]): boolean {
  const target: ConnectionsTarget = { seq: Date.now(), book, chapter };
  if (verses?.length) target.verses = verses;

  const existing = get(windowStore).find((w) => w.contentType === 'connections');
  if (existing) {
    windowStore.updateContentState(existing.id, { target });
    return true;
  }

  const id = windowStore.createWindow(dockEdge(), DOCK_SIZE);
  if (!id) {
    showWindowLimitNotice();
    return false;
  }
  windowStore.setWindowContent(id, 'connections', { tab: 'arcs', target });
  return true;
}
