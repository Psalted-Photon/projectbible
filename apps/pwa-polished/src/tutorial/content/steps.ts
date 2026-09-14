/**
 * Tour steps used in more than one place.
 */

import { get } from 'svelte/store';
import type { TourStep } from './types';
import { edgeLane, freeEdge, dirWord } from '../engine/edges';
import { windowStore } from '../../lib/stores/windowStore';

/** "Drag in from the glowing edge", finished when a new window appears. */
export function slideOutWindowStep(id: string): TourStep {
  return {
    id,
    skipIf: () => !freeEdge(),
    onEnter: (ctx) => {
      ctx.tour.windowEdge = freeEdge();
      ctx.tour.windowIdsBefore = get(windowStore).map((w) => w.id);
    },
    lane: (ctx) => (ctx.tour.windowEdge ? edgeLane(ctx.tour.windowEdge) : null),
    doneWhen: (ctx) => {
      const added = get(windowStore).find((w) => !ctx.tour.windowIdsBefore.includes(w.id));
      if (added) ctx.tour.windowId = added.id;
      return !!added;
    },
    title: 'Slide out a window',
    body: (ctx) =>
      `Put your finger on the glowing edge and drag ${dirWord(ctx.tour.windowEdge ?? 'right')}. A window slides out: a second Bible, notes, a map, commentary and more.`,
  };
}
