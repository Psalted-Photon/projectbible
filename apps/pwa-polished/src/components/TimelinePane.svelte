<script lang="ts">
  /**
   * The Timeline window: the whole story down one vertical strip.
   *
   * Split the same way the map is. The chrome, the gestures and the panel are
   * here; where anything actually sits is lib/timeline/layout.ts, and what there
   * is to draw is lib/timeline/data.ts, read from the Timeline pack.
   *
   * Drawn in screen space: every position is worked out in zoomed pixels and
   * offset by the scroll, and only what is on screen is drawn. An earlier
   * version scaled one tall layer with a CSS transform, which cannot zoom far
   * enough to pull the Gospel years apart without blurring or blowing up.
   *
   * A docked window rather than a fullscreen view, deliberately: tapping Read
   * sends the reader to the passage and the timeline stays open beside it.
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { windowStore } from '../lib/stores/windowStore';
  import { navigationStore } from '../stores/navigationStore';
  import GetPacksCard from './GetPacksCard.svelte';
  import {
    loadTimeline,
    releaseTimeline,
    timelineInstalled,
    formatYear,
    formatItemSpan,
    type TimelineData,
    type TimelineItem,
  } from '../lib/timeline/data';
  import {
    makeScale,
    makeStoryScale,
    layoutEras,
    layoutMarks,
    layoutBars,
    yearTicks,
    visibleTier,
    zoomForTier,
    itemColor,
    ZOOM_LIMITS,
    type Mark,
    type ScaleMode,
    type TimelineScale,
  } from '../lib/timeline/layout';

  export let windowId: string | undefined = undefined;

  let stageEl: HTMLDivElement;

  let loading = true;
  let missing = false;
  let error: string | null = null;
  let data: TimelineData | null = null;

  /** What was tapped, shown in the panel at the foot of the window: an event or an era. */
  let selected: TimelineItem | null = null;

  $: windowState = windowId ? $windowStore.find((w) => w.id === windowId) : undefined;

  /**
   * The window's resize grip lies over this pane's inner edge and takes every
   * press in that band, so the chrome is inset clear of it — the same 26px
   * AtlasPane and Window.svelte use.
   */
  const GRIP_PX = 26;
  $: edge = windowState?.edge;
  $: gripStyle = [
    `--grip-l:${edge === 'right' ? GRIP_PX : 0}px`,
    `--grip-r:${edge === 'left' ? GRIP_PX : 0}px`,
    `--grip-b:${edge === 'top' ? GRIP_PX : 0}px`,
  ].join(';');

  $: chronoOn = $navigationStore.isChronologicalMode === true;

  // ===== Scale and layout =====

  /** Story spacing by default; true years on the toggle, remembered per window. */
  let mode: ScaleMode = 'story';
  let storyScale: TimelineScale = makeScale(-4004, 100);
  let trueScale: TimelineScale = makeScale(-4004, 100);
  $: scale = mode === 'story' ? storyScale : trueScale;
  $: limits = ZOOM_LIMITS[mode];

  /** Zoom on the year axis only — this is a ruler, not a map. */
  let zoom = 1;
  /** How far the axis is scrolled, in zoomed pixels; 0 is the top. */
  let ty = 0;

  let stageH = 0;

  $: tier = visibleTier(zoom, mode);
  $: eraLayout = data ? layoutEras(data.eras, scale, zoom) : { bands: [], lanes: 1 };
  $: marks = data ? layoutMarks(data.events, data.byId, scale, zoom, tier) : [];
  $: bars = data ? layoutBars(marks, scale, zoom) : [];

  /** Only what is on screen, plus a margin so nothing pops in at the edge. */
  const MARGIN = 60;
  $: viewTop = -ty - MARGIN;
  $: viewBottom = -ty + stageH + MARGIN;
  $: shownBands = eraLayout.bands.filter((b) => b.bottom >= viewTop && b.top <= viewBottom);
  $: shownBars = bars.filter((b) => b.bottom >= viewTop && b.top <= viewBottom);
  $: shownMarks = marks.filter(
    (m) => (m.labelZ >= viewTop && m.labelZ <= viewBottom) || (m.z >= viewTop && m.z <= viewBottom),
  );
  $: ticks = data ? yearTicks(scale, zoom, viewTop, viewBottom) : [];

  function clampTy() {
    const h = scale.height * zoom;
    if (h <= stageH) {
      ty = 0;
      return;
    }
    ty = Math.min(0, Math.max(stageH - h, ty));
  }

  function clampZoom(z: number): number {
    return Math.min(limits.max, Math.max(limits.min, z));
  }

  /**
   * Scale about a point in stage coordinates.
   *
   * Lifted from ArtViewer: the mapping is linear, so holding the anchor still
   * is one line. One dimension here rather than two.
   */
  function zoomAt(ay: number, factor: number) {
    const next = clampZoom(zoom * factor);
    if (next === zoom) return;
    const r = next / zoom;
    ty = ay - (ay - ty) * r;
    zoom = next;
    clampTy();
  }

  /** Put a year in the middle of the stage, at the current zoom. */
  function centreOn(year: number) {
    ty = stageH / 2 - scale.y(year) * zoom;
    clampTy();
  }

  /** The zoom a fresh window opens at: about six screens of headline events. */
  function startZoom(s: TimelineScale, m: ScaleMode): number {
    if (m === 'true') return 1;
    const h = stageH || 600;
    return Math.min(1.5, Math.max(ZOOM_LIMITS.story.min, (h * 6) / s.height));
  }

  /**
   * Zoom in about the middle until the next tier shows. Behind the pill that
   * says there is more, since nothing else on the strip tells you a pinch will
   * bring out a hundred more events.
   */
  function zoomToNextTier() {
    measureStage();
    const next = (Math.min(3, tier + 1)) as 1 | 2 | 3;
    const target = clampZoom(Math.max(zoom * 1.25, zoomForTier(next, mode)));
    zoomAt(stageH / 2, target / zoom);
  }

  /**
   * Switch between story spacing and true years, keeping the year in the
   * middle of the strip where it is and the years around it about as far apart
   * as they were, so the toggle shows how the spacing differs rather than
   * throwing the reader somewhere else.
   */
  function setMode(next: ScaleMode) {
    if (next === mode || !data) return;
    measureStage();
    const year = scale.yearAt((stageH / 2 - ty) / zoom);
    const pxPerYear = (scale.y(year + 0.5) - scale.y(year - 0.5)) * zoom;
    const nextScale = next === 'story' ? storyScale : trueScale;
    const base = nextScale.y(year + 0.5) - nextScale.y(year - 0.5);
    const nextLimits = ZOOM_LIMITS[next];
    mode = next;
    scale = nextScale;
    zoom = Math.min(nextLimits.max, Math.max(nextLimits.min, base > 0 ? pxPerYear / base : 1));
    ty = stageH / 2 - nextScale.y(year) * zoom;
    clampTy();
    if (windowId) windowStore.updateContentState(windowId, { timelineScale: next });
  }

  // ===== Pointer gestures =====
  //
  // Pointer Events, one path for mouse, touch and pen — the same shape as
  // ArtViewer's, narrowed to the single axis this view has.

  type Pt = { x: number; y: number };
  const pointers = new Map<number, Pt>();
  let stageTop = 0;
  let pinchDist = 0;
  let pinchMid = 0;
  let dragLast: number | null = null;

  let downPos: Pt = { x: 0, y: 0 };
  let moved = false;
  let multiTouched = false;

  function toStageY(e: PointerEvent): number {
    return e.clientY - stageTop;
  }

  function measureStage() {
    if (!stageEl) return;
    const r = stageEl.getBoundingClientRect();
    stageTop = r.top;
    stageH = r.height;
    clampTy();
  }

  function onPointerDown(e: PointerEvent) {
    measureStage();
    stageEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: toStageY(e) });

    if (pointers.size === 1) {
      dragLast = toStageY(e);
      downPos = { x: e.clientX, y: e.clientY };
      moved = false;
      multiTouched = false;
    } else if (pointers.size === 2) {
      multiTouched = true;
      const [a, b] = [...pointers.values()];
      pinchDist = Math.abs(a.y - b.y);
      pinchMid = (a.y + b.y) / 2;
      dragLast = null;
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    const y = toStageY(e);
    pointers.set(e.pointerId, { x: e.clientX, y });

    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) moved = true;

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.abs(a.y - b.y);
      const mid = (a.y + b.y) / 2;
      // Two fingers scroll as well as zoom, so a pinch that drifts up the axis
      // takes the years with it.
      ty += mid - pinchMid;
      if (pinchDist > 2 && dist > 2) zoomAt(mid, dist / pinchDist);
      else clampTy();
      pinchDist = dist;
      pinchMid = mid;
      e.preventDefault();
    } else if (dragLast !== null) {
      ty += y - dragLast;
      dragLast = y;
      clampTy();
      e.preventDefault();
    }
  }

  function onPointerUp(e: PointerEvent) {
    const wasSingle = pointers.size === 1;
    const y = toStageY(e);
    pointers.delete(e.pointerId);
    if (stageEl.hasPointerCapture?.(e.pointerId)) stageEl.releasePointerCapture(e.pointerId);

    if (pointers.size === 1) {
      // Lifting one of two fingers: re-seat the drag on the survivor so the
      // axis doesn't jump by the distance between them.
      const [only] = [...pointers.values()];
      dragLast = only.y;
      pinchDist = 0;
    } else if (pointers.size === 0) {
      dragLast = null;
      // Movement alone decides what a tap is, the same as the family tree — a
      // slow, deliberate press on an event is still a press on it.
      if (wasSingle && !moved && !multiTouched) handleTap(e.clientX, e.clientY, y);
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragLast = null;
  }

  /** Double-tap the axis to zoom in on the year under the finger, and out again. */
  let lastTapAt = 0;
  let lastTapY = 0;
  /** When a tap last chose something, so a click that follows it is not acted on twice. */
  let tapHandledAt = 0;

  /**
   * A tap: whatever is under the finger, or a double-tap zoom on bare axis.
   *
   * The stage captures every pointer for dragging, and a captured pointer's
   * click lands on the stage rather than the event or band that was pressed —
   * so their own on:click never fires from a finger. What was tapped is worked
   * out here instead, the same way FamilyTreeViewer's `pick` does it. The
   * on:click handlers stay for the keyboard.
   */
  function handleTap(clientX: number, clientY: number, y: number) {
    const hit = document.elementFromPoint(clientX, clientY);
    if (hit?.closest('[data-more]')) {
      tapHandledAt = performance.now();
      lastTapAt = 0;
      zoomToNextTier();
      return;
    }
    const markEl = hit?.closest<HTMLElement>('[data-mark-key]');
    const mark = markEl ? marks.find((m) => m.key === markEl.dataset.markKey) : undefined;
    if (mark) {
      tapHandledAt = performance.now();
      lastTapAt = 0;
      activateMark(mark);
      return;
    }
    const barEl = hit?.closest<HTMLElement>('[data-item-id]');
    const barItem = barEl && data ? data.byId.get(barEl.dataset.itemId ?? '') : undefined;
    if (barItem) {
      tapHandledAt = performance.now();
      lastTapAt = 0;
      selectItem(barItem);
      return;
    }
    const bandEl = hit?.closest<HTMLElement>('[data-era-id]');
    const era = bandEl && data ? data.byId.get(bandEl.dataset.eraId ?? '') : undefined;
    if (era) {
      tapHandledAt = performance.now();
      lastTapAt = 0;
      selectEra(era);
      return;
    }

    const now = performance.now();
    if (now - lastTapAt < 300 && Math.abs(y - lastTapY) < 30) {
      lastTapAt = 0;
      const home = startZoom(scale, mode);
      if (zoom > home * 1.2) zoomAt(y, home / zoom);
      else zoomAt(y, 2.5);
      return;
    }
    lastTapAt = now;
    lastTapY = y;
  }

  /** A click from the keyboard; one straight after a tap is the same press. */
  function fromClick(run: () => void) {
    if (performance.now() - tapHandledAt < 500) return;
    run();
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    measureStage();
    // Ctrl/meta-wheel and a trackpad pinch zoom; a plain wheel scrolls the
    // years, which is what a ruler should do.
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientY - stageTop, Math.exp(-e.deltaY * 0.0025));
    } else {
      ty -= e.deltaY;
      clampTy();
    }
  }

  /** iOS Safari ignores user-scalable=no, so block its own pinch explicitly. */
  function blockGesture(e: Event) {
    e.preventDefault();
  }

  // ===== Selection and navigation =====

  function selectItem(item: TimelineItem) {
    selected = item;
  }

  function selectEra(era: TimelineItem) {
    selected = era;
    centreOn((era.year_start + era.year_end) / 2);
  }

  function activateMark(mark: Mark) {
    if (mark.kind === 'cluster') openCluster(mark);
    else selectItem(mark.item);
  }

  /**
   * Zoom into a folded run until it comes apart.
   *
   * Far enough that the span fills most of the strip and the deepest tier in
   * it shows; if that is still not enough, the next layout folds what is left
   * into smaller chips, which open the same way.
   */
  function openCluster(mark: Mark) {
    measureStage();
    // Already as close as the strip goes: show what the chip stands for
    // instead of zooming nowhere.
    if (zoom >= limits.max * 0.98) {
      const parentId = mark.items[0].parent_id;
      const shared = parentId && mark.items.every((it) => it.parent_id === parentId || it.id === parentId);
      selectItem((shared && data?.byId.get(parentId)) || mark.item);
      return;
    }
    const span = (mark.zEnd - mark.z) / zoom;
    const deepest = Math.max(...mark.items.map((it) => it.tier ?? 3)) as 1 | 2 | 3;
    const fill = span > 0 ? (stageH * 0.7) / span : zoom * 4;
    const next = clampZoom(Math.max(zoom * 1.6, fill, zoomForTier(deepest, mode)));
    const midContent = (mark.z + mark.zEnd) / 2 / zoom;
    zoom = next;
    ty = stageH / 2 - midContent * zoom;
    clampTy();
  }

  /**
   * Take the reader to the first verse.
   *
   * The map's exact call: a crumb first, so the navbar's back arrow puts the
   * reader back where it was standing with the timeline still open, then the
   * jump.
   */
  function goTo(item: TimelineItem) {
    if (!item.first) return;
    const current = get(navigationStore);
    navigationStore.pushHistory(current, 'timeline');
    navigationStore.navigateToVerse(current.translation, item.first.book, item.first.chapter, item.first.verse);
  }

  /**
   * The switch chronological mode never had.
   *
   * `setChronologicalMode` has been on the store, and persisted, since long
   * before this window — with nothing anywhere in the app that called it. This
   * is that control, put where reading in time order is already the subject.
   */
  function toggleChronological() {
    navigationStore.setChronologicalMode(!chronoOn);
  }

  function zoomButton(factor: number) {
    measureStage();
    zoomAt(stageH / 2, factor);
  }

  function resetView() {
    measureStage();
    zoom = clampZoom(stageH / scale.height);
    ty = 0;
    clampTy();
  }

  /** The era an event belongs to, for the panel's kind line. */
  $: selectedEra = selected && data && selected.kind !== 'era' ? data.byId.get(selected.era_id ?? '') : undefined;

  // ===== Lifecycle =====

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    (async () => {
      try {
        if (!(await timelineInstalled())) {
          missing = true;
          loading = false;
          return;
        }
        const loaded = await loadTimeline();
        storyScale = makeStoryScale(loaded.eras, loaded.events);
        trueScale = makeScale(loaded.minYear, loaded.maxYear);
        mode = windowState?.contentState?.timelineScale === 'true' ? 'true' : 'story';
        data = loaded;
        loading = false;
        // Wait for the stage to have a height before the first zoom and clamp.
        requestAnimationFrame(() => {
          measureStage();
          zoom = startZoom(mode === 'story' ? storyScale : trueScale, mode);
          ty = 0;
          clampTy();
        });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        loading = false;
      }
    })();

    // Attached by hand rather than with on: directives so passive:false is
    // guaranteed — a passive listener drops preventDefault, and without it the
    // browser scrolls the page instead of the axis.
    const opts: AddEventListenerOptions = { passive: false };
    let attached: HTMLDivElement | null = null;

    // The stage only exists once the gate has been cleared, so attaching waits
    // a frame rather than assuming it is there at mount.
    const raf = requestAnimationFrame(() => {
      if (!stageEl) return;
      attached = stageEl;
      attached.addEventListener('pointerdown', onPointerDown, opts);
      attached.addEventListener('pointermove', onPointerMove, opts);
      attached.addEventListener('pointerup', onPointerUp, opts);
      attached.addEventListener('pointercancel', onPointerCancel, opts);
      attached.addEventListener('wheel', onWheel, opts);
      attached.addEventListener('gesturestart', blockGesture, opts);
      attached.addEventListener('gesturechange', blockGesture, opts);
      attached.addEventListener('gestureend', blockGesture, opts);
      resizeObserver = new ResizeObserver(() => measureStage());
      resizeObserver.observe(attached);
    });

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (!attached) return;
      attached.removeEventListener('pointerdown', onPointerDown, opts);
      attached.removeEventListener('pointermove', onPointerMove, opts);
      attached.removeEventListener('pointerup', onPointerUp, opts);
      attached.removeEventListener('pointercancel', onPointerCancel, opts);
      attached.removeEventListener('wheel', onWheel, opts);
      attached.removeEventListener('gesturestart', blockGesture, opts);
      attached.removeEventListener('gesturechange', blockGesture, opts);
      attached.removeEventListener('gestureend', blockGesture, opts);
    };
  });

  onDestroy(() => {
    pointers.clear();
    releaseTimeline();
  });
