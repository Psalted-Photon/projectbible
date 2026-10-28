/**
 * openTimelineWindow.ts
 *
 * Hand an event, reign or life to the Timeline window, which moves the strip
 * to it and opens its card, the way its own search does. A voice command
 * ("when did the exodus happen") is what sends it.
 *
 * As with the map and Connections, there is only ever one window for it: a
 * second send reuses the open one rather than spending another of the six
 * slots on a copy.
 */

import { get } from 'svelte/store';
import { windowStore } from './stores/windowStore';
import { openWindowOfType } from './windowTypes';

/**
 * An item sent to the window. The pane clears it once it has shown it, so a
 * reload never sends it again; `seq` tells two sends of the same item apart.
 */
export interface TimelineTarget {
  seq: number;
  itemId: string;
}

/** Show this item on the Timeline, opening the window if it isn't up. False at the six-window cap, after saying so. */
export function openTimelineWindow(itemId: string): boolean {
  const target: TimelineTarget = { seq: Date.now(), itemId };
  const existing = get(windowStore).find((w) => w.contentType === 'timeline');
  if (existing) {
    windowStore.updateContentState(existing.id, { target });
    return true;
  }
  return openWindowOfType('timeline', { target });
}
