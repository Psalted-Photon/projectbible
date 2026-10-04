/**
 * openMapWindow.ts
 *
 * Hand a place — or a person's places — to the standalone map window.
 *
 * This is deliberately not the "pin beside the reader" move the Encyclopedia,
 * Topical, Dictionary and Bio headers make. Those take the card you are looking
 * at and dock it unchanged. This one is a handoff between two different
 * surfaces: the Map tab is a single marker and nothing else, while the map
 * window carries the base-layer control, the historical boundary overlays and a
 * place search across four gazetteers. So the button means "take this place to
 * the real map", and the tab stays the quick look.
 *
 * There is only ever one map window. Sending a second place reuses the open one
 * and flies it there, rather than spending another of the six window slots on a
 * duplicate of a map the reader has already positioned and chosen layers for.
 */

import { get } from 'svelte/store';
import { windowStore, type MapMarker, type MapTarget } from './stores/windowStore';
import { dockEdge, DOCK_SIZE } from './dockEdge';

/** Bumped per handoff so the map can tell a fresh send from its own pan write. */
let handoffSeq = 0;

/**
 * Show these markers on the map window, opening it if it isn't already up.
 *
 * Returns false when there was nowhere to put it — no located markers, or the
 * six-window cap already reached. Callers use that to leave whatever they were
 * showing in place rather than closing it onto nothing.
 */
export function openMapWindow(label: string, markers: MapMarker[], opts: { year?: number } = {}): boolean {
  const located = markers.filter(
    (m) => m.latitude != null && m.longitude != null && Number.isFinite(m.latitude) && Number.isFinite(m.longitude),
  );
  // A year alone is still somewhere to go: the map moves to that era.
  const year = opts.year != null && Number.isFinite(opts.year) ? opts.year : undefined;
  if (!located.length && year === undefined) return false;

  const target: MapTarget = { seq: ++handoffSeq, label, markers: located, ...(year !== undefined ? { year } : {}) };

  const existing = get(windowStore).find((w) => w.contentType === 'map');
  if (existing) {
    windowStore.updateContentState(existing.id, { target });
    return true;
  }

  const id = windowStore.createWindow(dockEdge(), DOCK_SIZE);
  if (!id) return false; // At the six-window cap.

  // Centre is seeded from the first marker so the map opens looking at roughly
  // the right part of the world, then applyTarget flies it the rest of the way.
  // With no places, it opens on the lands of the Bible and the era does the rest.
  windowStore.setWindowContent(id, 'map', {
    center: (located.length ? [located[0].latitude, located[0].longitude] : [31.8, 35.2]) as [number, number],
    zoom: located.length ? 8 : 5,
    target,
  });
  return true;
}
