/**
 * Connections lab v3.0 — tunes the look of the cross-reference arcs and the
 * way they fly in: all 344,799 links over one line of the whole Bible.
 *
 * Runs the real code: lib/connections/data.ts for the pack, layout.ts for the
 * shapes, lights.ts for the flights and render.ts for the frame. Every slider
 * writes straight into CONFIG or LIGHTS, so what is drawn here is what the app
 * will draw. Copy values prints both blocks, ready to paste back into
 * src/lib/connections/layout.ts and lights.ts.
 *
 * v3.0 follows the first real tuning pass. Every arc is now one width and one
 * opacity (votes only decide which are drawn); a tap hides everything else and
 * the arcs it touches fly in like arrows, a dot pulling each line behind it;
 * the chapter ruler stays on screen at any zoom, with numbered tags at the bar
 * tips and bold book names that can be tapped; and the line can be stretched
 * wider than the screen. Every control says what it does under it.
 *
 * The pack comes from whatever this origin already installed — the lab is on
 * the same site as the app, so it shares its IndexedDB. If it is not installed
 * the lab downloads it, imports it and carries on, so a phone that has never
 * opened the Connections window can still tune it.
 *
 * The values are kept in this browser between visits (localStorage), so a
 * reload on the phone doesn't lose a half-tuned set. Reset puts back what the
 * app currently ships.
 */

import {
  connectionsInstalled,
  loadConnections,
  refAt,
  bookSpan,
  chapterSpan,
  type ConnectionsData,
} from './src/lib/connections/data';
import { CONFIG, frameFor, type ArcSide, type ConnectionsConfig, type Orientation } from './src/lib/connections/layout';
import { axisDepth, chapterAtScreen, draw, pick, rulerAt, rulerHit, type DrawStats } from './src/lib/connections/render';
import { palette, type ConnectionsPalette } from './src/lib/connections/palette';
import {
  LIGHTS,
  countReach,
  flightFrame,
  litSetFor,
  volleyMs,
  type ConnectionsLights,
  type LitSet,
  type Span,
  type Volley,
} from './src/lib/connections/lights';
import { motionLevel } from './src/lib/motion';
import { BIBLE_BOOKS } from './src/lib/bibleData';
import { BOOK_COLORS } from './src/lib/connections/palette';
import { importPackFromBytes } from './src/adapters/pack-import';
import { PACK_BASE_URL } from './src/lib/packInstaller';

const SHIPPED: ConnectionsConfig = JSON.parse(JSON.stringify(CONFIG));
const SHIPPED_LIGHTS: ConnectionsLights = JSON.parse(JSON.stringify(LIGHTS));
const STORE_KEY = 'connections-lab-values';

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('arcs') as HTMLCanvasElement;
const drawer = document.getElementById('drawer') as HTMLElement;
const bookSel = document.getElementById('book') as HTMLSelectElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

let data: ConnectionsData | null = null;
let W = 0;
let H = 0;
let DPR = 1;
let colors: ConnectionsPalette = palette();

/** Pan and zoom, as the family tree does it. */
let view = { x: 0, y: 0, k: 1 };

/** What is lit, and when its arcs were loosed. Null means everything is shown. */
let lit: LitSet | null = null;
/** The opening volley, while it is in the air. */
let opening: { startedAt: number } | null = null;
/** What the last tap landed on, printed in the drawer. */
let picked: string = '';
/**
 * The Motion level the lab draws at.
 *
 * 'setting' follows the app, which is what ships; the other three force a level
 * so all three can be checked without leaving the page. The app itself only
 * ever reads the setting.
 */
let motionMode: 'setting' | 'full' | 'reduced' | 'off' = 'setting';
function motionNow(): 'full' | 'reduced' | 'off' {
  return motionMode === 'setting' ? motionLevel() : motionMode;
}

let showLabels = true;
/** The theme the canvas paints in. The lab is outside the app's themed subtree,
 *  so it asks for colors by name rather than inheriting an inverted filter. */
let themeName: 'reader' | 'dark' | 'light' | 'sepia' = 'reader';

