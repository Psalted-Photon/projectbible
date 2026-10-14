<script lang="ts">
  /**
   * The Connections window: every cross-reference in Scripture as an arc over
   * one line of all 1,189 chapters.
   *
   * The drawing, the shapes and the flights are lib/connections — the same
   * modules connections-lab.html tunes, so what was tuned there is what shows
   * here. This file is the chrome, the gestures and the card.
   *
   * Taps: a book name lights the book, a chapter bar lights the chapter, and an
   * arc out in the field opens a card with both of its verses. Those rows open
   * the verse in the reader. Pan with a drag, zoom with a pinch or the wheel;
   * Whole Bible puts the picture back.
   *
   * Never `.themed`: the light and sepia themes are an inverting filter, and a
   * canvas under it would show every book color as its opposite. The canvas
   * and the chrome both take real colors from lib/connections/palette.ts
   * instead, so the window still follows the reader's theme.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { windowStore } from '../lib/stores/windowStore';
  import { navigationStore } from '../stores/navigationStore';
  import { lookupStore } from '../stores/lookupStore';
  import { motionLevel } from '../lib/motion';
  import GetPacksCard from './GetPacksCard.svelte';
  import VerseRefRow from './VerseRefRow.svelte';
  import CloseX from './CloseX.svelte';
  import {
    connectionsInstalled,
    loadConnections,
    releaseConnections,
    refAt,
    bookSpan,
    chapterSpan,
    type ConnectionsData,
    type ConnectionRef,
  } from '../lib/connections/data';
  import { CONFIG, frameFor } from '../lib/connections/layout';
  import { axisDepth, chapterAtScreen, draw, pick, rulerAt, rulerHit, type PlacedName } from '../lib/connections/render';
  import { palette, type ConnectionsPalette } from '../lib/connections/palette';
  import { LIGHTS, countReach, flightFrame, litSetFor, type LitSet, type Span } from '../lib/connections/lights';

  export let windowId: string | undefined = undefined;

  /** The credit OpenBible's licence asks for, word for word. */
  const CREDIT = 'Cross references: OpenBible.info (CC BY)';

  let loading = true;
  let missing = false;
  let error: string | null = null;
  let data: ConnectionsData | null = null;

  $: windowState = windowId ? $windowStore.find((w) => w.id === windowId) : undefined;

  function remember(patch: Record<string, unknown>) {
    if (windowId) windowStore.updateContentState(windowId, patch);
  }

  /**
   * The window's resize grip lies over this pane's inner edge, so the chrome is
   * inset clear of it — the same 26px the Timeline and the map use.
   */
  const GRIP_PX = 26;
  $: edge = fullscreen ? undefined : windowState?.edge;
  $: gripStyle = [
    `--grip-l:${edge === 'right' ? GRIP_PX : 0}px`,
    `--grip-r:${edge === 'left' ? GRIP_PX : 0}px`,
    `--grip-b:${edge === 'top' ? GRIP_PX : 0}px`,
  ].join(';');

  // ===== Colors =====

  let colors: ConnectionsPalette = palette();
  $: themeStyle = [
    `--bg:${colors.bg}`,
    `--text:${colors.text}`,
    `--muted:${colors.muted}`,
    `--rule:${colors.rule}`,
  ].join(';');

  /** The theme changes by a class on <body>, and a custom theme by its style. */
  let themeObserver: MutationObserver | null = null;
  function watchTheme() {
    themeObserver = new MutationObserver(() => {
      colors = palette();
      schedule();
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  // ===== The canvas =====

  let stageEl: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let W = 0;
  let H = 0;
  let DPR = 1;

  /** Pan and zoom, as the lab and the family tree do it. */
  let view = { x: 0, y: 0, k: 1 };

  /** What is lit, and when its arcs were loosed. Null shows everything. */
  let lit: LitSet | null = null;
  /** The opening volley, while it is in the air. */
  let opening: { startedAt: number } | null = null;
  /** Where the book names landed on the last draw, for tapping them. */
  let names: PlacedName[] = [];

  function measure() {
    if (!stageEl || !canvas) return;
    DPR = window.devicePixelRatio || 1;
    W = stageEl.clientWidth;
    H = stageEl.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx = canvas.getContext('2d');
    schedule();
  }

  /** One frame is asked for at a time, and only while something needs drawing. */
  let frameId = 0;
  function schedule() {
    if (!frameId) frameId = requestAnimationFrame(frame);
  }

  function frame() {
    frameId = 0;
    if (!data || !ctx || W === 0 || H === 0) return;
    // The same clock a tap stamps its volley with; the frame's own timestamp
    // can trail it, which would start a flight a moment in the past.
    const now = performance.now();
    // The room under the rule follows from the name size; the lab does the same.
    CONFIG.axisDepth = axisDepth(true, CONFIG);
    const flight = flightFrame(LIGHTS, lit, opening, now, motionLevel());
    // A landed opening is spent, so an unrelated redraw does not fly it again.
    if (opening && !flight.opening) opening = null;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const stats = draw(ctx, data, CONFIG, { width: W, height: H }, {
      palette: colors,
      lit: lit?.spans,
      flight,
      labels: true,
      view,
    });
    names = stats.names;
    if (!flight.settled) schedule();
  }

  // ===== Gestures: drag to pan, pinch or wheel to zoom, tap to light =====

  /** Zoom runs out past the whole picture, so a stretched line can be seen whole. */
  const MIN_K = 0.05;
  const MAX_K = 60;
  /** One wheel notch, as tuned in the lab. */
  const WHEEL_STEP = 1.12 ** 2;
  /**
   * How far above the rule a tap still counts as aimed at the ruler. Every arc
   * has a foot on the rule, so near it a tap hits an arc every time; the
   * ruler wins there, and only a tap out in the field means an arc.
   */
  const AXIS_GRAB_PX = 44;

  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let pinchStart: { dist: number; k: number } | null = null;

  /**
   * Dragging a range instead of panning. A toggle rather than a long-press,
   * because long-press-then-drag and a pan are the same gesture on a phone.
   */
  let rangeMode = false;
  let rangeFrom: number | null = null;

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  /** A pointer's position on the canvas, in CSS pixels. */
  function onScreen(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** The same point in the picture's own coordinates, undoing pan and zoom. */
  function toPicture(at: { x: number; y: number }): { x: number; y: number } {
    return {
      x: (at.x - W / 2) / view.k + W / 2 - view.x,
      y: (at.y - H / 2) / view.k + H / 2 - view.y,
    };
  }

  /**
   * Zoom to `k`, keeping the point under (sx, sy) where it is. Over the ruler
   * the anchor is the rule itself: zooming about a point below the line flung
   * every arc off the top.
   */
  function zoomAt(sx: number, sy: number, k: number) {
    const next = clamp(k, MIN_K, MAX_K);
    const horizontal = CONFIG.orientation === 'horizontal';
    const { rule } = rulerAt({ width: W, height: H }, CONFIG, true, view);
    if ((horizontal ? sy : sx) >= rule - AXIS_GRAB_PX) {
      const size = horizontal ? H : W;
      const frame = frameFor({ width: W, height: H }, CONFIG);
      const natural = size / 2 + view.k * (frame.originAcross + (horizontal ? view.y : view.x) - size / 2);
      if (horizontal) sy = natural;
      else sx = natural;
    }
    const wx = (sx - W / 2) / view.k + W / 2 - view.x;
    const wy = (sy - H / 2) / view.k + H / 2 - view.y;
    view.k = next;
    view.x = (sx - W / 2) / next + W / 2 - wx;
    view.y = (sy - H / 2) / next + H / 2 - wy;
    schedule();
  }

  /** The pan and zoom outlive a reload or a fold, like the map's center does. */
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function rememberView() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => remember({ view: { ...view } }), 400);
  }

  function onPointerDown(e: PointerEvent) {
    if (!data) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    if (rangeMode && pointers.size === 1) rangeFrom = positionAt(onScreen(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // Zoom about the point between the fingers, so what is under them stays put.
      const mid = onScreen({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      zoomAt(mid.x, mid.y, pinchStart.k * (dist / pinchStart.dist));
      moved = true;
      return;
    }

    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    lastX = e.clientX;
    lastY = e.clientY;

    // In range mode the drag picks a passage instead of moving the picture.
    if (rangeMode && rangeFrom !== null) {
      const to = positionAt(onScreen(e));
      if (to !== null) lightRange(rangeFrom, to, false);
      return;
    }

    view.x += dx / view.k;
    view.y += dy / view.k;
    schedule();
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size > 0) return;
    dragging = false;
    // A finished range drag flies its arcs now, over the span the reader chose.
    if (rangeMode && rangeFrom !== null && moved) {
      const to = positionAt(onScreen(e));
      if (to !== null) lightRange(rangeFrom, to);
      rangeFrom = null;
      return;
    }
    rangeFrom = null;
    if (moved) rememberView();
    else tap(e);
  }

  function onWheel(e: WheelEvent) {
    if (!data) return;
    e.preventDefault();
    const at = onScreen(e);
    zoomAt(at.x, at.y, view.k * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP));
    rememberView();
  }

  function wholeBible() {
    view = { x: 0, y: 0, k: 1 };
    remember({ view: { ...view } });
    schedule();
  }

  // ===== What a tap lights =====

  /** What the card at the foot shows. */
  type Card =
    | { kind: 'link'; from: ConnectionRef; to: ConnectionRef; toLabel: string; votes: number }
    | { kind: 'span'; title: string; open: ConnectionRef; out: number; in: number };
  let card: Card | null = null;

  /** The book picker's value, kept in step with a tapped name. */
  let pickedBook = '';

  /** Light a set of spans, launching their arcs now. */
  function light(spans: Span[]) {
    lit = spans.length ? litSetFor(spans, performance.now()) : null;
    schedule();
  }

  /** Everything back on, nothing picked. */
  function showAll() {
    lit = null;
    card = null;
    pickedBook = '';
    schedule();
  }

  function lightBook(name: string) {
    const span = name ? bookSpan(name) : null;
    if (!span || !data) {
      showAll();
      return;
    }
    pickedBook = name;
    light([span]);
    const reach = countReach(data, span);
    card = { kind: 'span', title: name, open: { book: name, chapter: 1, verse: 1 }, out: reach.out, in: reach.in };
  }

  /** The first verse of the chapter under a screen point, or null off the line. */
  function positionAt(at: { x: number; y: number }): number | null {
    if (!data) return null;
    const chapter = chapterAtScreen(data, CONFIG, { width: W, height: H }, view, at);
    return chapter === null ? null : data.chapterStarts[chapter];
  }

  /** One past the last verse of the chapter a position falls in. */
  function endOfChapterAt(position: number): number {
    if (!data) return position + 1;
    const starts = data.chapterStarts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= position) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1 < starts.length ? starts[lo + 1] : data.totalVerses;
  }

  /**
   * Light everything between two verse positions. Mid-drag (`restart` false)
   * the range is simply shown; the volley flies when the finger lifts, or it
   * would never leave the ground.
   */
  function lightRange(a: number, b: number, restart = true) {
    if (!data) return;
    const lo = Math.min(a, b);
    // The chapter the drag ended in is included whole.
    const end = endOfChapterAt(Math.max(a, b));
    const spans = [{ start: lo, end }];
    pickedBook = '';
    if (restart) light(spans);
    else {
      // Launched long enough ago that every arc has already landed.
      lit = { spans, startedAt: -1e9 };
      schedule();
    }
    const from = refAt(lo);
    const to = refAt(Math.max(end - 1, lo));
    if (!from || !to || !restart) return;
    const reach = countReach(data, { start: lo, end });
    const title =
      from.book === to.book && from.chapter === to.chapter
        ? `${from.book} ${from.chapter}`
        : from.book === to.book
          ? `${from.book} ${from.chapter}–${to.chapter}`
          : `${from.book} ${from.chapter} – ${to.book} ${to.chapter}`;
    card = { kind: 'span', title, open: { ...from, verse: 1 }, out: reach.out, in: reach.in };
  }

  function tap(e: PointerEvent) {
    if (!data) return;
    const at = onScreen(e);
    const hit = rulerHit(data, CONFIG, { width: W, height: H }, view, true, names, at, AXIS_GRAB_PX);

    if (hit?.kind === 'book') {
      lightBook(data.books[hit.book].name);
      return;
    }

    if (hit?.kind === 'chapter') {
      const ref = refAt(data.chapterStarts[hit.chapter]);
      const span = ref ? chapterSpan(ref.book, ref.chapter) : null;
      if (span && ref) {
        pickedBook = '';
        light([span]);
        const reach = countReach(data, span);
        card = { kind: 'span', title: `${ref.book} ${ref.chapter}`, open: ref, out: reach.out, in: reach.in };
      }
      return;
    }

    // Out among the arcs: only the ones on show can be picked.
    const arc = pick(data, CONFIG, { width: W, height: H }, toPicture(at), 7 / view.k, lit?.spans);
    if (arc !== null) showLink(arc);
  }

  /** A tapped arc: both verses on the card, and both chapters lit. */
  function showLink(hit: number) {
    if (!data) return;
    const from = refAt(data.from[hit]);
    const a = refAt(data.toStart[hit]);
    const b = refAt(data.toEnd[hit]);
    if (!from || !a) return;
    const ranged = b && data.toStart[hit] !== data.toEnd[hit];
    const toLabel = ranged
      ? `${a.book} ${a.chapter}:${a.verse}–${b.chapter === a.chapter ? b.verse : `${b.chapter}:${b.verse}`}`
      : `${a.book} ${a.chapter}:${a.verse}`;
    card = { kind: 'link', from, to: a, toLabel, votes: data.votes[hit] };

    // Both ends by their chapters, not the two bare verses: two verses out of
    // 31,102 light almost nothing, which reads as the selection being lost.
    const spans: Span[] = [];
    const fromSpan = chapterSpan(from.book, from.chapter);
    if (fromSpan) spans.push(fromSpan);
    const toSpan = chapterSpan(a.book, a.chapter);
    if (toSpan) spans.push(toSpan);
    pickedBook = '';
    light(spans);
  }

  function toggleRange() {
    rangeMode = !rangeMode;
    rangeFrom = null;
  }

  /**
   * Take the reader to a verse. The Timeline's call: a crumb first, so the
   * back arrow returns with this window still open, then the jump. From full
   * screen it drops back into its window first, or the reader would be hidden.
   */
  async function read(ref: ConnectionRef) {
    await setFullscreen(false);
    const current = get(navigationStore);
    navigationStore.pushHistory(current, 'connections');
    navigationStore.navigateToVerse(current.translation, ref.book, ref.chapter, ref.verse);
  }

  // ===== Full screen =====
  //
  // The pane lifted out of its window and put back, so the view and the card
  // come along and nothing reloads. Not remembered over a reload.

  let fullscreen = false;

  /** Moved to <body> while full screen, as the Timeline does, so a fixed box covers the screen. */
  function portal(node: HTMLElement, on: boolean) {
    const home = node.parentElement!;
    const place = (next: boolean) => {
      if (next) document.body.appendChild(node);
      else if (node.parentElement !== home) home.appendChild(node);
    };
    place(on);
    return {
      update: place,
      destroy() {
        node.remove();
      },
    };
  }

  async function setFullscreen(on: boolean) {
    if (on === fullscreen) return;
    fullscreen = on;
    await tick();
    measure();
  }

  $: if ((missing || error) && fullscreen) fullscreen = false;

  /** Escape leaves full screen, unless a lookup card over it wants the key. */
  function onKeydownCapture(e: KeyboardEvent) {
    if (!fullscreen || e.key !== 'Escape' || get(lookupStore)) return;
    void setFullscreen(false);
  }

  // ===== Loading =====

  async function load(first: boolean) {
    if (!first && !missing) return;
    loading = true;
    missing = false;
    error = null;
    try {
      if (!(await connectionsInstalled())) {
        missing = true;
        return;
      }
      data = await loadConnections();
      const saved = windowState?.contentState?.view;
      if (saved && [saved.x, saved.y, saved.k].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        view = { x: saved.x, y: saved.y, k: clamp(saved.k, MIN_K, MAX_K) };
      }
      // The opening volley: the whole Bible flies in, Genesis first.
      if (LIGHTS.openOnLoad && motionLevel() === 'full') opening = { startedAt: performance.now() };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
    await tick();
    measure();
  }

  let resizeObserver: ResizeObserver | null = null;
  let observed: HTMLDivElement | null = null;
  $: if (stageEl !== observed) {
    resizeObserver?.disconnect();
    observed = stageEl ?? null;
    if (observed) {
      resizeObserver = new ResizeObserver(() => measure());
      resizeObserver.observe(observed);
    }
  }

  onMount(() => {
    void load(true);
    watchTheme();
    const onPacks = () => void load(false);
    window.addEventListener('packsUpdated', onPacks);
    window.addEventListener('keydown', onKeydownCapture, true);
    return () => {
      window.removeEventListener('packsUpdated', onPacks);
      window.removeEventListener('keydown', onKeydownCapture, true);
    };
  });

  onDestroy(() => {
    if (frameId) cancelAnimationFrame(frameId);
    if (saveTimer) clearTimeout(saveTimer);
    themeObserver?.disconnect();
    resizeObserver?.disconnect();
    pointers.clear();
    releaseConnections();
  });
</script>

<!-- `.no-edge-gesture`, or a drag near the screen edge arms a new window
     instead of panning the arcs. -->
<div class="connections-home">
<div
  class="connections no-edge-gesture"
  class:fullscreen
  style="{gripStyle};{themeStyle}"
  use:portal={fullscreen}
>
  {#if missing}
    <div class="gate">
      <GetPacksCard
        packs={['connections']}
        title="Connections isn’t installed yet"
        note="Every cross-reference in Scripture on one screen, arching from where it is written to where it is answered. Works with no connection once it’s there."
      />
    </div>
  {:else if error}
    <div class="gate">
      <div class="gate-card">
        <div class="gate-title">Connections failed to open</div>
        <p>{error}</p>
      </div>
    </div>
  {:else}
    <div class="nav">
      <div class="nav-title">Connections</div>
      <select
        class="book-pick"
        aria-label="Light a book"
        value={pickedBook}
        on:change={(e) => lightBook(e.currentTarget.value)}
        disabled={!data}
      >
        <option value="">Light a book…</option>
        {#each data?.books ?? [] as book (book.name)}
          <option value={book.name}>{book.name}</option>
        {/each}
      </select>
      <div class="nav-spacer"></div>
      <button
        class="btn"
        class:on={rangeMode}
        aria-pressed={rangeMode}
        title="Drag along the line to light a stretch of chapters"
        on:click={toggleRange}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h18"/><path d="M7 13v8"/><path d="M17 13v8"/><path d="M9.5 10l2.5-3 2.5 3"/></svg>
        <span class="btn-label">Select range</span>
      </button>
      {#if lit}
        <button class="btn" title="Show every arc again" on:click={showAll}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M5 18a7 7 0 0114 0"/><path d="M8.5 18a3.5 3.5 0 017 0"/></svg>
          <span class="btn-label">Show all</span>
        </button>
      {/if}
      <button class="btn" title="Back to the whole Bible" on:click={wholeBible}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/></svg>
        <span class="btn-label">Whole Bible</span>
      </button>
      <button
        class="btn btn-icon"
        class:on={fullscreen}
        aria-pressed={fullscreen}
        title={fullscreen ? 'Back to the window' : 'Full screen'}
        aria-label={fullscreen ? 'Back to the window' : 'Full screen'}
        on:click={() => setFullscreen(!fullscreen)}
      >
        {#if fullscreen}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 4 9 9 4 9"/><polyline points="20 9 15 9 15 4"/><polyline points="15 20 15 15 20 15"/><polyline points="4 15 9 15 9 20"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 9 4 4 9 4"/><polyline points="15 4 20 4 20 9"/><polyline points="20 15 20 20 15 20"/><polyline points="9 20 4 20 4 15"/></svg>
        {/if}
      </button>
    </div>

    <div class="stage" class:range={rangeMode} bind:this={stageEl}>
      <canvas
        bind:this={canvas}
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
        on:wheel|nonpassive={onWheel}
      ></canvas>
      {#if loading}
        <div class="loading">Reading the connections…</div>
      {:else if rangeMode && !card}
        <div class="hint">Drag along the line to light a stretch of chapters.</div>
      {/if}
    </div>

    {#if card}
      <div class="card">
        <div class="card-head">
          {#if card.kind === 'link'}
            <div class="card-title">Linked verses</div>
            <div class="card-meta">{card.votes.toLocaleString()} {card.votes === 1 ? 'vote' : 'votes'}</div>
          {:else}
            <div class="card-title">{card.title}</div>
            <div class="card-meta">{card.out.toLocaleString()} out · {card.in.toLocaleString()} in</div>
          {/if}
          <CloseX label="Close" on:click={() => (card = null)} />
        </div>
        {#if card.kind === 'link'}
          {@const link = card}
          <VerseRefRow book={link.from.book} chapter={link.from.chapter} verse={link.from.verse} onOpen={() => read(link.from)} />
          <VerseRefRow book={link.to.book} chapter={link.to.chapter} verse={link.to.verse} label={link.toLabel} onOpen={() => read(link.to)} />
        {:else}
          {@const span = card}
          <VerseRefRow book={span.open.book} chapter={span.open.chapter} verse={span.open.verse} label={span.title} onOpen={() => read(span.open)} />
        {/if}
      </div>
    {/if}

    <div class="credit">{CREDIT}</div>
  {/if}
</div>
</div>

<style>
  .connections {
    --bg: #1a1a1a;
    --text: #e0e0e0;
    --muted: #8a8a8a;
    --rule: #555;
    --focus: #a45be9;
    --nav-h: 46px;
    /* The app's display face, chrome only. */
    --display: 'Milonga', cursive;

    --grip-l: 0px;
    --grip-r: 0px;
    --grip-b: 0px;

    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    container-type: inline-size;
    overflow: hidden;
    isolation: isolate;
  }

  /* Stays in the window while the pane itself goes full screen. */
  .connections-home { height: 100%; }

  /* Over the whole app, under the lookup card (10001) and the notices. */
  .connections.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 10000;
    height: auto;
    box-sizing: border-box;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }

  /* ---------------- bar ---------------- */
  .nav {
    flex: none;
    height: var(--nav-h);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 calc(8px + var(--grip-r)) 0 calc(8px + var(--grip-l));
    background: var(--bg);
    border-bottom: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
    position: relative;
    z-index: 20;
    font-family: var(--display);
    overflow: hidden;
    /* Bar size: scaled as one piece, the same as the Timeline's bar. */
    width: calc(100% / var(--bar-scale, 1));
    transform: scale(var(--bar-scale, 1));
    transform-origin: 0 0;
    margin-bottom: calc(var(--nav-h) * (var(--bar-scale, 1) - 1));
  }
  .nav-title { font-size: 16px; letter-spacing: .3px; flex: none; }
  .nav-spacer { flex: 1; min-width: 4px; }

  .book-pick {
    height: 30px; min-width: 0; max-width: 150px; padding: 0 6px; border-radius: 6px;
    background: color-mix(in srgb, var(--text) 6%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    color: var(--text);
    font: 12.5px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    flex: 0 1 auto;
  }
  .book-pick:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

  .btn {
    height: 30px; min-width: 30px; padding: 0 9px; border-radius: 6px; cursor: pointer;
    background: color-mix(in srgb, var(--text) 6%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    color: var(--text);
    font: inherit; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px;
    white-space: nowrap; flex: none;
    transition: background .12s, border-color .12s;
  }
  .btn:hover { background: color-mix(in srgb, var(--text) 12%, var(--bg)); }
  .btn.on { border-color: var(--focus); background: color-mix(in srgb, var(--focus) 22%, var(--bg)); }
  .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .btn svg { width: 15px; height: 15px; flex: none; }
  .btn-icon { padding: 0; justify-content: center; }
  /* Narrow: the words go, the icons stay. */
  @container (max-width: 560px) {
    .nav .btn-label { display: none; }
    .nav .btn:not(.btn-icon) { padding: 0; width: 30px; justify-content: center; }
  }
  @container (max-width: 330px) {
    .nav-title { display: none; }
  }

  /* ---------------- the picture ---------------- */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* The gestures are ours; the browser must not also scroll or pinch. */
    touch-action: none;
    cursor: grab;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  canvas:active { cursor: grabbing; }
  .stage.range canvas { cursor: col-resize; }

  .loading {
    position: absolute; inset: 0; display: grid; place-items: center;
    color: var(--muted); font-size: 13px;
    pointer-events: none;
  }
  .hint {
    position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    padding: 4px 10px; border-radius: 6px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
    color: var(--muted); font-size: 12px; white-space: nowrap;
    pointer-events: none;
  }

  /* ---------------- the card ---------------- */
  .card {
    flex: none;
    max-height: 45%;
    overflow-y: auto;
    padding: 6px calc(10px + var(--grip-r)) 8px calc(10px + var(--grip-l));
    background: color-mix(in srgb, var(--text) 4%, var(--bg));
    border-top: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .card-title { font-family: var(--display); font-size: 15px; }
  .card-meta { flex: 1; color: var(--muted); font-size: 12px; }
  .card :global(.ref-row + .ref-row) { margin-top: 6px; }
  /* The row's own colors assume the dark theme (or the inverting filter, which
     this window never has), so on a pale theme its grey preview text would
     vanish. Here it takes the window's ink and paper instead. */
  .card :global(.ref-row) {
    background: color-mix(in srgb, var(--text) 5%, var(--bg));
    border-color: color-mix(in srgb, var(--text) 12%, transparent);
  }
  .card :global(.ref-row:hover) { background: color-mix(in srgb, var(--text) 10%, var(--bg)); }
  .card :global(.ref-row-text) { color: color-mix(in srgb, var(--text) 80%, var(--bg)); }

  /* ---------------- credit ---------------- */
  .credit {
    flex: none;
    padding: 2px calc(8px + var(--grip-r)) calc(3px + var(--grip-b)) calc(8px + var(--grip-l));
    color: var(--muted);
    font-size: 10px;
    background: var(--bg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---------------- not installed ---------------- */
  .gate {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    overflow-y: auto;
  }
  .gate-card {
    max-width: 360px;
    text-align: center;
    color: var(--muted);
  }
  .gate-title { color: var(--text); font-size: 15px; margin-bottom: 6px; }
</style>
