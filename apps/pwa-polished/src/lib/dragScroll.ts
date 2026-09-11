/**
 * Grab a sideways-scrolling strip and drag it, with a mouse.
 *
 * A touchscreen has always been able to do this: the bar overflows, and a swipe
 * scrolls it. A desktop never could. What looks like it works today is a text
 * selection running off the edge and dragging the view along with it — an
 * accident, and one that leaves half the navbar highlighted in blue.
 *
 * The rule is the one text selection already uses: direction decides. The first
 * few pixels of movement say whether this is a sideways drag or something else,
 * and only a sideways one takes over. Until then nothing is prevented, so a
 * press that turns out to be a click still reaches the button under it, and a
 * press that turns out to be a vertical scroll still scrolls the page.
 *
 * Used by the reader's navbar and the map's.
 */

/** How far the pointer must travel before the gesture is decided. */
const SLOP = 6;

export interface DragScrollOptions {
  /** Set false to leave the strip alone — a bar that is not overflowing. */
  enabled?: boolean;
  /**
   * Elements a drag must never start from. Defaults to the interactive things
   * a navbar holds; a range input in particular has its own drag.
   */
  ignore?: string;
}

const DEFAULT_IGNORE =
  'input, textarea, select, option, [contenteditable="true"], [data-no-drag-scroll]';

export function dragScroll(node: HTMLElement, options: DragScrollOptions = {}) {
  let enabled = options.enabled !== false;
  let ignore = options.ignore ?? DEFAULT_IGNORE;

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;
  /** null while the gesture is still undecided. */
  let dragging: boolean | null = null;

  function onPointerDown(event: PointerEvent) {
    // Touch and pen already scroll natively, and taking over would break the
    // momentum flick people expect. Primary button only: a right-click drag is
    // a context menu, not a scroll.
    if (!enabled || event.pointerType === 'touch' || event.button !== 0) return;
    if (node.scrollWidth <= node.clientWidth) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest(ignore)) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startScroll = node.scrollLeft;
    dragging = null;
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (dragging === null) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      // Whichever axis moved further wins, so a diagonal drift resolves rather
      // than doing both things badly.
      dragging = Math.abs(dx) > Math.abs(dy);
      if (!dragging) {
        pointerId = null;
        return;
      }
      // Only now does the gesture belong to us: capture the pointer so leaving
      // the bar mid-drag keeps scrolling, and stop the text selection that
      // would otherwise paint the whole navbar blue.
      node.setPointerCapture?.(pointerId);
      node.classList.add('drag-scrolling');
      document.getSelection()?.removeAllRanges();
    }

    event.preventDefault();
    node.scrollLeft = startScroll - dx;
  }

  function finish(event?: PointerEvent) {
    if (pointerId === null) return;
    if (event && event.pointerId !== pointerId) return;

    if (dragging) {
      node.classList.remove('drag-scrolling');
      // A drag must not end in a click. Swallowing exactly one click is enough:
      // without it, letting go over a button presses it, so scrolling the bar
      // would fire whichever control happened to be under the pointer.
      node.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 0);
    }
    try {
      if (event) node.releasePointerCapture?.(pointerId);
    } catch {
      // The pointer can already be gone; releasing a stale id throws.
    }
    pointerId = null;
    dragging = null;
  }

  function swallow(event: Event) {
    event.stopPropagation();
    event.preventDefault();
  }

  // Non-passive: a decided horizontal drag calls preventDefault.
  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove, { passive: false });
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', finish);

  return {
    update(next: DragScrollOptions = {}) {
      enabled = next.enabled !== false;
      ignore = next.ignore ?? DEFAULT_IGNORE;
      if (!enabled) finish();
    },
    destroy() {
      finish();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', finish);
      node.removeEventListener('pointercancel', finish);
    },
  };
}