/** Set when a dial changes, so the frame loop redraws once rather than per event. */
let dirty = true;
let lastStats: DrawStats | null = null;

// ── Saved values ─────────────────────────────────────────────────────────

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ config: CONFIG, lights: LIGHTS, prefs: { showLabels, themeName, motionMode } }),
    );
  } catch {
    // Storage blocked: the lab still works, it just forgets on reload.
  }
}

/**
 * Copy saved values over the shipped ones, but only keys that still exist and
 * still hold the same kind of value. A set saved by an older lab carries dials
 * that are gone (the vote thickness, the wave's flicker) and they must not
 * creep back into Copy values.
 */
function adopt(target: object, saved: unknown) {
  if (!saved || typeof saved !== 'object') return;
  const t = target as Record<string, unknown>;
  const s = saved as Record<string, unknown>;
  for (const key of Object.keys(t)) {
    if (key in s && typeof s[key] === typeof t[key]) t[key] = s[key];
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    adopt(CONFIG, v?.config);
    adopt(LIGHTS.open, v?.lights?.open);
    adopt(LIGHTS.tap, v?.lights?.tap);
    if (typeof v?.lights?.openOnLoad === 'boolean') LIGHTS.openOnLoad = v.lights.openOnLoad;
    if (typeof v?.lights?.dotSize === 'number') LIGHTS.dotSize = v.lights.dotSize;
    // Chapters are always equal width now; an older saved 'verses' must not stick.
    CONFIG.width = 'equal';
    if (typeof v?.prefs?.showLabels === 'boolean') showLabels = v.prefs.showLabels;
    if (typeof v?.prefs?.themeName === 'string') themeName = v.prefs.themeName;
    if (typeof v?.prefs?.motionMode === 'string') motionMode = v.prefs.motionMode;
  } catch {
    // Nothing saved, or storage blocked.
  }
}

function resetValues() {
  Object.assign(CONFIG, JSON.parse(JSON.stringify(SHIPPED)));
  Object.assign(LIGHTS, JSON.parse(JSON.stringify(SHIPPED_LIGHTS)));
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage blocked.
  }
  buildDrawer();
  dirty = true;
}

// ── The theme the canvas paints in ───────────────────────────────────────

const FIXED_THEMES: Record<'dark' | 'light' | 'sepia', { text: string; bg: string }> = {
  dark: { text: '#e0e0e0', bg: '#1a1a1a' },
  light: { text: '#1a1a1a', bg: '#fafafa' },
  sepia: { text: '#3b2f22', bg: '#f6f0e3' },
};

function refreshPalette() {
  if (themeName === 'reader') {
    colors = palette();
    return;
  }
  // The lab offers the three fixed themes directly, so a look can be checked
  // against each without changing the reader's own setting.
  const { text, bg } = FIXED_THEMES[themeName];
  const mixed = (amount: number) => blend(text, bg, amount);
  colors = {
    bg,
    text,
    muted: mixed(0.45),
    rule: mixed(0.7),
    pale: themeName !== 'dark',
  };
}

/** `amount` of the way from a to b. Enough of lib/themeColors' mix for here. */
function blend(a: string, b: string, amount: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const c = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * amount);
  return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
}
function hex(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// ── Canvas ───────────────────────────────────────────────────────────────

function measure() {
  DPR = window.devicePixelRatio || 1;
  W = stage.clientWidth;
  H = stage.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  dirty = true;
}

/** True while arcs are in the air, so the loop keeps asking for frames. */
let animating = false;

function render(now = performance.now()) {
  if (!data) return;
  // The room under the rule follows from the name size; it is not a dial.
  CONFIG.axisDepth = axisDepth(showLabels, CONFIG);
  const flight = flightFrame(LIGHTS, lit, opening, now, motionNow());
  // Once the opening volley has landed it is spent; clearing it here means the
  // picture does not fly in again on the next unrelated redraw.
  if (opening && !flight.opening) opening = null;
  animating = !flight.settled;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  lastStats = draw(ctx, data, CONFIG, { width: W, height: H }, {
    palette: colors,
    lit: lit?.spans,
    flight,
    labels: showLabels,
    view,
  });
}

let fpsFrames = 0;
let fpsT0 = performance.now();
let flashUntil = 0;

function frame() {
  const now = performance.now();

  // Arcs in flight need a frame a frame; everything else redraws once.
  if (dirty || animating) {
    dirty = false;
    render(now);
  }

  fpsFrames++;
  if (now - fpsT0 >= 500) {
    if (now > flashUntil) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsT0));
      const s = lastStats;
      // The frame rate while arcs fly is the number that decides whether the
      // flight is affordable, and it is not the same as the resting one.
      const air = s?.flying ? ` · ${s.flying.toLocaleString()} in the air` : '';
      fpsEl.textContent = s
        ? `${fps} fps · ${s.ms.toFixed(1)} ms/draw${air}\n${s.drawn.toLocaleString()} arcs shown · ${s.batches} batches`
        : `${fps} fps`;
      fpsEl.style.whiteSpace = 'pre';
    }
    fpsFrames = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(frame);
}

