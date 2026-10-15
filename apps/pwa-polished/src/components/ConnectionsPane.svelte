<script lang="ts">
  /**
   * The Connections window: every cross-reference in Scripture, four ways.
   * Arcs: an arc over one line of all 1,189 chapters. Grid: every book against
   * every book, each square the links between two of them. Detail: one square
   * opened up, two books side by side with a line for each link. Chord: the 66
   * books around a ring, a ribbon between each pair as wide as their links.
   *
   * The drawing, the shapes and the flights are lib/connections — the same
   * modules connections-lab.html tunes, so what was tuned there is what shows
   * here. This file is the chrome, the gestures and the card.
   *
   * Taps: a book name lights the book, a chapter bar lights the chapter, and an
   * arc out in the field opens a card with both of its verses. Those rows open
   * the verse in the reader. Pan with a drag, zoom with a pinch or the wheel;
   * Whole Bible puts the picture back. On the grid a square opens the detail and
   * a name picks out its row or column; on the detail a chapter, a heading or a
   * book name lights its lines, and a line opens its two verses. On the ring a
   * book keeps only its own ribbons, and a ribbon opens that pair on the detail.
   *
   * Never `.themed`: the light and sepia themes are an inverting filter, and a
   * canvas under it would show every book color as its opposite. The chrome
   * takes the theme's real colors from lib/connections/palette.ts instead, so
   * it still follows the reader's theme; the pictures are drawn on black or
   * cream, the reader's pick (canvasPalette).
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { windowStore } from '../lib/stores/windowStore';
  import { navigationStore } from '../stores/navigationStore';
  import { landingIn } from '../lib/versification';
  import { lookupStore } from '../stores/lookupStore';
  import { motionLevel } from '../lib/motion';
  import GetPacksCard from './GetPacksCard.svelte';
  import VerseRefRow from './VerseRefRow.svelte';
  import CloseX from './CloseX.svelte';
  import {
    connectionsInstalled,
    loadConnections,
    holdConnections,
    refAt,
    bookSpan,
    chapterSpan,
    type ConnectionsData,
    type ConnectionRef,
  } from '../lib/connections/data';
  import { CONFIG, frameFor, type ConnectionsConfig } from '../lib/connections/layout';
  import { arcPeak, axisDepth, chapterAtScreen, draw, pick, rulerAt, rulerHit, type PlacedName } from '../lib/connections/render';
  import {
    canvasGround,
    canvasPalette,
    palette,
    type CanvasGround,
    type ConnectionsPalette,
  } from '../lib/connections/palette';
  import { LIGHTS, countReach, flightFrame, litSetFor, type LitSet, type Span } from '../lib/connections/lights';
  import {
    MAX_ITEMS,
    MAX_SETS,
    MAX_SHOWN_SETS,
    MAX_VIEWS,
    cleanChordLook,
    cleanGridLook,
    cleanLook,
    cleanPair,
    cleanTab,
    itemFromSpan,
    itemLabel,
    layerFor,
    newSetId,
    nextSetColor,
    parseItem,
    readyOffers,
    saveSets,
    saveViews,
    savedSets,
    savedViews,
    type ChordLook,
    type ConnectionSet,
    type ConnectionsLook,
    type ConnectionsTab,
    type DetailPair,
    type GridLook,
    type ConnectionsView,
    type ReadyOffer,
    type SetItem,
    type SetLayer,
  } from '../lib/connections/sets';
  import { getHighlightNames, updateSettings } from '../adapters/settings';
  import { CREDIT, renderConnectionsImage, renderFramedImage } from '../lib/connections/image';
  import {
    GRID,
    BOOK_GROUPS,
    bandAt,
    buildGridLayout,
    cellAt,
    drawGrid,
    gridFrame,
    laneNamed,
    paintGrid,
    sortIntoCells,
    type GridCells,
    type GridConfig,
    type GridLayout,
    type GridView,
  } from '../lib/connections/grid';
  import {
    DETAIL,
    bookHeadings,
    buildDetail,
    detailAxis,
    detailHit,
    drawDetail,
    type DetailConfig,
    type DetailLit,
    type DetailModel,
    type DetailView,
    type PlacedHeading,
  } from '../lib/connections/detail';
  import {
    CHORD,
    buildChordLayout,
    busierWay,
    chordHit,
    chordScene,
    countChords,
    drawChord,
    partnersOf,
    type ChordConfig,
    type ChordCounts,
    type ChordLayout,
    type ChordPick,
    type ChordScene,
    type ChordView,
  } from '../lib/connections/chord';
  import { download } from '../lib/backup/saveFile';
  import { isIOS } from '../lib/device';
  import { askConfirm } from '../stores/confirmStore';

  export let windowId: string | undefined = undefined;

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

  /**
   * Every picture — arcs, grid and detail — is drawn on black or cream, the
   * reader's pick, whatever the theme; the bar, the cards and the panel keep
   * the theme's colors.
   */
  let ground: CanvasGround = canvasGround();
  $: canvasColors = canvasPalette(ground);

  function toggleGround() {
    ground = ground === 'black' ? 'cream' : 'black';
    updateSettings({ connectionsBackground: ground });
    // The grid's image has the ground baked in.
    staleGrid('paint');
    schedule();
  }

  /** The theme changes by a class on <body>, and a custom theme by its style. */
  let themeObserver: MutationObserver | null = null;
  function watchTheme() {
    themeObserver = new MutationObserver(() => {
      colors = palette();
      const next = canvasGround();
      if (next !== ground) {
        ground = next;
        // The grid's image has the ground baked in.
        staleGrid('paint');
      }
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

  /**
   * This window's own copy of the look. The lab writes into the shared CONFIG;
   * here a saved view or the View controls change one window, not every
   * Connections window open.
   */
  let config: ConnectionsConfig = { ...CONFIG };

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
    // The ring's ribbons are paths in pixels, laid out for this size.
    if (chordLayout) chordSceneNow = chordScene(chordLayout, chordConfig, { width: W, height: H });
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
    if (tab === 'grid') {
      frameGrid(ctx, data);
      return;
    }
    if (tab === 'detail') {
      frameDetail(ctx, data);
      return;
    }
    if (tab === 'chord') {
      frameChord(ctx);
      return;
    }
    // The same clock a tap stamps its volley with; the frame's own timestamp
    // can trail it, which would start a flight a moment in the past.
    const now = performance.now();
    // The room under the rule follows from the name size; the lab does the same.
    config.axisDepth = axisDepth(true, config);
    // Showing or hiding a set flies its arcs in the way a tap does.
    const flying = lit ?? (setsLaunch !== null ? { spans: [], startedAt: setsLaunch } : null);
    const flight = flightFrame(LIGHTS, flying, opening, now, motionLevel());
    // A landed opening is spent, so an unrelated redraw does not fly it again.
    if (opening && !flight.opening) opening = null;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const stats = draw(ctx, data, config, { width: W, height: H }, {
      palette: canvasColors,
      lit: lit?.spans,
      flight,
      labels: true,
      view,
      sets: layer,
      selected,
      hovered,
    });
    names = stats.names;
    if (selected !== null) placePopup(selected);
    if (!flight.settled) schedule();
  }

  // ===== Gestures: drag to pan, pinch or wheel to zoom, tap to light =====

  /** Zoom runs out past the whole picture, so a stretched line can be seen whole. */
  const MIN_K = 0.05;
  const MAX_K = 60;
  /** One wheel notch, as tuned in the lab. */
  const WHEEL_STEP = 1.12 ** 2;
  /**
   * How far above the rule a wheel or pinch still zooms about the rule rather
   * than the pointer.
   */
  const AXIS_GRAB_PX = 44;
  /**
   * How far above the rule a tap still counts as the ruler. Only a sliver: the
   * arcs are what a tap there is after, and the bars hang below the rule.
   */
  const RULER_TAP_PX = 4;

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
    if (tab === 'grid') {
      // About the point; the grid has no rule to anchor on.
      const frame = gridFrame({ width: W, height: H }, gridConfig);
      const next = clamp(k, GRID_K[0], GRID_K[1]);
      const u = (sx - frame.left - gridView.x) / gridView.k;
      const v = (sy - frame.top - gridView.y) / gridView.k;
      gridView = { x: sx - frame.left - u * next, y: sy - frame.top - v * next, k: next };
      schedule();
      return;
    }
    if (tab === 'detail') {
      // Up and down only: the two axes stay where they are across.
      const next = clamp(k, DETAIL_K[0], DETAIL_K[1]);
      const f = (sy - detailConfig.padTop - detailView.y) / detailView.k;
      detailView = { y: sy - detailConfig.padTop - f * next, k: next };
      schedule();
      return;
    }
    if (tab === 'chord') {
      // About the point, around the ring's middle.
      const next = clamp(k, CHORD_K[0], CHORD_K[1]);
      const u = (sx - W / 2 - chordView.x) / chordView.k;
      const v = (sy - H / 2 - chordView.y) / chordView.k;
      chordView = { x: sx - W / 2 - u * next, y: sy - H / 2 - v * next, k: next };
      schedule();
      return;
    }
    const next = clamp(k, MIN_K, MAX_K);
    const horizontal = config.orientation === 'horizontal';
    const { rule } = rulerAt({ width: W, height: H }, config, true, view);
    if ((horizontal ? sy : sx) >= rule - AXIS_GRAB_PX) {
      const size = horizontal ? H : W;
      const frame = frameFor({ width: W, height: H }, config);
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
    saveTimer = setTimeout(() => remember({ view: { ...view }, gridView: { ...gridView }, chordView: { ...chordView } }), 400);
  }

  function onPointerDown(e: PointerEvent) {
    if (!data) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    if (rangeMode && tab === 'arcs' && pointers.size === 1) rangeFrom = positionAt(onScreen(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: currentK() };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) {
      onHover(e);
      return;
    }
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

    if (tab === 'grid') gridView = { ...gridView, x: gridView.x + dx, y: gridView.y + dy };
    else if (tab === 'detail') detailView = { ...detailView, y: detailView.y + dy };
    else if (tab === 'chord') chordView = { ...chordView, x: chordView.x + dx, y: chordView.y + dy };
    else {
      view.x += dx / view.k;
      view.y += dy / view.k;
    }
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
    zoomAt(at.x, at.y, currentK() * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP));
    rememberView();
  }

  function wholeBible() {
    view = { x: 0, y: 0, k: 1 };
    remember({ view: { ...view } });
    schedule();
  }

  /** The open tab's zoom. */
  function currentK(): number {
    return tab === 'grid' ? gridView.k : tab === 'detail' ? detailView.k : tab === 'chord' ? chordView.k : view.k;
  }

  /** The bar's button: the open tab's picture back to whole. */
  function fitView() {
    if (tab === 'grid') {
      gridView = { x: 0, y: 0, k: 1 };
      remember({ gridView: { ...gridView } });
      schedule();
    } else if (tab === 'detail') {
      detailView = { y: 0, k: 1 };
      schedule();
    } else if (tab === 'chord') {
      chordView = { x: 0, y: 0, k: 1 };
      remember({ chordView: { ...chordView } });
      schedule();
    } else wholeBible();
  }

  // ===== What a tap lights =====

  /** What the card at the foot shows. */
  type Card = (
    | { kind: 'link'; index: number; from: ConnectionRef; to: ConnectionRef; toLabel: string; votes: number }
    | { kind: 'span'; title: string; meta: string; open: ConnectionRef; label: string }
  ) & {
    /** What Add to set adds: the passage, or an arc's two ends. */
    items: SetItem[];
  };
  let card: Card | null = null;

  function reachMeta(reach: { out: number; in: number }): string {
    return `${reach.out.toLocaleString()} out · ${reach.in.toLocaleString()} in`;
  }

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
    card = {
      kind: 'span',
      title: name,
      meta: reachMeta(reach),
      open: { book: name, chapter: 1, verse: 1 },
      label: name,
      items: itemsOf([span]),
    };
  }

  /**
   * Light one chapter, with its card. A tapped chapter on the ruler and a
   * chapter sent from the reader strip both come here, so they behave the same.
   */
  function lightChapter(book: string, chapter: number) {
    const span = chapterSpan(book, chapter);
    if (!span || !data) return;
    pickedBook = '';
    light([span]);
    const reach = countReach(data, span);
    card = {
      kind: 'span',
      title: `${book} ${chapter}`,
      meta: reachMeta(reach),
      open: { book, chapter, verse: 1 },
      label: `${book} ${chapter}`,
      items: itemsOf([span]),
    };
  }

  /** The first verse of the chapter under a screen point, or null off the line. */
  function positionAt(at: { x: number; y: number }): number | null {
    if (!data) return null;
    const chapter = chapterAtScreen(data, config, { width: W, height: H }, view, at);
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
    card = { kind: 'span', title, meta: reachMeta(reach), open: { ...from, verse: 1 }, label: title, items: itemsOf(spans) };
  }

  function tap(e: PointerEvent) {
    if (!data) return;
    const at = onScreen(e);
    if (tab === 'grid') {
      tapGrid(at);
      return;
    }
    if (tab === 'detail') {
      tapDetail(at);
      return;
    }
    if (tab === 'chord') {
      tapChord(at);
      return;
    }
    const hit = rulerHit(data, config, { width: W, height: H }, view, true, names, at, RULER_TAP_PX);

    if (hit?.kind === 'book') {
      lightBook(data.books[hit.book].name);
      return;
    }

    if (hit?.kind === 'chapter') {
      const ref = refAt(data.chapterStarts[hit.chapter]);
      if (ref) lightChapter(ref.book, ref.chapter);
      return;
    }

    // Out among the arcs: only the ones on show can be picked.
    const arc = pick(data, config, { width: W, height: H }, toPicture(at), 7 / view.k, lit?.spans, layer);
    if (arc !== null) showLink(arc);
    else if (card?.kind === 'link') card = null;
  }

  /** A link's card: both of its verses, and its votes. */
  function linkCard(hit: number): Card | null {
    if (!data) return null;
    const from = refAt(data.from[hit]);
    const a = refAt(data.toStart[hit]);
    const b = refAt(data.toEnd[hit]);
    if (!from || !a) return null;
    const ranged = b && data.toStart[hit] !== data.toEnd[hit];
    const toLabel = ranged
      ? `${a.book} ${a.chapter}:${a.verse}–${b.chapter === a.chapter ? b.verse : `${b.chapter}:${b.verse}`}`
      : `${a.book} ${a.chapter}:${a.verse}`;
    return {
      kind: 'link',
      index: hit,
      from,
      to: a,
      toLabel,
      votes: data.votes[hit],
      items: itemsOf([
        { start: data.from[hit], end: data.from[hit] + 1 },
        { start: data.toStart[hit], end: Math.max(data.toEnd[hit], data.toStart[hit]) + 1 },
      ]),
    };
  }

  /**
   * A tapped arc: picked, glowing over the rest, with its two verses in a
   * small card beside it. Nothing else is hidden, so the arc is seen among
   * its neighbors.
   */
  function showLink(hit: number) {
    if (!data) return;
    const next = linkCard(hit);
    if (!next || next.kind !== 'link') return;
    card = next;
  }

  // ===== The picked arc and its card =====

  /** The picked arc on the Arcs tab, drawn glowing. Follows the card. */
  $: selected = tab === 'arcs' && card?.kind === 'link' ? card.index : null;
  /** The arc under the mouse, glowing faintly. Never set by touch. */
  let hovered: number | null = null;
  /** The same on the other tabs: a grid square, a detail line. */
  let hoveredCell: { row: number; col: number } | null = null;
  let hoveredLine: number | null = null;
  $: selected, hovered, hoveredCell, hoveredLine, schedule();

  let popupEl: HTMLDivElement | undefined;
  /** Where the card sits in the stage, pinned to the top of its arc. */
  let popupStyle = '';

  /**
   * Pin the card beside the top of the arc, on whichever side has more room,
   * kept inside the stage. Called each frame, so it rides along with a pan.
   */
  function placePopup(link: number) {
    if (!data) return;
    const peak = arcPeak(data, config, { width: W, height: H }, view, link);
    const PAD = 8;
    const GAP = 14;
    const w = popupEl?.offsetWidth ?? 320;
    const h = popupEl?.offsetHeight ?? 160;
    const x = clamp(peak.x - w / 2, PAD, Math.max(PAD, W - w - PAD));
    const below = peak.y < H / 2;
    const y = below
      ? clamp(peak.y + GAP, PAD, Math.max(PAD, H - h - PAD))
      : clamp(peak.y - GAP - h, PAD, Math.max(PAD, H - h - PAD));
    const next = `left:${Math.round(x)}px;top:${Math.round(y)}px`;
    if (next !== popupStyle) popupStyle = next;
  }

  /** Once the card has its real size, place it again with that size. */
  $: if (popupEl && selected !== null) void tick().then(() => selected !== null && placePopup(selected));

  // Hover: on a mouse, the pointer shows what a click would get — an arc, a
  // grid square or name, a detail line, chapter or heading. Checked at most
  // once a frame, and never mid-drag.
  let hoverAt: { x: number; y: number } | null = null;
  let hoverFrame = 0;
  let overTarget = false;

  function onHover(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || pointers.size > 0 || rangeMode) return;
    hoverAt = onScreen(e);
    if (!hoverFrame) hoverFrame = requestAnimationFrame(checkHover);
  }

  function checkHover() {
    hoverFrame = 0;
    if (!data || !hoverAt || pointers.size > 0) return;
    const at = hoverAt;
    if (tab === 'grid') {
      if (!gridLayout) return;
      const frame = gridFrame({ width: W, height: H }, gridConfig);
      const band = bandAt(gridLayout, frame, gridView, at);
      const cell = band ? null : cellAt(gridLayout, frame, gridView, at);
      if (cell?.row !== hoveredCell?.row || cell?.col !== hoveredCell?.col) hoveredCell = cell;
      overTarget = band !== null || cell !== null;
      return;
    }
    if (tab === 'detail') {
      if (!detailModel) return;
      const hit = detailHit(data, detailModel, detailConfig, { width: W, height: H }, detailView, placed, detailLit, at);
      const line = hit?.kind === 'line' ? hit.link : null;
      if (line !== hoveredLine) hoveredLine = line;
      overTarget = hit !== null;
      return;
    }
    if (tab === 'chord') {
      overTarget = !!chordSceneNow && chordHit(chordSceneNow, chordConfig, chordView, at) !== null;
      return;
    }
    const ruler = rulerHit(data, config, { width: W, height: H }, view, true, names, at, RULER_TAP_PX);
    const arc = ruler ? null : pick(data, config, { width: W, height: H }, toPicture(at), 7 / view.k, lit?.spans, layer);
    if (arc !== hovered) hovered = arc;
    overTarget = ruler !== null || arc !== null;
  }

  function endHover() {
    hoverAt = null;
    if (hovered !== null) hovered = null;
    if (hoveredCell !== null) hoveredCell = null;
    if (hoveredLine !== null) hoveredLine = null;
    overTarget = false;
  }

  function toggleRange() {
    rangeMode = !rangeMode;
    rangeFrom = null;
  }

  // ===== Tabs =====
  //
  // One window, four pictures. Each tab keeps its own pan, what it has lit
  // and its card, so moving between them loses nothing.

  const TABS: Array<{ id: ConnectionsTab; label: string }> = [
    { id: 'arcs', label: 'Arcs' },
    { id: 'grid', label: 'Grid' },
    { id: 'detail', label: 'Detail' },
    { id: 'chord', label: 'Chord' },
  ];
  let tab: ConnectionsTab = 'arcs';
  /** The other tabs' cards, put away while they are hidden. */
  const stash: Partial<Record<ConnectionsTab, Card | null>> = {};

  function setTab(next: ConnectionsTab) {
    if (next === tab) return;
    endHover();
    stash[tab] = card;
    tab = next;
    card = stash[next] ?? null;
    rangeMode = false;
    rangeFrom = null;
    remember({ tab });
    if (next === 'grid') void buildGrid();
    if (next === 'detail' && !detailModel) void openPair(pair);
    if (next === 'chord') buildChord();
    schedule();
  }

  // ===== Grid and detail: the look =====
  //
  // A grid square is its detail in miniature, so the two share one look: the
  // colors, the groups, and which links are shown. Their other dials are the
  // values tuned in connections-grid-lab.html.

  let gridLook: GridLook = {
    colorBy: DETAIL.colorBy,
    groups: GRID.groups,
    voteFloor: GRID.voteFloor,
    maxLinks: GRID.maxLinks,
  };
  /** This window's own copies, as with the arcs' config. */
  let gridConfig: GridConfig = { ...GRID };
  let detailConfig: DetailConfig = { ...DETAIL };

  function applyGridConfigs() {
    gridConfig = { ...gridConfig, groups: gridLook.groups, voteFloor: gridLook.voteFloor, maxLinks: gridLook.maxLinks };
    detailConfig = {
      ...detailConfig,
      colorBy: gridLook.colorBy,
      voteFloor: gridLook.voteFloor,
      maxLinks: gridLook.maxLinks,
    };
  }

  function applyGridLook(next: GridLook) {
    const relink = next.voteFloor !== gridLook.voteFloor || next.maxLinks !== gridLook.maxLinks;
    const recount = relink || next.groups !== gridLook.groups;
    const repaint = next.colorBy !== gridLook.colorBy;
    gridLook = next;
    applyGridConfigs();
    remember({ grid: gridLook });
    if (recount) staleGrid('count');
    else if (repaint) staleGrid('paint');
    if (relink && detailModel && data) {
      detailModel = buildDetail(data, detailModel.left, detailModel.right, detailConfig);
      detailPicked = null;
      if (tab === 'detail' && card?.kind === 'link') card = null;
    }
    schedule();
  }

  function setGridLook(patch: Partial<GridLook>) {
    applyGridLook({ ...gridLook, ...patch });
  }

  const COLOR_ORDER: GridLook['colorBy'][] = ['books', 'rainbow', 'ink'];
  const COLOR_NAMES: Record<GridLook['colorBy'], string> = {
    books: 'The two books',
    rainbow: 'By place',
    ink: 'One ink',
  };

  /** The grid's cap choices. Unlike the arcs, every link costs nothing to move once drawn. */
  const LINK_CAPS = [
    { value: 10000, label: '10,000' },
    { value: 20000, label: '20,000' },
    { value: 50000, label: '50,000' },
    { value: 100000, label: '100,000' },
    { value: 0, label: 'All' },
  ];

  // ===== The grid =====
  //
  // Drawn once into an image that pans and zooms, as in the lab. Built the
  // first time the tab shows, and again when the look or the theme changes.

  const GRID_K = [0.5, 40] as const;
  let gridLayout: GridLayout | null = null;
  let gridCells: GridCells | null = null;
  let gridImage: HTMLCanvasElement | null = null;
  /** What the grid needs redone: the links sorted into squares (and the painting), or only the painting. */
  let gridStale: 'count' | 'paint' | null = 'count';
  let gridBuilding = false;
  let gridView: GridView = { x: 0, y: 0, k: 1 };
  /** The hint at the foot goes once the grid (or the detail) has been tapped. */
  let gridTried = false;
  let detailTried = false;
  /** The square last opened, ringed. */
  let gridPicked: { row: number; col: number } | null = null;
  /** A row or column picked out by its name. */
  let gridFocus: { axis: 'row' | 'col'; lane: number } | null = null;

  function staleGrid(level: 'count' | 'paint') {
    if (gridStale !== 'count') gridStale = level;
    if (tab === 'grid') void buildGrid();
  }

  /** A canvas holds its memory until it is shrunk; the grid's is 3,072 pixels square. */
  function releaseGridImage() {
    if (!gridImage) return;
    gridImage.width = 0;
    gridImage.height = 0;
    gridImage = null;
  }

  async function buildGrid() {
    if (!data || !gridStale || gridBuilding) return;
    gridBuilding = true;
    try {
      // Let "Drawing the grid…" show before the build holds the thread.
      await tick();
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      // A change made while waiting is folded into this build.
      const level = gridStale;
      gridStale = null;
      if (!data || !level) return;
      if (level === 'count' || !gridLayout || !gridCells) {
        gridLayout = buildGridLayout(data, gridConfig);
        gridCells = sortIntoCells(data, gridConfig, gridLayout);
        // New lanes: an old pick or card may point anywhere.
        gridPicked = null;
        gridFocus = null;
        if (tab === 'grid') card = null;
        else stash.grid = null;
      }
      releaseGridImage();
      gridImage = paintGrid(data, gridCells, gridLayout, gridConfig, detailConfig, canvasColors).image;
    } finally {
      gridBuilding = false;
    }
    schedule();
  }

  function frameGrid(c: CanvasRenderingContext2D, d: ConnectionsData) {
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!gridImage || !gridLayout || !gridCells) {
      c.fillStyle = canvasColors.bg;
      c.fillRect(0, 0, W, H);
      return;
    }
    drawGrid(c, { data: d, cells: gridCells, layout: gridLayout, image: gridImage }, gridConfig, detailConfig, { width: W, height: H }, {
      palette: canvasColors,
      view: gridView,
      picked: gridPicked,
      hovered: hoveredCell,
      focus: gridFocus,
      dimTo: 0.25,
    });
  }

  /**
   * A name along the top or left picks out its column or row and dims the
   * rest (tap it again to let go); a square opens the detail.
   */
  function tapGrid(at: { x: number; y: number }) {
    if (!data || !gridLayout || !gridCells) return;
    gridTried = true;
    const frame = gridFrame({ width: W, height: H }, gridConfig);
    const band = bandAt(gridLayout, frame, gridView, at);
    if (band) {
      const same = gridFocus && gridFocus.axis === band.axis && gridFocus.lane === band.lane;
      if (same) {
        clearGrid();
        return;
      }
      gridFocus = band;
      card = laneCard(band.axis, band.lane);
      schedule();
      return;
    }
    const cell = cellAt(gridLayout, frame, gridView, at);
    if (!cell) return;
    gridPicked = cell;
    void openPair({ from: gridLayout.lanes[cell.row].name, to: gridLayout.lanes[cell.col].name });
    setTab('detail');
  }

  /** A picked-out row or column: its links, counted against the books. */
  function laneCard(axis: 'row' | 'col', index: number): Card | null {
    if (!gridLayout || !gridCells) return null;
    const lanes = gridLayout.lanes;
    const L = lanes.length;
    const lane = lanes[index];
    const counts = gridCells.counts;
    // Book squares only: the group squares count the same links again.
    let n = 0;
    lanes.forEach((other, i) => {
      if (other.kind === 'book') n += counts[axis === 'row' ? index * L + i : i * L + index];
    });
    const first = refAt(lane.start);
    if (!first) return null;
    const verb = axis === 'row' ? (n === 1 ? 'link leaves' : 'links leave') : n === 1 ? 'link arrives' : 'links arrive';
    return {
      kind: 'span',
      title: lane.name,
      meta: `${n.toLocaleString()} ${verb}`,
      open: first,
      label: lane.name,
      items: itemsOf([{ start: lane.start, end: lane.end }]),
    };
  }

  function clearGrid() {
    gridFocus = null;
    card = null;
    schedule();
  }

  // ===== The detail =====

  const DETAIL_K = [1, 80] as const;
  /** The two sides, by name. Psalms against Proverbs until one is picked. */
  let pair: DetailPair = { from: 'Psalm', to: 'Proverbs' };
  let detailModel: DetailModel | null = null;
  let detailView: DetailView = { y: 0, k: 1 };
  let detailLit: DetailLit | null = null;
  let detailPicked: number | null = null;
  /** What is lit, in words, for the saved image's title. */
  let detailLabel = '';
  /** Where the headings landed on the last draw, for tapping them. */
  let placed: PlacedHeading[] = [];
  let detailToken = 0;

  /** Open two books (or groups) side by side. */
  async function openPair(next: DetailPair) {
    if (!data) return;
    const a = laneNamed(data, next.from);
    const b = laneNamed(data, next.to);
    if (!a || !b) return;
    pair = next;
    remember({ pair });
    const token = ++detailToken;
    const translation = get(navigationStore).translation;
    const [headA, headB] = await Promise.all([
      a.kind === 'book' ? bookHeadings(data, a.name, translation) : Promise.resolve([]),
      b.kind === 'book' ? (a.name === b.name ? null : bookHeadings(data, b.name, translation)) : Promise.resolve([]),
    ]);
    // A quicker pick since has already opened; this one is stale.
    if (token !== detailToken || !data) return;
    const left = detailAxis(data, a, headA);
    const right = detailAxis(data, b, headB ?? headA);
    detailModel = buildDetail(data, left, right, detailConfig);
    detailView = { y: 0, k: 1 };
    detailLit = null;
    detailPicked = null;
    detailLabel = '';
    if (tab === 'detail') card = null;
    else stash.detail = null;
    schedule();
  }

  function frameDetail(c: CanvasRenderingContext2D, d: ConnectionsData) {
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!detailModel) {
      c.fillStyle = canvasColors.bg;
      c.fillRect(0, 0, W, H);
      return;
    }
    const stats = drawDetail(c, d, detailModel, detailConfig, { width: W, height: H }, {
      palette: canvasColors,
      view: detailView,
      lit: detailLit,
      now: performance.now(),
      motion: motionLevel(),
      picked: detailPicked,
      hovered: hoveredLine,
    });
    placed = stats.placed;
    if (stats.flying) schedule();
  }

  /**
   * A chapter, a heading or a book name lights its lines, which draw across
   * from the side tapped; a line between the axes opens its two verses.
   */
  function tapDetail(at: { x: number; y: number }) {
    if (!data || !detailModel) return;
    detailTried = true;
    const hit = detailHit(data, detailModel, detailConfig, { width: W, height: H }, detailView, placed, detailLit, at);
    if (!hit) return;
    if (hit.kind === 'line') {
      detailPicked = hit.link;
      card = linkCard(hit.link);
      schedule();
      return;
    }
    const axis = hit.side === 'left' ? detailModel.left : detailModel.right;
    if (hit.kind === 'title') {
      lightDetail(hit.side, { start: axis.start, end: axis.end }, axis.name);
    } else if (hit.kind === 'mark') {
      // A group's marks are books, in short; the card wants the full name.
      const title = axis.byBook ? refAt(hit.span.start)?.book ?? hit.label : `${axis.name} ${hit.label}`;
      lightDetail(hit.side, hit.span, title);
    } else {
      lightDetail(hit.side, hit.span, hit.heading.text);
    }
  }

  function lightDetail(side: 'left' | 'right', span: Span, title: string) {
    if (!data || !detailModel) return;
    detailLit = { side, span, startedAt: performance.now() };
    detailPicked = null;
    detailLabel = title;
    let n = 0;
    for (const i of detailModel.links) {
      const on =
        side === 'left'
          ? data.from[i] >= span.start && data.from[i] < span.end
          : data.toStart[i] < span.end && data.toEnd[i] >= span.start;
      if (on) n++;
    }
    const open = refAt(span.start);
    const item = itemFromSpan(span);
    const verb = side === 'left' ? (n === 1 ? 'line leaves' : 'lines leave') : n === 1 ? 'line arrives' : 'lines arrive';
    card = open
      ? {
          kind: 'span',
          title,
          meta: `${n.toLocaleString()} ${verb}`,
          open,
          label: item ? itemLabel(item) : title,
          items: item ? [item] : [],
        }
      : null;
    schedule();
  }

  function clearDetail() {
    detailLit = null;
    detailPicked = null;
    detailLabel = '';
    card = null;
    schedule();
  }

  // ===== The chord ring =====
  //
  // Drawn live, not from an image like the grid: at most 2,145 ribbons, so it
  // stays sharp at any zoom and a picked book dims the rest without a rebuild.
  // Counted the first time the tab shows, and again when its links change.

  const CHORD_K = [0.6, 12] as const;
  let chordLook: ChordLook = { voteFloor: CHORD.voteFloor, maxLinks: CHORD.maxLinks };
  /** This window's own copy, as with the arcs' config. */
  let chordConfig: ChordConfig = { ...CHORD };
  let chordCounts: ChordCounts | null = null;
  let chordLayout: ChordLayout | null = null;
  let chordSceneNow: ChordScene | null = null;
  let chordView: ChordView = { x: 0, y: 0, k: 1 };
  let chordPick: ChordPick = null;
  /** The pick before, which fades out as the new one fades in. */
  let chordPrevious: ChordPick = null;
  let chordPickedAt = 0;
  let chordTried = false;
  /** The book picker's value, kept in step with a tapped book. */
  let chordBook = '';

  /** Count and lay out the ring, if it isn't already. */
  function buildChord() {
    if (!data || chordLayout) return;
    chordCounts = countChords(data, chordConfig);
    chordLayout = buildChordLayout(chordCounts, chordConfig);
    if (W && H) chordSceneNow = chordScene(chordLayout, chordConfig, { width: W, height: H });
    schedule();
  }

  function applyChordLook(next: ChordLook) {
    const changed = next.voteFloor !== chordLook.voteFloor || next.maxLinks !== chordLook.maxLinks;
    chordLook = next;
    chordConfig = { ...chordConfig, voteFloor: next.voteFloor, maxLinks: next.maxLinks };
    remember({ chord: chordLook });
    if (!changed) return;
    // New counts move every book, so an old pick may point at nothing.
    chordCounts = null;
    chordLayout = null;
    chordSceneNow = null;
    clearChord();
    if (tab === 'chord') buildChord();
    else stash.chord = null;
  }

  function setChordLook(patch: Partial<ChordLook>) {
    applyChordLook({ ...chordLook, ...patch });
  }

  function frameChord(c: CanvasRenderingContext2D) {
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!chordSceneNow || !chordCounts) {
      c.fillStyle = canvasColors.bg;
      c.fillRect(0, 0, W, H);
      return;
    }
    const stats = drawChord(c, chordSceneNow, chordConfig, {
      palette: canvasColors,
      view: chordView,
      pick: chordPick,
      previous: chordPrevious,
      pickedAt: chordPickedAt,
      now: performance.now(),
      motion: motionLevel(),
      max: chordCounts.max,
    });
    if (stats.fading) schedule();
  }

  function setChordPick(next: ChordPick) {
    chordPrevious = chordPick;
    chordPick = next;
    chordPickedAt = performance.now();
    schedule();
  }

  /**
   * A book keeps only its own ribbons and shows its busiest partners (tap it
   * again to let go). A ribbon opens that pair on the Detail tab, the way
   * round more of its links run.
   */
  function tapChord(at: { x: number; y: number }) {
    if (!data || !chordSceneNow || !chordCounts) return;
    chordTried = true;
    const hit = chordHit(chordSceneNow, chordConfig, chordView, at);
    if (!hit) {
      if (chordPick) clearChord();
      return;
    }
    if (hit.kind === 'book') {
      if (chordPick?.kind === 'book' && chordPick.book === hit.book) clearChord();
      else pickChordBook(hit.book);
      return;
    }
    const way = busierWay(chordCounts, hit.a, hit.b);
    void openPair({ from: data.books[way.from].name, to: data.books[way.to].name });
    setTab('detail');
  }

  function pickChordBook(index: number) {
    if (!data || !chordCounts) return;
    const book = data.books[index];
    chordBook = book.name;
    setChordPick({ kind: 'book', book: index });
    const total = chordCounts.totals[index];
    const most = partnersOf(chordCounts, index, 3).map((p) => data!.books[p.book].name);
    card = {
      kind: 'span',
      title: book.name,
      meta: `${total.toLocaleString()} ${total === 1 ? 'link' : 'links'}${most.length ? ` · most with ${most.join(', ')}` : ''}`,
      open: { book: book.name, chapter: 1, verse: 1 },
      label: book.name,
      items: itemsOf([{ start: book.start, end: book.end }]),
    };
  }

  /** The nav's book picker on the ring. */
  function chooseChordBook(name: string) {
    const index = data?.books.findIndex((b) => b.name === name) ?? -1;
    if (index < 0) clearChord();
    else pickChordBook(index);
  }

  function clearChord() {
    if (chordPick) setChordPick(null);
    chordBook = '';
    if (tab === 'chord') card = null;
  }

  /** Show all, on whichever tab is open. */
  function clearTab() {
    if (tab === 'grid') clearGrid();
    else if (tab === 'detail') clearDetail();
    else if (tab === 'chord') clearChord();
    else showAll();
  }

  $: anyLit =
    tab === 'grid'
      ? !!gridFocus
      : tab === 'detail'
        ? !!detailLit || detailPicked !== null
        : tab === 'chord'
          ? !!chordPick
          : !!lit;

  // ===== Sets and saved views =====
  //
  // The sets themselves and the saved views live in settings and follow the
  // account, so every Connections window shares them. Which sets a window is
  // showing, and its look, are that window's own and outlive a reload with it.

  let library: ConnectionSet[] = savedSets();
  let views: ConnectionsView[] = savedViews();
  /** Which sets this window shows, by id. */
  let shown: string[] = [];
  /** The shown sets, ready for the draw. Null draws the book colors. */
  let layer: SetLayer | null = null;
  /** When the shown sets last changed, so their arcs fly in the way a tap's do. */
  let setsLaunch: number | null = null;
  let layerToken = 0;

  let panelOpen = false;
  /** The set whose passages are open for editing. */
  let editing: string | null = null;
  let passageText = '';
  let passageError = '';
  let viewName = '';
  let offers: ReadyOffer[] = [];

  /** The shown sets in the library's order, which is the order they win an arc in. */
  function shownList(): ConnectionSet[] {
    return library.filter((s) => shown.includes(s.id)).slice(0, MAX_SHOWN_SETS);
  }
  $: shownSets = library.filter((s) => shown.includes(s.id)).slice(0, MAX_SHOWN_SETS);
  $: emptyShown = shownSets.find((s) => !s.ready && s.items.length === 0) ?? null;
  $: ownSets = library.filter((s) => !s.ready);

  function itemsOf(spans: Span[]): SetItem[] {
    return spans.map(itemFromSpan).filter((i): i is SetItem => i !== null);
  }

  /** Work out the draw's layer again. `fly` sends the arcs in fresh. */
  async function rebuildLayer(fly: boolean) {
    const token = ++layerToken;
    const sets = shownList();
    const next = data && sets.length ? await layerFor(data, sets) : null;
    // A quicker toggle since has already been drawn; this one is stale.
    if (token !== layerToken) return;
    layer = next;
    if (fly) {
      const now = performance.now();
      if (lit) lit = { ...lit, startedAt: now };
      else setsLaunch = now;
    }
    schedule();
  }

  function setShown(next: string[], fly = true) {
    shown = next;
    remember({ shown });
    void rebuildLayer(fly);
  }

  function toggleSet(id: string) {
    if (shown.includes(id)) setShown(shown.filter((x) => x !== id));
    else if (shownList().length < MAX_SHOWN_SETS) setShown([...shown, id]);
  }

  /** Save the library. A change to what a shown set covers or wears redraws it. */
  function commitSets(next: ConnectionSet[], redraw: boolean) {
    library = next;
    saveSets(next);
    if (redraw) void rebuildLayer(false);
  }

  function createSet(items: SetItem[] = []): ConnectionSet | null {
    if (library.length >= MAX_SETS) return null;
    const set: ConnectionSet = {
      id: newSetId(),
      name: `Set ${ownSets.length + 1}`,
      color: nextSetColor(library),
      items: items.slice(0, MAX_ITEMS),
    };
    commitSets([...library, set], false);
    return set;
  }

  function newSet() {
    const set = createSet();
    if (!set) return;
    editing = set.id;
    passageText = '';
    passageError = '';
    setShown([...shown, set.id]);
  }

  /** Add passages to a set, skipping any it already has, and show it. */
  function addItems(id: string, items: SetItem[]) {
    const set = library.find((s) => s.id === id);
    if (!set || set.ready) return;
    const have = new Set(set.items.map(itemLabel));
    const fresh = items.filter((i) => !have.has(itemLabel(i)));
    const merged = [...set.items, ...fresh].slice(0, MAX_ITEMS);
    commitSets(library.map((s) => (s.id === id ? { ...s, items: merged } : s)), false);
    if (!shown.includes(id) && shownList().length < MAX_SHOWN_SETS) setShown([...shown, id]);
    else void rebuildLayer(true);
  }

  function removeItem(id: string, index: number) {
    commitSets(
      library.map((s) => (s.id === id ? { ...s, items: s.items.filter((_, i) => i !== index) } : s)),
      shown.includes(id),
    );
  }

  function renameSet(id: string, name: string) {
    const trimmed = name.trim();
    const set = library.find((s) => s.id === id);
    if (!set || !trimmed || trimmed === set.name) return;
    commitSets(library.map((s) => (s.id === id ? { ...s, name: trimmed } : s)), false);
  }

  function recolorSet(id: string, color: string) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    commitSets(library.map((s) => (s.id === id ? { ...s, color } : s)), shown.includes(id));
  }

  /** Move a set up the list, where it wins the arcs it shares with the sets below. */
  function raiseSet(id: string) {
    const at = library.findIndex((s) => s.id === id);
    if (at <= 0) return;
    const next = library.slice();
    [next[at - 1], next[at]] = [next[at], next[at - 1]];
    commitSets(next, shown.includes(id));
  }

  async function deleteSet(set: ConnectionSet) {
    const ok = await askConfirm(`Delete the set “${set.name}”? Saved views that show it will stop showing it.`, {
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (editing === set.id) editing = null;
    commitSets(library.filter((s) => s.id !== set.id), false);
    if (views.some((v) => v.shown.includes(set.id))) {
      views = views.map((v) => ({ ...v, shown: v.shown.filter((x) => x !== set.id) }));
      saveViews(views);
    }
    setShown(shown.filter((x) => x !== set.id), false);
  }

  function toggleEditing(id: string) {
    editing = editing === id ? null : id;
    passageText = '';
    passageError = '';
  }

  function addPassage(id: string) {
    const item = parseItem(passageText);
    if (!item) {
      passageError = 'That passage couldn’t be read. Try “Isaiah 53”, “John 3:16” or “Matthew 5-7”.';
      return;
    }
    passageError = '';
    passageText = '';
    addItems(id, [item]);
  }

  function addReady(offer: ReadyOffer) {
    const have = library.find((s) => s.ready === offer.source);
    if (have) {
      if (!shown.includes(have.id)) toggleSet(have.id);
      return;
    }
    if (library.length >= MAX_SETS) return;
    const set: ConnectionSet = { id: newSetId(), name: offer.name, color: offer.color, items: [], ready: offer.source };
    commitSets([...library, set], false);
    if (shownList().length < MAX_SHOWN_SETS) setShown([...shown, set.id]);
  }

  /** The card's passage, or both ends of its arc, into a set — a new one on "new". */
  function addCardTo(value: string) {
    const items = card?.items ?? [];
    if (!items.length || !value) return;
    if (value === 'new') {
      const set = createSet(items);
      if (set) setShown([...shown, set.id]);
    } else addItems(value, items);
  }

  async function togglePanel() {
    panelOpen = !panelOpen;
    if (panelOpen) offers = await readyOffers(getHighlightNames());
  }

  // ----- the look -----

  function lookOf(): ConnectionsLook {
    return { orientation: config.orientation, side: config.side, voteFloor: config.voteFloor, maxArcs: config.maxArcs };
  }

  function applyLook(look: ConnectionsLook) {
    const turned = look.orientation !== config.orientation;
    config = { ...config, orientation: look.orientation, side: look.side, voteFloor: look.voteFloor, maxArcs: look.maxArcs };
    remember({ look: lookOf() });
    // Turned on its side, the old pan points at nothing in particular.
    if (turned) wholeBible();
    schedule();
  }

  function setLook(patch: Partial<ConnectionsLook>) {
    applyLook({ ...lookOf(), ...patch });
  }

  /** The vote-floor choices: everything, or only links readers voted for. */
  const FLOORS = [
    { value: -32768, label: 'Every link' },
    { value: 1, label: '1 vote or more' },
    { value: 5, label: '5 votes or more' },
    { value: 10, label: '10 votes or more' },
    { value: 25, label: '25 votes or more' },
    { value: 50, label: '50 votes or more' },
    { value: 100, label: '100 votes or more' },
  ];
  function floorLabel(value: number): string {
    return FLOORS.find((f) => f.value === value)?.label ?? `${value} votes or more`;
  }
  /** The cap choices. The whole set is slow to pan, so it says so. */
  const CAPS = [
    { value: 10000, label: '10,000' },
    { value: 20000, label: '20,000' },
    { value: 50000, label: '50,000' },
    { value: 100000, label: '100,000' },
    { value: 0, label: 'All (slow to move)' },
  ];

  // ----- saved views -----

  function saveView() {
    const name = viewName.trim() || `View ${views.length + 1}`;
    const same = views.find((v) => v.name.toLowerCase() === name.toLowerCase());
    if (!same && views.length >= MAX_VIEWS) return;
    const saved: ConnectionsView = {
      id: same?.id ?? `view-${Date.now().toString(36)}`,
      name,
      ...lookOf(),
      shown: shownList().map((s) => s.id),
      tab,
      grid: { ...gridLook },
      pair: { ...pair },
      chord: { ...chordLook },
    };
    // The same name again saves over it, rather than making a twin.
    views = same ? views.map((v) => (v.id === same.id ? saved : v)) : [...views, saved];
    saveViews(views);
    viewName = '';
  }

  function openView(v: ConnectionsView) {
    applyLook(v);
    setShown(v.shown.filter((id) => library.some((s) => s.id === id)));
    if (v.grid) applyGridLook(v.grid);
    if (v.chord) applyChordLook(v.chord);
    if (v.pair && (v.pair.from !== pair.from || v.pair.to !== pair.to || !detailModel)) void openPair(v.pair);
    setTab(v.tab ?? 'arcs');
  }

  async function deleteView(v: ConnectionsView) {
    const ok = await askConfirm(`Delete the saved view “${v.name}”? Its sets are kept.`, {
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    views = views.filter((x) => x.id !== v.id);
    saveViews(views);
  }

  /** What a saved view shows, for its row. */
  function viewSummary(v: ConnectionsView): string {
    if (v.tab === 'grid') return `Grid · ${COLOR_NAMES[v.grid?.colorBy ?? gridLook.colorBy]}`;
    if (v.tab === 'detail' && v.pair) return `Detail · ${v.pair.from} → ${v.pair.to}`;
    if (v.tab === 'chord') return `Chord · ${floorLabel(v.chord?.voteFloor ?? chordLook.voteFloor)}`;
    const names = v.shown.map((id) => library.find((s) => s.id === id)?.name).filter(Boolean);
    return names.length ? names.join(', ') : 'Every arc, book colors';
  }

  /** Sets or views changed on another device, or in another Connections window. */
  function onSettingsUpdated() {
    library = savedSets();
    views = savedViews();
    shown = shown.filter((id) => library.some((s) => s.id === id));
    void rebuildLayer(false);
  }

  // ===== Save or share as an image =====
  //
  // Drawn first and offered after, rather than on the tap: a 4,000-pixel
  // render and its PNG take a moment on a phone, and the share sheet only
  // opens from a fresh tap. So the image is made, shown, and then shared or
  // saved from buttons of its own — the share card's way.

  /** What the picture is of, for the image's title. Follows what was lit last. */
  let litTitle = '';
  $: if (card && tab === 'arcs') {
    litTitle =
      card.kind === 'span'
        ? card.title
        : `${card.from.book} ${card.from.chapter}:${card.from.verse} → ${card.toLabel}`;
  }
  $: if (!lit) litTitle = '';

  let imageBusy = false;
  let imageFile: File | null = null;
  let imageUrl = '';
  let imageError = '';
  let imageSaved = false;

  /** Can the OS share sheet take an image file? Probed once, as the share card does. */
  const canShareFiles = (() => {
    try {
      const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
      return (
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [probe] })
      );
    } catch {
      return false;
    }
  })();
  // iOS's share sheet has Save Image in it, and a blob download there opens a
  // bare preview page, so on iOS Share is the one way out.
  const showSave = !(isIOS() && canShareFiles);

  function closeImage() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = '';
    imageFile = null;
    imageError = '';
    imageBusy = false;
    imageSaved = false;
  }

  async function makeImage() {
    if (!data || imageBusy || W === 0 || H === 0) return;
    if (tab === 'grid' && (!gridImage || !gridLayout || !gridCells)) return;
    if (tab === 'detail' && !detailModel) return;
    if (tab === 'chord' && (!chordSceneNow || !chordCounts)) return;
    closeImage();
    imageBusy = true;
    try {
      const viewport = { width: W, height: H };
      let title: string;
      let blob: Blob | null;
      if (tab === 'grid') {
        const scene = { data, cells: gridCells!, layout: gridLayout!, image: gridImage! };
        const focus = gridFocus;
        const lane = focus ? gridLayout!.lanes[focus.lane] : null;
        title =
          lane && focus
            ? `${lane.name}, ${focus.axis === 'row' ? 'where its links land' : 'where its links come from'}`
            : 'Cross references, book by book';
        const at = { ...gridView };
        blob = await renderFramedImage({
          viewport,
          palette: canvasColors,
          title,
          legend: [],
          paint: (c) => {
            drawGrid(c, scene, gridConfig, detailConfig, viewport, { palette: canvasColors, view: at, focus, dimTo: 0.25, everyCell: true });
          },
        });
      } else if (tab === 'detail') {
        const model = detailModel!;
        const d = data;
        title = `${model.left.name} → ${model.right.name}${detailLabel ? `: ${detailLabel}` : ''}`;
        const at = { ...detailView };
        const litNow = detailLit;
        const pickedNow = detailPicked;
        blob = await renderFramedImage({
          viewport,
          palette: canvasColors,
          title,
          legend: [],
          // Drawn landed: a picture taken mid-flight would be a half-drawn one.
          paint: (c) => {
            drawDetail(c, d, model, detailConfig, viewport, {
              palette: canvasColors,
              view: at,
              lit: litNow,
              now: performance.now(),
              motion: 'off',
              picked: pickedNow,
            });
          },
        });
      } else if (tab === 'chord') {
        const scene = chordSceneNow!;
        const max = chordCounts!.max;
        const pickNow = chordPick;
        const at = { ...chordView };
        title =
          pickNow?.kind === 'book'
            ? `${data.books[pickNow.book].name} and the books it links to`
            : 'Cross references between the books';
        blob = await renderFramedImage({
          viewport,
          palette: canvasColors,
          title,
          legend: [],
          // Drawn settled: a picture taken mid-fade would catch the old pick too.
          paint: (c) => {
            drawChord(c, scene, chordConfig, {
              palette: canvasColors,
              view: at,
              pick: pickNow,
              previous: pickNow,
              pickedAt: 0,
              now: 0,
              motion: 'off',
              max,
            });
          },
        });
      } else {
        title = litTitle || (shownSets.length ? 'Cross references in Scripture' : 'Every cross reference in Scripture');
        blob = await renderConnectionsImage({
          data,
          config,
          viewport,
          view: { ...view },
          palette: canvasColors,
          lit: lit?.spans,
          sets: layer,
          title,
          legend: shownSets.map((s) => ({ name: s.name, color: s.color })),
        });
      }
      if (!imageBusy) return; // closed while it was drawing
      if (!blob) throw new Error('The browser couldn’t make the image.');
      const base = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'connections';
      imageFile = new File([blob], `connections-${base}.png`, { type: 'image/png' });
      imageUrl = URL.createObjectURL(blob);
    } catch (e) {
      imageError = e instanceof Error ? e.message : String(e);
    } finally {
      imageBusy = false;
    }
  }

  async function shareImage() {
    if (!imageFile) return;
    try {
      await navigator.share({ files: [imageFile] });
      closeImage();
    } catch (err) {
      // Dismissing the sheet leaves the image up so the choice can be made again.
      if ((err as Error)?.name === 'AbortError') return;
      download(imageFile);
    }
  }

  function saveImage() {
    if (!imageFile) return;
    download(imageFile);
    imageSaved = true;
  }

  $: imageOpen = imageBusy || !!imageUrl || !!imageError;

  /**
   * Take the reader to a verse. The Timeline's call: a crumb first, so the
   * back arrow returns with this window still open, then the jump. From full
   * screen it drops back into its window first, or the reader would be hidden.
   */
  async function read(ref: ConnectionRef) {
    await setFullscreen(false);
    const current = get(navigationStore);
    navigationStore.pushHistory(current, 'connections');
    const at = landingIn(current.translation, ref);
    navigationStore.navigateToVerse(current.translation, ref.book, at.chapter, at.verse);
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
    if (e.key === 'Escape' && imageOpen && !get(lookupStore)) {
      e.stopPropagation();
      closeImage();
      return;
    }
    if (e.key === 'Escape' && selected !== null && !get(lookupStore)) {
      card = null;
      return;
    }
    if (!fullscreen || e.key !== 'Escape' || get(lookupStore)) return;
    void setFullscreen(false);
  }

  // ===== A chapter sent from the reader strip =====

  /**
   * openConnectionsWindow drops a chapter here. It is taken once the data is
   * in and the saved view restored: the Arcs tab, the whole Bible in view, no
   * opening volley, and the chapter lit with its card, the same as a tap on
   * its bar. Then it is cleared, so a reload does not send it again.
   */
  $: handoff = windowState?.contentState?.target as { seq?: unknown; book?: unknown; chapter?: unknown } | null | undefined;
  $: if (handoff && data && !loading) takeHandoff(handoff);

  function takeHandoff(target: { book?: unknown; chapter?: unknown }) {
    remember({ target: null });
    if (typeof target.book !== 'string' || typeof target.chapter !== 'number') return;
    if (tab !== 'arcs') setTab('arcs');
    opening = null;
    rangeMode = false;
    rangeFrom = null;
    view = { x: 0, y: 0, k: 1 };
    remember({ view: { ...view } });
    lightChapter(target.book, target.chapter);
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
      const look = cleanLook(windowState?.contentState?.look);
      if (look) config = { ...config, ...look };
      const state = windowState?.contentState;
      const savedTab = cleanTab(state?.tab);
      if (savedTab) tab = savedTab;
      const savedGrid = cleanGridLook(state?.grid);
      if (savedGrid) {
        gridLook = savedGrid;
        applyGridConfigs();
      }
      const savedPair = cleanPair(state?.pair);
      if (savedPair) pair = savedPair;
      const savedChord = cleanChordLook(state?.chord);
      if (savedChord) {
        chordLook = savedChord;
        chordConfig = { ...chordConfig, voteFloor: savedChord.voteFloor, maxLinks: savedChord.maxLinks };
      }
      const cv = state?.chordView;
      if (cv && [cv.x, cv.y, cv.k].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        chordView = { x: cv.x, y: cv.y, k: clamp(cv.k, CHORD_K[0], CHORD_K[1]) };
      }
      const gv = state?.gridView;
      if (gv && [gv.x, gv.y, gv.k].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        gridView = { x: gv.x, y: gv.y, k: clamp(gv.k, GRID_K[0], GRID_K[1]) };
      }
      const savedShown = windowState?.contentState?.shown;
      if (Array.isArray(savedShown)) {
        shown = savedShown.filter((id): id is string => typeof id === 'string' && library.some((s) => s.id === id));
      }
      await rebuildLayer(false);
      // The opening volley: the whole Bible flies in, Genesis first.
      if (tab === 'arcs' && LIGHTS.openOnLoad && motionLevel() === 'full') opening = { startedAt: performance.now() };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
    await tick();
    measure();
    if (data && tab === 'grid') void buildGrid();
    if (data && tab === 'detail') void openPair(pair);
    if (data && tab === 'chord') buildChord();
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

  /** Lets go of the data when the window closes. The strip may still hold it. */
  const letGo = holdConnections();

  onMount(() => {
    void load(true);
    watchTheme();
    const onPacks = () => void load(false);
    window.addEventListener('packsUpdated', onPacks);
    window.addEventListener('keydown', onKeydownCapture, true);
    window.addEventListener('settingsUpdated', onSettingsUpdated);
    return () => {
      window.removeEventListener('settingsUpdated', onSettingsUpdated);
      window.removeEventListener('packsUpdated', onPacks);
      window.removeEventListener('keydown', onKeydownCapture, true);
    };
  });

  onDestroy(() => {
    if (frameId) cancelAnimationFrame(frameId);
    if (hoverFrame) cancelAnimationFrame(hoverFrame);
    if (saveTimer) clearTimeout(saveTimer);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    themeObserver?.disconnect();
    resizeObserver?.disconnect();
    pointers.clear();
    releaseGridImage();
    letGo();
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
    <div class="nav" class:pairs={tab === 'detail'}>
      <div class="nav-title">Connections</div>
      {#if tab === 'arcs'}
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
      {:else if tab === 'chord'}
        <select
          class="book-pick"
          aria-label="Pick out a book"
          value={chordBook}
          on:change={(e) => chooseChordBook(e.currentTarget.value)}
          disabled={!chordLayout}
        >
          <option value="">Pick out a book…</option>
          {#each data?.books ?? [] as book (book.name)}
            <option value={book.name}>{book.name}</option>
          {/each}
        </select>
      {:else if tab === 'detail'}
        {#each ['from', 'to'] as side (side)}
          {#if side === 'to'}<span class="pair-arrow" aria-hidden="true">→</span>{/if}
          <select
            class="book-pick pair-pick"
            aria-label={side === 'from' ? 'Where the links start' : 'Where the links land'}
            value={side === 'from' ? pair.from : pair.to}
            on:change={(e) =>
              openPair(side === 'from' ? { from: e.currentTarget.value, to: pair.to } : { from: pair.from, to: e.currentTarget.value })}
            disabled={!data}
          >
            <optgroup label="Groups">
              {#each BOOK_GROUPS as g (g.name)}<option value={g.name}>{g.name}</option>{/each}
            </optgroup>
            <optgroup label="Books">
              {#each data?.books ?? [] as book (book.name)}<option value={book.name}>{book.name}</option>{/each}
            </optgroup>
          </select>
        {/each}
      {/if}
      <div class="nav-spacer"></div>
      {#if tab === 'arcs'}
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
      {/if}
      <button
        class="btn"
        title={ground === 'black' ? 'Draw the picture on cream' : 'Draw the picture on black'}
        on:click={toggleGround}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor"/></svg>
        <span class="btn-label">{ground === 'black' ? 'Black' : 'Cream'}</span>
      </button>
      {#if anyLit}
        <button
          class="btn"
          title={tab === 'arcs' ? 'Show every arc again' : tab === 'chord' ? 'Show every ribbon again' : 'Show every line again'}
          on:click={clearTab}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M5 18a7 7 0 0114 0"/><path d="M8.5 18a3.5 3.5 0 017 0"/></svg>
          <span class="btn-label">Show all</span>
        </button>
      {/if}
      <button
        class="btn"
        class:on={panelOpen}
        aria-pressed={panelOpen}
        title={tab === 'arcs' ? 'Sets and saved views' : 'How the lines look, and saved views'}
        on:click={togglePanel}
      >
        {#if tab === 'arcs'}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9" r="4.5"/><circle cx="16" cy="9" r="4.5"/><circle cx="12" cy="15.5" r="4.5"/></svg>
          <span class="btn-label">Sets</span>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12"/><circle cx="18" cy="18" r="2"/></svg>
          <span class="btn-label">View</span>
        {/if}
      </button>
      <button
        class="btn"
        title="Save or share this picture as an image"
        disabled={!data ||
          imageBusy ||
          (tab === 'grid' && (!gridImage || gridBuilding)) ||
          (tab === 'detail' && !detailModel) ||
          (tab === 'chord' && !chordSceneNow)}
        on:click={makeImage}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>
        <span class="btn-label">Image</span>
      </button>
      <button
        class="btn"
        title={tab === 'detail'
          ? 'Back to both sides whole'
          : tab === 'grid'
            ? 'Back to the whole grid'
            : tab === 'chord'
              ? 'Back to the whole ring'
              : 'Back to the whole Bible'}
        on:click={fitView}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/></svg>
        <span class="btn-label">{tab === 'detail' ? 'Whole' : 'Whole Bible'}</span>
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

    <div class="tabs" role="tablist" aria-label="Connections pictures">
      {#each TABS as t (t.id)}
        <button
          class="tab"
          class:on={tab === t.id}
          role="tab"
          aria-selected={tab === t.id}
          on:click={() => setTab(t.id)}
        >{t.label}</button>
      {/each}
    </div>

    <div class="stage" class:range={rangeMode} style="--stage-bg:{canvasColors.bg}" bind:this={stageEl}>
      <canvas
        bind:this={canvas}
        class:target={overTarget}
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
        on:pointerleave={endHover}
        on:wheel|nonpassive={onWheel}
      ></canvas>
      {#if loading}
        <div class="loading">Reading the connections…</div>
      {:else if tab === 'grid' && (gridBuilding || !gridImage)}
        <div class="loading">Drawing the grid…</div>
      {:else if tab === 'grid' && !gridTried && !card && !panelOpen}
        <div class="hint low">Tap a square to open it. Tap a name to pick out its row or column.</div>
      {:else if tab === 'chord' && !chordTried && !card && !panelOpen && chordSceneNow}
        <div class="hint low">Tap a book to pick out its ribbons. Tap a ribbon to open that pair.</div>
      {:else if tab === 'detail' && !detailTried && !card && !panelOpen && detailModel}
        <div class="hint low">Tap a chapter, a heading or a book name to light its lines.</div>
      {:else if tab === 'arcs' && rangeMode && !card}
        <div class="hint">Drag along the line to light a stretch of chapters.</div>
      {:else if tab === 'arcs' && emptyShown && !card && !panelOpen}
        <div class="hint">“{emptyShown.name}” is empty. Tap a book, a chapter or an arc, then Add to set.</div>
      {/if}

      {#if tab === 'arcs' && shownSets.length && !panelOpen}
        <button class="legend" title="Sets and saved views" on:click={togglePanel}>
          {#each shownSets as set (set.id)}
            <span class="legend-item"><span class="dot" style="background:{set.color}"></span>{set.name}</span>
          {/each}
        </button>
      {/if}

      {#if panelOpen}
        <div class="panel" role="dialog" aria-label={tab === 'arcs' ? 'Sets and saved views' : 'View and saved views'}>
          <div class="panel-head">
            <div class="panel-title">{tab === 'arcs' ? 'Sets' : 'View'}</div>
            <CloseX label="Close" on:click={() => (panelOpen = false)} />
          </div>
          {#if tab === 'chord'}
          <p class="panel-note">
            Each book’s stretch of the ring is sized by its links with the other books, and a ribbon is as wide as the
            links between two of them. Links within one book are on the grid’s diagonal instead.
          </p>
          <label class="field">
            <span>Links shown</span>
            <select
              class="pick"
              value={chordLook.voteFloor}
              on:change={(e) => setChordLook({ voteFloor: Number(e.currentTarget.value) })}
            >
              {#each FLOORS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
              {#if !FLOORS.some((f) => f.value === chordLook.voteFloor)}
                <option value={chordLook.voteFloor}>{chordLook.voteFloor} votes or more</option>
              {/if}
            </select>
          </label>
          <label class="field">
            <span>Most links</span>
            <select
              class="pick"
              value={chordLook.maxLinks}
              on:change={(e) => setChordLook({ maxLinks: Number(e.currentTarget.value) })}
            >
              {#each LINK_CAPS as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
              {#if !LINK_CAPS.some((c) => c.value === chordLook.maxLinks)}
                <option value={chordLook.maxLinks}>{chordLook.maxLinks.toLocaleString()}</option>
              {/if}
            </select>
          </label>
          <p class="panel-note">Readers vote on each link at OpenBible.info. With a cap, the most-voted links are kept.</p>
          {:else if tab !== 'arcs'}
          <p class="panel-note">
            The grid puts every book against every book: rows are where a link starts, columns where it lands. A square
            opened up is the detail. Both follow these.
          </p>
          <div class="field">
            <span>Color</span>
            <div class="seg">
              {#each COLOR_ORDER as c (c)}
                <button class:on={gridLook.colorBy === c} on:click={() => setGridLook({ colorBy: c })}>{COLOR_NAMES[c]}</button>
              {/each}
            </div>
          </div>
          <p class="panel-note">
            The two books: each line leaves wearing the other book’s color, as the arcs do. By place: a rainbow down the
            source book, so a line can be followed across. One ink: every line alike.
          </p>
          <div class="field">
            <span>Groups</span>
            <div class="seg">
              <button class:on={gridLook.groups === 'start'} on:click={() => setGridLook({ groups: 'start' })}>Together first</button>
              <button class:on={gridLook.groups === 'each'} on:click={() => setGridLook({ groups: 'each' })}>Before each</button>
              <button class:on={gridLook.groups === 'off'} on:click={() => setGridLook({ groups: 'off' })}>None</button>
            </div>
          </div>
          <p class="panel-note">
            A row and column for each group of books (Law, History, Wisdom/Poetry, Prophets, Gospels, Pauline Epistles,
            General Epistles), with all its books on one axis.
          </p>
          <label class="field">
            <span>Links shown</span>
            <select
              class="pick"
              value={gridLook.voteFloor}
              on:change={(e) => setGridLook({ voteFloor: Number(e.currentTarget.value) })}
            >
              {#each FLOORS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
              {#if !FLOORS.some((f) => f.value === gridLook.voteFloor)}
                <option value={gridLook.voteFloor}>{gridLook.voteFloor} votes or more</option>
              {/if}
            </select>
          </label>
          <label class="field">
            <span>Most links</span>
            <select
              class="pick"
              value={gridLook.maxLinks}
              on:change={(e) => setGridLook({ maxLinks: Number(e.currentTarget.value) })}
            >
              {#each LINK_CAPS as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
              {#if !LINK_CAPS.some((c) => c.value === gridLook.maxLinks)}
                <option value={gridLook.maxLinks}>{gridLook.maxLinks.toLocaleString()}</option>
              {/if}
            </select>
          </label>
          <p class="panel-note">Readers vote on each link at OpenBible.info. With a cap, the most-voted links are kept.</p>
          {:else}
          <p class="panel-note">
            Show a set and only the arcs touching it are drawn, in its color. A set higher in the list wins an arc it
            shares with one below.
          </p>

          {#each library as set, i (set.id)}
            {@const on = shown.includes(set.id)}
            <div class="set" class:on>
              <div class="set-row">
                <input
                  class="swatch"
                  type="color"
                  value={set.color}
                  aria-label="Color for {set.name}"
                  on:change={(e) => recolorSet(set.id, e.currentTarget.value)}
                />
                <input
                  class="set-name"
                  value={set.name}
                  aria-label="Set name"
                  maxlength="60"
                  on:change={(e) => renameSet(set.id, e.currentTarget.value)}
                  on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <button
                  class="icon"
                  class:lit={on}
                  aria-pressed={on}
                  title={on ? 'Hide this set' : 'Show this set'}
                  aria-label={on ? `Hide ${set.name}` : `Show ${set.name}`}
                  disabled={!on && shownSets.length >= MAX_SHOWN_SETS}
                  on:click={() => toggleSet(set.id)}
                >
                  {#if on}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.2 4.1"/><path d="M6.6 6.6A17.4 17.4 0 002 12s3.6 7 10 7a10.4 10.4 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>
                  {/if}
                </button>
                <button
                  class="icon"
                  title="Move up the list"
                  aria-label="Move {set.name} up"
                  disabled={i === 0}
                  on:click={() => raiseSet(set.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>
                </button>
                <button
                  class="icon"
                  class:lit={editing === set.id}
                  aria-expanded={editing === set.id}
                  title={set.ready ? 'About this set' : 'Passages in this set'}
                  aria-label="Open {set.name}"
                  on:click={() => toggleEditing(set.id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate({editing === set.id ? 180 : 0}deg)"><path d="M6 9l6 6 6-6"/></svg>
                </button>
              </div>
              <div class="set-meta">
                {#if set.ready}
                  {offers.find((o) => o.source === set.ready)?.blurb ?? 'Ready-made, kept up to date'}
                {:else}
                  {set.items.length} {set.items.length === 1 ? 'passage' : 'passages'}
                {/if}
              </div>

              {#if editing === set.id}
                <div class="set-body">
                  {#if !set.ready}
                    {#each set.items as item, n (itemLabel(item) + n)}
                      <div class="item">
                        <span class="item-label">{itemLabel(item)}</span>
                        <button class="item-x" aria-label="Take {itemLabel(item)} out" on:click={() => removeItem(set.id, n)}>×</button>
                      </div>
                    {:else}
                      <div class="set-meta">Nothing yet. Type a passage below, or tap a book, a chapter or an arc and use Add to set.</div>
                    {/each}
                    {#if set.items.length < MAX_ITEMS}
                      <form class="add-row" on:submit|preventDefault={() => addPassage(set.id)}>
                        <input
                          class="text"
                          bind:value={passageText}
                          placeholder="Isaiah 53, John 3:16, Ruth…"
                          aria-label="Passage to add"
                        />
                        <button class="btn" type="submit">Add</button>
                      </form>
                      {#if passageError}<div class="error">{passageError}</div>{/if}
                    {/if}
                  {/if}
                  <button class="link-danger" on:click={() => deleteSet(set)}>Delete set</button>
                </div>
              {/if}
            </div>
          {/each}

          <button class="btn wide" disabled={library.length >= MAX_SETS} on:click={newSet}>+ New set</button>

          <div class="panel-sub">Ready-made</div>
          {#each offers as offer (offer.source)}
            {@const have = library.find((s) => s.ready === offer.source)}
            <div class="offer">
              <span class="dot" style="background:{offer.color}"></span>
              <div class="offer-text">
                <div>{offer.name}</div>
                <div class="set-meta">{offer.blurb}</div>
              </div>
              <button
                class="btn"
                disabled={!!have && shown.includes(have.id)}
                on:click={() => addReady(offer)}
              >{have ? (shown.includes(have.id) ? 'Shown' : 'Show') : 'Add'}</button>
            </div>
          {/each}

          <div class="panel-sub">View</div>
          <div class="field">
            <span>Line</span>
            <div class="seg">
              <button class:on={config.orientation === 'horizontal'} on:click={() => setLook({ orientation: 'horizontal' })}>Across</button>
              <button class:on={config.orientation === 'vertical'} on:click={() => setLook({ orientation: 'vertical' })}>Down</button>
            </div>
          </div>
          <div class="field">
            <span>Arcs</span>
            <div class="seg">
              <button class:on={config.side === 'top'} on:click={() => setLook({ side: 'top' })}>One side</button>
              <button class:on={config.side === 'bottom'} on:click={() => setLook({ side: 'bottom' })}>Other side</button>
              <button class:on={config.side === 'split'} on:click={() => setLook({ side: 'split' })}>Split</button>
            </div>
          </div>
          <p class="panel-note">Split puts links that point forward through the Bible on one side and links that point back on the other.</p>
          <label class="field">
            <span>Links shown</span>
            <select
              class="pick"
              value={config.voteFloor}
              on:change={(e) => setLook({ voteFloor: Number(e.currentTarget.value) })}
            >
              {#each FLOORS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
              {#if !FLOORS.some((f) => f.value === config.voteFloor)}
                <option value={config.voteFloor}>{config.voteFloor} votes or more</option>
              {/if}
            </select>
          </label>
          <label class="field">
            <span>Most arcs</span>
            <select
              class="pick"
              value={config.maxArcs}
              on:change={(e) => setLook({ maxArcs: Number(e.currentTarget.value) })}
            >
              {#each CAPS as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
              {#if !CAPS.some((c) => c.value === config.maxArcs)}
                <option value={config.maxArcs}>{config.maxArcs.toLocaleString()}</option>
              {/if}
            </select>
          </label>
          <p class="panel-note">Readers vote on each link at OpenBible.info. With a cap, the most-voted links are kept.</p>
          {/if}

          <div class="panel-sub">Saved views</div>
          {#each views as v (v.id)}
            <div class="offer">
              <div class="offer-text">
                <div>{v.name}</div>
                <div class="set-meta">{viewSummary(v)}</div>
              </div>
              <button class="btn" on:click={() => openView(v)}>Open</button>
              <button class="icon" aria-label="Delete {v.name}" title="Delete this view" on:click={() => deleteView(v)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>
              </button>
            </div>
          {:else}
            <div class="set-meta">None yet. A saved view keeps the tab you are on and how each picture looks: the arcs’ line, sides, links and sets, the grid’s color, groups and links, the two sides of the detail, and the ring’s links.</div>
          {/each}
          <form class="add-row" on:submit|preventDefault={saveView}>
            <input class="text" bind:value={viewName} maxlength="60" placeholder="Name this view" aria-label="View name" />
            <button class="btn" type="submit" disabled={views.length >= MAX_VIEWS && !views.some((v) => v.name.toLowerCase() === viewName.trim().toLowerCase())}>Save</button>
          </form>
        </div>
      {/if}

      {#if selected !== null && card?.kind === 'link' && !panelOpen}
        {@const link = card}
        <div class="card popup" role="dialog" aria-label="Linked verses" bind:this={popupEl} style={popupStyle}>
          <div class="card-head">
            <div class="card-title">Linked verses</div>
            <div class="card-meta">{link.votes.toLocaleString()} {link.votes === 1 ? 'vote' : 'votes'}</div>
            <select
              class="pick add-pick"
              aria-label="Add to a set"
              value=""
              on:change={(e) => {
                addCardTo(e.currentTarget.value);
                e.currentTarget.value = '';
              }}
            >
              <option value="">Add both to set…</option>
              {#each ownSets as set (set.id)}
                <option value={set.id} disabled={set.items.length >= MAX_ITEMS}>{set.name}</option>
              {/each}
              {#if library.length < MAX_SETS}<option value="new">New set</option>{/if}
            </select>
            <CloseX label="Close" on:click={() => (card = null)} />
          </div>
          <VerseRefRow book={link.from.book} chapter={link.from.chapter} verse={link.from.verse} onOpen={() => read(link.from)} />
          <VerseRefRow book={link.to.book} chapter={link.to.chapter} verse={link.to.verse} label={link.toLabel} onOpen={() => read(link.to)} />
        </div>
      {/if}
    </div>

    {#if card && selected === null}
      <div class="card">
        <div class="card-head">
          {#if card.kind === 'link'}
            <div class="card-title">Linked verses</div>
            <div class="card-meta">{card.votes.toLocaleString()} {card.votes === 1 ? 'vote' : 'votes'}</div>
          {:else}
            <div class="card-title">{card.title}</div>
            <div class="card-meta">{card.meta}</div>
          {/if}
          {#if card.items.length}
            <select
              class="pick add-pick"
              aria-label="Add to a set"
              value=""
              on:change={(e) => {
                addCardTo(e.currentTarget.value);
                e.currentTarget.value = '';
              }}
            >
              <option value="">{card.kind === 'link' ? 'Add both to set…' : 'Add to set…'}</option>
              {#each ownSets as set (set.id)}
                <option value={set.id} disabled={set.items.length >= MAX_ITEMS}>{set.name}</option>
              {/each}
              {#if library.length < MAX_SETS}<option value="new">New set</option>{/if}
            </select>
          {/if}
          <CloseX label="Close" on:click={() => (card = null)} />
        </div>
        {#if card.kind === 'link'}
          {@const link = card}
          <VerseRefRow book={link.from.book} chapter={link.from.chapter} verse={link.from.verse} onOpen={() => read(link.from)} />
          <VerseRefRow book={link.to.book} chapter={link.to.chapter} verse={link.to.verse} label={link.toLabel} onOpen={() => read(link.to)} />
        {:else}
          {@const span = card}
          <VerseRefRow book={span.open.book} chapter={span.open.chapter} verse={span.open.verse} label={span.label} onOpen={() => read(span.open)} />
        {/if}
      </div>
    {/if}

    <div class="credit">{CREDIT}</div>

    {#if imageOpen}
      <div class="image-scrim" role="presentation" on:click|self={closeImage}>
        <div class="image-card" role="dialog" aria-label="Save or share the picture">
          <div class="card-head">
            <div class="card-title">Picture</div>
            <div class="card-meta">{imageBusy ? 'Drawing it large…' : imageFile ? 'Ready' : ''}</div>
            <CloseX label="Close" on:click={closeImage} />
          </div>
          {#if imageBusy}
            <div class="image-wait">Drawing it large…</div>
          {:else if imageError}
            <p class="error">{imageError}</p>
          {:else if imageUrl}
            <img class="image-preview" src={imageUrl} alt="The Connections view as it will be saved" />
            <div class="image-actions">
              {#if canShareFiles}
                <button class="btn" on:click={shareImage}>Share</button>
              {/if}
              {#if showSave}
                <button class="btn" on:click={saveImage}>{imageSaved ? 'Saved' : 'Save'}</button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
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
  /* Two pickers want the title's room sooner. */
  @container (max-width: 560px) {
    .nav.pairs .nav-title { display: none; }
  }

  .pair-pick { flex: 0 1 auto; max-width: 130px; }
  .pair-arrow { color: var(--muted); flex: none; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }

  /* ---------------- tabs ---------------- */
  .tabs {
    --tabs-h: 32px;
    flex: none;
    height: var(--tabs-h);
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding: 0 calc(8px + var(--grip-r)) 0 calc(8px + var(--grip-l));
    background: var(--bg);
    box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--rule) 60%, transparent);
    position: relative;
    z-index: 19;
    /* Bar size, the same as the bar above it. */
    width: calc(100% / var(--bar-scale, 1));
    transform: scale(var(--bar-scale, 1));
    transform-origin: 0 0;
    margin-bottom: calc(var(--tabs-h) * (var(--bar-scale, 1) - 1));
  }
  .tab {
    flex: 0 1 auto;
    padding: 0 12px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--muted);
    font-family: var(--display);
    font-size: 14px;
    cursor: pointer;
    transition: color .12s, border-color .12s;
  }
  .tab:hover { color: var(--text); }
  .tab.on { color: var(--text); border-bottom-color: var(--focus); }
  .tab:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

  /* ---------------- the picture ---------------- */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--stage-bg, var(--bg));
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
  canvas.target { cursor: pointer; }
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
  /* The grid's names run along the top, so its hints sit at the foot. */
  .hint.low { top: auto; bottom: 8px; max-width: calc(100% - 16px); white-space: normal; text-align: center; }

  /* ---------------- sets ---------------- */
  .legend {
    position: absolute; top: 8px; left: calc(8px + var(--grip-l)); max-width: calc(100% - 16px - var(--grip-l) - var(--grip-r));
    display: flex; flex-wrap: wrap; gap: 4px 10px;
    padding: 4px 9px; border-radius: 6px; cursor: pointer;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
    color: var(--text); font: inherit; font-size: 12px; text-align: left;
  }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }

  .panel {
    position: absolute; top: 0; right: 0; bottom: 0;
    width: min(360px, 100%); box-sizing: border-box;
    overflow-y: auto; overscroll-behavior: contain;
    padding: 8px calc(12px + var(--grip-r)) 16px 12px;
    background: color-mix(in srgb, var(--text) 4%, var(--bg));
    border-left: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
    z-index: 10;
  }
  .panel-head { display: flex; align-items: center; justify-content: space-between; }
  .panel-title { font-family: var(--display); font-size: 16px; }
  .panel-sub { font-family: var(--display); font-size: 14px; margin: 16px 0 6px; }
  .panel-note { color: var(--muted); font-size: 11.5px; line-height: 1.4; margin: 2px 0 8px; }

  .set {
    border: 1px solid color-mix(in srgb, var(--rule) 50%, transparent);
    border-radius: 8px; padding: 6px 8px; margin-bottom: 6px;
  }
  .set.on { border-color: color-mix(in srgb, var(--text) 30%, transparent); }
  .set-row { display: flex; align-items: center; gap: 6px; }
  .set-meta { color: var(--muted); font-size: 11.5px; line-height: 1.35; }
  .set-row + .set-meta { padding-left: 32px; }
  .swatch {
    width: 26px; height: 26px; padding: 0; border: none; border-radius: 50%;
    background: none; cursor: pointer; flex: none;
  }
  .swatch::-webkit-color-swatch-wrapper { padding: 0; }
  .swatch::-webkit-color-swatch { border: 2px solid color-mix(in srgb, var(--text) 25%, transparent); border-radius: 50%; }
  .swatch::-moz-color-swatch { border: 2px solid color-mix(in srgb, var(--text) 25%, transparent); border-radius: 50%; }
  .set-name, .text {
    flex: 1; min-width: 0; height: 28px; padding: 0 7px; border-radius: 6px;
    background: color-mix(in srgb, var(--text) 6%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
    color: var(--text); font: inherit; font-size: 13px;
  }
  .set-name { background: transparent; border-color: transparent; }
  .set-name:hover, .set-name:focus { border-color: color-mix(in srgb, var(--rule) 70%, transparent); }
  .set-name:focus-visible, .text:focus-visible, .swatch:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .icon {
    width: 28px; height: 28px; flex: none; padding: 0; border-radius: 6px; cursor: pointer;
    display: inline-grid; place-items: center;
    background: none; border: 1px solid transparent; color: var(--muted);
  }
  .icon:hover:not(:disabled) { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
  .icon.lit { color: var(--text); }
  .icon:disabled { opacity: .35; cursor: default; }
  .icon:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .icon svg { width: 16px; height: 16px; transition: transform .15s; }
  .set-body { margin-top: 6px; padding-left: 32px; }
  .item { display: flex; align-items: center; gap: 6px; font-size: 13px; padding: 1px 0; }
  .item-label { flex: 1; min-width: 0; }
  .item-x {
    width: 22px; height: 22px; border-radius: 50%; border: none; cursor: pointer;
    background: none; color: var(--muted); font-size: 16px; line-height: 1;
  }
  .item-x:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
  .add-row { display: flex; gap: 6px; margin-top: 6px; }
  .error { color: #ff6b6b; font-size: 11.5px; margin-top: 4px; }
  .link-danger {
    margin-top: 8px; padding: 0; border: none; background: none; cursor: pointer;
    color: #ff6b6b; font: inherit; font-size: 12px;
  }
  .btn.wide { width: 100%; justify-content: center; margin-top: 2px; }
  .btn:disabled { opacity: .45; cursor: default; }
  .offer { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; }
  .offer-text { flex: 1; min-width: 0; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 0; font-size: 13px; }
  .seg { display: inline-flex; border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); border-radius: 6px; overflow: hidden; }
  .seg button {
    height: 28px; padding: 0 9px; border: none; cursor: pointer;
    background: color-mix(in srgb, var(--text) 4%, var(--bg)); color: var(--text); font: inherit; font-size: 12px;
  }
  .seg button + button { border-left: 1px solid color-mix(in srgb, var(--rule) 70%, transparent); }
  .seg button.on { background: color-mix(in srgb, var(--focus) 28%, var(--bg)); }
  .seg button:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .pick {
    height: 28px; min-width: 0; max-width: 170px; padding: 0 6px; border-radius: 6px;
    background: color-mix(in srgb, var(--text) 6%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    color: var(--text); font: inherit; font-size: 12.5px;
  }
  .pick:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  .add-pick { max-width: 150px; }

  /* ---------------- image ---------------- */
  .image-scrim {
    position: absolute; inset: 0; z-index: 30;
    display: grid; place-items: center; padding: 16px;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .image-card {
    width: min(520px, 100%); max-height: 100%; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 8px;
    padding: 8px 12px 12px; border-radius: 10px;
    background: color-mix(in srgb, var(--text) 5%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
  }
  .image-wait { color: var(--muted); font-size: 13px; padding: 24px 0; text-align: center; }
  .image-preview {
    display: block; min-height: 0; max-width: 100%; max-height: 60vh; object-fit: contain;
    border-radius: 6px; border: 1px solid color-mix(in srgb, var(--rule) 50%, transparent);
  }
  .image-actions { display: flex; justify-content: flex-end; gap: 8px; }

  /* ---------------- the card ---------------- */
  .card {
    flex: none;
    max-height: 45%;
    overflow-y: auto;
    padding: 6px calc(10px + var(--grip-r)) 8px calc(10px + var(--grip-l));
    background: color-mix(in srgb, var(--text) 4%, var(--bg));
    border-top: 1px solid color-mix(in srgb, var(--rule) 60%, transparent);
  }
  /* An arc's card: small, floating beside the arc it belongs to. */
  .card.popup {
    position: absolute;
    z-index: 5;
    width: min(340px, calc(100% - 16px));
    max-height: min(60%, 260px);
    box-sizing: border-box;
    padding: 6px 10px 8px;
    border: 1px solid color-mix(in srgb, var(--rule) 70%, transparent);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 6px 24px rgba(0, 0, 0, .35);
  }
  .card.popup .add-pick { max-width: 120px; }
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
