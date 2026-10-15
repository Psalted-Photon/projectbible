/**
 * Connections chord lab v1.0 — tunes the chord ring and the reader strip
 * (roadmap Connections, Phase 8).
 *
 * Runs the real code: lib/connections/chord.ts counts, lays out and draws the
 * ring, and lib/connections/strip.ts finds a chapter's links and draws the
 * strip, so what is tuned here is what the Connections window's Chord tab and
 * the reader's chapter header will show. Copy values prints CHORD and STRIP,
 * ready to paste back into those files.
 *
 * Like the other labs, the pack comes from whatever this origin already
 * installed, or is downloaded and installed here; the values are kept in this
 * browser between visits, and Reset puts back what the app currently ships.
 */

import { chapterSpan, connectionsInstalled, loadConnections, type ConnectionsData } from './src/lib/connections/data';
import {
  CHORD,
  buildChordLayout,
  chordHit,
  chordScene,
  countChords,
  drawChord,
  partnersOf,
  type ChordConfig,
  type ChordCounts,
  type ChordDrawStats,
  type ChordLayout,
  type ChordPick,
  type ChordScene,
  type ChordView,
} from './src/lib/connections/chord';
import { STRIP, chapterReach, drawStrip, type ChapterReach, type StripConfig } from './src/lib/connections/strip';
import { canvasPalette, canvasGround, BOOK_COLORS, type CanvasGround, type ConnectionsPalette } from './src/lib/connections/palette';
import { motionLevel } from './src/lib/motion';
import { BIBLE_BOOKS } from './src/lib/bibleData';
import { mix } from './src/lib/themeColors';
import { importPackFromBytes } from './src/adapters/pack-import';
import { PACK_BASE_URL } from './src/lib/packInstaller';

const SHIPPED_CHORD: ChordConfig = JSON.parse(JSON.stringify(CHORD));
const SHIPPED_STRIP: StripConfig = JSON.parse(JSON.stringify(STRIP));
const STORE_KEY = 'connections-chord-lab-values';

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const drawer = document.getElementById('drawer') as HTMLElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const ctx = canvas.getContext('2d')!;

let data: ConnectionsData | null = null;
let W = 0;
let H = 0;
let DPR = 1;

// ── Ring state ──
let counts: ChordCounts | null = null;
let layout: ChordLayout | null = null;
let scene: ChordScene | null = null;
let view: ChordView = { x: 0, y: 0, k: 1 };
let pick: ChordPick = null;
let previous: ChordPick = null;
let pickedAt = 0;
let last: ChordDrawStats | null = null;
let ground: CanvasGround = canvasGround();
let ringColors: ConnectionsPalette = canvasPalette(ground);
/** What the ring needs redone: counting the links (and the layout after), or just the layout. */
let stale: 'count' | 'layout' | null = 'count';
let staleAt = 0;

// ── Strip state ──
let stripBook = 'Isaiah';
let stripChapter = 53;
let reach: ChapterReach | null = null;
let reachMs = 0;
let stripStale = true;
let stripTheme: 'dark' | 'light' | 'sepia' = 'dark';

let picked = '';
let dirty = true;

let motionMode: 'setting' | 'full' | 'reduced' | 'off' = 'setting';
function motionNow(): 'full' | 'reduced' | 'off' {
  return motionMode === 'setting' ? motionLevel() : motionMode;
}

// ── Saved values ─────────────────────────────────────────────────────────

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        chord: CHORD,
        strip: STRIP,
        prefs: { motionMode, ground, stripTheme, stripBook, stripChapter },
      }),
    );
  } catch {
    // Storage blocked: the lab still works, it just forgets on reload.
  }
}

