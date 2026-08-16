/**
 * dockEdge.ts
 *
 * Which edge a newly opened window should come in from, and how much room it
 * should take.
 *
 * The rule is the same everywhere in the app: beside the text on a wide screen,
 * under it on a phone. It is decided by orientation rather than a pixel
 * breakpoint, because what matters is which way there is room to spare — a
 * portrait tablet wants the same bottom sheet a portrait phone does.
 *
 * This used to be written out at each call site, which is how App.svelte ended
 * up hardcoding 'right' and two other copies drifted into comparing the
 * operands the other way round. One copy, so the reader learns one behaviour.
 */

import type { WindowEdge } from './stores/windowStore';

/** Half the screen: what every caller has always asked for. */
export const DOCK_SIZE = 50;

export function dockEdge(): WindowEdge {
  if (typeof globalThis.window === 'undefined') return 'right';
  return globalThis.window.innerHeight > globalThis.window.innerWidth ? 'bottom' : 'right';
}