/**
 * Redraw every frame for a moment, so the readout measures a real frame rate
 * rather than the idle loop. Dragging a slider does this by itself.
 */
function spin(ms = 1200) {
  const until = performance.now() + ms;
  const tick = () => {
    dirty = true;
    if (performance.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Gestures: drag to pan, pinch or wheel to zoom, tap to light ──────────

/**
 * Zoom runs out past the whole picture, not just down to it: with the line
 * stretched wider than the screen, zooming out is how the whole Bible comes
 * back into view.
 */
const MIN_K = 0.05;
/** One wheel notch: two of the old 1.12 steps, so one swipe does what two used to. */
const WHEEL_STEP = 1.12 ** 2;
const MAX_K = 60;

let dragging = false;
let moved = false;
let lastX = 0;
let lastY = 0;
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: { dist: number; k: number } | null = null;

/**
 * Dragging a range instead of panning.
 *
 * A toggle rather than a long-press, because a long-press-then-drag and a pan
 * are the same gesture on a phone and the picture is something you pan a lot.
 * While it is on, a drag along the axis picks the passage under it.
 */
let rangeMode = false;
let rangeFrom: number | null = null;

const rangeBtn = document.getElementById('range') as HTMLButtonElement;
rangeBtn.addEventListener('click', () => {
  rangeMode = !rangeMode;
  rangeBtn.setAttribute('aria-pressed', String(rangeMode));
  rangeFrom = null;
});

/** The first verse of the chapter under a screen point, or null off the line. */
function positionAt(at: { x: number; y: number }): number | null {
  if (!data) return null;
  const chapter = chapterAtScreen(data, CONFIG, { width: W, height: H }, view, at);
  return chapter === null ? null : data.chapterStarts[chapter];
}

/**
 * Light everything between two verse positions.
 *
 * `restart` is false while a drag is still in progress: re-launching on every
 * pointermove would hold the arcs on the ground forever, so mid-drag the range
 * is simply shown and the volley only flies when the drag ends.
 */
function lightRange(a: number, b: number, restart = true) {
  if (!data) return;
  const lo = Math.min(a, b);
  // The chapter the drag ended in is included whole, so a drag across Matthew
  // lights all of Matthew rather than stopping mid-chapter.
  const end = endOfChapterAt(Math.max(a, b));
  const spans = [{ start: lo, end }];
  if (restart) light(spans);
  else {
    // Launched long enough ago that every arc has already landed.
    lit = { spans, startedAt: -1e9 };
    dirty = true;
  }
  const from = refAt(lo);
  const to = refAt(Math.max(end - 1, lo));
  if (from && to) {
    const reach = countReach(data, { start: lo, end });
    picked =
      `<b>${from.book} ${from.chapter} – ${to.book} ${to.chapter}</b><br>` +
      `${reach.out.toLocaleString()} out, ${reach.in.toLocaleString()} in`;
    refreshPicked();
  }
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

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = true;
  moved = false;
  lastX = e.clientX;
  lastY = e.clientY;
  if (rangeMode && pointers.size === 1) {
    rangeFrom = positionAt(onScreen(e));
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
  }
});

canvas.addEventListener('pointermove', (e) => {
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
  dirty = true;
});

function endPointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) {
    dragging = false;
    // A finished range drag flies its arcs now, over the span the reader chose.
    if (rangeMode && rangeFrom !== null && moved) {
      const to = positionAt(onScreen(e));
      if (to !== null) lightRange(rangeFrom, to);
      rangeFrom = null;
      return;
    }
    rangeFrom = null;
    if (!moved) tap(e);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const at = onScreen(e);
    zoomAt(at.x, at.y, view.k * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP));
  },
  { passive: false },
);

