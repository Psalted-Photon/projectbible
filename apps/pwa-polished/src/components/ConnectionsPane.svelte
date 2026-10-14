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
  import { CONFIG, frameFor, type ConnectionsConfig } from '../lib/connections/layout';
  import { axisDepth, chapterAtScreen, draw, pick, rulerAt, rulerHit, type PlacedName } from '../lib/connections/render';
  import { palette, type ConnectionsPalette } from '../lib/connections/palette';
  import { LIGHTS, countReach, flightFrame, litSetFor, type LitSet, type Span } from '../lib/connections/lights';
  import {
    MAX_ITEMS,
    MAX_SETS,
    MAX_SHOWN_SETS,
    MAX_VIEWS,
    cleanLook,
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
    type ConnectionSet,
    type ConnectionsLook,
    type ConnectionsView,
    type ReadyOffer,
    type SetItem,
    type SetLayer,
  } from '../lib/connections/sets';
  import { getHighlightNames } from '../adapters/settings';
  import { CREDIT, renderConnectionsImage } from '../lib/connections/image';
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
    config.axisDepth = axisDepth(true, config);
    // Showing or hiding a set flies its arcs in the way a tap does.
    const flying = lit ?? (setsLaunch !== null ? { spans: [], startedAt: setsLaunch } : null);
    const flight = flightFrame(LIGHTS, flying, opening, now, motionLevel());
    // A landed opening is spent, so an unrelated redraw does not fly it again.
    if (opening && !flight.opening) opening = null;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const stats = draw(ctx, data, config, { width: W, height: H }, {
      palette: colors,
      lit: lit?.spans,
      flight,
      labels: true,
      view,
      sets: layer,
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
  type Card = (
    | { kind: 'link'; from: ConnectionRef; to: ConnectionRef; toLabel: string; votes: number }
    | { kind: 'span'; title: string; open: ConnectionRef; out: number; in: number }
  ) & {
    /** What Add to set adds: the passage, or an arc's two ends. */
    items: SetItem[];
  };
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
    card = {
      kind: 'span',
      title: name,
      open: { book: name, chapter: 1, verse: 1 },
      out: reach.out,
      in: reach.in,
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
    card = { kind: 'span', title, open: { ...from, verse: 1 }, out: reach.out, in: reach.in, items: itemsOf(spans) };
  }

  function tap(e: PointerEvent) {
    if (!data) return;
    const at = onScreen(e);
    const hit = rulerHit(data, config, { width: W, height: H }, view, true, names, at, AXIS_GRAB_PX);

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
        card = {
          kind: 'span',
          title: `${ref.book} ${ref.chapter}`,
          open: ref,
          out: reach.out,
          in: reach.in,
          items: itemsOf([span]),
        };
      }
      return;
    }

    // Out among the arcs: only the ones on show can be picked.
    const arc = pick(data, config, { width: W, height: H }, toPicture(at), 7 / view.k, lit?.spans, layer);
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
    card = {
      kind: 'link',
      from,
      to: a,
      toLabel,
      votes: data.votes[hit],
      items: itemsOf([
        { start: data.from[hit], end: data.from[hit] + 1 },
        { start: data.toStart[hit], end: Math.max(data.toEnd[hit], data.toStart[hit]) + 1 },
      ]),
    };

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
    };
    // The same name again saves over it, rather than making a twin.
    views = same ? views.map((v) => (v.id === same.id ? saved : v)) : [...views, saved];
    saveViews(views);
    viewName = '';
  }

  function openView(v: ConnectionsView) {
    applyLook(v);
    setShown(v.shown.filter((id) => library.some((s) => s.id === id)));
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
  $: if (card) {
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
    closeImage();
    imageBusy = true;
    try {
      const title = litTitle || (shownSets.length ? 'Cross references in Scripture' : 'Every cross reference in Scripture');
      const blob = await renderConnectionsImage({
        data,
        config,
        viewport: { width: W, height: H },
        view: { ...view },
        palette: colors,
        lit: lit?.spans,
        sets: layer,
        title,
        legend: shownSets.map((s) => ({ name: s.name, color: s.color })),
      });
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
    if (e.key === 'Escape' && imageOpen && !get(lookupStore)) {
      e.stopPropagation();
      closeImage();
      return;
    }
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
      const look = cleanLook(windowState?.contentState?.look);
      if (look) config = { ...config, ...look };
      const savedShown = windowState?.contentState?.shown;
      if (Array.isArray(savedShown)) {
        shown = savedShown.filter((id): id is string => typeof id === 'string' && library.some((s) => s.id === id));
      }
      await rebuildLayer(false);
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
    window.addEventListener('settingsUpdated', onSettingsUpdated);
    return () => {
      window.removeEventListener('settingsUpdated', onSettingsUpdated);
      window.removeEventListener('packsUpdated', onPacks);
      window.removeEventListener('keydown', onKeydownCapture, true);
    };
  });

  onDestroy(() => {
    if (frameId) cancelAnimationFrame(frameId);
    if (saveTimer) clearTimeout(saveTimer);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
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
      <button
        class="btn"
        class:on={panelOpen}
        aria-pressed={panelOpen}
        title="Sets and saved views"
        on:click={togglePanel}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9" r="4.5"/><circle cx="16" cy="9" r="4.5"/><circle cx="12" cy="15.5" r="4.5"/></svg>
        <span class="btn-label">Sets</span>
      </button>
      <button class="btn" title="Save or share this picture as an image" disabled={!data || imageBusy} on:click={makeImage}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>
        <span class="btn-label">Image</span>
      </button>
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
      {:else if emptyShown && !card && !panelOpen}
        <div class="hint">“{emptyShown.name}” is empty. Tap a book, a chapter or an arc, then Add to set.</div>
      {/if}

      {#if shownSets.length && !panelOpen}
        <button class="legend" title="Sets and saved views" on:click={togglePanel}>
          {#each shownSets as set (set.id)}
            <span class="legend-item"><span class="dot" style="background:{set.color}"></span>{set.name}</span>
          {/each}
        </button>
      {/if}

      {#if panelOpen}
        <div class="panel" role="dialog" aria-label="Sets and saved views">
          <div class="panel-head">
            <div class="panel-title">Sets</div>
            <CloseX label="Close" on:click={() => (panelOpen = false)} />
          </div>
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
            <div class="set-meta">None yet. A saved view keeps the line, the arcs, the links shown and which sets are on.</div>
          {/each}
          <form class="add-row" on:submit|preventDefault={saveView}>
            <input class="text" bind:value={viewName} maxlength="60" placeholder="Name this view" aria-label="View name" />
            <button class="btn" type="submit" disabled={views.length >= MAX_VIEWS && !views.some((v) => v.name.toLowerCase() === viewName.trim().toLowerCase())}>Save</button>
          </form>
        </div>
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
          <VerseRefRow book={span.open.book} chapter={span.open.chapter} verse={span.open.verse} label={span.title} onOpen={() => read(span.open)} />
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
            <img class="image-preview" src={imageUrl} alt="The Connections arcs as they will be saved" />
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
