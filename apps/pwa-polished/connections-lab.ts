/**
 * Connections lab v2.0 — tunes the look of the cross-reference arcs, and the
 * light that travels over them: all 344,799 links over one line of the whole
 * Bible.
 *
 * Runs the real code: lib/connections/data.ts for the pack, layout.ts for the
 * shapes, lights.ts for the travelling light and render.ts for the frame. Every
 * slider writes straight into CONFIG or LIGHTS, so what is drawn here is what
 * the app will draw. Copy values prints both blocks, ready to paste back into
 * src/lib/connections/layout.ts and lights.ts.
 *
 * The light is the v2.0 addition. Tapping a chapter, picking a book or dragging
 * a range lights what it touches and dims the rest, and the light arrives
 * rather than appearing — it spreads from the tap using the family tree's own
 * easing and wave dials, so the two pictures move like one app. An opening
 * sweep runs Genesis to Revelation when the picture first appears. All of it
 * follows the Motion setting; the Motion section forces a level so 'full',
 * 'reduced' and 'off' can each be checked without leaving the page.
 *
 * The pack comes from whatever this origin already installed — the lab is on
 * the same site as the app, so it shares its IndexedDB. If it is not installed
 * the lab downloads it, imports it and carries on, so a phone that has never
 * opened the Connections window can still tune it.
 *
 * The frame-rate readout is the point of the exercise as much as the dials are:
 * it says whether the full set can be drawn live or has to be cached to an
 * image layer. Both the draw time and the arc count are printed with it.
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
import { CONFIG, frameFor, type ArcSide, type ChapterWidth, type ConnectionsConfig, type Orientation } from './src/lib/connections/layout';
import { chapterAt, draw, pick, type DrawStats } from './src/lib/connections/render';
import { palette, type ConnectionsPalette } from './src/lib/connections/palette';
import {
  LIGHTS,
  LIGHT_ORDER_NAMES,
  countReach,
  lightFrame,
  litSetFor,
  waveDurationMs,
  type ConnectionsLights,
  type LightOrder,
  type LitSet,
  type Span,
} from './src/lib/connections/lights';
import { CURVE_NAMES, type Curve } from './src/lib/familyTree/motion';
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

/**
 * What is lit, and when its light began. Null means everything is lit, which
 * is the resting state.
 */
let lit: LitSet | null = null;
/** The opening sweep, while it is running. */
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

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (v?.config) Object.assign(CONFIG, v.config);
    // The light specs are nested, so each is merged rather than replaced: a set
    // saved before a dial existed still loads, with the new dial at its
    // shipped value instead of undefined.
    if (v?.lights) {
      const l = v.lights;
      if (l.open) Object.assign(LIGHTS.open, l.open);
      if (l.tap) Object.assign(LIGHTS.tap, l.tap);
      if (typeof l.order === 'string') LIGHTS.order = l.order;
      if (typeof l.openOnLoad === 'boolean') LIGHTS.openOnLoad = l.openOnLoad;
    }
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

/** True while a light is still travelling, so the loop keeps asking for frames. */
let animating = false;

function render(now = performance.now()) {
  if (!data) return;
  const light = lightFrame(LIGHTS, lit, opening, now, CONFIG.dimFloor, motionNow());
  // Once the opening sweep has settled it is spent; clearing it here means the
  // picture does not re-light on the next unrelated redraw.
  if (opening && !light.opening && light.settled) opening = null;
  animating = !light.settled;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  lastStats = draw(ctx, data, CONFIG, { width: W, height: H }, {
    palette: colors,
    lit: lit?.spans,
    light,
    labels: showLabels,
    view,
  });
}

let fpsFrames = 0;
let fpsT0 = performance.now();
let flashUntil = 0;

function frame() {
  const now = performance.now();

  // A travelling light needs a frame a frame; everything else redraws once.
  if (dirty || animating) {
    dirty = false;
    render(now);
  }

  fpsFrames++;
  if (now - fpsT0 >= 500) {
    if (now > flashUntil) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsT0));
      const s = lastStats;
      // While a light travels, say so and say how long it runs: the frame rate
      // during a wave is the number that decides whether the light is
      // affordable, and it is not the same as the resting one.
      const wave = animating
        ? ` · lighting ${(waveDurationMs(opening ? LIGHTS.open : LIGHTS.tap) / 1000).toFixed(1)}s`
        : '';
      fpsEl.textContent = s
        ? `${fps} fps · ${s.ms.toFixed(1)} ms/draw${wave}\n${s.drawn.toLocaleString()} arcs · ${s.batches} batches${s.skipped ? ` · ${s.skipped.toLocaleString()} skipped` : ''}`
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