</script>

<!-- `.no-edge-gesture`, or scrubbing the axis near the screen edge arms a new
     window instead of scrolling the years. -->
<div class="timeline no-edge-gesture" style={gripStyle}>
  {#if missing}
    <div class="gate">
      <GetPacksCard
        packs={['timeline']}
        title="The Timeline isn’t installed yet"
        note="About four hundred events from Creation to Revelation, with the kings, the prophets and the empires around them. Works with no connection once it’s there."
      />
    </div>
  {:else if error}
    <div class="gate">
      <div class="gate-card">
        <div class="gate-title">The timeline failed to open</div>
        <p>{error}</p>
      </div>
    </div>
  {:else}
    <div class="nav">
      <div class="nav-title">Timeline</div>
      <div class="nav-spacer"></div>
      <button
        class="btn"
        class:on={chronoOn}
        aria-pressed={chronoOn}
        title="Read the Bible in the order events happened"
        on:click={toggleChronological}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>
        <span class="btn-label">Chronological</span>
      </button>
      <button
        class="btn"
        class:on={mode === 'true'}
        aria-pressed={mode === 'true'}
        title={mode === 'true' ? 'Space the strip by what happens' : 'Space the strip by years, each the same height'}
        on:click={() => setMode(mode === 'true' ? 'story' : 'true')}
      >
        <!-- A ruler: evenly spaced marks. -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2.5" width="8" height="19" rx="1.5"/><line x1="8" y1="7" x2="11" y2="7"/><line x1="8" y1="11" x2="12.5" y2="11"/><line x1="8" y1="15" x2="11" y2="15"/><line x1="8" y1="19" x2="12.5" y2="19"/></svg>
        <span class="btn-label">True years</span>
      </button>
      <div class="nav-sep"></div>
      <button class="btn btn-icon" title="Zoom out" aria-label="Zoom out" on:click={() => zoomButton(1 / 1.6)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="btn btn-icon" title="Zoom in" aria-label="Zoom in" on:click={() => zoomButton(1.6)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
      </button>
      <button class="btn btn-icon" title="Fit the whole span" aria-label="Fit the whole span" on:click={resetView}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 5 12 3 16 5"/><polyline points="8 19 12 21 16 19"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
      </button>
    </div>

    <div class="stage" bind:this={stageEl}>
      {#if loading}
        <div class="loading">Reading the timeline…</div>
      {:else if data}
        <!-- Bands are clipped to the stage so their names stay pinned to the
             top of whatever part of the era is showing. -->
        {#each shownBands as band (band.era.id)}
          {@const top = Math.max(band.top + ty, -4)}
          {@const bottom = Math.min(band.bottom + ty, stageH + 4)}
          <div
            class="band"
            class:sel={selected?.id === band.era.id}
            style="top: {top}px; height: {Math.max(0, bottom - top)}px; --c: {band.color}; left: calc(56px + {band.lane} * (var(--lane-w) + 4px)); width: var(--lane-w);"
            role="button"
            tabindex="0"
            title={band.era.title}
            data-era-id={band.era.id}
            on:click={() => fromClick(() => selectEra(band.era))}
            on:keydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectEra(band.era);
              }
            }}
          >
            <span class="band-label">{band.era.title}</span>
          </div>
        {/each}

        {#each ticks as t (t.year)}
          <div class="tick" style="top: {t.z + ty}px;">
            <span class="tick-label">{formatYear(t.year)}</span>
            <span class="tick-line"></span>
          </div>
        {/each}

        {#each shownBars as bar (bar.item.id)}
          {@const top = Math.max(bar.top + ty, -4)}
          {@const bottom = Math.min(bar.bottom + ty, stageH + 4)}
          <div
            class="bar"
            style="top: {top}px; height: {Math.max(0, bottom - top)}px; --c: {bar.color}; --lane: {bar.lane};"
            title={bar.item.title}
            data-item-id={bar.item.id}
          ></div>
        {/each}

        {#each shownMarks as mark (mark.key)}
          <!-- The dot stays at the event's place; the label slides off it where
               two would print on top of each other, with a leader back to it. -->
          <div class="dot" class:cluster={mark.kind === 'cluster'} style="top: {mark.z + ty}px; --c: {mark.color};"></div>
          {#if Math.abs(mark.labelZ - mark.z) > 1}
            <div class="leader" style="top: {Math.min(mark.z, mark.labelZ) + ty}px; height: {Math.abs(mark.labelZ - mark.z)}px;"></div>
          {/if}
          <button
            class="mark"
            class:cluster={mark.kind === 'cluster'}
            class:headline={mark.kind === 'item' && mark.item.tier === 1}
            class:sel={mark.kind === 'item' && selected?.id === mark.item.id}
            class:unlinked={mark.kind === 'item' && !mark.item.first}
            data-mark-key={mark.key}
            style="top: {mark.labelZ + ty}px; --c: {mark.color};"
            title={mark.kind === 'cluster' ? `${mark.title}: tap to zoom in` : mark.title}
            on:click={() => fromClick(() => activateMark(mark))}
          >
            {#if mark.kind === 'cluster'}
              <svg class="mark-zoom" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="20.5" y2="20.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            {/if}
            <span class="mark-name">{mark.title}</span>
            {#if mark.kind === 'item'}
              <span class="mark-year">{formatYear(mark.item.year_start)}</span>
            {/if}
          </button>
        {/each}

        {#if tier < 3}
          <button class="more" data-more on:click={() => fromClick(zoomToNextTier)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="20.5" y2="20.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            Zoom in for more events
          </button>
        {/if}
      {/if}
    </div>

    {#if selected}
      <div class="panel">
        <button class="panel-close" aria-label="Close" on:click={() => (selected = null)}>×</button>
        {#if selected.kind === 'era'}
          <div class="panel-kind" style="--c: {itemColor(selected)}">Era</div>
        {:else}
          <div class="panel-kind" style="--c: {itemColor(selectedEra ?? selected)}">
            {selectedEra?.title ?? 'Event'}
          </div>
        {/if}
        <div class="panel-title">{selected.title}</div>
        <div class="panel-span">{formatItemSpan(selected)}</div>
        {#if selected.summary}
          <p class="panel-body">{selected.summary}</p>
        {/if}
        {#if selected.kind !== 'era'}
          {#if selected.first && selected.passages.length}
            {@const item = selected}
            <button class="panel-go" on:click={() => goTo(item)}>
              Read {item.passages[0].label}
              {#if item.passages.length > 1}
                <span class="panel-go-note">+{item.passages.length - 1} more</span>
              {/if}
            </button>
          {:else}
            <p class="panel-note">No passage is tied to this event.</p>
          {/if}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .timeline {
    --chrome: #1a1a1a;
    --chrome-2: #212121;
    --sunken: #141414;
    --line: #333;
    --line-2: #3a3a3a;
    --text: #e0e0e0;
    --dim: #8a8a8a;
    --faint: #5a5a5a;
    --focus: #fb7185;
    --nav-h: 46px;
    /* The app's display face, chrome only — Milonga is unreadable as body text. */
    --display: 'Milonga', cursive;

    --grip-l: 0px;
    --grip-r: 0px;
    --grip-b: 0px;

    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--chrome);
    color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    /* Breakpoints measure this box, not the viewport: docked, it can be 380px
       wide inside a 1600px screen. */
    container-type: inline-size;
    overflow: hidden;
    isolation: isolate;
  }

  /* ---------------- navbar ---------------- */
  .nav {
    flex: none;
    height: var(--nav-h);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 calc(8px + var(--grip-r)) 0 calc(8px + var(--grip-l));
    background: var(--chrome);
    border-bottom: 1px solid var(--line);
    position: relative;
    z-index: 20;
    font-family: var(--display);
    overflow: hidden;
    /* Bar size: scaled as one piece, like the main bar's strip. Laid out
       1/scale wide so it still spans once scaled; the margin gives back the
       height the box gained or lost. */
    width: calc(100% / var(--bar-scale, 1));
    transform: scale(var(--bar-scale, 1));
    transform-origin: 0 0;
    margin-bottom: calc(var(--nav-h) * (var(--bar-scale, 1) - 1));
  }
  .nav-title { font-size: 16px; letter-spacing: .3px; flex: none; }
  .nav-spacer { flex: 1; min-width: 4px; }
  .nav-sep { width: 1px; height: 22px; background: var(--line); margin: 0 3px; flex: none; }

  .btn {
    height: 30px; min-width: 30px; padding: 0 9px; border-radius: 6px; cursor: pointer;
    background: var(--chrome-2); border: 1px solid var(--line); color: var(--text);
    font: inherit; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px;
    white-space: nowrap; flex: none;
    transition: background .12s, border-color .12s, color .12s;
  }
  .btn:hover { background: #292929; border-color: var(--line-2); }
  .btn.on { background: #2f2a2b; border-color: var(--focus); color: #fff; }
  .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .btn svg { width: 15px; height: 15px; flex: none; }
  .btn-icon { padding: 0; justify-content: center; }
  /* Narrow: the words go, the icons stay. */
  @container (max-width: 520px) { .btn-label { display: none; } .btn:not(.btn-icon) { padding: 0; width: 30px; justify-content: center; } }

  /* ---------------- the axis ---------------- */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--sunken);
    /* The two era lanes and where the event column starts after them. Set
       here rather than on the root so a container query can narrow them —
       a query cannot restyle the element that declares the container. */
    --lane-w: 74px;
    --events-x: calc(56px + 2 * (var(--lane-w) + 4px) + 14px);
    /* The gestures are ours; the browser must not also scroll or pinch. */
    touch-action: none;
    cursor: grab;
    user-select: none;
  }
  .stage:active { cursor: grabbing; }
  /* Docked narrow, the bands give back the room the event names need. */
  @container (max-width: 380px) { .stage { --lane-w: 52px; } }

  .loading {
    position: absolute; inset: 0; display: grid; place-items: center;
    color: var(--dim); font-size: 13px;
  }

  .band {
    position: absolute;
    border-radius: 5px;
    background: color-mix(in srgb, var(--c) 26%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 60%, transparent);
    box-sizing: border-box;
    cursor: pointer;
    overflow: hidden;
  }
  .band.sel {
    background: color-mix(in srgb, var(--c) 46%, transparent);
    border-color: var(--c);
  }
  .band:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .band-label {
    position: absolute; top: 4px; left: 6px; right: 4px;
    font-family: var(--display); font-size: 11.5px; line-height: 1.2;
    color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, .7);
    pointer-events: none;
  }

  .tick { position: absolute; left: 0; right: 0; height: 0; pointer-events: none; }
  .tick-label {
    position: absolute; left: 4px; top: 0;
    transform: translateY(-50%);
    font-size: 10.5px; color: var(--faint); white-space: nowrap;
  }
  .tick-line {
    position: absolute; left: 52px; right: 0; top: 0; height: 1px;
    background: #262626;
  }

  /* A span that lasts: a thin line from its start to its end, left of the dots. */
  .bar {
    position: absolute;
    left: calc(var(--events-x) - 19px - var(--lane) * 5px);
    width: 3px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--c) 75%, transparent);
    cursor: pointer;
  }

  .dot {
    position: absolute;
    left: calc(var(--events-x) - 10px);
    width: 9px; height: 9px; border-radius: 50%;
    transform: translateY(-50%);
    background: var(--c);
    box-shadow: 0 0 0 2px var(--sunken);
    pointer-events: none;
  }
  .dot.cluster {
    background: var(--sunken);
    box-shadow: 0 0 0 2px var(--c);
  }
  .leader {
    position: absolute;
    left: calc(var(--events-x) - 6px);
    width: 1px;
    background: #3a3a3a;
    pointer-events: none;
  }

  .mark {
    position: absolute;
    left: calc(var(--events-x) + 4px);
    max-width: calc(100% - var(--events-x) - 12px);
    transform: translateY(-50%);
    display: flex; align-items: baseline; gap: 7px;
    padding: 3px 8px; border-radius: 6px;
    background: var(--chrome-2); border: 1px solid var(--line);
    border-left: 3px solid var(--c);
    color: var(--text); font: inherit; font-size: 12px;
    cursor: pointer; text-align: left; white-space: nowrap;
  }
  .mark:hover { background: #292929; border-color: var(--line-2); border-left-color: var(--c); }
  .mark.sel { background: #2f2a2b; border-color: var(--focus); border-left-color: var(--c); }
  .mark:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .mark.headline .mark-name { font-weight: 600; }
  /* A folded run: dashed, with a magnifier, so it reads as "there is more here". */
  .mark.cluster {
    align-items: center;
    border-style: dashed;
    border-left-style: solid;
    background: #1c1c1c;
    color: var(--dim);
  }
  .mark-zoom { width: 13px; height: 13px; flex: none; align-self: center; }
  /* An event with no passage tied to it is still real history, so it is drawn
     — just not dressed up as a link to somewhere it cannot go. */
  .mark.unlinked { color: var(--dim); }
  .mark-name { overflow: hidden; text-overflow: ellipsis; }
  .mark-year { color: var(--faint); font-size: 10.5px; flex: none; }

  /* The pill that says there is more to see. Kept small and out of the way. */
  .more {
    position: absolute; bottom: 10px; right: 10px; z-index: 5;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 10px; border-radius: 999px; cursor: pointer;
    background: rgba(33, 33, 33, .92); border: 1px solid var(--line-2); color: var(--dim);
    font: inherit; font-size: 11.5px;
  }
  .more:hover { color: var(--text); border-color: var(--focus); }
  .more svg { width: 13px; height: 13px; }

  /* ---------------- what you tapped ---------------- */
  .panel {
    flex: none;
    position: relative;
    max-height: 46%;
    overflow-y: auto;
    padding: 12px calc(14px + var(--grip-r)) calc(12px + var(--grip-b)) calc(14px + var(--grip-l));
    background: var(--chrome);
    border-top: 1px solid var(--line);
    z-index: 20;
  }
  .panel-close {
    position: absolute; top: 6px; right: calc(8px + var(--grip-r));
    width: 26px; height: 26px; border-radius: 6px;
    background: transparent; border: 0; color: var(--dim);
    font-size: 19px; line-height: 1; cursor: pointer;
  }
  .panel-close:hover { background: var(--chrome-2); color: var(--text); }
  .panel-kind {
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--c); margin-bottom: 3px;
  }
  .panel-title { font-family: var(--display); font-size: 17px; line-height: 1.25; padding-right: 30px; }
  .panel-span { color: var(--dim); font-size: 12px; margin-top: 2px; }
  .panel-body { color: var(--dim); font-size: 13px; line-height: 1.6; margin: 8px 0 0; }
  .panel-note { color: var(--faint); font-size: 12px; margin: 10px 0 0; }
  .panel-go {
    margin-top: 10px; padding: 7px 11px; border-radius: 6px; cursor: pointer;
    background: var(--chrome-2); border: 1px solid var(--line-2); color: var(--text);
    font: inherit; font-size: 13px; display: inline-flex; align-items: baseline; gap: 8px;
  }
  .panel-go:hover { background: #292929; border-color: var(--focus); }
  .panel-go:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .panel-go-note { color: var(--faint); font-size: 11px; }

  /* ---------------- not installed ---------------- */
  .gate {
    position: absolute; inset: 0; z-index: 30; display: grid; place-items: center;
    padding: 24px; background: var(--chrome); overflow-y: auto;
  }
  .gate-card { max-width: 380px; text-align: center; color: var(--dim); font-size: 13px; line-height: 1.6; }
  .gate-title { font-family: var(--display); font-size: 17px; color: var(--text); margin-bottom: 10px; }
</style>
