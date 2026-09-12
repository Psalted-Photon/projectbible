/**
 * Keep a map fitted to a container that is being dragged, without letting the
 * map fight the drag.
 *
 * Leaflet never watches its own container, so both maps carry an observer that
 * tells them to re-fit. That was fine when the map was photographs fetched as
 * tiles: re-fitting cost nothing. This map is drawn — every coastline, border
 * and river — and re-fitting redraws all of it. Wired straight to the observer
 * that meant a full redraw of the world on every frame of a window drag, which
 * saturates the main thread and leaves the window apparently stuck: it is the
 * map eating the machine, not the window refusing to move.
 *
 * So the redraw is held. While the window is being dragged nothing is fitted at
 * all; the moment the drag ends, the map catches up once. Outside a drag — the
 * browser window resizing, a panel opening beside it — the fit is still
 * coalesced to the next frame, so a burst of size changes costs one redraw
 * rather than one each.
 */
export interface ResizeFit {
  /** The container changed size. */
  request(): void;
  /** True while the window this map lives in is being dragged. */
  hold(value: boolean): void;
  /** Drop any frame still owed, on the way out. */
  stop(): void;
}

export function createResizeFit(fit: () => void): ResizeFit {
  let holding = false;
  let pending = false;
  let frame = 0;

  function run() {
    frame = 0;
    pending = false;
    fit();
  }

  function request() {
    if (holding) {
      pending = true;
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(run);
  }

  return {
    request,
    hold(value: boolean) {
      if (holding === value) return;
      holding = value;
      // Let go, and whatever happened during the drag is owed exactly once.
      if (!value && pending) request();
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = false;
    },
  };
}
