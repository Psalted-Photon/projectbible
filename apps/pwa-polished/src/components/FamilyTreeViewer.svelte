<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { familyTreeStore } from '../stores/familyTreeStore';
  import { loadFamilyTree } from '../lib/familyTree/data';
  import { layout, ancestorChain, type TreeModel, type TreeRec } from '../lib/familyTree/layout';
  import { draw, fitView, pick, toWorld, viewFor, type View } from '../lib/familyTree/render';
  import { MAX_ZOOM, MIN_ZOOM_OF_FIT, FOCUS_ZOOM } from '../lib/familyTree/config';
  import FamilyTreeCard from './FamilyTreeCard.svelte';

  /**
   * The tree, full screen on black — opened from People, over everything the
   * user was doing there.
   *
   * Mounted in App.svelte beside LookupModal and moved to <body> by the same
   * portal action ArtViewer uses, so nothing under it — the People card, its
   * list, letter, search, scroll and trail — is ever unmounted. Closing this
   * simply removes the overlay and the user is exactly where they were, with
   * no restore code needed anywhere.
   */

  const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  /** Same portal ArtViewer uses: filters on the light/sepia themes make their
   *  element a fixed-position anchor, so this escapes to <body> instead. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  let rootEl: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  let W = 0;
  let H = 0;
  let DPR = 1;

  let model: TreeModel | null = null;
  let loading = true;
  let errored = false;

  let view: View = { x: 0, y: 0, k: 1 };
  /** The zoom that shows the whole tree — the floor for MIN_ZOOM_OF_FIT and
   *  the target for "Whole tree". Recalculated on every resize. */
  let fittedK = 1;
  $: minZoom = fittedK * MIN_ZOOM_OF_FIT;

  let tracedPath: Set<string> | null = null;
  let selectedTribe: string | null = null;
  let pinned: TreeRec | null = null;
  let hovered: TreeRec | null = null;

  // ── Breathing pulse ──────────────────────────────────────────────────────
  // Runs only while someone is pinned — a permanent render loop on a page
  // that doesn't need one is wasted battery on a phone.
  let pulsePhase = REDUCED_MOTION ? 1 : 0;
  let pulseRAF: number | null = null;
  let pulseStart = 0;

  function startPulse() {
    if (pulseRAF != null || REDUCED_MOTION) return;
    pulseStart = performance.now();
    const tick = (now: number) => {
      if (!pinned) {
        pulseRAF = null;
        return;
      }
      pulsePhase = (Math.sin((now - pulseStart) / 480) + 1) / 2;
      redraw();
      pulseRAF = requestAnimationFrame(tick);
    };
    pulseRAF = requestAnimationFrame(tick);
  }
  function stopPulse() {
    if (pulseRAF != null) cancelAnimationFrame(pulseRAF);
    pulseRAF = null;
    pulsePhase = REDUCED_MOTION ? 1 : 0;
  }

  // ── All names ────────────────────────────────────────────────────────────
  const NAMES_KEY = 'projectbible-familytree-names';
  function readNamesPref(): boolean {
    try {
      const v = localStorage.getItem(NAMES_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  }
  let allNames = true; // set for real in onMount, once localStorage is safe to touch
  function toggleAllNames() {
    allNames = !allNames;
    try {
      localStorage.setItem(NAMES_KEY, allNames ? '1' : '0');
    } catch {
      // Private mode, or storage blocked — the toggle still works this visit.
    }
    redraw();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  function redraw() {
    if (!ctx || !model) return;
    draw({
      ctx,
      W,
      H,
      DPR,
      view,
      model,
      tracedPath,
      selectedTribe,
      pinnedId: pinned?.id ?? null,
      pulsePhase,
      allNames,
    });
  }

  /** Canvas sizing only, with no side effect on the view — shared by the
   *  first open (which fits and sets `view` itself) and every later resize
   *  (which does not: a resize re-measures and redraws, nothing more). */
  function measure() {
    if (!canvas) return;
    DPR = window.devicePixelRatio || 1;
    W = rootEl.clientWidth;
    H = rootEl.clientHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
  }

  function resize() {
    if (!canvas) return;
    measure();
    if (model) {
      fittedK = fitView(model, W, H).k;
    }
    redraw();
  }

  // ── Tracing and hover ────────────────────────────────────────────────────
  function traceFrom(n: TreeRec) {
    if (!model) return;
    const chain = ancestorChain(model, n);
    tracedPath = new Set(chain.map((r) => r.id));
    selectedTribe = n.tribe || null;
    pinned = n;
    startPulse();
    redraw();
  }

  function clearSelection() {
    tracedPath = null;
    selectedTribe = null;
    pinned = null;
    hovered = null;
    stopPulse();
    redraw();
  }

  // ── Glides ───────────────────────────────────────────────────────────────
  // Two things eased from start to end: log(k) (so the zoom doesn't swoop —
  // easing k directly changes too fast at the start) and the world point that
  // should sit at the target screen spot. The view is rebuilt from those two
  // every frame with viewFor, so a glide can never disagree with a jump cut.
  let glideRAF: number | null = null;

  function cancelGlide() {
    if (glideRAF != null) cancelAnimationFrame(glideRAF);
    glideRAF = null;
  }

  function glideTo(targetWorld: { x: number; y: number }, targetK: number, screen: { x: number; y: number }, ms = 700) {
    cancelGlide();
    if (REDUCED_MOTION) {
      view = viewFor(targetWorld.x, targetWorld.y, targetK, screen.x, screen.y, W, H);
      redraw();
      return;
    }
    const startWorld = toWorld(screen.x, screen.y, view, W, H);
    const startK = view.k;
    const logStart = Math.log(startK);
    const logEnd = Math.log(targetK);
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      const k = Math.exp(logStart + (logEnd - logStart) * e);
      const wx = startWorld.x + (targetWorld.x - startWorld.x) * e;
      const wy = startWorld.y + (targetWorld.y - startWorld.y) * e;
      view = viewFor(wx, wy, k, screen.x, screen.y, W, H);
      redraw();
      if (t < 1) {
        glideRAF = requestAnimationFrame(tick);
      } else {
        glideRAF = null;
      }
    };
    glideRAF = requestAnimationFrame(tick);
  }

  function glideToWhole() {
    if (!model) return;
    // fitView already knows exactly where the tree's midpoint has to land on
    // screen — reading that back with toWorld, rather than re-deriving the
    // padded area's centre here, means this can never drift out of step with
    // fitView's own pad if that ever changes.
    const fit = fitView(model, W, H);
    const anchor = { x: W / 2, y: H / 2 };
    const midWorld = toWorld(anchor.x, anchor.y, fit, W, H);
    glideTo(midWorld, fit.k, anchor);
  }

  /** Opening on a person, or the header 🌳's focusId: zoom to FOCUS_ZOOM, since
   *  the previous zoom (the whole tree, or whatever the last visit left) means
   *  nothing here — this is a fresh arrival, not a move within one visit. */
  function glideToPersonFocused(n: TreeRec) {
    if (n.x == null || n.y == null) return;
    glideTo({ x: n.x, y: n.y }, FOCUS_ZOOM, { x: W / 2, y: H * 0.62 });
  }

  /** Tapping an ancestor in the card: glide to them at whatever zoom the
   *  tree is already at, per the plan — a walk along a line the user is
   *  already looking at shouldn't also change how far in they are. */
  function glideToPersonAtCurrentZoom(n: TreeRec) {
    if (n.x == null || n.y == null) return;
    glideTo({ x: n.x, y: n.y }, view.k, { x: W / 2, y: H * 0.62 });
  }

  // ── Opening ──────────────────────────────────────────────────────────────
  onMount(async () => {
    allNames = readNamesPref();
    try {
      const data = await loadFamilyTree();
      model = layout(data);
      loading = false;
      ctx = canvas.getContext('2d');
      if (!ctx) {
        errored = true;
        return;
      }
      // Measure the canvas, then set the fitted view, THEN draw the first
      // frame — resize() draws as its last step, so calling it before `view`
      // is fitted would flash one frame at the stale default view (0,0,k:1).
      measure();
      const fit = fitView(model, W, H);
      fittedK = fit.k;
      view = fit;
      redraw();

      const focusId = $familyTreeStore.focusId;
      const target = focusId ? model.nodes.get(focusId) || model.rootById.get(focusId) : null;
      if (target && target.x != null && target.y != null) {
        traceFrom(target);
        // So the user sees where the whole tree is before zooming to them —
        // the glide starts from the fitted view rather than jumping straight in.
        glideToPersonFocused(target);
      }

      // Milonga can arrive after this first paint; redraw once it's ready so
      // labels don't sit in the fallback face until the next interaction.
      document.fonts?.load('600 14px Milonga').then(() => redraw());
    } catch {
      loading = false;
      errored = true;
    }
  });

  onDestroy(() => {
    stopPulse();
    cancelGlide();
  });

  // ── Gestures ─────────────────────────────────────────────────────────────
  // Attached by hand, not with on: directives, so passive:false is guaranteed —
  // a passive listener drops preventDefault(), and without it the page pans
  // instead of the tree. Modelled on ArtViewer, not the lab: the lab has no
  // pinch-to-zoom-and-pan-together (it treats a pinch as zoom-only), and no tap
  // discrimination against a drag.
  type Pt = { x: number; y: number };
  const pointers = new Map<number, Pt>();
  let dragLast: Pt | null = null;
  let pinchDist = 0;
  let pinchMid: Pt = { x: 0, y: 0 };
  let downPos: Pt = { x: 0, y: 0 };
  let moved = false;
  let multiTouched = false;
  let gestured = false;

  function toLocal(e: PointerEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function clampZoom(k: number): number {
    return Math.max(minZoom, Math.min(MAX_ZOOM, k));
  }

  function onPointerDown(e: PointerEvent) {
    cancelGlide();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toLocal(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      dragLast = null;
      multiTouched = true;
      return;
    }
    dragLast = toLocal(e);
    downPos = { x: e.clientX, y: e.clientY };
    moved = false;
    multiTouched = false;
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) {
      // No button down: plain hover, mouse only, and only while nobody is
      // pinned — a pinned card isn't hover's to overwrite.
      if (!pinned && !TOUCH && model) {
        const p = toLocal(e);
        const n = pick(model, view, W, H, p.x, p.y, 14);
        if (n !== hovered) {
          hovered = n;
        }
      }
      return;
    }
    pointers.set(e.pointerId, toLocal(e));
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) moved = true;

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Two fingers pan and zoom together about their midpoint.
      view = { ...view, x: view.x + (mid.x - pinchMid.x), y: view.y + (mid.y - pinchMid.y) };
      if (pinchDist > 0 && dist > 0) {
        const before = toWorld(mid.x, mid.y, view, W, H);
        view.k = clampZoom(view.k * (dist / pinchDist));
        const after = toWorld(mid.x, mid.y, view, W, H);
        view.x += (after.x - before.x) * view.k;
        view.y += (after.y - before.y) * view.k;
      }
      pinchDist = dist;
      pinchMid = mid;
      redraw();
      return;
    }

    if (dragLast) {
      const p = toLocal(e);
      view = { ...view, x: view.x + (p.x - dragLast.x), y: view.y + (p.y - dragLast.y) };
      dragLast = p;
      redraw();
    }
  }

  /**
   * A tap: a pointerup that moved 8px or less and never had a second finger.
   * No time limit — a slow, deliberate press should still count as a tap,
   * and this is what discriminates it from a drag, not the clock.
   */
  function endGesture(hadOneFinger: boolean) {
    if (hadOneFinger && !moved && !multiTouched) {
      handleTap(downPos);
    }
    gestured = true;
  }

  function onPointerUp(e: PointerEvent) {
    const wasSingle = pointers.size === 1 && !multiTouched;
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (pointers.size === 1) {
      // Lifting one finger of a pinch: re-seat the drag on the survivor so
      // the tree doesn't lurch by the distance between the two fingers.
      const [only] = [...pointers.values()];
      dragLast = { ...only };
      pinchDist = 0;
    } else if (pointers.size === 0) {
      dragLast = null;
      endGesture(wasSingle);
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragLast = null;
  }

  function handleTap(screen: Pt) {
    if (!model) return;
    const radius = TOUCH ? 22 : 14;
    const n = pick(model, view, W, H, screen.x, screen.y, radius);
    if (n) {
      traceFrom(n);
    } else {
      clearSelection();
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    cancelGlide();
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const before = toWorld(cx, cy, view, W, H);
    view.k = clampZoom(view.k * Math.exp(-e.deltaY * 0.0015));
    const after = toWorld(cx, cy, view, W, H);
    view.x += (after.x - before.x) * view.k;
    view.y += (after.y - before.y) * view.k;
    redraw();
  }

  function blockGesture(e: Event) {
    e.preventDefault();
  }

  // ── History: back closes the tree ───────────────────────────────────────
  // Same pattern as ParallelView: one pushState on mount, consumed by ×,
  // Escape and the phone's Back alike, so none of them can leave a dead
  // entry behind for the next Back to trip over.
  let pushedHistory = false;

  function closeViaHistory() {
    if (pushedHistory) {
      pushedHistory = false;
      history.back();
      return;
    }
    doClose();
  }

  function onPopState() {
    if (history.state?.pbFamilyTree) return;
    pushedHistory = false;
    doClose();
  }

  /** Escape is caught in the capture phase and stopped, so the People card
   *  underneath doesn't also step back — same reason HarmonyPicker does this
   *  for the harmony view behind it. */
  function onKeydownCapture(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeViaHistory();
  }

  let openerEl: HTMLElement | null = null;

  function doClose() {
    familyTreeStore.close();
  }

  // Attached by hand rather than with on: directives, the same reason
  // ArtViewer does: passive:false is guaranteed this way, and a passive
  // listener silently drops preventDefault() — without it the page would pan
  // instead of the tree.
  onMount(() => {
    const opts: AddEventListenerOptions = { passive: false };
    canvas.addEventListener('pointerdown', onPointerDown, opts);
    canvas.addEventListener('pointermove', onPointerMove, opts);
    canvas.addEventListener('pointerup', onPointerUp, opts);
    canvas.addEventListener('pointercancel', onPointerCancel, opts);
    canvas.addEventListener('wheel', onWheel, opts);
    // iOS Safari ignores user-scalable=no, so its own pinch has to be blocked
    // explicitly or it fights the tree's own two-finger zoom.
    canvas.addEventListener('gesturestart', blockGesture, opts);
    canvas.addEventListener('gesturechange', blockGesture, opts);
    canvas.addEventListener('gestureend', blockGesture, opts);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, opts);
      canvas.removeEventListener('pointermove', onPointerMove, opts);
      canvas.removeEventListener('pointerup', onPointerUp, opts);
      canvas.removeEventListener('pointercancel', onPointerCancel, opts);
      canvas.removeEventListener('wheel', onWheel, opts);
      canvas.removeEventListener('gesturestart', blockGesture, opts);
      canvas.removeEventListener('gesturechange', blockGesture, opts);
      canvas.removeEventListener('gestureend', blockGesture, opts);
    };
  });

  onMount(() => {
    openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      history.pushState({ pbFamilyTree: true }, '');
      pushedHistory = true;
    } catch {
      // × and Escape still close it; only the phone's Back is affected.
    }
    window.addEventListener('keydown', onKeydownCapture, true);
    return () => window.removeEventListener('keydown', onKeydownCapture, true);
  });

  onDestroy(() => {
    if (openerEl && document.contains(openerEl)) {
      openerEl.focus({ preventScroll: true });
    }
  });

  $: hintText = TOUCH ? '· Back to return' : '· Esc to return';
