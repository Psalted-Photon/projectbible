<script lang="ts">
  /**
   * The Timeline window: the whole story down one vertical strip, and where
   * you are in it.
   *
   * Split the same way the map is. The chrome, the gestures and the panel are
   * here; where anything sits is lib/timeline/layout.ts (events, eras, ticks)
   * and lib/timeline/lanes.ts (kings, prophets, world, lives, books); the
   * questions asked of the data are lib/timeline/query.ts; what there is to
   * draw is lib/timeline/data.ts, read from the Timeline pack. The card is
   * TimelineCard, the "At this moment" readout TimelineMoment.
   *
   * Drawn in screen space: every position is worked out in zoomed pixels and
   * offset by the scroll, and only what is on screen is drawn. An earlier
   * version scaled one tall layer with a CSS transform, which cannot zoom far
   * enough to pull the Gospel years apart without blurring or blowing up.
   *
   * Taps: the stage captures every pointer for dragging, so nothing inside it
   * ever gets a click from a finger. Anything tappable inside the stage carries
   * a data- attribute and is found in handleTap. Controls outside the stage
   * (the nav, its menus, search, the card) are ordinary buttons.
   *
   * A docked window rather than a fullscreen view, deliberately: tapping a
   * passage sends the reader there and the timeline stays open beside it.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { windowStore } from '../lib/stores/windowStore';
  import { navigationStore } from '../stores/navigationStore';
  import GetPacksCard from './GetPacksCard.svelte';
  import TimelineCard from './TimelineCard.svelte';
  import TimelineMoment from './TimelineMoment.svelte';
  import {
    loadTimeline,
    releaseTimeline,
    timelineInstalled,
    formatYear,
    formatItemSpan,
    type TimelineData,
    type TimelineItem,
    type TimelinePassage,
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
    ZOOM_LIMITS,
    type Mark,
    type ScaleMode,
    type TimelineScale,
  } from '../lib/timeline/layout';
  import { LANES, laneLimit, laneWidth, layoutLane, laneView, type LaneId, type LaneLayout } from '../lib/timeline/lanes';
  import { buildHereIndex, findHere, momentAt, searchItems, type HereIndex } from '../lib/timeline/query';

  export let windowId: string | undefined = undefined;

  let stageEl: HTMLDivElement;

  let loading = true;
  let missing = false;
  let error: string | null = null;
  let data: TimelineData | null = null;

  /** What the card at the foot shows: any item on the strip. */
  let selected: TimelineItem | null = null;

  $: windowState = windowId ? $windowStore.find((w) => w.id === windowId) : undefined;

  function remember(patch: Record<string, unknown>) {
    if (windowId) windowStore.updateContentState(windowId, patch);
  }

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


  // ===== Scale =====

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
  let stageW = 0;

  $: tier = visibleTier(zoom, mode);

  // ===== Columns =====
  //
  // Year ticks, then the eras, then whichever lanes are chosen, then the
  // events. Worked out here in pixels because the lanes come and go.

  const TICK_W = 50;
  $: narrow = stageW > 0 && stageW < 430;
  $: eraW = narrow ? 44 : 62;
  $: eraX = TICK_W + 2;

  let chosenLanes: LaneId[] = LANES.map((l) => l.id);
  $: limit = laneLimit(stageW || 400);
  /** The chosen lanes that fit, most recently chosen first, drawn in their fixed order. */
  $: shownLaneIds = new Set(chosenLanes.slice(0, limit));
  $: laneCols = (() => {
    let x = eraX + eraW + 6;
    const cols: { id: LaneId; x: number; w: number; header: string }[] = [];
    for (const lane of LANES) {
      if (!shownLaneIds.has(lane.id)) continue;
      const w = laneWidth(lane.id, narrow);
      cols.push({ id: lane.id, x, w, header: lane.header });
      x += w + 4;
    }
    return cols;
  })();
  $: eventsX = (laneCols.length ? laneCols[laneCols.length - 1].x + laneCols[laneCols.length - 1].w : eraX + eraW) + 30;

  let laneLayouts = new Map<LaneId, LaneLayout>();

  function toggleLane(id: LaneId) {
    // Start from what is actually showing, so turning one off at this width
    // does not bring a hidden one forward in its place.
    const base = chosenLanes.slice(0, limit);
    chosenLanes = base.includes(id) ? base.filter((l) => l !== id) : [id, ...base].slice(0, limit);
    remember({ timelineLanes: chosenLanes });
  }

  // ===== Layout =====

  $: eraLayout = data ? layoutEras(data.eras, scale, zoom) : { bands: [], lanes: 1 };
  /** Where two eras overlap they share the column, half each. */
  $: halfEras = (() => {
    const half = new Map<string, 'left' | 'right'>();
    const bands = eraLayout.bands;
    for (const b of bands) {
      if (b.lane > 0) half.set(b.era.id, 'right');
      else if (bands.some((o) => o.lane > 0 && o.era.year_start < b.era.year_end && o.era.year_end > b.era.year_start)) {
        half.set(b.era.id, 'left');
      }
    }
    return half;
  })();
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
  $: laneViews = data
    ? laneCols.map((c) => {
        const layout = laneLayouts.get(c.id);
        return { ...c, ...(layout ? laneView(layout, scale, zoom, ty, stageH, c.w) : { bars: [], labels: [] }) };
      })
    : [];

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

  /** The scroll that puts a year in the middle of the stage at the current zoom. */
  function tyFor(year: number): number {
    const h = scale.height * zoom;
    const t = stageH / 2 - scale.y(year) * zoom;
    return h <= stageH ? 0 : Math.min(0, Math.max(stageH - h, t));
  }

  // ----- Gliding, for Follow my reading and for stepping between items -----

  let glideFrame = 0;

  function stopGlide() {
    if (glideFrame) cancelAnimationFrame(glideFrame);
    glideFrame = 0;
  }

  /** Ease the scroll to a new place over about 300ms. */
  function glideTo(target: number, ms = 300) {
    stopGlide();
    const from = ty;
    if (Math.abs(target - from) < 1) {
      ty = target;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      ty = from + (target - from) * e;
      glideFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    glideFrame = requestAnimationFrame(step);
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
    const next = Math.min(3, tier + 1) as 1 | 2 | 3;
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
    stopGlide();
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
    remember({ timelineScale: next });
  }

  // ===== You are here =====

  let hereIndex: HereIndex | null = null;
  $: here = data && hereIndex && $navigationStore.book && $navigationStore.chapter
    ? findHere(data, hereIndex, $navigationStore.book, $navigationStore.chapter)
    : null;
  $: hereLabel = `${$navigationStore.book} ${$navigationStore.chapter}`;
  /** Screen pixels: the line, or the top and bottom of the shaded span. */
  $: hereTop = here ? scale.y(here.start) * zoom + ty : 0;
  $: hereBottom = here ? (here.range ? scale.y(here.end) * zoom + ty : hereTop) : 0;
  $: hereWhere = !here ? 'none' : hereBottom < 0 ? 'above' : hereTop > stageH ? 'below' : 'on';

  /** On by default: the strip keeps what you are reading in view. */
  let follow = true;
  /** When a finger or wheel last moved the strip; Follow leaves it alone for three seconds after. */
  let lastUserMove = 0;
  let followedKey = '';

  $: hereKey = here ? `${here.item.id}|${here.start}|${hereLabel}` : '';
  $: if (data && follow && hereKey && hereKey !== followedKey && stageH > 0) followHere();

  function hereCentreYear(): number | null {
    if (!here) return null;
    if (!here.range) return here.start;
    // A long span is shown from its start rather than lost around its middle.
    const spanPx = (scale.y(here.end) - scale.y(here.start)) * zoom;
    return spanPx < stageH * 0.7 ? (here.start + here.end) / 2 : here.start;
  }

  function followHere() {
    followedKey = hereKey;
    if (performance.now() - lastUserMove < 3000) return;
    const year = hereCentreYear();
    if (year !== null) glideTo(tyFor(year));
  }

  function goToHere() {
    const year = hereCentreYear();
    if (year !== null) glideTo(tyFor(year));
  }

  function toggleFollow() {
    follow = !follow;
    remember({ timelineFollow: follow });
    if (follow) {
      lastUserMove = 0;
      followedKey = '';
    }
  }

  // ===== At this moment =====

  let momentOn = false;
  $: momentYear = (() => {
    const y = Math.round(scale.yearAt((stageH / 2 - ty) / Math.max(zoom, 1e-6)));
    return y === 0 ? -1 : y;
  })();
  $: moment = momentOn && data ? momentAt(data, momentYear) : null;
  $: momentEra = moment && data ? data.eras.filter((e) => e.year_start <= momentYear && momentYear <= e.year_end).map((e) => e.title).join(' · ') : '';

  function toggleMoment() {
    momentOn = !momentOn;
    if (momentOn) selected = null;
  }

  // ===== Search =====

  let searchOpen = false;
  let query = '';
  let searchInput: HTMLInputElement;
  $: results = searchOpen && data ? searchItems(data, query) : [];

  async function openSearch() {
    menu = null;
    searchOpen = !searchOpen;
    if (searchOpen) {
      await tick();
      searchInput?.focus();
    }
  }

  function closeSearch() {
    searchOpen = false;
    query = '';
  }

  function pickResult(item: TimelineItem) {
    closeSearch();
    focusItem(item);
  }

  const KIND_LABEL: Record<string, string> = {
    event: 'Event', era: 'Era', reign: 'King', prophet: 'Prophet', empire: 'Empire', ruler: 'Ruler', life: 'Life', book: 'Book',
  };

  // ===== Menus =====

  let menu: 'lanes' | 'more' | null = null;

  function toggleMenu(which: 'lanes' | 'more') {
    menu = menu === which ? null : which;
  }

  /** A press anywhere but a menu or its button closes it. */
  function onRootPointerDown(e: PointerEvent) {
    if (!menu) return;
    const el = e.target as Element | null;
    if (el?.closest('.menu, [data-menu-button]')) return;
    menu = null;
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
    stageW = r.width;
    clampTy();
  }

  function onPointerDown(e: PointerEvent) {
    stopGlide();
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
      lastUserMove = performance.now();
      e.preventDefault();
    } else if (dragLast !== null) {
      ty += y - dragLast;
      dragLast = y;
      clampTy();
      if (moved) lastUserMove = performance.now();
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
   * click lands on the stage rather than the thing that was pressed — so their
   * own on:click never fires from a finger. What was tapped is worked out here
   * instead, the same way FamilyTreeViewer's `pick` does it. The on:click
   * handlers stay for the keyboard.
   */
  function handleTap(clientX: number, clientY: number, y: number) {
    const hit = document.elementFromPoint(clientX, clientY);
    const handled = (run: () => void) => {
      tapHandledAt = performance.now();
      lastTapAt = 0;
      run();
    };

    if (hit?.closest('[data-more]')) return handled(zoomToNextTier);
    if (hit?.closest('[data-here]')) return handled(tapHere);

    const markEl = hit?.closest<HTMLElement>('[data-mark-key]');
    const mark = markEl ? marks.find((m) => m.key === markEl.dataset.markKey) : undefined;
    if (mark) return handled(() => activateMark(mark));

    const itemEl = hit?.closest<HTMLElement>('[data-item-id]');
    const item = itemEl && data ? data.byId.get(itemEl.dataset.itemId ?? '') : undefined;
    if (item) return handled(() => selectItem(item));

    const bandEl = hit?.closest<HTMLElement>('[data-era-id]');
    const era = bandEl && data ? data.byId.get(bandEl.dataset.eraId ?? '') : undefined;
    if (era) return handled(() => selectEra(era));

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
    stopGlide();
    measureStage();
    lastUserMove = performance.now();
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
    glideTo(tyFor((era.year_start + era.year_end) / 2));
  }

  function tapHere() {
    if (!here) return;
    if (hereWhere === 'on') selectItem(here.item);
    else goToHere();
  }

  function activateMark(mark: Mark) {
    if (mark.kind === 'cluster') openCluster(mark);
    else selectItem(mark.item);
  }

  /**
   * Bring an item into view and open its card: its lane turned on if it was
   * off, the zoom raised until an event's tier shows, and the strip moved to it.
   * Used by search, the card's back and next, and its links.
   */
  function focusItem(item: TimelineItem) {
    selected = item;
    if (!data) return;
    const lane = item.lane as LaneId;
    if (LANES.some((l) => l.id === lane) && !shownLaneIds.has(lane)) {
      chosenLanes = [lane, ...chosenLanes.slice(0, limit)].slice(0, limit);
      remember({ timelineLanes: chosenLanes });
    }
    measureStage();
    if (item.lane === 'events') {
      const need = clampZoom(zoomForTier((item.tier ?? 3) as 1 | 2 | 3, mode));
      if (need > zoom) {
        stopGlide();
        zoom = need;
        ty = tyFor(item.sort_key);
        return;
      }
      glideTo(tyFor(item.sort_key));
      return;
    }
    const spanPx = (scale.y(item.year_end) - scale.y(item.year_start)) * zoom;
    glideTo(tyFor(spanPx < stageH * 0.7 ? (item.year_start + item.year_end) / 2 : item.year_start));
  }

  /**
   * Zoom into a folded run until it comes apart.
   *
   * Far enough that the span fills most of the strip and the deepest tier in
   * it shows; if that is still not enough, the next layout folds what is left
   * into smaller chips, which open the same way.
   */
  function openCluster(mark: Mark) {
    stopGlide();
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
   * Take the reader to a passage.
   *
   * The map's exact call: a crumb first, so the navbar's back arrow puts the
   * reader back where it was standing with the timeline still open, then the
   * jump.
   */
  function read(p: TimelinePassage) {
    const current = get(navigationStore);
    navigationStore.pushHistory(current, 'timeline');
    navigationStore.navigateToVerse(current.translation, p.b, p.c, p.v);
  }

  function zoomButton(factor: number) {
    stopGlide();
    measureStage();
    zoomAt(stageH / 2, factor);
  }

  function resetView() {
    stopGlide();
    measureStage();
    zoom = clampZoom(stageH / scale.height);
    ty = 0;
    clampTy();
  }

  // ===== Lifecycle =====

  /**
   * Read the pack and build everything that depends only on it.
   *
   * Run at open, and again whenever a pack is installed or updated
   * (packsUpdated), so a Timeline installed from its own Get packs card, or
   * updated from the new-version notice, shows straight away with no restart.
   * A reload keeps the year in the middle of the strip where it was.
   */
  async function load(first: boolean) {
    try {
      if (!(await timelineInstalled())) {
        missing = true;
        loading = false;
        return;
      }
      const keepYear = !first && data && stageH > 0 ? scale.yearAt((stageH / 2 - ty) / zoom) : null;
      if (!first) releaseTimeline();
      const loaded = await loadTimeline();
      storyScale = makeStoryScale(loaded.eras, loaded.events);
      trueScale = makeScale(loaded.minYear, loaded.maxYear);
      laneLayouts = new Map(LANES.map((l) => [l.id, layoutLane(l.id, loaded.items)]));
      hereIndex = buildHereIndex(loaded);

      // The window's own settings, on its first real load (at open, or once a
      // pack that was missing arrives).
      if (first || missing) {
        const saved = windowState?.contentState;
        mode = saved?.timelineScale === 'true' ? 'true' : 'story';
        if (Array.isArray(saved?.timelineLanes)) {
          chosenLanes = saved.timelineLanes.filter((id: string) => LANES.some((l) => l.id === id));
        }
        if (typeof saved?.timelineFollow === 'boolean') follow = saved.timelineFollow;
      }

      const wasMissing = missing;
      missing = false;
      error = null;
      data = loaded;
      loading = false;
      // The card keeps showing the same item, as the new pack has it.
      if (selected) selected = loaded.byId.get(selected.id) ?? null;

      // Wait for the stage to have a size before the zoom and scroll.
      requestAnimationFrame(() => {
        // Follow may already have started a glide at the old zoom; this
        // placement replaces it.
        stopGlide();
        measureStage();
        if (keepYear !== null && !wasMissing) {
          ty = tyFor(keepYear);
          return;
        }
        zoom = startZoom(mode === 'story' ? storyScale : trueScale, mode);
        ty = 0;
        clampTy();
        // Opening with Follow on starts where the reader is, without a glide.
        const year = follow ? hereCentreYear() : null;
        if (year !== null) {
          ty = tyFor(year);
          followedKey = hereKey;
        }
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      loading = false;
    }
  }

  // Attached by hand rather than with on: directives so passive:false is
  // guaranteed — a passive listener drops preventDefault, and without it the
  // browser scrolls the page instead of the axis. The stage element comes and
  // goes with the install gate, so the listeners follow whichever one is there.
  const listenerOpts: AddEventListenerOptions = { passive: false };
  let attached: HTMLDivElement | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const STAGE_EVENTS: [string, (e: any) => void][] = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerCancel],
    ['wheel', onWheel],
    ['gesturestart', blockGesture],
    ['gesturechange', blockGesture],
    ['gestureend', blockGesture],
  ];

  function detachStage() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (!attached) return;
    for (const [name, fn] of STAGE_EVENTS) attached.removeEventListener(name, fn, listenerOpts);
    attached = null;
  }

  function attachStage(el: HTMLDivElement | null | undefined) {
    if (el === attached) return;
    detachStage();
    if (!el) return;
    attached = el;
    for (const [name, fn] of STAGE_EVENTS) el.addEventListener(name, fn, listenerOpts);
    resizeObserver = new ResizeObserver(() => measureStage());
    resizeObserver.observe(el);
  }

  $: attachStage(stageEl);

  onMount(() => {
    void load(true);
    const onPacks = () => void load(false);
    window.addEventListener('packsUpdated', onPacks);
    return () => {
      window.removeEventListener('packsUpdated', onPacks);
      stopGlide();
      detachStage();
    };
  });

  onDestroy(() => {
    pointers.clear();
    releaseTimeline();
  });
</script>

<!-- `.no-edge-gesture`, or scrubbing the axis near the screen edge arms a new
     window instead of scrolling the years. -->
<div class="timeline no-edge-gesture" style={gripStyle} on:pointerdown={onRootPointerDown}>
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
      <button class="btn" class:on={searchOpen} aria-pressed={searchOpen} title="Find an event, king, prophet or book" on:click={openSearch}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="20.5" y2="20.5"/></svg>
        <span class="btn-label">Find</span>
      </button>
      <button class="btn" class:on={momentOn} aria-pressed={momentOn} title="Everything going on in one year" on:click={toggleMoment}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/></svg>
        <span class="btn-label">Moment</span>
      </button>
      <button class="btn" class:on={menu === 'lanes'} data-menu-button title="Kings, prophets, world powers, lives and books beside the events" on:click={() => toggleMenu('lanes')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="4.5" height="17" rx="1"/><rect x="10" y="3.5" width="4.5" height="17" rx="1"/><rect x="16.5" y="3.5" width="4" height="17" rx="1"/></svg>
        <span class="btn-label">Lanes</span>
      </button>
      <button class="btn btn-icon" class:on={menu === 'more'} data-menu-button title="More" aria-label="More" on:click={() => toggleMenu('more')}>
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
      </button>
    </div>

    {#if menu === 'lanes'}
      <div class="menu" role="menu">
        <div class="menu-h">Lanes beside the events</div>
        {#each LANES as lane (lane.id)}
          <button class="menu-item" role="menuitemcheckbox" aria-checked={shownLaneIds.has(lane.id)} on:click={() => toggleLane(lane.id)}>
            <span class="menu-check">{shownLaneIds.has(lane.id) ? '✓' : ''}</span>
            {lane.label}
          </button>
        {/each}
        <div class="menu-note">
          {limit === LANES.length ? 'All of them fit at this width.' : `${limit === 1 ? 'One fits' : `${limit} fit`} at this width; widen the window for more.`}
        </div>
      </div>
    {:else if menu === 'more'}
      <div class="menu" role="menu">
        <button class="menu-item" role="menuitemcheckbox" aria-checked={mode === 'true'} on:click={() => setMode(mode === 'true' ? 'story' : 'true')}>
          <span class="menu-check">{mode === 'true' ? '✓' : ''}</span>
          True years <span class="menu-sub">each year the same height</span>
        </button>
        <button class="menu-item" role="menuitemcheckbox" aria-checked={follow} on:click={toggleFollow}>
          <span class="menu-check">{follow ? '✓' : ''}</span>
          Follow my reading
        </button>
        <div class="menu-row">
          <button class="btn btn-icon" title="Zoom out" aria-label="Zoom out" on:click={() => zoomButton(1 / 1.6)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="btn btn-icon" title="Zoom in" aria-label="Zoom in" on:click={() => zoomButton(1.6)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
          </button>
          <button class="btn" title="Fit the whole span" on:click={resetView}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 5 12 3 16 5"/><polyline points="8 19 12 21 16 19"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
            Whole span
          </button>
        </div>
      </div>
    {/if}

    {#if searchOpen}
      <div class="search">
        <input
          bind:this={searchInput}
          bind:value={query}
          class="search-input"
          type="search"
          placeholder="Hezekiah, Exodus, Malachi, Rome…"
          aria-label="Find on the timeline"
          on:keydown={(e) => {
            if (e.key === 'Escape') closeSearch();
            if (e.key === 'Enter' && results[0]) pickResult(results[0]);
          }}
        />
        <button class="search-close" aria-label="Close search" on:click={closeSearch}>×</button>
        {#if query.trim()}
          <div class="results">
            {#each results as r (r.id)}
              <button class="result" on:click={() => pickResult(r)}>
                <span class="result-title">{r.title}</span>
                <span class="result-meta">{r.subtitle ?? KIND_LABEL[r.kind]} · {formatItemSpan(r)}</span>
              </button>
            {:else}
              <div class="result-none">Nothing on the timeline matches.</div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="stage" bind:this={stageEl} style="--events-x: {eventsX}px; --era-x: {eraX}px; --era-w: {eraW}px;">
      {#if loading}
        <div class="loading">Reading the timeline…</div>
      {:else if data}
        <!-- Bands are clipped to the stage so their names stay pinned to the
             top of whatever part of the era is showing. -->
        {#each shownBands as band (band.era.id)}
          {@const top = Math.max(band.top + ty, -4)}
          {@const bottom = Math.min(band.bottom + ty, stageH + 4)}
          {@const half = halfEras.get(band.era.id)}
          <div
            class="band"
            class:sel={selected?.id === band.era.id}
            style="top: {top}px; height: {Math.max(0, bottom - top)}px; --c: {band.color}; left: {eraX + (half === 'right' ? eraW / 2 + 1 : 0)}px; width: {half ? eraW / 2 - 1 : eraW}px;"
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

        <!-- The lanes: kings, prophets, world, lives, books. -->
        {#each laneViews as lane (lane.id)}
          <div class="lane" style="left: {lane.x}px; width: {lane.w}px;">
            {#each lane.bars as bar (bar.key)}
              <div
                class="lane-bar"
                class:narrow={bar.narrow}
                class:sel={selected?.id === bar.item.id}
                style="top: {bar.top}px; height: {bar.height}px; left: {bar.left}px; width: {bar.width}px; --c: {bar.color};"
                title={bar.item.title}
                data-item-id={bar.item.id}
              ></div>
            {/each}
            {#each lane.labels as label (label.item.id)}
              <div
                class="lane-label"
                style="top: {label.top}px; left: {label.left}px; max-width: {label.maxWidth}px;"
                data-item-id={label.item.id}
              >{label.item.title}</div>
            {/each}
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

        <!-- You are here: a line at the event, or a shaded span for a reign,
             a prophet or a whole book. -->
        {#if here && hereWhere === 'on'}
          {#if here.range}
            <div class="here-span" style="top: {Math.max(hereTop, -2)}px; height: {Math.max(2, Math.min(hereBottom, stageH + 2) - Math.max(hereTop, -2))}px;"></div>
          {:else}
            <div class="here-line" style="top: {hereTop}px;"></div>
          {/if}
          <button class="here-tag" data-here style="top: {Math.max(Math.min(hereTop, stageH - 24), 4)}px;" on:click={() => fromClick(tapHere)}>
            You’re reading {hereLabel}
          </button>
        {:else if here && hereWhere !== 'none'}
          <button class="here-tag here-off" class:below={hereWhere === 'below'} data-here on:click={() => fromClick(tapHere)}>
            {hereWhere === 'above' ? '↑' : '↓'} {hereLabel}
          </button>
        {/if}

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

        {#if momentOn}
          <div class="moment-line" style="top: {stageH / 2}px;"></div>
          <div class="moment-tag" style="top: {stageH / 2}px;">c. {formatYear(momentYear)}</div>
        {/if}

        <!-- Lane names, pinned to the top of the strip. -->
        {#if laneViews.length}
          <div class="lane-heads">
            {#each laneViews as lane (lane.id)}
              <div class="lane-head" style="left: {lane.x}px; width: {lane.w}px;">
                {#if lane.id === 'kings'}
                  <span class="lane-head-half">Judah</span><span class="lane-head-half">Israel</span>
                {:else}
                  {lane.header}
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if tier < 3}
          <button class="more" data-more on:click={() => fromClick(zoomToNextTier)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="20.5" y2="20.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            Zoom in for more events
          </button>
        {/if}
      {/if}
    </div>

    {#if data && selected}
      <div class="panel">
        <TimelineCard
          item={selected}
          {data}
          {tier}
          onSelect={focusItem}
          onRead={read}
          onClose={() => (selected = null)}
        />
      </div>
    {:else if data && moment}
      <div class="panel">
        <TimelineMoment {moment} eraTitle={momentEra} onSelect={focusItem} onClose={() => (momentOn = false)} />
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
    --moment: #fbbf24;
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
  @container (max-width: 560px) { .nav .btn-label { display: none; } .nav .btn:not(.btn-icon) { padding: 0; width: 30px; justify-content: center; } }

  /* ---------------- menus ---------------- */
  .menu {
    position: absolute;
    top: calc(var(--nav-h) * var(--bar-scale, 1) + 4px);
    right: calc(8px + var(--grip-r));
    z-index: 30;
    min-width: 230px; max-width: calc(100% - 16px);
    padding: 6px;
    background: var(--chrome-2);
    border: 1px solid var(--line-2);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, .5);
  }
  .menu-h {
    padding: 4px 8px 6px;
    font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint);
  }
  .menu-item {
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
    width: 100%; padding: 7px 8px; border-radius: 6px; cursor: pointer; text-align: left;
    background: none; border: 0; color: var(--text); font: inherit; font-size: 13px;
  }
  .menu-item:hover { background: #2a2a2a; }
  .menu-item:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
  .menu-check { width: 14px; flex: none; color: var(--focus); }
  .menu-sub { flex-basis: 100%; padding-left: 22px; color: var(--faint); font-size: 11px; }
  .menu-note { padding: 6px 8px 4px; color: var(--faint); font-size: 11px; line-height: 1.4; }
  .menu-row { display: flex; gap: 6px; padding: 6px 8px 4px; border-top: 1px solid var(--line); margin-top: 4px; }

  /* ---------------- search ---------------- */
  .search {
    flex: none; position: relative; z-index: 25;
    display: flex; align-items: center; gap: 6px;
    padding: 6px calc(8px + var(--grip-r)) 6px calc(8px + var(--grip-l));
    background: var(--chrome); border-bottom: 1px solid var(--line);
  }
  .search-input {
    flex: 1; min-width: 0; height: 32px; padding: 0 10px; border-radius: 6px;
    background: var(--sunken); border: 1px solid var(--line-2); color: var(--text);
    font: inherit; font-size: 14px;
  }
  .search-input:focus { outline: none; border-color: var(--focus); }
  .search-close {
    width: 30px; height: 30px; border-radius: 6px; background: transparent; border: 0;
    color: var(--dim); font-size: 19px; line-height: 1; cursor: pointer;
  }
  .results {
    position: absolute; left: calc(8px + var(--grip-l)); right: calc(8px + var(--grip-r)); top: 100%;
    max-height: 60vh; overflow-y: auto;
    background: var(--chrome-2); border: 1px solid var(--line-2); border-radius: 0 0 8px 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, .5);
  }
  .result {
    display: block; width: 100%; padding: 7px 10px; text-align: left; cursor: pointer;
    background: none; border: 0; border-bottom: 1px solid var(--line); font: inherit;
  }
  .result:last-child { border-bottom: 0; }
  .result:hover, .result:focus-visible { background: #2a2a2a; outline: none; }
  .result-title { display: block; color: var(--color-primary, #4a90e2); font-size: 13px; }
  .result-meta { display: block; color: var(--faint); font-size: 11px; }
  .result-none { padding: 10px; color: var(--faint); font-size: 12px; }

  /* ---------------- the axis ---------------- */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--sunken);
    /* The gestures are ours; the browser must not also scroll or pinch. */
    touch-action: none;
    cursor: grab;
    user-select: none;
  }
  .stage:active { cursor: grabbing; }

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
    position: absolute; top: 4px; left: 5px; right: 3px;
    font-family: var(--display); font-size: 11px; line-height: 1.2;
    color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, .7);
    overflow-wrap: anywhere;
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
    background: #222;
  }

  /* ---------------- lanes ---------------- */
  .lane {
    position: absolute; top: 0; bottom: 0;
    overflow: hidden;
    background: rgba(255, 255, 255, .015);
  }
  .lane-bar {
    position: absolute;
    border-radius: 3px;
    background: color-mix(in srgb, var(--c) 55%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 80%, transparent);
    box-sizing: border-box;
    cursor: pointer;
  }
  .lane-bar.narrow {
    background: repeating-linear-gradient(180deg, var(--c) 0 3px, transparent 3px 6px);
    border: 0;
    opacity: .8;
  }
  .lane-bar.sel { box-shadow: 0 0 0 2px var(--focus); z-index: 1; }
  .lane-label {
    position: absolute;
    padding: 0 3px;
    border-radius: 3px;
    background: rgba(10, 10, 10, .62);
    color: #f1f1f1;
    font-size: 10px; line-height: 13px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    cursor: pointer;
    z-index: 2;
  }
  .lane-heads {
    position: absolute; left: 0; right: 0; top: 0; height: 16px; z-index: 3;
    background: linear-gradient(var(--sunken) 55%, transparent);
    pointer-events: none;
  }
  .lane-head {
    position: absolute; top: 2px;
    display: flex; justify-content: center;
    font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint);
    white-space: nowrap; overflow: hidden;
  }
  .lane-head-half { flex: 1; text-align: center; }

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
    z-index: 2;
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

  /* ---------------- you are here ---------------- */
  .here-line {
    position: absolute; left: 0; right: 0; height: 0;
    border-top: 2px solid var(--focus);
    box-shadow: 0 0 8px rgba(251, 113, 133, .55);
    pointer-events: none; z-index: 1;
  }
  .here-span {
    position: absolute; left: 0; right: 0;
    background: rgba(251, 113, 133, .09);
    border-top: 2px solid rgba(251, 113, 133, .8);
    border-bottom: 1px dashed rgba(251, 113, 133, .5);
    box-sizing: border-box;
    pointer-events: none; z-index: 1;
  }
  .here-tag {
    position: absolute; left: 4px; z-index: 4;
    transform: translateY(-100%);
    padding: 1px 7px; border-radius: 999px; cursor: pointer;
    background: var(--focus); border: 0; color: #1a0a0d;
    font: inherit; font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  .here-tag.here-off { top: 22px; transform: none; opacity: .92; }
  .here-tag.here-off.below { top: auto; bottom: 10px; left: 10px; }

  /* ---------------- at this moment ---------------- */
  .moment-line {
    position: absolute; left: 0; right: 0; height: 0;
    border-top: 2px dashed var(--moment);
    pointer-events: none; z-index: 3;
  }
  .moment-tag {
    position: absolute; left: 4px; z-index: 4;
    transform: translateY(4px);
    padding: 1px 7px; border-radius: 999px;
    background: var(--moment); color: #1f1600;
    font-size: 11px; font-weight: 600; white-space: nowrap;
    pointer-events: none;
  }

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

  /* ---------------- the card ---------------- */
  .panel {
    flex: none;
    position: relative;
    max-height: 50%;
    overflow-y: auto;
    padding: 10px calc(14px + var(--grip-r)) calc(14px + var(--grip-b)) calc(14px + var(--grip-l));
    background: var(--chrome);
    border-top: 1px solid var(--line);
    z-index: 20;
  }

  /* ---------------- not installed ---------------- */
  .gate {
    position: absolute; inset: 0; z-index: 30; display: grid; place-items: center;
    padding: 24px; background: var(--chrome); overflow-y: auto;
  }
  .gate-card { max-width: 380px; text-align: center; color: var(--dim); font-size: 13px; line-height: 1.6; }
  .gate-title { font-family: var(--display); font-size: 17px; color: var(--text); margin-bottom: 10px; }
</style>
