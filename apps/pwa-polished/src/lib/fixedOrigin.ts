/**
 * Where `position: fixed` actually resolves from.
 *
 * Normally a fixed element is placed against the viewport, so JS that positions
 * one can just hand it `getBoundingClientRect()` numbers. But an ancestor with a
 * filter, transform, perspective or containment becomes the containing block for
 * its fixed descendants, and then those same numbers are off by that ancestor's
 * offset.
 *
 * That is not hypothetical here: the reader lives in `.main-content.themed`, and
 * light and sepia put `filter: invert(1)` on `.themed`. So every fixed overlay in
 * the reader resolves against the viewport in dark and against `.main-content` in
 * light/sepia — and a docked window, which insets `.main-content`, makes the two
 * disagree by the window's width.
 *
 * Rather than each caller guessing, ask for the box it is really being placed in.
 * A reader hosted inside a docked window falls out of this for free, since
 * `.panel` carries `themed` too.
 */

/** The box a fixed-position descendant is laid out against, in viewport coordinates. */
export interface FixedOrigin {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Properties that make an element the containing block for `position: fixed` descendants. */
function createsFixedContainingBlock(cs: CSSStyleDeclaration): boolean {
  if (cs.transform !== "none") return true;
  if (cs.perspective !== "none") return true;
  if (cs.filter !== "none") return true;
  // Safari reports the unprefixed property as "" rather than "none" when unset.
  const backdrop = cs.backdropFilter || (cs as any).webkitBackdropFilter;
  if (backdrop && backdrop !== "none") return true;
  if (/\b(transform|perspective|filter)\b/.test(cs.willChange)) return true;
  if (/\b(paint|layout|strict|content)\b/.test(cs.contain)) return true;
  return false;
}

/**
 * Returns the viewport rect that `position: fixed` resolves against for a fixed
 * descendant of `el` — the nearest ancestor that establishes a containing block,
 * or the viewport when there is none.
 *
 * Pass either the fixed element itself or its parent; an element never contains
 * itself, so the walk starts at `parentElement` in both cases.
 */
export function fixedOrigin(el: Element | null | undefined): FixedOrigin {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (createsFixedContainingBlock(getComputedStyle(p))) {
      const r = p.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}