/**
 * Zoom to `k`, keeping the point under (sx, sy) where it is — so the chapter
 * under the mouse or between the fingers is the one you zoom into, rather than
 * whatever happens to be at the center.
 *
 * Over the ruler the anchor across the axis is the rule itself, not the
 * pointer. The ruler is drawn on top of empty space below the line, and
 * zooming about a point down there flung the line — and every arc with it —
 * off the top of the screen. Anchored on the rule, zooming over a chapter
 * widens it in place with its arcs still rising from it.
 */
function zoomAt(sx: number, sy: number, k: number) {
  const next = clamp(k, MIN_K, MAX_K);
  const horizontal = CONFIG.orientation === 'horizontal';
  const { rule } = rulerAt({ width: W, height: H }, CONFIG, showLabels, view);
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
  dirty = true;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A pointer's position on the canvas, in CSS pixels. */
function onScreen(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** The same point in the picture's own coordinates, undoing pan and zoom. */
function toCanvas(e: PointerEvent): { x: number; y: number } {
  const { x: sx, y: sy } = onScreen(e);
  return {
    x: (sx - W / 2) / view.k + W / 2 - view.x,
    y: (sy - H / 2) / view.k + H / 2 - view.y,
  };
}

/**
 * How far above the rule a tap still counts as aimed at the ruler.
 *
 * Every arc has a foot on the rule, so near it the arcs are packed shoulder to
 * shoulder: measured over the real set, a tap within 40px of the rule hits an
 * arc **100% of the time**. So the ruler wins near the rule, and only a tap out
 * in the field where arcs are separable means an arc.
 */
const AXIS_GRAB_PX = 44;

/**
 * A tap on a book name lights the book, a tap on the bars lights the chapter,
 * and a tap out among the arcs picks the arc under it.
 */
function tap(e: PointerEvent) {
  if (!data) return;
  const hit = rulerHit(
    data,
    CONFIG,
    { width: W, height: H },
    view,
    showLabels,
    lastStats?.names ?? [],
    onScreen(e),
    AXIS_GRAB_PX,
  );

  if (hit?.kind === 'book') {
    lightBook(data.books[hit.book].name);
    return;
  }

  if (hit?.kind === 'chapter') {
    const ref = refAt(data.chapterStarts[hit.chapter]);
    const span = ref ? chapterSpan(ref.book, ref.chapter) : null;
    if (span && ref) {
      light([span]);
      const reach = countReach(data, span);
      picked = `<b>${ref.book} ${ref.chapter}</b><br>${reach.out.toLocaleString()} out, ${reach.in.toLocaleString()} in`;
      refreshPicked();
    }
    return;
  }

  // Out among the arcs: only the ones on show can be picked.
  const arc = pick(data, CONFIG, { width: W, height: H }, toCanvas(e), 7 / view.k, lit?.spans);
  if (arc !== null) showLink(arc);
}

/** Light a set of spans, launching their arcs now. */
function light(spans: Span[]) {
  lit = spans.length ? litSetFor(spans, performance.now()) : null;
  dirty = true;
}

/** Light one book, from the picker or a tapped name. An empty name shows everything. */
function lightBook(name: string) {
  const span = name ? bookSpan(name) : null;
  bookSel.value = span ? name : '';
  light(span ? [span] : []);
  if (span && data) {
    const reach = countReach(data, span);
    picked = `<b>${name}</b><br>${reach.out.toLocaleString()} out, ${reach.in.toLocaleString()} in`;
  } else {
    picked = '';
  }
  refreshPicked();
}

/**
 * A tapped arc, shown as both of its verses.
 *
 * The rows are the app's standard reference row — the reference in its book's
 * color over the opening words, with a bar of that color down the left. The lab
 * builds them in plain DOM because this page carries no Svelte; the real window
 * in Phase 3 uses `components/VerseRefRow.svelte` itself, which is also where
 * the verse text comes from.
 */
function showLink(hit: number) {
  if (!data) return;
  const fromRef = refAt(data.from[hit]);
  const a = refAt(data.toStart[hit]);
  const b = refAt(data.toEnd[hit]);
  const ranged = a && b && data.toStart[hit] !== data.toEnd[hit];
  const target = ranged
    ? `${a!.book} ${a!.chapter}:${a!.verse}–${b!.chapter === a!.chapter ? b!.verse : `${b!.chapter}:${b!.verse}`}`
    : a
      ? `${a.book} ${a.chapter}:${a.verse}`
      : '?';

  picked = fromRef
    ? refRow(fromRef.book, `${fromRef.book} ${fromRef.chapter}:${fromRef.verse}`) +
      refRow(a?.book ?? fromRef.book, target) +
      `<div class="votes">${data.votes[hit].toLocaleString()} votes</div>`
    : '';

  // Light both ends by their chapters, not by the two bare verses: two verses
  // out of 31,102 light almost nothing, which reads as the selection having
  // been lost rather than as an arc having been chosen.
  const spans: Span[] = [];
  const fromSpan = fromRef ? chapterSpan(fromRef.book, fromRef.chapter) : null;
  if (fromSpan) spans.push(fromSpan);
  const toSpan = a ? chapterSpan(a.book, a.chapter) : null;
  if (toSpan) spans.push(toSpan);
  light(spans.length ? spans : [{ start: data.from[hit], end: data.from[hit] + 1 }]);
  refreshPicked();
}

/** One reference row, in its book's color. */
function refRow(book: string, label: string): string {
  const color = BOOK_COLORS[BIBLE_BOOKS.findIndex((b) => b.name === book)] ?? '#8a8f98';
  return (
    `<div class="refrow" style="border-left-color:${color}">` +
    `<span class="refname" style="color:${color}">${label}</span>` +
    `</div>`
  );
}

document.getElementById('redraw')!.addEventListener('click', () => {
  dirty = true;
  spin();
});
document.getElementById('whole')!.addEventListener('click', () => {
  view = { x: 0, y: 0, k: 1 };
  dirty = true;
});
document.getElementById('clear')!.addEventListener('click', () => {
  lightBook('');
});
document.getElementById('replay')!.addEventListener('click', () => {
  // The opening, from scratch: clear whatever is lit so it flies the whole
  // Bible the way it does when the window first opens.
  lightBook('');
  replayOpen();
});
bookSel.addEventListener('change', () => lightBook(bookSel.value));

// ── The drawer ───────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  parent?.appendChild(e);
  return e;
}

/** A line of explanation under a heading. */
function note(text: string) {
  el('p', { className: 'note', textContent: text }, drawer);
}

/** The two dials every volley has, so the tap and the opening read the same way. */
function volleyDials(spec: Volley, replay: () => void) {
  slider(
    'flight time',
    () => spec.flightMs,
    (v) => { spec.flightMs = v; replay(); },
    100, 3000, 25,
    'How long one arc takes from leaving its verse to landing, in milliseconds.',
  );
  slider(
    'stagger',
    () => spec.staggerMs,
    (v) => { spec.staggerMs = v; replay(); },
    0, 4000, 25,
    'Spread the launches over this long, earliest verse first, so the volley rolls along the line. 0 fires them all at once.',
  );
}

/** Fly the tapped arcs in again, so a dial can be judged. */
function replayTap() {
  if (lit) light(lit.spans);
  else replayOpen();
}

/** Fly the whole Bible in again. */
function replayOpen() {
  opening = { startedAt: performance.now() };
  dirty = true;
}

function heading(text: string, action?: { label: string; onClick: () => void }) {
  const h = el('h2', { textContent: text }, drawer);
  if (action) {
    const b = el('button', { textContent: action.label }, h);
    b.addEventListener('click', action.onClick);
  }
}

function slider(
  label: string,
  get: () => number,
  set: (v: number) => void,
  min: number,
  max: number,
  step: number,
  hint?: string,
) {
  const row = el('div', { className: 'row' }, drawer);
  el('label', { textContent: label }, row);
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) }, row);
  input.value = String(get());
  const out = el('output', { textContent: fmtNum(get()) }, row);
  input.addEventListener('input', () => {
    set(Number(input.value));
    out.textContent = fmtNum(get());
    save();
    dirty = true;
  });
  if (hint) el('p', { className: 'hint', textContent: hint }, drawer);
}