const MIN_K = 1;
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

/** The verse position under a point, or null if it missed the axis. */
function positionAt(at: { x: number; y: number }): number | null {
  if (!data) return null;
  const chapter = chapterAt(data, CONFIG, { width: W, height: H }, at);
  return chapter === null ? null : data.chapterStarts[chapter];
}

/**
 * Light everything between two verse positions.
 *
 * `restart` is false while a drag is still in progress: re-stamping the light's
 * start time on every pointermove would hold the wave at its first frame
 * forever, so the span updates live and the wave only runs when the drag ends.
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
    // Mid-drag the light is simply there: a start time far enough back that the
    // wave has already finished, so the reader sees the range they are choosing
    // rather than a wave restarting under their finger.
    lit = { spans, origin: (lo + end) / 2, startedAt: -1e9 };
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
    rangeFrom = positionAt(toCanvas(e));
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
    view.k = clamp(pinchStart.k * (dist / pinchStart.dist), MIN_K, MAX_K);
    moved = true;
    dirty = true;
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
    const to = positionAt(toCanvas(e));
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
    // A finished range drag runs its wave now, over the span the reader chose.
    if (rangeMode && rangeFrom !== null && moved) {
      const to = positionAt(toCanvas(e));
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
    view.k = clamp(view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_K, MAX_K);
    dirty = true;
  },
  { passive: false },
);

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The tap point in the canvas's own coordinates, undoing pan and zoom. */
function toCanvas(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return {
    x: (sx - W / 2) / view.k + W / 2 - view.x,
    y: (sy - H / 2) / view.k + H / 2 - view.y,
  };
}

/**
 * A tap picks an arc if one is under it, and otherwise lights the chapter it
 * landed on. Phase 2 takes this further; here it is enough to check that the
 * shapes and the lighting line up with what is drawn.
 */
/**
 * How near the axis a tap counts as aiming at a chapter rather than an arc.
 *
 * This matters more than it looks. Every arc has a foot on the axis, so near
 * the rule the arcs are packed shoulder to shoulder: measured over the real
 * set, a tap within 40px of the axis hits an arc **100% of the time**, at every
 * point along the whole Bible. Trying `pick` first therefore made tapping a
 * chapter impossible — the tap always found some arc and lit its two verses
 * instead of the 176 in Psalm 119, which read as the selection being lost.
 *
 * So the axis wins near the axis: a tap in this band means the chapter under
 * it, and only a tap out in the field where arcs are separable means the arc.
 */
const AXIS_GRAB_PX = 44;

function tap(e: PointerEvent) {
  if (!data) return;
  const at = toCanvas(e);

  // How far the tap is from the rule, across the axis.
  const frame = frameFor({ width: W, height: H }, CONFIG);
  const across = Math.abs(
    (CONFIG.orientation === 'horizontal' ? at.y : at.x) - frame.originAcross,
  );

  if (across > AXIS_GRAB_PX) {
    const hit = pick(data, CONFIG, { width: W, height: H }, at, 7 / view.k);
    if (hit !== null) {
      showLink(hit);
      return;
    }
  }

  const chapter = chapterAt(data, CONFIG, { width: W, height: H }, at);
  if (chapter === null) return;
  const start = data.chapterStarts[chapter];
  const ref = refAt(start);
  const span = ref ? chapterSpan(ref.book, ref.chapter) : null;
  if (span && ref) {
    light([span]);
    const reach = countReach(data, span);
    picked = `<b>${ref.book} ${ref.chapter}</b><br>${reach.out.toLocaleString()} out, ${reach.in.toLocaleString()} in`;
    refreshPicked();
  }
}

/** Light a set of spans, starting the wave from now. */
function light(spans: Span[]) {
  lit = spans.length ? litSetFor(spans, performance.now()) : null;
  dirty = true;
}

