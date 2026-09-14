/**
 * Where the lime dots go.
 *
 * A tip gets a dot on the first thing matching it that is on screen and
 * actually on top -- not scrolled away, not clipped by a scrolling bar, not
 * under a modal or a pane. "On top" is asked of the browser directly: whatever
 * it would hand a tap at the middle of the target has to be the target itself
 * (or something inside it).
 */

import type { Tip, DotCorner } from '../content/types';
import type { Box } from './targets';

export interface Spot {
  tip: Tip;
  el: Element;
  /** The dot's centre, in screen coordinates. */
  x: number;
  y: number;
}

/** Keeps a dot's glow inside the screen. */
const SCREEN_MARGIN = 10;

function inTutorial(el: Element): boolean {
  return !!el.closest('.tut-root');
}

/** Every match for a tip, main reader first, then docked windows and the rest. */
export function candidates(tip: Tip): Element[] {
  let all: Element[];
  try {
    all = Array.from(document.querySelectorAll(tip.target));
  } catch {
    // A mistyped selector in a tip file shows no dot; `__tutorial` lists it.
    return [];
  }
  const needles = tip.text === undefined ? null : (Array.isArray(tip.text) ? tip.text : [tip.text]).map((t) => t.toLowerCase());
  const matches = all.filter((el) => {
    if (inTutorial(el)) return false;
    if (!needles) return true;
    const label = (el.textContent ?? '').trim().toLowerCase();
    return needles.some((n) => (tip.exact ? label === n : label.includes(n)));
  });
  const main = matches.filter((el) => el.closest('.main-content'));
  return main.length === matches.length
    ? matches
    : [...main, ...matches.filter((el) => !el.closest('.main-content'))];
}

/**
 * The first line box of an element. For text that wraps -- a verse -- the
 * whole bounding box is mostly other lines, and its middle can fall between
 * words; the first line is what the dot should sit on.
 */
export function firstBox(el: Element): Box | null {
  for (const r of Array.from(el.getClientRects())) {
    if (r.width > 0 && r.height > 0) return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return null;
}

/** The browser would hand a tap in the middle of this box to `el`. */
export function uncovered(el: Element, box: Box): boolean {
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
  const top = document.elementsFromPoint(x, y).find((hit) => !inTutorial(hit));
  return !!top && (top === el || el.contains(top));
}

function dotAt(box: Box, corner: DotCorner = 'top-right'): { x: number; y: number } {
  const right = corner.endsWith('right');
  const bottom = corner.startsWith('bottom');
  const x = corner === 'center' ? box.left + box.width / 2 : right ? box.left + box.width - 2 : box.left + 2;
  const y = corner === 'center' ? box.top + box.height / 2 : bottom ? box.top + box.height - 2 : box.top + 2;
  return {
    x: Math.min(Math.max(x, SCREEN_MARGIN), window.innerWidth - SCREEN_MARGIN),
    y: Math.min(Math.max(y, SCREEN_MARGIN), window.innerHeight - SCREEN_MARGIN),
  };
}

/** Where this tip's dot goes right now, if anywhere. */
export function locateTip(tip: Tip): Spot | null {
  for (const el of candidates(tip)) {
    const box = firstBox(el);
    if (!box) continue;
    if (box.top + box.height <= 0 || box.top >= window.innerHeight) continue;
    if (box.left + box.width <= 0 || box.left >= window.innerWidth) continue;
    if (!uncovered(el, box)) continue;
    return { tip, el, ...dotAt(box, tip.corner) };
  }
  return null;
}

/** Every dot for the current screen, one per tip. */
export function locateAll(tips: Tip[]): Spot[] {
  const spots: Spot[] = [];
  for (const tip of tips) {
    const spot = locateTip(tip);
    if (spot) spots.push(spot);
  }
  return spots;
}

/** Dots at least this close to one another (centre to centre) share one dot. */
const CLUSTER_GAP = 44;

/** Several tips close together, drawn as one numbered dot. */
export interface Cluster {
  /** In reading order: top to bottom, then left to right. */
  spots: Spot[];
  x: number;
  y: number;
}

function readingOrder(a: Spot, b: Spot): number {
  return Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x;
}

/**
 * Gather dots that sit close together.
 *
 * A row of buttons a finger-width apart -- the top bar on a phone, the seats
 * of the word ring -- would otherwise wear a row of dots, each one's tap area
 * eating into the button beside it. Close dots chain: if A is near B and B is
 * near C, all three share one dot, placed where the first of them would be.
 */
export function clusterSpots(spots: Spot[]): Cluster[] {
  const groups: Spot[][] = [];
  for (const spot of spots) {
    const near = groups.filter((g) => g.some((o) => Math.hypot(o.x - spot.x, o.y - spot.y) < CLUSTER_GAP));
    const merged = [...near.flat(), spot];
    for (const g of near) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups.map((group) => {
    const ordered = [...group].sort(readingOrder);
    return { spots: ordered, x: ordered[0].x, y: ordered[0].y };
  });
}

/** One row per tip, for `__tutorial.tips()` in the console. */
export function diagnose(tips: Tip[]): Array<Record<string, string | number | boolean>> {
  const shown = new Set(locateAll(tips).map((s) => s.tip.id));
  return tips.map((tip) => ({
    id: tip.id,
    area: tip.area,
    matches: candidates(tip).length,
    dot: shown.has(tip.id),
    needs: tip.needs ?? '',
  }));
}