function choice<T extends string>(
  label: string,
  options: readonly T[],
  get: () => T,
  set: (v: T) => void,
  names?: Partial<Record<T, string>>,
) {
  const row = el('div', { className: 'row' }, drawer);
  el('label', { textContent: label }, row);
  const sel = el('select', {}, row);
  for (const o of options) el('option', { value: o, textContent: names?.[o] ?? o }, sel);
  sel.value = get();
  sel.addEventListener('change', () => {
    set(sel.value as T);
    save();
    dirty = true;
  });
}

function checks(items: [string, () => boolean, (v: boolean) => void][]) {
  const wrap = el('div', { className: 'checks' }, drawer);
  for (const [label, get, set] of items) {
    const l = el('label', {}, wrap);
    const c = el('input', { type: 'checkbox', checked: get() }, l);
    l.append(label);
    c.addEventListener('change', () => {
      set(c.checked);
      save();
      dirty = true;
    });
  }
}

function refreshPicked() {
  const box = document.getElementById('picked');
  if (box) box.innerHTML = picked || '<span style="color:#6b6153">Tap a chapter bar, a book name, or an arc.</span>';
}

function buildDrawer() {
  drawer.innerHTML = '';

  heading('Tapped');
  el('div', { className: 'picked', id: 'picked' }, drawer);
  refreshPicked();

  heading('The line');
  choice<Orientation>('direction', ['horizontal', 'vertical'], () => CONFIG.orientation, (v) => {
    CONFIG.orientation = v;
  });
  choice<ArcSide>(
    'arcs',
    ['top', 'split'],
    () => (CONFIG.side === 'bottom' ? 'top' : CONFIG.side),
    (v) => { CONFIG.side = v; },
    { top: 'all above the line', split: 'forward above, backward below' },
  );
  slider(
    'Bible length',
    () => CONFIG.stretch,
    (v) => { CONFIG.stretch = v; },
    1, 12, 0.25,
    'Stretches the line wider than the screen so every chapter gets wider and more numbers fit. Drag sideways to travel along it, or zoom out to see all of it. Unlike zooming, the arcs keep their height.',
  );

  heading('Chapter ruler');
  slider(
    'bar width',
    () => CONFIG.barFill,
    (v) => { CONFIG.barFill = v; },
    0.1, 1, 0.05,
    'How much of its own space each chapter bar fills. 1 is touching; lower leaves a gap between bars. Arcs always land on their own bar, verse 1 at its left edge and the last verse at its right.',
  );
  slider(
    'number size',
    () => CONFIG.numberSize,
    (v) => { CONFIG.numberSize = v; },
    7, 20, 0.5,
    'Chapter numbers sit at the tip of each bar, and climb their own bar where two would overlap. They show once a chapter is wide enough: zoom in, or lengthen the line.',
  );
  slider(
    'outline',
    () => CONFIG.numberOutline,
    (v) => { CONFIG.numberOutline = v; },
    0, 4, 0.1,
    'The dark edge around each chapter number and book-name letter (light on a light theme), so they read on top of the bars and dividers. 0 is no edge.',
  );
  slider(
    'name height',
    () => CONFIG.nameHeight,
    (v) => { CONFIG.nameHeight = v; },
    30, 200, 2,
    'How tall every book name stands. Long names get small letters and short names big ones, so they all end level. Tap a name to light the whole book.',
  );
  checks([['show numbers and names', () => showLabels, (v) => { showLabels = v; }]]);

  heading('Arcs');
  slider(
    'thickness',
    () => CONFIG.thickness,
    (v) => { CONFIG.thickness = v; },
    0.1, 4, 0.05,
    'Every arc is the same width, in screen pixels, and stays that width when you zoom.',
  );
  slider(
    'opacity',
    () => CONFIG.opacity,
    (v) => { CONFIG.opacity = v; },
    0.01, 1, 0.01,
    'How solid each arc is. Where many cross they add up, so a bright band means many links.',
  );
  slider(
    'tallest',
    () => CONFIG.heightMax,
    (v) => { CONFIG.heightMax = v; },
    0.1, 1, 0.01,
    'Height of the longest arc (Genesis to Revelation), as a share of the space above the line.',
  );
  slider(
    'shortest',
    () => CONFIG.heightMin,
    (v) => { CONFIG.heightMin = v; },
    0, 0.3, 0.005,
    'Height of the shortest arc, so a link to the next verse is still a visible bump.',
  );
  slider(
    'height curve',
    () => CONFIG.heightCurve,
    (v) => { CONFIG.heightCurve = v; },
    0.1, 2, 0.01,
    'How fast arcs get taller with distance. 1 is even. Lower lifts the short arcs up off the line; higher keeps them flat and saves the height for long ones.',
  );

  heading('Colors along each arc');
  note('An arc leaves wearing the color of where it is going and lands wearing the color of where it came from.');
  slider(
    'swap point',
    () => CONFIG.crossfadeAt,
    (v) => { CONFIG.crossfadeAt = v; },
    0, 1, 0.01,
    'Where along the arc the color changes over. 0.5 is the middle.',
  );
  slider(
    'blend length',
    () => CONFIG.crossfadeWidth,
    (v) => { CONFIG.crossfadeWidth = v; },
    0, 1, 0.01,
    '0 switches color in one hard step; 1 blends slowly over the whole arc.',
  );

  heading('Which links');
  slider(
    'min votes',
    () => CONFIG.voteFloor,
    (v) => { CONFIG.voteFloor = v; },
    0, 200, 1,
    'Hide links fewer readers have voted for. 0 shows them all. Votes never change how an arc looks, only whether it is drawn.',
  );
  slider(
    'only the top',
    () => CONFIG.maxArcs,
    (v) => { CONFIG.maxArcs = v; },
    0, 344799, 1000,
    'Keep only this many links, most-voted first. 0 keeps all 344,799. Fewer makes dragging and zooming smoother.',
  );

  heading('Dots', { label: 'Replay', onClick: replayTap });
  slider(
    'dot size',
    () => LIGHTS.dotSize,
    (v) => { LIGHTS.dotSize = v; replayTap(); },
    0.5, 8, 0.1,
    'The dot at the front of each flying arc. It wears the color of the book it was shot from all the way to where it lands.',
  );

  heading('Tap: arcs fly in', { label: 'Replay', onClick: replayTap });
  note(
    'Tap a chapter bar or a book name, pick a book, or turn on Select range and drag along the line. ' +
      'Everything else hides and that passage’s arcs shoot out from their first verse and land on the other.',
  );
  volleyDials(LIGHTS.tap, replayTap);

  heading('Opening: whole Bible flies in', { label: 'Replay', onClick: replayOpen });
  checks([['run when the page opens', () => LIGHTS.openOnLoad, (v) => { LIGHTS.openOnLoad = v; }]]);
  volleyDials(LIGHTS.open, replayOpen);

  heading('Motion');
  note(
    'The app follows the Motion setting. With motion reduced or off the arcs skip the flight and are simply there. ' +
      'This forces a level so each can be checked here.',
  );
  choice('level', ['setting', 'full', 'reduced', 'off'] as const, () => motionMode, (v) => {
    motionMode = v;
  }, { setting: 'follow the app setting' });

  heading('Look');
  choice('theme', ['reader', 'dark', 'light', 'sepia'] as const, () => themeName, (v) => {
    themeName = v;
    refreshPalette();
  }, { reader: 'the app’s theme' });

  heading('Copy values', { label: 'Copy', onClick: copyValues });
  el('textarea', { id: 'readout', readOnly: true, value: readout() }, drawer);
  const reset = el('button', { textContent: 'Reset to what ships' }, drawer);
  reset.style.marginTop = '8px';
  reset.addEventListener('click', resetValues);
}