/**
 * A tapped arc, shown as both of its verses.
 *
 * The rows are the app's standard reference row — the reference in its book's
 * color over the opening words, with a bar of that color down the left. The lab
 * builds them in plain DOM because this page carries no Svelte; the real window
 * in Phase 3 uses `components/VerseRefRow.svelte` itself, which is also where
 * the verse text comes from. Here the shape is what matters: the two ends of a
 * cross-reference read as references, not as coordinates.
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
  // been lost rather than as an arc having been chosen. The chapters either end
  // sits in are what a reader is actually asking about.
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
  light([]);
  picked = '';
  bookSel.value = '';
  refreshPicked();
});
document.getElementById('replay')!.addEventListener('click', () => {
  // The opening sweep, from scratch: clear whatever is lit so it runs over the
  // whole Bible the way it does when the window first opens.
  light([]);
  picked = '';
  bookSel.value = '';
  refreshPicked();
  opening = { startedAt: performance.now() };
  dirty = true;
});
bookSel.addEventListener('change', () => {
  const span = bookSel.value ? bookSpan(bookSel.value) : null;
  light(span ? [span] : []);
  if (span && data) {
    const reach = countReach(data, span);
    picked = `<b>${bookSel.value}</b><br>${reach.out.toLocaleString()} out, ${reach.in.toLocaleString()} in`;
  } else {
    picked = '';
  }
  refreshPicked();
  dirty = true;
});

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

/**
 * The dials every wave shares, so the tap light and the opening sweep are tuned
 * by the same controls and read the same way.
 *
 * Each change replays its own wave, because a spread or a curve cannot be
 * judged from a still picture.
 */
function waveDials(spec: { spreadMs: number; fadeMs: number; orderCurve: Curve; jitter: number; flash: number; flicker: number; flickerHz: number }, replay: () => void) {
  slider('spread ms', () => spec.spreadMs, (v) => { spec.spreadMs = v; replay(); }, 0, 4000, 25);
  slider('fade ms', () => spec.fadeMs, (v) => { spec.fadeMs = v; replay(); }, 0, 1200, 10);
  choice(
    'order curve',
    CURVE_NAMES,
    () => (Array.isArray(spec.orderCurve) ? 'cubic' : spec.orderCurve),
    (v) => { spec.orderCurve = v; replay(); },
  );
  slider('jitter', () => spec.jitter, (v) => { spec.jitter = v; replay(); }, 0, 1, 0.01);
  slider('flash', () => spec.flash, (v) => { spec.flash = v; replay(); }, 0, 1, 0.01);
  slider('flicker', () => spec.flicker, (v) => { spec.flicker = v; replay(); }, 0, 1, 0.01);
  slider('flicker hz', () => spec.flickerHz, (v) => { spec.flickerHz = v; replay(); }, 1, 30, 1);
}

/** Run the tap light again over whatever is lit, so a dial can be judged. */
function replayTap() {
  if (lit) light(lit.spans);
  else replayOpen();
}

/** Run the opening sweep again. */
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
}

