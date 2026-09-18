/**
 * The screen edges a window slides out from, as the tutorial draws them.
 */

import { get } from 'svelte/store';
import type { EdgeLane } from '../content/types';
import { windowStore, type DockEdge } from '../../lib/stores/windowStore';
import { dockEdge } from '../../lib/dockEdge';

/** The app's edge-swipe lane is 40px deep (EdgeGestureDetector). */
export const LANE_DEPTH = 40;

/** The app opens no more than this many windows at once. */
export const MAX_WINDOWS = 6;

export function edgeLane(edge: DockEdge): EdgeLane {
  const w = window.innerWidth;
  const h = window.innerHeight;
  switch (edge) {
    case 'right':
      return { edge, box: { left: w - LANE_DEPTH, top: h * 0.3, width: LANE_DEPTH, height: h * 0.4 } };
    case 'left':
      return { edge, box: { left: 0, top: h * 0.3, width: LANE_DEPTH, height: h * 0.4 } };
    case 'top':
      return { edge, box: { left: w * 0.3, top: 0, width: w * 0.4, height: LANE_DEPTH } };
    case 'bottom':
    default:
      // Left of the middle: the centre of the bottom edge is kept free for the
      // phone's own home gesture and never opens a window.
      return { edge: 'bottom', box: { left: w * 0.12, top: h - LANE_DEPTH, width: w * 0.26, height: LANE_DEPTH } };
  }
}

/**
 * Edges a new window could come from, best first: the app's own choice (under
 * the text in portrait, beside it in landscape), then the rest. An edge with a
 * window already docked is left out -- that window covers its lane.
 */
export function freeEdges(): DockEdge[] {
  // Docked windows only. A harmony view's panes are neither counted against the
  // six nor able to take an edge, since they are not docked to one.
  const docked = get(windowStore).filter((w) => !w.transient);
  if (docked.length >= MAX_WINDOWS) return [];
  const taken = new Set(docked.map((w) => w.edge));
  const order: DockEdge[] = [dockEdge(), 'right', 'left', 'bottom', 'top'];
  return order.filter((e, i) => !taken.has(e) && order.indexOf(e) === i);
}

export function freeEdge(): DockEdge | null {
  return freeEdges()[0] ?? null;
}

/** Which way a drag from this edge goes. Only docked edges are ever dragged. */
export function dirWord(edge: DockEdge): string {
  return { right: 'left', left: 'right', bottom: 'up', top: 'down' }[edge];
}
