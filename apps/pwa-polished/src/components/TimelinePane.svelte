<script lang="ts">
  /**
   * The Timeline window: twelve era bands and forty events down a vertical axis.
   *
   * Split the same way the map is. The chrome, the gestures and the panel are
   * here; where anything actually sits is lib/timeline/layout.ts, and what there
   * is to draw is lib/timeline/data.ts.
   *
   * A docked window rather than a fullscreen view, deliberately: tapping an
   * event sends the reader to its first verse and the timeline stays open
   * beside the passage, which is the only reason to read with one.
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { windowStore } from '../lib/stores/windowStore';
  import { navigationStore } from '../stores/navigationStore';
  import {
    loadTimeline,
    releaseTimeline,
    timelineInstalled,
    formatYear,
    formatSpan,
    type TimelineData,
    type TimelineEra,
    type TimelineEvent,
  } from '../lib/timeline/data';
  import {
    makeScale,
    layoutEras,
    layoutEvents,
    yearTicks,
    eraColor,
    type TimelineScale,
  } from '../lib/timeline/layout';

  export let windowId: string | undefined = undefined;

  let stageEl: HTMLDivElement;

  let loading = true;
  let missing = false;
  let error: string | null = null;
  let data: TimelineData | null = null;

  /** What was tapped, shown in the panel at the foot of the window. */
  let selected:
    | { kind: 'event'; value: TimelineEvent }
    | { kind: 'era'; value: TimelineEra }
    | null = null;

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

  let scale: TimelineScale = makeScale(-4004, 100);
  $: if (data) scale = makeScale(data.minYear, data.maxYear);

  /** Zoom on the year axis only — this is a ruler, not a map. */
  let zoom = 1;
  /** How far the axis is scrolled, in content pixels. */
  let ty = 0;

  let stageH = 0;

  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 8;

  $: eraLayout = data ? layoutEras(data.eras, scale) : { bands: [], lanes: 1 };
  $: marks = data ? layoutEvents(data.events, scale, 22, zoom) : [];
  $: ticks = data ? yearTicks(scale, zoom) : [];

  /** Content height at the current zoom, for clamping the scroll. */
  $: contentH = scale.height * zoom;

  function clampTy() {
    if (contentH <= stageH) {
      ty = 0;
      return;
    }
    ty = Math.min(0, Math.max(stageH - contentH, ty));
  }

  /**
   * Scale about a point in stage coordinates.
   *
   * Lifted from ArtViewer: with `transform-origin: 0 0` the mapping is linear,
   * so holding the anchor still is one line. One dimension here rather than two.
   */
  function zoomAt(ay: number, factor: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
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

  let downAt = 0;
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
      downAt = performance.now();
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
      if (wasSingle && !moved && !multiTouched && performance.now() - downAt < 300) handleTap(y);
    }
  }

  function onPointerCancel(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragLast = null;
  }

  /** Double-tap the axis to zoom in on the year under the finger, and out again. */
  let lastTapAt = 0;
  let lastTapY = 0;

  function handleTap(y: number) {
    const now = performance.now();
    if (now - lastTapAt < 300 && Math.abs(y - lastTapY) < 30) {
      lastTapAt = 0;
      if (zoom > 1.2) {
        zoom = 1;
        clampTy();
      } else {
        zoomAt(y, 2.5);
      }
      return;
    }
    lastTapAt = now;
    lastTapY = y;
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

  function selectEvent(event: TimelineEvent) {
    selected = { kind: 'event', value: event };
  }

  function selectEra(era: TimelineEra) {
    selected = { kind: 'era', value: era };
    centreOn((era.year_start + era.year_end) / 2);
  }

  /**
   * Take the reader to this event's first verse.
   *
   * The map's exact call: a crumb first, so the navbar's back arrow puts the
   * reader back where it was standing with the timeline still open, then the
   * jump. Nineteen of the forty events have no verse tagged to them in the
   * pack, and those are not offered as a link at all rather than being a button
   * that does nothing.
   */
  function goToEvent(event: TimelineEvent) {
    if (!event.first) return;
    const current = get(navigationStore);
    navigationStore.pushHistory(current, 'timeline');
    navigationStore.navigateToVerse(
      current.translation,
      event.first.book,
      event.first.chapter,
      event.first.verse,
    );
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
    zoom = 1;
    ty = 0;
    clampTy();
  }

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
        data = await loadTimeline();
        loading = false;
        // Wait for the stage to have a height before the first clamp.
        requestAnimationFrame(() => {
          measureStage();
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
      <div class="gate-card">
        <div class="gate-title">The Timeline isn’t installed yet</div>
        <p>
          The twelve eras, the forty events and the year on every verse live in
          the Study Tools pack. Install it from Packs and this window fills in.
        </p>
        <p class="gate-note">About 14 MB. Works with no connection once it’s there.</p>
      </div>
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
        <!-- Everything inside is counter-scaled on the Y axis so the bands
             stretch with the years while the lettering keeps its size. That is
             what a ruler does: the distances grow, the numbers do not. -->
        <div class="content" style="transform: translateY({ty}px) scaleY({zoom}); height: {scale.height}px;">
          {#each eraLayout.bands as band (band.era.era_id)}
            <div
              class="band"
              class:sel={selected?.kind === 'era' && selected.value.era_id === band.era.era_id}
              style="top: {band.top}px; height: {band.height}px; --c: {band.color}; left: calc(56px + {band.lane} * (var(--lane-w) + 4px)); width: var(--lane-w);"
              role="button"
              tabindex="0"
              title={band.era.name}
              on:click={() => selectEra(band.era)}
              on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectEra(band.era);
                }
              }}
            >
              <span class="band-label" style="transform: scaleY({1 / zoom});">{band.era.name}</span>
            </div>
          {/each}

          {#each ticks as year (year)}
            <div class="tick" style="top: {scale.y(year)}px;">
              <span class="tick-label" style="transform: translateY(-50%) scaleY({1 / zoom});">{formatYear(year)}</span>
              <span class="tick-line"></span>
            </div>
          {/each}

          {#each marks as mark (mark.event.event_id)}
            <!-- The dot stays at the true year; the label slides down where two
                 would print on top of each other, with a leader back to it. -->
            <div class="dot" style="top: {mark.top}px; --c: {mark.color}; transform: translateY(-50%) scaleY({1 / zoom});"></div>
            {#if mark.labelTop - mark.top > 1}
              <div class="leader" style="top: {mark.top}px; height: {mark.labelTop - mark.top}px;"></div>
            {/if}
            <button
              class="mark"
              class:sel={selected?.kind === 'event' && selected.value.event_id === mark.event.event_id}
              class:unlinked={!mark.event.first}
              style="top: {mark.labelTop}px; --c: {mark.color}; transform: translateY(-50%) scaleY({1 / zoom});"
              on:click={() => selectEvent(mark.event)}
            >
              <span class="mark-name">{mark.event.name}</span>
              <span class="mark-year">{formatYear(mark.event.year_start)}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if selected}
      <div class="panel">
        <button class="panel-close" aria-label="Close" on:click={() => (selected = null)}>×</button>
        {#if selected.kind === 'event'}
          <div class="panel-kind" style="--c: {eraColor(selected.value.era ?? '')}">
            {selected.value.era ?? 'Event'}
          </div>
          <div class="panel-title">{selected.value.name}</div>
          <div class="panel-span">{formatSpan(selected.value.year_start, selected.value.year_end)}</div>
          {#if selected.value.description}
            <p class="panel-body">{selected.value.description}</p>
          {/if}
          {#if selected.value.first}
            {@const first = selected.value.first}
            {@const event = selected.value}
            <button class="panel-go" on:click={() => goToEvent(event)}>
              Read {first.book} {first.chapter}:{first.verse}
              <span class="panel-go-note">{event.verseCount.toLocaleString()} verses</span>
            </button>
          {:else}
            <p class="panel-note">No passage is tagged to this event yet.</p>
          {/if}
        {:else}
          <div class="panel-kind" style="--c: {eraColor(selected.value.era_id)}">Era</div>
          <div class="panel-title">{selected.value.name}</div>
          <div class="panel-span">{formatSpan(selected.value.year_start, selected.value.year_end)}</div>
          {#if selected.value.description}
            <p class="panel-body">{selected.value.description}</p>
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
  /* Narrow: the word goes, the clock face stays. */
  @container (max-width: 430px) { .btn-label { display: none; } }

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
    --events-x: calc(56px + 2 * (var(--lane-w) + 4px));
    /* The gestures are ours; the browser must not also scroll or pinch. */
    touch-action: none;
    cursor: grab;
    user-select: none;
  }
  .stage:active { cursor: grabbing; }
  /* Docked narrow, the bands give back the room the event names need. */
  @container (max-width: 380px) { .stage { --lane-w: 52px; } }

  .content {
    position: absolute;
    inset: 0 0 auto 0;
    transform-origin: 0 0;
    will-change: transform;
  }

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
    transform-origin: 0 0;
    font-family: var(--display); font-size: 11.5px; line-height: 1.2;
    color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, .7);
    pointer-events: none;
  }

  .tick { position: absolute; left: 0; right: 0; }
  .tick-label {
    position: absolute; left: 4px; top: 0;
    transform-origin: 0 50%;
    font-size: 10.5px; color: var(--faint); white-space: nowrap;
  }
  .tick-line {
    position: absolute; left: 52px; right: 0; top: 0; height: 1px;
    background: #262626;
  }

  .dot {
    position: absolute;
    left: calc(var(--events-x) - 10px);
    width: 9px; height: 9px; border-radius: 50%;
    transform-origin: 0 50%;
    background: var(--c);
    box-shadow: 0 0 0 2px var(--sunken);
    pointer-events: none;
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
    transform-origin: 0 50%;
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
  /* An event with no verses tagged to it is still real history, so it is drawn
     — just not dressed up as a link to somewhere it cannot go. */
  .mark.unlinked { color: var(--dim); }
  .mark-name { overflow: hidden; text-overflow: ellipsis; }
  .mark-year { color: var(--faint); font-size: 10.5px; flex: none; }

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
    padding: 24px; background: var(--chrome);
  }
  .gate-card { max-width: 380px; text-align: center; color: var(--dim); font-size: 13px; line-height: 1.6; }
  .gate-title { font-family: var(--display); font-size: 17px; color: var(--text); margin-bottom: 10px; }
  .gate-note { color: var(--faint); font-size: 12px; }
</style>