function choice<T extends string>(
  label: string,
  options: readonly T[],
  get: () => T,
  set: (v: T) => void,
) {
  const row = el('div', { className: 'row' }, drawer);
  el('label', { textContent: label }, row);
  const sel = el('select', {}, row);
  for (const o of options) el('option', { value: o, textContent: o }, sel);
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
  if (box) box.innerHTML = picked || '<span style="color:#6b6153">Tap an arc, a chapter or a book.</span>';
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
  choice<ArcSide>('arcs', ['top', 'bottom', 'split'], () => CONFIG.side, (v) => {
    CONFIG.side = v;
  });
  choice<ChapterWidth>('chapter width', ['verses', 'equal'], () => CONFIG.width, (v) => {
    CONFIG.width = v;
  });
  slider('axis at', () => CONFIG.axisAt, (v) => { CONFIG.axisAt = v; }, 0, 1, 0.01);
  slider('padding', () => CONFIG.padding, (v) => { CONFIG.padding = v; }, 0, 60, 1);
  // Room past the rule for the chapter bars and the sideways book names.
  slider('ruler room', () => CONFIG.axisDepth, (v) => { CONFIG.axisDepth = v; }, 0, 160, 2);

  heading('Height');
  slider('curve', () => CONFIG.heightCurve, (v) => { CONFIG.heightCurve = v; }, 0.1, 2, 0.01);
  slider('tallest', () => CONFIG.heightMax, (v) => { CONFIG.heightMax = v; }, 0.1, 1, 0.01);
  slider('shortest', () => CONFIG.heightMin, (v) => { CONFIG.heightMin = v; }, 0, 0.3, 0.005);

  heading('Crossfade');
  slider('spot', () => CONFIG.crossfadeAt, (v) => { CONFIG.crossfadeAt = v; }, 0, 1, 0.01);
  slider('width', () => CONFIG.crossfadeWidth, (v) => { CONFIG.crossfadeWidth = v; }, 0, 1, 0.01);

  heading('Votes');
  slider('curve', () => CONFIG.voteCurve, (v) => { CONFIG.voteCurve = v; }, 0.1, 2, 0.01);
  slider('thin', () => CONFIG.thicknessMin, (v) => { CONFIG.thicknessMin = v; }, 0.1, 3, 0.05);
  slider('thick', () => CONFIG.thicknessMax, (v) => { CONFIG.thicknessMax = v; }, 0.2, 8, 0.05);
  slider('faintest', () => CONFIG.alphaMin, (v) => { CONFIG.alphaMin = v; }, 0, 0.5, 0.005);
  slider('brightest', () => CONFIG.alphaMax, (v) => { CONFIG.alphaMax = v; }, 0.1, 1, 0.01);

  heading('How many');
  slider('vote floor', () => CONFIG.voteFloor, (v) => { CONFIG.voteFloor = v; }, 0, 200, 1);
  slider('max arcs', () => CONFIG.maxArcs, (v) => { CONFIG.maxArcs = v; }, 0, 344799, 1000);
  el('p', {
    className: 'note',
    textContent:
      'Max arcs 0 draws them all. Above 0 it keeps the most-voted. All 344,799 cost about 100ms a frame on a PC, so watch the readout: a cap near 20,000, or a vote floor near 25, lands around 20ms.',
  }, drawer);

  heading('Light');
  slider('dim floor', () => CONFIG.dimFloor, (v) => { CONFIG.dimFloor = v; }, 0, 0.5, 0.005);

  heading('Tap light', { label: 'Replay', onClick: replayTap });
  note(
    'Tap a chapter, pick a book, or turn on Select range and drag along the axis. ' +
      'The light travels out from where you tapped. A wave redraws every frame, so ' +
      'the readout shows its real cost: near 3ms at a 20,000 cap, near 40ms uncapped.',
  );
  choice<LightOrder>(
    'travels',
    Object.keys(LIGHT_ORDER_NAMES) as LightOrder[],
    () => LIGHTS.order,
    (v) => { LIGHTS.order = v; replayTap(); },
  );
  waveDials(LIGHTS.tap, replayTap);

  heading('Opening sweep', { label: 'Replay', onClick: replayOpen });
  note('Runs Genesis to Revelation when the picture first appears.');
  checks([['on when it opens', () => LIGHTS.openOnLoad, (v) => { LIGHTS.openOnLoad = v; }]]);
  slider('starts at', () => LIGHTS.open.floor, (v) => { LIGHTS.open.floor = v; replayOpen(); }, 0, 0.5, 0.005);
  waveDials(LIGHTS.open, replayOpen);

  heading('Motion');
  note(
    'The app follows the Motion setting: reduced keeps the fade but drops the travel, ' +
      'off puts the light straight on. The other three force a level so all of them can be checked here.',
  );
  choice('level', ['setting', 'full', 'reduced', 'off'] as const, () => motionMode, (v) => {
    motionMode = v;
  });

  heading('Look');
  choice('theme', ['reader', 'dark', 'light', 'sepia'] as const, () => themeName, (v) => {
    themeName = v;
    refreshPalette();
  });
  checks([['book names', () => showLabels, (v) => { showLabels = v; }]]);

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
    // The opening sweep, the first thing the picture does — the same light the
    // window will run when it opens in the app.
    if (LIGHTS.openOnLoad && motionNow() !== 'off') opening = { startedAt: performance.now() };
    requestAnimationFrame(frame);
    spin(2000);
  })
  .catch((error) => {
    status(`Couldn’t load the connections. ${error instanceof Error ? error.message : ''}`);
  });