// ── Copy values ──────────────────────────────────────────────────────────

/** Keep the readout in step with every control. Attached once, since the
 *  drawer is rebuilt on Reset. */
function refreshReadout() {
  const ta = document.getElementById('readout') as HTMLTextAreaElement | null;
  if (ta) ta.value = readout();
}
drawer.addEventListener('input', refreshReadout);
drawer.addEventListener('change', refreshReadout);
drawer.addEventListener('pointerup', refreshReadout);

function fmtNum(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function fmt(v: unknown, indent: string): string {
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map((x) => fmt(x, indent)).join(', ')}]`;
  if (v && typeof v === 'object') {
    const inner = indent + '  ';
    const lines = Object.entries(v).map(([k, x]) => `${inner}${k}: ${fmt(x, inner)},`);
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return String(v);
}

function readout(): string {
  CONFIG.axisDepth = axisDepth(showLabels, CONFIG);
  return (
    `// src/lib/connections/layout.ts\nexport const CONFIG: ConnectionsConfig = ${fmt(CONFIG, '')};\n` +
    `\n// src/lib/connections/lights.ts\nexport const LIGHTS: ConnectionsLights = ${fmt(LIGHTS, '')};\n`
  );
}

async function copyValues() {
  const text = readout();
  const ta = document.getElementById('readout') as HTMLTextAreaElement | null;
  if (ta) ta.value = text;
  try {
    await navigator.clipboard.writeText(text);
    flash('Copied');
  } catch {
    ta?.select();
    const ok = document.execCommand?.('copy');
    flash(ok ? 'Copied' : 'Select the text and copy it');
  }
}

