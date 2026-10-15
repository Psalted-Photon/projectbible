/**
 * openConnectionsWindow.ts
 *
 * Hand a chapter from the reader strip to the Connections window, which shows
 * it on the Arcs tab, lit, with its card (roadmap Connections, Phase 8).
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
 * A chapter sent to the window. The pane clears it once it has lit the
 * chapter, so a reload never sends it again; `seq` tells two sends of the same
 * chapter apart.
 */
export interface ConnectionsTarget {
  seq: number;
  book: string;
  chapter: number;
}

/**
 * Show this chapter lit on the Connections window's Arcs tab, opening the
 * window if it isn't already up. Returns false at the six-window cap, after
 * saying so.
 */
export function openConnectionsWindow(book: string, chapter: number): boolean {
  const target: ConnectionsTarget = { seq: Date.now(), book, chapter };

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
