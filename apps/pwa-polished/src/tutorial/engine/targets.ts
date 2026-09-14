/**
 * Finding the things the tutorial points at, and where they are on screen.
 *
 * Everything is looked up by the class names and labels the app already has --
 * the tutorial adds no hooks of its own to app components. When the app's
 * markup changes and a lookup stops matching, the step simply waits and then
 * falls back to a plain card; nothing breaks.
 */

/** A rectangle in screen (viewport) coordinates. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.left + b.width);
    bottom = Math.max(bottom, b.top + b.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function padBox(box: Box, pad: number): Box {
  return {
    left: box.left - pad,
    top: box.top - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
}

export function hasSize(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * The first element matching `selector` that is actually laid out. With `text`,
 * only one whose visible text contains it (case-insensitive) -- for the rows
 * whose only distinguishing mark is their label, like Settings section headers.
 */
export function find(selector: string, text?: string): HTMLElement | null {
  const needle = text?.toLowerCase();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (!hasSize(el)) continue;
    if (needle && !(el.textContent ?? '').toLowerCase().includes(needle)) continue;
    return el;
  }
  return null;
}

/** Some part of the box is inside the screen. */
export function onScreen(box: Box): boolean {
  return (
    box.width > 0 &&
    box.height > 0 &&
    box.left + box.width > 0 &&
    box.top + box.height > 0 &&
    box.left < window.innerWidth &&
    box.top < window.innerHeight
  );
}

/** The whole box is inside the screen. */
function fullyOnScreen(box: Box): boolean {
  return (
    box.left >= 0 &&
    box.top >= 0 &&
    box.left + box.width <= window.innerWidth &&
    box.top + box.height <= window.innerHeight
  );
}

/**
 * Bring an element into view before pointing at it.
 *
 * Two things hide targets. The navbar's button strip scrolls sideways on a
 * phone, so a tool button can be off to the right; scrollIntoView handles that.
 * And the navbar itself slides up out of sight while reading, which no scroll
 * of the bar can undo -- the reader has to scroll up a little, the same signal
 * a person gives it to bring the bar back.
 */
export function reveal(el: HTMLElement, block: 'nearest' | 'center' = 'nearest'): void {
  const navbar = el.closest('.navigation-bar');
  if (navbar && navbar.getBoundingClientRect().bottom <= 8) {
    const reader = navbar.closest('.main-content')?.querySelector<HTMLElement>('.bible-reader');
    reader?.scrollBy({ top: -120, behavior: 'auto' });
  }
  if (block === 'center' ? !comfortablyOnScreen(boxOf(el)) : !fullyOnScreen(boxOf(el))) {
    el.scrollIntoView({ block, inline: 'center', behavior: 'auto' });
  }
}

/** The main reader's copy of something, not a copy inside a docked Bible window. */
export function inMainReader(selector: string, text?: string): HTMLElement | null {
  return find(`.main-content ${selector}`, text);
}

/** Space kept clear at the top and bottom of the screen: the navbar, and a thumb. */
const EDGE_ROOM = 72;

/** On screen with room to spare above and below. */
export function comfortablyOnScreen(box: Box): boolean {
  return box.top >= EDGE_ROOM && box.top + box.height <= window.innerHeight - EDGE_ROOM;
}

/**
 * The main reader's copy of something closest to where the person is reading:
 * the first one comfortably on screen, else the next one further down, else
 * the last one above. For things scattered through the text, like verse badges.
 */
export function nearestInMainReader(selector: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`.main-content ${selector}`)).filter(hasSize);
  if (all.length === 0) return null;
  return (
    all.find((el) => comfortablyOnScreen(boxOf(el))) ??
    all.find((el) => boxOf(el).top >= EDGE_ROOM) ??
    all[all.length - 1]
  );
}