/** Copy saved values over the shipped ones, but only keys that still exist with the same kind of value. */
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
    adopt(CHORD, v?.chord);
    adopt(STRIP, v?.strip);
    const p = v?.prefs ?? {};
    if (typeof p.motionMode === 'string') motionMode = p.motionMode;
    if (p.ground === 'black' || p.ground === 'cream') ground = p.ground;
    if (p.stripTheme === 'dark' || p.stripTheme === 'light' || p.stripTheme === 'sepia') stripTheme = p.stripTheme;
    if (typeof p.stripBook === 'string' && BIBLE_BOOKS.some((b) => b.name === p.stripBook)) stripBook = p.stripBook;
    if (typeof p.stripChapter === 'number') stripChapter = p.stripChapter;
  } catch {
    // Nothing saved, or storage blocked.
  }
}

function resetValues() {
  Object.assign(CHORD, JSON.parse(JSON.stringify(SHIPPED_CHORD)));
  Object.assign(STRIP, JSON.parse(JSON.stringify(SHIPPED_STRIP)));
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage blocked.
  }
  staleRing('count');
  stripStale = true;
  buildDrawer();
}

// ── Theme ────────────────────────────────────────────────────────────────

/** The reader's three themes, as the strip will see them: real colors, not the invert trick. */
const READER_THEMES: Record<'dark' | 'light' | 'sepia', { text: string; bg: string }> = {
  dark: { text: '#e0e0e0', bg: '#1a1a1a' },
  light: { text: '#1a1a1a', bg: '#fafafa' },
  sepia: { text: '#3b2f22', bg: '#f6f0e3' },
};

function stripPalette(): ConnectionsPalette {
  const { text, bg } = READER_THEMES[stripTheme];
  return { bg, text, muted: mix(text, bg, 0.45), rule: mix(text, bg, 0.7), pale: stripTheme !== 'dark' };
}

// ── The ring ─────────────────────────────────────────────────────────────

/** Mark the ring out of date. It is rebuilt shortly after the last change, not on every slider step. */
function staleRing(level: 'count' | 'layout') {
  if (stale !== 'count') stale = level;
  staleAt = performance.now();
  dirty = true;
}

function rebuildRing() {
  if (!data || !stale) return;
  if (stale === 'count' || !counts) counts = countChords(data, CHORD);
  layout = buildChordLayout(counts, CHORD);
  scene = chordScene(layout, CHORD, { width: W, height: H });
  stale = null;
  dirty = true;
  refreshStats();
}

// ── Canvas ───────────────────────────────────────────────────────────────

function measure() {
  DPR = window.devicePixelRatio || 1;
  W = stage.clientWidth;
  H = stage.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  if (layout) scene = chordScene(layout, CHORD, { width: W, height: H });
  dirty = true;
  stripStale = true;
}

let fading = false;

function render(now: number) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!scene || !counts) {
    ctx.fillStyle = ringColors.bg;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  last = drawChord(ctx, scene, CHORD, {
    palette: ringColors,
    view,
    pick,
    previous,
    pickedAt,
    now,
    motion: motionNow(),
    max: counts.max,
  });
  fading = last.fading;
}

function renderStrip() {
  const c = document.getElementById('strip') as HTMLCanvasElement | null;
  const box = document.getElementById('reader') as HTMLDivElement | null;
  if (!c || !box || !data) return;
  const colors = stripPalette();
  box.style.background = colors.bg;
  box.style.color = colors.text;
  const title = box.querySelector('h1') as HTMLElement;
  title.textContent = `${stripBook} ${stripChapter}`;

  const span = chapterSpan(stripBook, stripChapter);
  if (!span) return;
  const t0 = performance.now();
  reach = chapterReach(data, span, STRIP.voteFloor, STRIP.maxArcs);
  reachMs = performance.now() - t0;

  const width = c.clientWidth;
  const height = STRIP.height;
  c.width = Math.round(width * DPR);
  c.height = Math.round(height * DPR);
  c.style.height = `${height}px`;
  const g = c.getContext('2d')!;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, width, height);
  drawStrip(g, data, reach, STRIP, { width, height }, { palette: colors, background: false });
  stripStale = false;
}

let fpsFrames = 0;
let fpsT0 = performance.now();
let flashUntil = 0;