</script>

<svelte:window on:resize={resize} on:popstate={onPopState} />

<div
  class="family-tree no-edge-gesture"
  use:portal
  bind:this={rootEl}
  role="dialog"
  aria-modal="true"
  aria-label="Family tree"
>
  <canvas bind:this={canvas}></canvas>

  {#if loading}
    <div class="viewer-state">Loading the tree…</div>
  {:else if errored}
    <div class="viewer-state">Couldn’t load the family tree.</div>
  {/if}

  {#if model}
    <div class="controls-top">
      <button class="tree-btn" on:click={glideToWhole}>Whole tree</button>
      <button class="tree-btn toggle" class:on={allNames} aria-pressed={allNames} on:click={toggleAllNames}>
        All names
      </button>
    </div>
    <button class="close-btn" on:click={closeViaHistory} aria-label="Close family tree">✕ Close</button>

    {#if pinned}
      <FamilyTreeCard
        {model}
        person={pinned}
        pinned={true}
        onTraceAncestor={(rec: TreeRec) => {
          traceFrom(rec);
          glideToPersonAtCurrentZoom(rec);
        }}
      />
    {:else if hovered}
      <FamilyTreeCard {model} person={hovered} pinned={false} />
    {/if}

    <div class="hint" class:faded={gestured}>
      Drag to pan · Tap a person to trace their line · Pinch or scroll to zoom {hintText}
    </div>
    <div class="attrib">{model.attribution}</div>
  {/if}
</div>

<style>
  .family-tree {
    position: fixed;
    inset: 0;
    z-index: 10040;
    background: #000;
    overscroll-behavior: contain;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
  }

  .viewer-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #8a8a8a;
    font-size: 15px;
    pointer-events: none;
  }

  .controls-top {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    left: calc(env(safe-area-inset-left, 0px) + 12px);
    display: flex;
    gap: 8px;
  }

  .tree-btn {
    background: rgba(13, 12, 11, 0.72);
    border: 1px solid #3a342a;
    color: #cdbfa8;
    border-radius: 7px;
    padding: 7px 12px;
    font-size: 12.5px;
    font-family: inherit;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }
  .tree-btn:hover {
    background: rgba(28, 25, 22, 0.85);
    color: #e8dcc8;
  }
  .tree-btn.toggle.on {
    border-color: #6b5d3a;
    color: #e8dcc8;
    background: rgba(44, 40, 32, 0.85);
  }

  .close-btn {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    right: calc(env(safe-area-inset-right, 0px) + 12px);
    background: rgba(0, 0, 0, 0.55);
    border: none;
    border-radius: 20px;
    color: #f2f2f2;
    font-size: 13px;
    font-family: inherit;
    padding: 8px 14px;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }
  .close-btn:hover {
    background: rgba(0, 0, 0, 0.8);
  }

  .hint {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 30px);
    text-align: center;
    font-size: 11px;
    color: #6b6153;
    pointer-events: none;
    transition: opacity 0.6s ease;
  }
  .hint.faded {
    opacity: 0;
  }

  .attrib {
    position: absolute;
    left: 12px;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
    font-size: 10px;
    color: #4a443c;
    max-width: 380px;
    line-height: 1.5;
    pointer-events: none;
  }

  @media (max-width: 480px) {
    .attrib {
      max-width: calc(100% - 24px);
      font-size: 9.5px;
    }
  }
</style>