function flash(msg: string) {
  fpsEl.textContent = msg;
  flashUntil = performance.now() + 1200;
}

// ── The pack ─────────────────────────────────────────────────────────────

function status(msg: string) {
  drawer.innerHTML = `<p class="note">${msg}</p>`;
}

/**
 * The pack, from this origin's own IndexedDB or off the wire.
 *
 * The lab is served from the same origin as the app, so an install the app
 * already did is simply there. When it is not, the lab downloads and imports it
 * rather than refusing to open: the whole point is tuning on the phone, and the
 * phone may never have opened the window.
 */
async function ensurePack(): Promise<void> {
  if (await connectionsInstalled()) return;

  status('Downloading the Connections pack (1.7 MB)…');
  const response = await fetch(`${PACK_BASE_URL}/connections.sqlite`);
  if (!response.ok) throw new Error(`The pack would not download (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  status('Installing the Connections pack…');
  await importPackFromBytes(bytes, 'connections.sqlite');
}

function buildBookPicker(d: ConnectionsData) {
  el('option', { value: '', textContent: 'Light a book…' }, bookSel);
  for (const book of d.books) {
    el('option', { value: book.name, textContent: book.name }, bookSel);
  }
}

// ── Start ────────────────────────────────────────────────────────────────

load();
refreshPalette();
new ResizeObserver(() => measure()).observe(stage);

ensurePack()
  .then(() => loadConnections())
  .then((loaded) => {
    data = loaded;
    buildBookPicker(loaded);
    measure();
    buildDrawer();
    // The opening volley, the first thing the picture does — the same flight
    // the window will run when it opens in the app.
    if (LIGHTS.openOnLoad && motionNow() === 'full') opening = { startedAt: performance.now() };
    requestAnimationFrame(frame);
    spin(Math.max(2000, volleyMs(LIGHTS.open)));
  })
  .catch((error) => {
    status(`Couldn’t load the connections. ${error instanceof Error ? error.message : ''}`);
  });