function frame() {
  const now = performance.now();

  if (stale && now - staleAt > 120) rebuildRing();

  if (dirty || fading) {
    dirty = false;
    render(now);
  }
  if (stripStale) renderStrip();

  fpsFrames++;
  if (now - fpsT0 >= 500) {
    if (now > flashUntil) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsT0));
      const ring =
        last && layout && counts
          ? `${fps} fps · ${last.ms.toFixed(1)} ms/draw · ${layout.ribbons.length.toLocaleString()} of ${layout.pairCount.toLocaleString()} pairs drawn`
          : `${fps} fps`;
      const strip = reach ? `\nstrip: ${reach.links.length} arcs · found in ${reachMs.toFixed(1)} ms` : '';
      fpsEl.textContent = ring + strip;
    }
    fpsFrames = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(frame);
}

// ── Gestures ─────────────────────────────────────────────────────────────

const WHEEL_STEP = 1.12 ** 2;
const K = [0.6, 12] as const;

let dragging = false;
let moved = false;
let lastX = 0;
let lastY = 0;
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: { dist: number; k: number } | null = null;

function onScreen(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Zoom to `k`, keeping what is under the point where it is. */
function zoomAt(sx: number, sy: number, k: number) {
  const next = clamp(k, K[0], K[1]);
  const cx = W / 2;
  const cy = H / 2;
  const u = (sx - cx - view.x) / view.k;
  const v = (sy - cy - view.y) / view.k;
  view = { x: sx - cx - u * next, y: sy - cy - v * next, k: next };
  dirty = true;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = true;
  moved = false;
  lastX = e.clientX;
  lastY = e.clientY;
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
  view = { ...view, x: view.x + dx, y: view.y + dy };
  dirty = true;
});

function endPointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) {
    dragging = false;
    if (!moved) tap(onScreen(e));
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

// ── Taps ─────────────────────────────────────────────────────────────────

function setPick(next: ChordPick) {
  previous = pick;
  pick = next;
  pickedAt = performance.now();
  clearBtn.hidden = !next;
  dirty = true;
}

function bookLabel(b: number): string {
  return `<b style="color:${BOOK_COLORS[b]}">${BIBLE_BOOKS[b].name}</b>`;
}

/**
 * A book keeps only its own ribbons and lists its busiest partners (tap it
 * again to let go). A ribbon keeps just itself; in the app it opens that pair
 * on the Detail tab.
 */
function tap(at: { x: number; y: number }) {
  if (!scene || !counts) return;
  const hit = chordHit(scene, CHORD, view, at);
  if (!hit) {
    if (pick) {
      setPick(null);
      picked = '';
      refreshPicked();
    }
    return;
  }
  if (hit.kind === 'book') {
    if (pick?.kind === 'book' && pick.book === hit.book) {
      setPick(null);
      picked = '';
    } else {
      setPick({ kind: 'book', book: hit.book });
      const total = counts.totals[hit.book];
      const partners = partnersOf(counts, hit.book, 6)
        .map((p) => `${bookLabel(p.book)} ${p.count.toLocaleString()}`)
        .join(' · ');
      picked = `${bookLabel(hit.book)} · ${total.toLocaleString()} links with other books<br>${partners}`;
    }
    refreshPicked();
    return;
  }
  setPick({ kind: 'pair', a: hit.a, b: hit.b });
  picked =
    `${bookLabel(hit.a)} ↔ ${bookLabel(hit.b)}<br>${hit.count.toLocaleString()} link${hit.count === 1 ? '' : 's'}` +
    `<br><span style="color:#6b6153">In the app this opens the pair on the Detail tab.</span>`;
  refreshPicked();
}

clearBtn.addEventListener('click', () => {
  setPick(null);
  picked = '';
  refreshPicked();
});
document.getElementById('whole')!.addEventListener('click', () => {
  view = { x: 0, y: 0, k: 1 };
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

function note(text: string) {
  el('p', { className: 'note', textContent: text }, drawer);
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
  hint?: string,
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
  if (hint) el('p', { className: 'hint', textContent: hint }, drawer);
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
  if (!box) return;
  const hint = 'Tap a book on the ring to keep only its ribbons. Tap a ribbon to pick out that pair. Tap empty space to show all.';
  box.innerHTML = picked || `<span style="color:#6b6153">${hint}</span>`;
}

function refreshStats() {
  const box = document.getElementById('ring-stats');
  if (box && counts && layout) {
    box.textContent =
      `${counts.links.toLocaleString()} links between two different books, ` +
      `${layout.pairCount.toLocaleString()} pairs, counted in ${counts.ms.toFixed(0)} ms.`;
  }
}

/** The mock reader at the top: a chapter title with the strip under it, and a chapter picker. */
function buildPreview() {
  const wrap = el('div', { className: 'preview' }, drawer);
  const reader = el('div', { className: 'reader', id: 'reader' }, wrap);
  el('h1', { textContent: `${stripBook} ${stripChapter}` }, reader);
  const c = el('canvas', { id: 'strip', title: 'In the app, tapping this opens the Arcs tab with the chapter lit' }, reader);
  c.addEventListener('click', () => flash(`In the app: opens the Arcs tab with ${stripBook} ${stripChapter} lit`));

  const row = el('div', { className: 'pick' }, wrap);
  const bookSel = el('select', { ariaLabel: 'Book' }, row);
  for (const b of BIBLE_BOOKS) el('option', { value: b.name, textContent: b.name }, bookSel);
  bookSel.value = stripBook;
  const chIn = el('input', { type: 'number', min: '1', ariaLabel: 'Chapter' }, row);
  const syncMax = () => {
    const info = BIBLE_BOOKS.find((b) => b.name === stripBook);
    chIn.max = String(info?.chapters ?? 1);
    if (stripChapter > (info?.chapters ?? 1)) stripChapter = info?.chapters ?? 1;
    chIn.value = String(stripChapter);
  };
  syncMax();
  bookSel.addEventListener('change', () => {
    stripBook = bookSel.value;
    stripChapter = 1;
    syncMax();
    stripStale = true;
    save();
  });
  chIn.addEventListener('change', () => {
    const n = Math.round(Number(chIn.value));
    if (Number.isFinite(n) && n >= 1) stripChapter = n;
    syncMax();
    stripStale = true;
    save();
  });
}

/** Ring dials that change what is counted. */
const recount = () => staleRing('count');
/** Ring dials that change where things sit. */
const relayout = () => staleRing('layout');
/** Strip dials: redraw it. */
const restrip = () => {
  stripStale = true;
};

function buildDrawer() {
  drawer.innerHTML = '';
  buildPreview();

  heading('Reader strip: shape');
  note('The strip goes under each chapter title in the reader. It shows the same links the Arcs tab lights for that chapter: the ones leaving it and the ones arriving.');
  slider('height', () => STRIP.height, (v) => { STRIP.height = v; restrip(); }, 20, 120, 1,
    'The whole strip, in pixels.');
  slider('side room', () => STRIP.sidePad, (v) => { STRIP.sidePad = v; restrip(); }, 0, 40, 1);
  slider('line', () => STRIP.lineWidth, (v) => { STRIP.lineWidth = v; restrip(); }, 1, 8, 0.5,
    'The book-colored line of the whole Bible.');
  choice('arcs go', ['above', 'split'] as const, () => STRIP.side, (v) => { STRIP.side = v; restrip(); },
    { above: 'all above the line', split: 'later above, earlier below' });
  choice('chapters', ['equal', 'verses'] as const, () => STRIP.width, (v) => { STRIP.width = v; restrip(); },
    { equal: 'all the same width', verses: 'by verse count' },
    'Same as the Arcs tab’s chapter width.');
  slider('tallest', () => STRIP.lift, (v) => { STRIP.lift = v; restrip(); }, 0.2, 1, 0.01,
    'The longest arc, as a share of the room it has.');
  slider('height curve', () => STRIP.heightCurve, (v) => { STRIP.heightCurve = v; restrip(); }, 0.2, 1.5, 0.01,
    '1 is straight: twice as far, twice as tall. Lower lifts the short arcs.');
  slider('shortest', () => STRIP.heightMin, (v) => { STRIP.heightMin = v; restrip(); }, 0, 20, 0.5,
    'In pixels, so a link to the next chapter still shows as a bump.');
  checks([
    ['mark this chapter', () => STRIP.marker, (v) => { STRIP.marker = v; restrip(); }],
    ['Gen / Rev at the ends', () => STRIP.ends, (v) => { STRIP.ends = v; restrip(); }],
  ]);

  heading('Reader strip: arcs');
  slider('thickness', () => STRIP.thickness, (v) => { STRIP.thickness = v; restrip(); }, 0.25, 3, 0.05);
  slider('opacity', () => STRIP.opacity, (v) => { STRIP.opacity = v; restrip(); }, 0.05, 1, 0.01,
    'The most-voted arc.');
  slider('faintest', () => STRIP.opacityFloor, (v) => { STRIP.opacityFloor = v; restrip(); }, 0, 1, 0.01,
    'The least-voted arc, as a share of the opacity.');
  slider('min votes', () => STRIP.voteFloor, (v) => { STRIP.voteFloor = v; restrip(); }, 0, 100, 1,
    'Leave off links fewer readers voted for.');
  slider('most arcs', () => STRIP.maxArcs, (v) => { STRIP.maxArcs = v; restrip(); }, 0, 1500, 10,
    'Keep only the best-voted this many. 0 keeps them all.');
  choice('color', ['both', 'far'] as const, () => STRIP.colorBy, (v) => { STRIP.colorBy = v; restrip(); },
    { both: 'this book to the other', far: 'the other book only' });
  choice('reader theme', ['dark', 'light', 'sepia'] as const, () => stripTheme, (v) => { stripTheme = v; restrip(); });

  heading('Chord ring: tapped');
  el('div', { className: 'picked', id: 'picked' }, drawer);
  refreshPicked();

  heading('Chord ring: books');
  slider('ring size', () => CHORD.ringSize, (v) => { CHORD.ringSize = v; relayout(); }, 0.4, 0.98, 0.01,
    'The ring’s radius, as a share of half the picture. Room outside it is for the names.');
  slider('band', () => CHORD.bandWidth, (v) => { CHORD.bandWidth = v; relayout(); }, 2, 30, 0.5,
    'The thickness of each book’s band, in pixels.');
  slider('book size', () => CHORD.bookSize, (v) => { CHORD.bookSize = v; relayout(); }, 0, 1, 0.05,
    '0 gives every book the same stretch. 1 sizes them strictly by link count.');
  slider('gap', () => CHORD.gap, (v) => { CHORD.gap = v; relayout(); }, 0, 0.006, 0.0001,
    'Between two books, as a share of the circle.');
  slider('group gap', () => CHORD.groupGap, (v) => { CHORD.groupGap = v; relayout(); }, 1, 12, 0.5,
    'Where one book category ends and the next begins, as a multiple of the gap.');
  slider('name size', () => CHORD.labelSize, (v) => { CHORD.labelSize = v; }, 7, 16, 0.5,
    'A name that would not fit beside its book is left off. Zoom in to see more.');
  choice('names', ['short', 'full'] as const, () => CHORD.labelNames, (v) => { CHORD.labelNames = v; },
    { short: 'short (Gen, 1 Sam)', full: 'full' });

  heading('Chord ring: ribbons');
  slider('min votes', () => CHORD.voteFloor, (v) => { CHORD.voteFloor = v; recount(); }, 0, 100, 1,
    'Leave out links fewer readers voted for before counting.');
  slider('pairs shown', () => CHORD.pairs, (v) => { CHORD.pairs = v; relayout(); }, 0, 2145, 5,
    'Draw only the busiest this many pairs. 0 draws every pair that links (up to 2,145).');
  slider('opacity', () => CHORD.opacity, (v) => { CHORD.opacity = v; }, 0.05, 1, 0.01,
    'The busiest ribbon.');
  slider('faintest', () => CHORD.opacityFloor, (v) => { CHORD.opacityFloor = v; }, 0, 1, 0.01,
    'The quietest ribbon, as a share of the opacity.');
  slider('bend', () => CHORD.pinch, (v) => { CHORD.pinch = v; relayout(); }, 0, 0.9, 0.01,
    '0 pulls every ribbon through the middle. Higher keeps them nearer the rim.');
  slider('inset', () => CHORD.inset, (v) => { CHORD.inset = v; relayout(); }, 0, 12, 0.5,
    'Space between a book’s band and its ribbons.');
  el('p', { className: 'note', id: 'ring-stats' }, drawer);
  refreshStats();

  heading('Chord ring: picking', { label: 'Replay', onClick: () => { pickedAt = performance.now(); dirty = true; } });
  slider('dim to', () => CHORD.dimFloor, (v) => { CHORD.dimFloor = v; }, 0, 1, 0.01,
    'While a book or a ribbon is picked, how faint the rest go.');
  slider('fade', () => CHORD.fadeMs, (v) => { CHORD.fadeMs = v; }, 0, 1000, 10,
    'How long the rest take to dim, in milliseconds.');

  heading('Motion');
  note('The app follows the Motion setting. With motion reduced or off, the dimming is instant.');
  choice('level', ['setting', 'full', 'reduced', 'off'] as const, () => motionMode, (v) => { motionMode = v; },
    { setting: 'follow the app setting' });

  heading('Look');
  choice('ring ground', ['black', 'cream'] as const, () => ground, (v) => {
    ground = v;
    ringColors = canvasPalette(ground);
  }, undefined, 'The same background choice as the Arcs tab.');

  heading('Copy values', { label: 'Copy', onClick: copyValues });
  el('textarea', { id: 'readout', readOnly: true, value: readout() }, drawer);
  const reset = el('button', { textContent: 'Reset to what ships' }, drawer);
  reset.style.marginTop = '8px';
  reset.addEventListener('click', resetValues);

  stripStale = true;
}

// ── Copy values ──────────────────────────────────────────────────────────

function refreshReadout() {
  const ta = document.getElementById('readout') as HTMLTextAreaElement | null;
  if (ta) ta.value = readout();
}
drawer.addEventListener('input', refreshReadout);
drawer.addEventListener('change', refreshReadout);
drawer.addEventListener('pointerup', refreshReadout);

function fmtNum(v: number): string {
  return String(Math.round(v * 10000) / 10000);
}

function fmt(v: unknown, indent: string): string {
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'boolean') return String(v);
  if (v && typeof v === 'object') {
    const inner = indent + '  ';
    const lines = Object.entries(v).map(([k, x]) => `${inner}${k}: ${fmt(x, inner)},`);
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return String(v);
}

function readout(): string {
  return (
    `// src/lib/connections/chord.ts\nexport const CHORD: ChordConfig = ${fmt(CHORD, '')};\n` +
    `\n// src/lib/connections/strip.ts\nexport const STRIP: StripConfig = ${fmt(STRIP, '')};\n`
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
  flashUntil = performance.now() + 1600;
}

// ── The pack ─────────────────────────────────────────────────────────────

function status(msg: string) {
  drawer.innerHTML = `<p class="note">${msg}</p>`;
}

async function ensurePack(): Promise<void> {
  if (await connectionsInstalled()) return;
  status('Downloading the Connections pack (1.7 MB)…');
  const response = await fetch(`${PACK_BASE_URL}/connections.sqlite`);
  if (!response.ok) throw new Error(`The pack would not download (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  status('Installing the Connections pack…');
  await importPackFromBytes(bytes, 'connections.sqlite');
}

// ── Start ────────────────────────────────────────────────────────────────

load();
ringColors = canvasPalette(ground);
new ResizeObserver(() => measure()).observe(stage);
// The strip follows the drawer's width, which a turn of the phone changes.
new ResizeObserver(() => {
  stripStale = true;
}).observe(drawer);

ensurePack()
  .then(() => loadConnections())
  .then((loaded) => {
    data = loaded;
    measure();
    rebuildRing();
    buildDrawer();
    requestAnimationFrame(frame);
  })
  .catch((error) => {
    status(`Couldn’t load the connections. ${error instanceof Error ? error.message : ''}`);
  });
