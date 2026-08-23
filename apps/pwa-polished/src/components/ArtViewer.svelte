<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';

  /** Object URL of the full-resolution painting. */
  export let src: string;
  export let title = '';
  export let artist: string | undefined = undefined;
  export let year: string | number | undefined = undefined;
  export let license: string | undefined = undefined;
  export let sourceUrl: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ close: void }>();

  /**
   * Move the viewer to the end of <body>.
   *
   * Same reason as BibleRefPopover: on the light and sepia themes a panel
   * carries `filter: invert(1)`, and a CSS filter makes its element the anchor
   * for fixed-position descendants — so rendered inside the art window this
   * would be positioned against the panel and then clipped by its
   * `overflow: hidden`. It would have looked right on dark and broken on light.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  let stageEl: HTMLDivElement;
  let imgEl: HTMLImageElement;

  let loaded = false;
  let failed = false;
  let naturalW = 0;
  let naturalH = 0;
  let stageW = 0;
  let stageH = 0;

  /** Scale at which the whole painting fits the stage; also the minimum zoom. */
  let fitScale = 1;
  let k = 1;
  let tx = 0;
  let ty = 0;

  /** Briefly true so double-tap zoom eases instead of snapping. */
  let animating = false;

  $: minK = fitScale;
  // The `1` guarantees 1:1 native pixels is always reachable, however large the
  // source; the multiple gives small engravings somewhere to go.
  $: maxK = Math.max(1, fitScale * 4);
  $: zoomed = k > fitScale * 1.02;

  function measureStage() {
    if (!stageEl) return;
    stageW = stageEl.clientWidth;
    stageH = stageEl.clientHeight;
  }

  function computeFit(): number {
    if (!naturalW || !naturalH || !stageW || !stageH) return 1;
    return Math.min(stageW / naturalW, stageH / naturalH);
  }

  /**
   * Keep the image inside the stage.
   *
   * On an axis where the image is smaller than the stage it is hard-centred —
   * that is what puts a portrait painting in the middle of a landscape screen
   * with black either side. Otherwise it may move, but not past its own edge.
   */
  function clampT() {
    const cw = naturalW * k;
    const ch = naturalH * k;
    tx = cw <= stageW ? (stageW - cw) / 2 : Math.min(0, Math.max(stageW - cw, tx));
    ty = ch <= stageH ? (stageH - ch) / 2 : Math.min(0, Math.max(stageH - ch, ty));
  }

  /**
   * Scale by `factor` about a point in stage coordinates.
   *
   * With `transform-origin: 0 0` the mapping is linear (screen = natural * k + T),
   * so holding the anchor still is a one-liner. This is what makes a pinch zoom
   * under the fingers rather than at the centre of the screen.
   */
  function zoomAt(ax: number, ay: number, factor: number) {
    const next = Math.min(maxK, Math.max(minK, k * factor));
    if (next === k) return;
    const r = next / k;
    tx = ax - (ax - tx) * r;
    ty = ay - (ay - ty) * r;
    k = next;
    clampT();
  }

  function animateTo(run: () => void) {
    animating = true;
    run();
    // Fallback in case transitionend never fires (interrupted by a new gesture).
    window.setTimeout(() => (animating = false), 260);
  }

  function resetFit() {
    k = fitScale;
    clampT();
  }

  function onImgLoad() {
    naturalW = imgEl.naturalWidth;
    naturalH = imgEl.naturalHeight;
    measureStage();
    fitScale = computeFit();
    k = fitScale;
    clampT();
    loaded = true;
  }

  /**
   * Re-fit after a rotation or a resize, preserving how far in the user was.
   *
   * Keeps the natural-space point that was at the centre of the stage there,
   * and keeps the zoom as the same multiple of fit — so fit stays fit and 3x
   * stays roughly 3x rather than snapping back.
   */
  function onViewportChange() {
    if (!loaded) return;
    const ratio = fitScale ? k / fitScale : 1;
    const cx = k ? (stageW / 2 - tx) / k : 0;
    const cy = k ? (stageH / 2 - ty) / k : 0;

    measureStage();
    fitScale = computeFit();
    k = Math.min(Math.max(1, fitScale * 4), Math.max(fitScale, ratio * fitScale));
    tx = stageW / 2 - cx * k;
    ty = stageH / 2 - cy * k;
    clampT();
  }

  // ===== Pointer gestures =====
  //
  // Pointer Events rather than Touch Events: one code path for mouse, touch and
  // pen, and a pointer map makes two-finger tracking straightforward. Pointer
  // capture keeps a drag alive when a finger slides onto the caption bar.

  type Pt = { x: number; y: number };
  const pointers = new Map<number, Pt>();

  let stageLeft = 0;
  let stageTop = 0;
  let pinchDist = 0;
  let pinchMid: Pt = { x: 0, y: 0 };
  let dragLast: Pt | null = null;

  /** Tap discrimination: a pan or a pinch must never be read as a tap. */
  let downAt = 0;
  let downPos: Pt = { x: 0, y: 0 };
  let moved = false;
  let multiTouched = false;
  let lastTapAt = 0;
  let lastTapPos: Pt = { x: 0, y: 0 };

  function toStage(e: PointerEvent): Pt {
    return { x: e.clientX - stageLeft, y: e.clientY - stageTop };
  }

  function refreshStageOrigin() {
    if (!stageEl) return;
    const r = stageEl.getBoundingClientRect();
    stageLeft = r.left;
    stageTop = r.top;
  }

  function midpoint(a: Pt, b: Pt): Pt {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function distance(a: Pt, b: Pt): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent) {
    refreshStageOrigin();
    stageEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toStage(e));
    animating = false;

    if (pointers.size === 1) {
      dragLast = toStage(e);
      downAt = performance.now();
      downPos = { x: e.clientX, y: e.clientY };
      moved = false;
      multiTouched = false;
    } else if (pointers.size === 2) {
      multiTouched = true;
      const [a, b] = [...pointers.values()];
      pinchDist = distance(a, b);
      pinchMid = midpoint(a, b);
      dragLast = null;
    }
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const p = toStage(e);
    pointers.set(e.pointerId, p);

    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) moved = true;

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = distance(a, b);
      const mid = midpoint(a, b);

      // Two fingers pan as well as zoom — moving the pair without changing the
      // spread should slide the painting, which is what makes it feel native.
      tx += mid.x - pinchMid.x;
      ty += mid.y - pinchMid.y;
      if (pinchDist > 0 && dist > 0) zoomAt(mid.x, mid.y, dist / pinchDist);
      else clampT();

      pinchDist = dist;
      pinchMid = mid;
    } else if (dragLast) {
      tx += p.x - dragLast.x;
      ty += p.y - dragLast.y;
      dragLast = p;
      clampT();
    }
    e.preventDefault();
  }

  function onPointerUp(e: PointerEvent) {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (stageEl.hasPointerCapture?.(e.pointerId)) stageEl.releasePointerCapture(e.pointerId);

    if (pointers.size === 1) {
      // Lifting one of two fingers: re-seat the drag on the survivor so the
      // image doesn't jump by the distance between them.
      const [only] = [...pointers.values()];
      dragLast = { ...only };
      pinchDist = 0;
    } else if (pointers.size === 0) {
      dragLast = null;
      if (wasSingle && !moved && !multiTouched && performance.now() - downAt < 300) {
        handleTap(e);
      }
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragLast = null;
  }

  /** Is this stage point over the painting itself, or the black beside it? */
  function overImage(p: Pt): boolean {
    return p.x >= tx && p.x <= tx + naturalW * k && p.y >= ty && p.y <= ty + naturalH * k;
  }

  function handleTap(e: PointerEvent) {
    const p = toStage(e);

    // Tapping the letterbox dismisses. Restricting it to the black area rather
    // than the whole stage means there is no ambiguity with double-tap zoom and
    // no 300ms wait to find out which one it was.
    if (!overImage(p)) {
      close();
      return;
    }

    const now = performance.now();
    if (now - lastTapAt < 300 && distance(p, lastTapPos) < 30) {
      lastTapAt = 0;
      animateTo(() => {
        if (zoomed) resetFit();
        else zoomAt(p.x, p.y, Math.min(2.5, maxK / k));
      });
      return;
    }
    lastTapAt = now;
    lastTapPos = p;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    refreshStageOrigin();
    // Exponential so a notched mouse wheel and a trackpad both feel right.
    zoomAt(e.clientX - stageLeft, e.clientY - stageTop, Math.exp(-e.deltaY * 0.0015));
  }

  /** iOS Safari ignores user-scalable=no, so block its own pinch explicitly. */
  function blockGesture(e: Event) {
    e.preventDefault();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function close() {
    dispatch('close');
  }

  onMount(() => {
    measureStage();
    refreshStageOrigin();

    // Attached by hand rather than with on: directives so passive:false is
    // guaranteed — a passive listener silently drops preventDefault(), and
    // without it the browser pans the page instead of the painting.
    const opts: AddEventListenerOptions = { passive: false };
    stageEl.addEventListener('pointerdown', onPointerDown, opts);
    stageEl.addEventListener('pointermove', onPointerMove, opts);
    stageEl.addEventListener('pointerup', onPointerUp, opts);
    stageEl.addEventListener('pointercancel', onPointerCancel, opts);
    stageEl.addEventListener('wheel', onWheel, opts);
    stageEl.addEventListener('gesturestart', blockGesture, opts);
    stageEl.addEventListener('gesturechange', blockGesture, opts);
    stageEl.addEventListener('gestureend', blockGesture, opts);

    window.addEventListener('resize', onViewportChange);
    // iOS reports an orientation change reliably only through visualViewport.
    window.visualViewport?.addEventListener('resize', onViewportChange);

    return () => {
      stageEl?.removeEventListener('pointerdown', onPointerDown, opts);
      stageEl?.removeEventListener('pointermove', onPointerMove, opts);
      stageEl?.removeEventListener('pointerup', onPointerUp, opts);
      stageEl?.removeEventListener('pointercancel', onPointerCancel, opts);
      stageEl?.removeEventListener('wheel', onWheel, opts);
      stageEl?.removeEventListener('gesturestart', blockGesture, opts);
      stageEl?.removeEventListener('gesturechange', blockGesture, opts);
      stageEl?.removeEventListener('gestureend', blockGesture, opts);
      window.removeEventListener('resize', onViewportChange);
      window.visualViewport?.removeEventListener('resize', onViewportChange);
    };
  });

  onDestroy(() => pointers.clear());

  $: meta = [artist || undefined, year ? String(year) : undefined].filter(Boolean).join(', ');
</script>

<svelte:window on:keydown={onKeydown} />

<div class="art-viewer no-edge-gesture" use:portal transition:fade={{ duration: 140 }}>
  <div class="stage" class:zoomed bind:this={stageEl} role="presentation">
    <img
      bind:this={imgEl}
      {src}
      alt={title}
      draggable="false"
      class:ready={loaded}
      class:animating
      on:load={onImgLoad}
      on:error={() => (failed = true)}
      on:transitionend={() => (animating = false)}
      style={loaded
        ? `width:${naturalW}px; height:${naturalH}px; transform: translate(${tx}px, ${ty}px) scale(${k});`
        : ''}
    />
  </div>

  {#if !loaded && !failed}
    <div class="viewer-state">Loading…</div>
  {:else if failed}
    <div class="viewer-state">Couldn’t open this image.</div>
  {/if}

  <button class="viewer-close" on:click={close} aria-label="Close image viewer">✕</button>

  {#if title || meta || sourceUrl}
    <div class="viewer-caption">
      <div class="caption-text">
        {#if title}<span class="caption-title">{title}</span>{/if}
        {#if meta}<span class="caption-meta">{meta}</span>{/if}
        {#if license}<span class="caption-license">{license}</span>{/if}
      </div>
      {#if sourceUrl}
        <a class="caption-source" href={sourceUrl} target="_blank" rel="noopener noreferrer">
          Wikimedia Commons ↗
        </a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .art-viewer {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: #000;
    overscroll-behavior: contain;
    user-select: none;
    -webkit-user-select: none;
    /* Stops the long-press "save image" sheet fighting a pan. */
    -webkit-touch-callout: none;
  }

  .stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
    /* Hands every touch to the pointer handlers instead of the browser's own
       pan and zoom — also what makes pointermove fire for touch at all. */
    touch-action: none;
    cursor: grab;
  }
  .stage.zoomed { cursor: grabbing; }

  .stage img {
    position: absolute;
    left: 0;
    top: 0;
    /* Linear transform maths depends on this origin — see zoomAt(). */
    transform-origin: 0 0;
    opacity: 0;
    -webkit-user-drag: none;
    will-change: transform;
  }
  .stage img.ready { opacity: 1; }
  .stage img.animating { transition: transform 200ms ease-out; }

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

  /* The portal escaped #app's safe-area padding, so the chrome carries its own. */
  .viewer-close {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    right: calc(env(safe-area-inset-right, 0px) + 12px);
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: #f2f2f2;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    backdrop-filter: blur(6px);
  }
  .viewer-close:hover { background: rgba(0, 0, 0, 0.8); }

  .viewer-caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 14px;
    padding: 28px 16px calc(env(safe-area-inset-bottom, 0px) + 14px);
    padding-left: calc(env(safe-area-inset-left, 0px) + 16px);
    padding-right: calc(env(safe-area-inset-right, 0px) + 16px);
    background: linear-gradient(to top, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0));
    /* Let pans that start over the caption reach the stage; only the link
       itself needs to be hittable. */
    pointer-events: none;
  }
  .caption-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .caption-title { font-size: 15px; font-weight: 600; color: #f4f4f4; }
  .caption-meta { font-size: 13px; color: #bdbdbd; }
  .caption-license { font-size: 11px; color: #8b8b8b; }
  .caption-source {
    flex-shrink: 0;
    font-size: 12px;
    color: #d8b077;
    text-decoration: none;
    white-space: nowrap;
    pointer-events: auto;
  }
  .caption-source:hover { text-decoration: underline; }

  @media (max-height: 420px) {
    /* Landscape on a phone: keep the painting the point. */
    .viewer-caption { padding-top: 18px; }
    .caption-license { display: none; }
  }
</style>
