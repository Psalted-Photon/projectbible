/**
 * barSize.ts
 *
 * Bar size: Small, Normal or Large, set in Settings → Appearance. Per device,
 * like the pin: a phone held close and a desktop across the room want
 * different sizes of the same bar.
 *
 * The size is one number, the scale. It goes onto :root as `--bar-scale`, which
 * every bar, header and tab strip multiplies its sizes by, and into the
 * `barScale` store for the code that measures in pixels: the navigation bar's
 * contour and clock, the reader's hide distance and the tutorial's clearance.
 */

import { writable } from 'svelte/store';
import { getSettings } from '../adapters/settings';

export type BarSize = 'small' | 'normal' | 'large';

export const BAR_SIZES: { value: BarSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
];

const SCALE: Record<BarSize, number> = { small: 0.85, normal: 1, large: 1.2 };

export function scaleFor(size: BarSize | undefined): number {
  return SCALE[size ?? 'normal'] ?? 1;
}

/** The current scale. 1 is Normal. */
export const barScale = writable<number>(scaleFor(getSettings().navBarSize));

/** Put a size on the page: the CSS variable and the store together. */
export function applyBarSize(size: BarSize | undefined): void {
  const s = scaleFor(size);
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--bar-scale', String(s));
  }
  barScale.set(s);
}
