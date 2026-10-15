/**
 * Connections grid lab v1.0 — tunes the book-by-book grid and the two-sided
 * detail view a grid cell opens into (roadmap Connections, Phase 6).
 *
 * Runs the real code: lib/connections/grid.ts builds and draws the grid and
 * lib/connections/detail.ts draws the detail, so what is tuned here is what the
 * app's Connections window will show when they become its tabs in Phase 7.
 * Copy values prints GRID and DETAIL, ready to paste back into those files.
 *
 * Like the arc lab, the pack comes from whatever this origin already installed,
 * or is downloaded and installed here; the values are kept in this browser
 * between visits, and Reset puts back what the app currently ships.
 */

import { connectionsInstalled, loadConnections, refAt, type ConnectionsData } from './src/lib/connections/data';
import {
  GRID,
  bandAt,
  buildGridLayout,
  cellAt,
  drawGrid,
  paintGrid,
  sortIntoCells,
  gridFrame,
  type GridConfig,
  type GridCells,
  type GridDrawStats,
  type GridLayout,
  type GridView,
} from './src/lib/connections/grid';
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
  type DetailStats,
  type DetailView,
  type PlacedHeading,
} from './src/lib/connections/detail';
import { palette, BOOK_COLORS, type ConnectionsPalette } from './src/lib/connections/palette';
import { motionLevel } from './src/lib/motion';
import { BIBLE_BOOKS } from './src/lib/bibleData';
import { mix } from './src/lib/themeColors';
import { importPackFromBytes } from './src/adapters/pack-import';
import { PACK_BASE_URL } from './src/lib/packInstaller';

const SHIPPED_GRID: GridConfig = JSON.parse(JSON.stringify(GRID));
const SHIPPED_DETAIL: DetailConfig = JSON.parse(JSON.stringify(DETAIL));
const STORE_KEY = 'connections-grid-lab-values';

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const drawer = document.getElementById('drawer') as HTMLElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const backBtn = document.getElementById('back') as HTMLButtonElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const rebuildBtn = document.getElementById('rebuild') as HTMLButtonElement;
const cellSel = document.getElementById('cell') as HTMLSelectElement;
const ctx = canvas.getContext('2d')!;

let data: ConnectionsData | null = null;
let W = 0;
let H = 0;
let DPR = 1;
let colors: ConnectionsPalette = palette();

let mode: 'grid' | 'detail' = 'grid';

// ── Grid state ──
let layout: GridLayout | null = null;
let cells: GridCells | null = null;
let image: HTMLCanvasElement | null = null;
let paintMs = 0;
let lastGrid: GridDrawStats | null = null;
let gridView: GridView = { x: 0, y: 0, k: 1 };
let pickedCell: { row: number; col: number } | null = null;
let focus: { axis: 'row' | 'col'; lane: number } | null = null;
/** What the grid needs redone: sorting the links into cells (and the painting after), or just the painting. */
let gridStale: 'count' | 'paint' | null = 'count';
let gridStaleAt = 0;

// ── Detail state ──
let model: DetailModel | null = null;
let detailView: DetailView = { y: 0, k: 1 };
let lit: DetailLit | null = null;
let pickedLine: number | null = null;
let lastDetail: DetailStats | null = null;
let placed: PlacedHeading[] = [];

let picked = '';
let dirty = true;

let motionMode: 'setting' | 'full' | 'reduced' | 'off' = 'setting';
function motionNow(): 'full' | 'reduced' | 'off' {
  return motionMode === 'setting' ? motionLevel() : motionMode;
}
let themeName: 'reader' | 'dark' | 'light' | 'sepia' = 'reader';

// ── Saved values ─────────────────────────────────────────────────────────

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ grid: GRID, detail: DETAIL, prefs: { themeName, motionMode } }),
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
    adopt(GRID, v?.grid);
    adopt(DETAIL, v?.detail);
    if (typeof v?.prefs?.themeName === 'string') themeName = v.prefs.themeName;
    if (typeof v?.prefs?.motionMode === 'string') motionMode = v.prefs.motionMode;
  } catch {
    // Nothing saved, or storage blocked.
  }
}

function resetValues() {
  Object.assign(GRID, JSON.parse(JSON.stringify(SHIPPED_GRID)));
  Object.assign(DETAIL, JSON.parse(JSON.stringify(SHIPPED_DETAIL)));
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Storage blocked.
  }
  staleGrid('count');
  rebuildDetail();
  buildDrawer();
}

// ── Theme ────────────────────────────────────────────────────────────────

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
  const { text, bg } = FIXED_THEMES[themeName];
  colors = { bg, text, muted: mix(text, bg, 0.45), rule: mix(text, bg, 0.7), pale: themeName !== 'dark' };
}

// ── Building the grid image ──────────────────────────────────────────────

/** Mark the grid image out of date. It is rebuilt shortly after the last change, not on every slider step. */
function staleGrid(level: 'count' | 'paint') {
  if (gridStale !== 'count') gridStale = level;
  gridStaleAt = performance.now();
  dirty = true;
}

function rebuildGrid() {
  if (!data || !gridStale) return;
  if (gridStale === 'count' || !layout || !cells) {
    layout = buildGridLayout(data, GRID);
    cells = sortIntoCells(data, GRID, layout);
    // A different layout means different lanes; the old pick may point anywhere.
    pickedCell = null;
    focus = null;
  }
  const painted = paintGrid(data, cells, layout, GRID, DETAIL, colors);
  image = painted.image;
  paintMs = painted.ms;
  gridStale = null;
  dirty = true;
  refreshStats();
  buildPairPicker();
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

let animating = false;

function render(now: number) {
  if (!data) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const viewport = { width: W, height: H };

  if (mode === 'grid') {
    animating = false;
    if (!image || !layout || !cells) {
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    lastGrid = drawGrid(ctx, { data, cells, layout, image }, GRID, DETAIL, viewport, {
      palette: colors,
      view: gridView,
      picked: pickedCell,
      focus,
      dimTo: 0.25,
    });
    return;
  }

  if (!model) return;
  lastDetail = drawDetail(ctx, data, model, DETAIL, viewport, {
    palette: colors,
    view: detailView,
    lit,
    now,
    motion: motionNow(),
    picked: pickedLine,
  });
  placed = lastDetail.placed;
  animating = lastDetail.flying;
}

let fpsFrames = 0;
let fpsT0 = performance.now();
let flashUntil = 0;

function frame() {
  const now = performance.now();

  // Rebuild the grid once the dials have been still for a moment.
  if (gridStale && now - gridStaleAt > 140) rebuildGrid();

  if (dirty || animating) {
    dirty = false;
    render(now);
  }

  fpsFrames++;
  if (now - fpsT0 >= 500) {
    if (now > flashUntil) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsT0));
      fpsEl.style.whiteSpace = 'pre';
      if (mode === 'grid' && cells && image) {
        const g = lastGrid;
        const how = g?.live
          ? `drawn live · ${g.lines.toLocaleString()} lines · ${g.ms.toFixed(1)} ms/draw`
          : `from the image${g && g.lines ? ` (${g.lines.toLocaleString()} lines on screen, too many to draw live)` : ''}`;
        fpsEl.textContent =
          `${fps} fps · ${how}\n` +
          `image ${image.width}px built in ${(cells.ms + paintMs).toFixed(0)} ms · ${cells.passed.toLocaleString()} links`;
      } else if (mode === 'detail' && lastDetail && model) {
        const air = lastDetail.flying ? ' · flying' : '';
        fpsEl.textContent =
          `${fps} fps · ${lastDetail.ms.toFixed(1)} ms/draw${air}\n` +
          `${model.links.length.toLocaleString()} links · ${lastDetail.drawn.toLocaleString()} drawn` +
          (lit ? ` · ${lastDetail.lit.toLocaleString()} lit` : '');
      } else {
        fpsEl.textContent = `${fps} fps`;
      }
    }
    fpsFrames = 0;
    fpsT0 = now;
  }
  requestAnimationFrame(frame);
}

// ── Gestures ─────────────────────────────────────────────────────────────

const WHEEL_STEP = 1.12 ** 2;
const GRID_K = [0.5, 40] as const;
const DETAIL_K = [1, 80] as const;

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
  if (mode === 'grid') {
    const frame = gridFrame({ width: W, height: H }, GRID);
    const next = clamp(k, GRID_K[0], GRID_K[1]);
    const u = (sx - frame.left - gridView.x) / gridView.k;
    const v = (sy - frame.top - gridView.y) / gridView.k;
    gridView = { x: sx - frame.left - u * next, y: sy - frame.top - v * next, k: next };
  } else {
    // The detail zooms up and down only: the two axes stay where they are.
    const next = clamp(k, DETAIL_K[0], DETAIL_K[1]);
    const f = (sy - DETAIL.padTop - detailView.y) / detailView.k;
    detailView = { y: sy - DETAIL.padTop - f * next, k: next };
  }
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
    pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: mode === 'grid' ? gridView.k : detailView.k };
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
  if (mode === 'grid') {
    gridView = { ...gridView, x: gridView.x + dx, y: gridView.y + dy };
  } else {
    detailView = { ...detailView, y: detailView.y + dy };
  }
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
    const k = mode === 'grid' ? gridView.k : detailView.k;
    zoomAt(at.x, at.y, k * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP));
  },
  { passive: false },
);

// ── Taps ─────────────────────────────────────────────────────────────────

function tap(at: { x: number; y: number }) {
  if (!data) return;
  if (mode === 'grid') tapGrid(at);
  else tapDetail(at);
}

/**
 * On the grid: a name in the top or left band keeps its column or row bright
 * and dims the rest (tap it again to let go); a cell opens the detail.
 */
function tapGrid(at: { x: number; y: number }) {
  if (!layout || !cells) return;
  const frame = gridFrame({ width: W, height: H }, GRID);
  const band = bandAt(layout, frame, gridView, at);
  if (band) {
    const same = focus && focus.axis === band.axis && focus.lane === band.lane;
    focus = same ? null : band;
    const lane = layout.lanes[band.lane];
    picked = same ? '' : `<b style="color:${lane.color}">${lane.name}</b> ${band.axis === 'row' ? 'as the source (its row)' : 'as the target (its column)'}`;
    refreshPicked();
    dirty = true;
    return;
  }
  const cell = cellAt(layout, frame, gridView, at);
  if (!cell) return;
  pickedCell = cell;
  void openDetail(cell.row, cell.col);
}

/** Open the two-sided view for a pair of lanes. */
async function openDetail(row: number, col: number) {
  if (!data || !layout || !cells) return;
  const L = layout.lanes.length;
  const a = layout.lanes[row];
  const b = layout.lanes[col];
  const n = cells.counts[row * L + col];
  picked =
    `<b style="color:${a.color}">${a.name}</b> → <b style="color:${b.color}">${b.name}</b><br>` +
    `${n.toLocaleString()} link${n === 1 ? '' : 's'}`;
  refreshPicked();

  const [headA, headB] = await Promise.all([
    a.kind === 'book' ? bookHeadings(data, a.name) : Promise.resolve([]),
    b.kind === 'book' ? (a === b ? null : bookHeadings(data, b.name)) : Promise.resolve([]),
  ]);
  const left = detailAxis(data, a, headA);
  const right = detailAxis(data, b, headB ?? headA);
  model = buildDetail(data, left, right, DETAIL);
  detailView = { y: 0, k: 1 };
  lit = null;
  pickedLine = null;
  setMode('detail');
}

/** Rebuild the open detail after a dial that changes which links it holds. */
function rebuildDetail() {
  if (!data || !model) return;
  model = buildDetail(data, model.left, model.right, DETAIL);
  pickedLine = null;
  dirty = true;
}

function tapDetail(at: { x: number; y: number }) {
  if (!data || !model) return;
  const hit = detailHit(data, model, DETAIL, { width: W, height: H }, detailView, placed, lit, at);
  if (!hit) return;

  if (hit.kind === 'title') {
    // A title lights its whole side.
    const axis = hit.side === 'left' ? model.left : model.right;
    lightSpan(hit.side, { start: axis.start, end: axis.end }, axis.name);
    return;
  }
  if (hit.kind === 'mark') {
    const axis = hit.side === 'left' ? model.left : model.right;
    const label = axis.marks.length && !Number.isNaN(Number(hit.label)) ? `${axis.name} ${hit.label}` : hit.label;
    lightSpan(hit.side, hit.span, label);
    return;
  }
  if (hit.kind === 'heading') {
    const axis = hit.side === 'left' ? model.left : model.right;
    lightSpan(
      hit.side,
      hit.span,
      `${hit.heading.text}<br><span style="color:#8a7d66">${axis.name} ${hit.heading.chapter}:${hit.heading.verse}</span>`,
    );
    return;
  }
  showLine(hit.link);
}

/** Light a passage on one side and fly its lines across. */
function lightSpan(side: 'left' | 'right', span: { start: number; end: number }, label: string) {
  if (!data || !model) return;
  lit = { side, span, startedAt: performance.now() };
  pickedLine = null;
  let n = 0;
  for (const i of model.links) {
    if (side === 'left' ? data.from[i] >= span.start && data.from[i] < span.end : data.toStart[i] < span.end && data.toEnd[i] >= span.start) n++;
  }
  const axis = side === 'left' ? model.left : model.right;
  picked = `<b style="color:${axis.color}">${label}</b><br>${n.toLocaleString()} line${n === 1 ? '' : 's'} ${side === 'left' ? 'leave' : 'arrive'}`;
  refreshPicked();
  dirty = true;
}

/** A tapped line, as both of its verses. */
function showLine(i: number) {
  if (!data) return;
  pickedLine = i;
  const fromRef = refAt(data.from[i]);
  const a = refAt(data.toStart[i]);
  const b = refAt(data.toEnd[i]);
  const ranged = a && b && data.toStart[i] !== data.toEnd[i];
  const target = ranged
    ? `${a!.book} ${a!.chapter}:${a!.verse}–${b!.chapter === a!.chapter ? b!.verse : `${b!.chapter}:${b!.verse}`}`
    : a
      ? `${a.book} ${a.chapter}:${a.verse}`
      : '?';
  picked = fromRef
    ? refRow(fromRef.book, `${fromRef.book} ${fromRef.chapter}:${fromRef.verse}`) +
      refRow(a?.book ?? fromRef.book, target) +
      `<div class="votes">${data.votes[i].toLocaleString()} votes</div>`
    : '';
  refreshPicked();
  dirty = true;
}

function refRow(book: string, label: string): string {
  const color = BOOK_COLORS[BIBLE_BOOKS.findIndex((b) => b.name === book)] ?? '#8a8f98';
  return (
    `<div class="refrow" style="border-left-color:${color}">` +
    `<span class="refname" style="color:${color}">${label}</span>` +
    `</div>`
  );
}

function setMode(next: 'grid' | 'detail') {
  mode = next;
  backBtn.hidden = next !== 'detail';
  clearBtn.hidden = next !== 'detail';
  rebuildBtn.hidden = next !== 'grid';
  if (next === 'grid') {
    lit = null;
    pickedLine = null;
  }
  dirty = true;
}

backBtn.addEventListener('click', () => {
  setMode('grid');
  if (layout && pickedCell) {
    const a = layout.lanes[pickedCell.row];
    const b = layout.lanes[pickedCell.col];
    picked = `<b style="color:${a.color}">${a.name}</b> → <b style="color:${b.color}">${b.name}</b>`;
    refreshPicked();
  }
});
clearBtn.addEventListener('click', () => {
  lit = null;
  pickedLine = null;
  picked = '';
  refreshPicked();
  dirty = true;
});
rebuildBtn.addEventListener('click', () => staleGrid('count'));
document.getElementById('whole')!.addEventListener('click', () => {
  if (mode === 'grid') gridView = { x: 0, y: 0, k: 1 };
  else detailView = { y: 0, k: 1 };
  dirty = true;
});

/**
 * The pair picker: one list of every book, read as "from" then "to" by picking
 * twice. Simpler on a phone than 66 × 66 options, and a cell can always be
 * tapped instead.
 */
let pickFrom: number | null = null;
function buildPairPicker() {
  cellSel.innerHTML = '';
  if (!layout) return;
  const prompt = pickFrom === null ? 'Open: pick the source…' : `${layout.lanes[pickFrom].name} → pick the target…`;
  const first = document.createElement('option');
  first.value = '';
  first.textContent = prompt;
  cellSel.appendChild(first);
  layout.lanes.forEach((lane, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = lane.kind === 'group' ? `${lane.name} (group)` : lane.name;
    cellSel.appendChild(o);
  });
  cellSel.value = '';
}
cellSel.addEventListener('change', () => {
  const v = cellSel.value;
  if (v === '') return;
  const lane = Number(v);
  if (pickFrom === null) {
    pickFrom = lane;
    buildPairPicker();
    return;
  }
  const from = pickFrom;
  pickFrom = null;
  buildPairPicker();
  pickedCell = { row: from, col: lane };
  void openDetail(from, lane);
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
  const hint =
    mode === 'grid'
      ? 'Tap a cell to open it. Tap a name along the top or left to pick out its column or row.'
      : 'Tap a chapter, a heading or a book name to light its lines. Tap a line to see its two verses.';
  box.innerHTML = picked || `<span style="color:#6b6153">${hint}</span>`;
}

function refreshStats() {
  const box = document.getElementById('grid-stats');
  if (box && cells && image) {
    box.textContent = `${cells.passed.toLocaleString()} links in the image, ${image.width} × ${image.height} pixels.`;
  }
}

/** Grid dials that change where things are or what is counted. */
const recount = () => staleGrid('count');
/** Dials that only change how the grid's lines are painted. */
const repaint = () => staleGrid('paint');

function buildDrawer() {
  drawer.innerHTML = '';

  heading('Tapped');
  el('div', { className: 'picked', id: 'picked' }, drawer);
  refreshPicked();

  heading('Lines: grid and detail');
  note('A grid cell is its detail view in miniature: the source book’s axis down its left edge, the target’s down its right, one line per link. These set how a line looks in both.');
  slider('curve', () => DETAIL.curve, (v) => { DETAIL.curve = v; repaint(); }, 0, 1, 0.01,
    '0 is straight. 1 leaves each verse level and lands level, like a ribbon.');
  choice('color', ['books', 'rainbow', 'ink'] as const, () => DETAIL.colorBy, (v) => { DETAIL.colorBy = v; repaint(); },
    { books: 'the two books', rainbow: 'by place in the source', ink: 'one ink' },
    '“By place in the source” runs a rainbow down the left book, so a line can be followed across.');
  checks([['crossed, like the arcs', () => DETAIL.crossed, (v) => { DETAIL.crossed = v; repaint(); }]]);
  slider('swap point', () => DETAIL.crossfadeAt, (v) => { DETAIL.crossfadeAt = v; repaint(); }, 0, 1, 0.01,
    'With the two books’ colors: where along the line the color changes over. Crossed, a line leaves wearing the other book’s color.');
  slider('blend length', () => DETAIL.crossfadeWidth, (v) => { DETAIL.crossfadeWidth = v; repaint(); }, 0, 1, 0.01);
  choice('axis length', ['fill', 'true'] as const, () => DETAIL.scale, (v) => { DETAIL.scale = v; repaint(); },
    { fill: 'both full height', true: 'to scale' },
    'To scale keeps a short book short beside a long one. Full height stretches both.');

  heading('Grid: layout');
  note('Rows are where a link starts, columns are where it lands.');
  slider('book size', () => GRID.bookSize, (v) => { GRID.bookSize = v; recount(); }, 0, 1, 0.05,
    '0 gives every book the same row and column. 1 sizes them by verse count, so Psalms is 100 times Obadiah. Between bends toward it.');
  choice('groups', ['start', 'each', 'off'] as const, () => GRID.groups, (v) => { GRID.groups = v; recount(); },
    { start: 'together, first', each: 'before each group', off: 'none' },
    'The seven group rows and columns: Law, History, Wisdom/Poetry, Prophets, Gospels (with Acts), Pauline Epistles, General Epistles (with Revelation). Each one is all its books on one axis.');
  slider('group size', () => GRID.groupSize, (v) => { GRID.groupSize = v; recount(); }, 0.5, 8, 0.1,
    'A group row, as a multiple of an average book row.');
  slider('gap', () => GRID.gap, (v) => { GRID.gap = v; recount(); }, 0, 0.6, 0.01,
    'The gap between two books, as a share of an average book row.');
  slider('group gap', () => GRID.groupGap, (v) => { GRID.groupGap = v; recount(); }, 0, 2, 0.05,
    'The wider gap where one group of books ends and the next begins.');

  heading('Grid: lines');
  slider('min votes', () => GRID.voteFloor, (v) => { GRID.voteFloor = v; recount(); }, 0, 100, 1,
    'Hide links fewer readers voted for. 0 keeps every one, which is a lot of lines.');
  slider('line width', () => GRID.lineWidth, (v) => { GRID.lineWidth = v; repaint(); }, 0.1, 3, 0.05,
    'In image pixels, and in screen pixels once zoomed in and drawn live.');
  slider('opacity', () => GRID.opacity, (v) => { GRID.opacity = v; repaint(); }, 0.01, 1, 0.01,
    'How solid one line is. Where many cross they add up, so a bright band means many links.');
  slider('diagonal', () => GRID.diagonal, (v) => { GRID.diagonal = v; repaint(); }, 0, 2, 0.01,
    'Lines where a book links to itself, compared to the rest. Those cells are the busiest by far and can drown everything else.');
  slider('axis inset', () => GRID.inset, (v) => { GRID.inset = v; repaint(); }, 0, 0.3, 0.01,
    'How far each cell’s two axes stand in from its edges.');
  slider('axes', () => GRID.axisAlpha, (v) => { GRID.axisAlpha = v; repaint(); }, 0, 1, 0.01,
    'How strongly the two axes in each cell are drawn. 0 leaves them out.');
  slider('cell tint', () => GRID.cellTint, (v) => { GRID.cellTint = v; repaint(); }, 0, 0.4, 0.01,
    'A faint wash of each cell in its column’s color, so empty cells still show.');

  heading('Grid: image and zoom');
  choice('image size', ['2048', '3072', '4096', '6144'] as const, () => String(GRID.imageSize) as '3072', (v) => {
    GRID.imageSize = Number(v);
    repaint();
  }, undefined, 'The picture the grid is drawn into once. Bigger is sharper before the live drawing takes over, but slower to build and heavier on memory.');
  checks([['draw sharp when zoomed in', () => GRID.sharpZoom, (v) => { GRID.sharpZoom = v; }]]);
  slider('live limit', () => GRID.liveLimit, (v) => { GRID.liveLimit = v; }, 5000, 300000, 5000,
    'Zoomed past the image, the cells on screen are drawn fresh so lines stay sharp, but only with no more than this many lines on screen. Lower it if zooming stutters.');
  slider('name size', () => GRID.labelSize, (v) => { GRID.labelSize = v; }, 8, 16, 0.5,
    'Book names along the top and left. They stay pinned to the edges as you pan.');
  el('p', { className: 'note', id: 'grid-stats' }, drawer);
  refreshStats();

  heading('Detail: layout');
  note('Tap a grid cell to open it: the source book on the left, the target on the right.');
  slider('side room', () => DETAIL.sideRoom, (v) => { DETAIL.sideRoom = v; }, 0.05, 0.45, 0.01,
    'Room outside each axis for its numbers and headings, as a share of the width.');
  slider('min votes', () => DETAIL.voteFloor, (v) => { DETAIL.voteFloor = v; rebuildDetail(); }, 0, 100, 1,
    'Hide links fewer readers voted for.');
  slider('thickness', () => DETAIL.thickness, (v) => { DETAIL.thickness = v; }, 0.1, 4, 0.05);
  slider('opacity', () => DETAIL.opacity, (v) => { DETAIL.opacity = v; }, 0.02, 1, 0.01,
    'How solid each line is. Where many cross they add up.');
  slider('dim floor', () => DETAIL.dimFloor, (v) => { DETAIL.dimFloor = v; }, 0, 1, 0.01,
    'While something is lit, how faint the rest goes, as a share of the opacity. 0 hides them.');

  heading('Detail: axes');
  slider('axis width', () => DETAIL.axisWidth, (v) => { DETAIL.axisWidth = v; }, 0.5, 6, 0.1);
  slider('tick length', () => DETAIL.tickLength, (v) => { DETAIL.tickLength = v; }, 0, 16, 0.5);
  slider('number size', () => DETAIL.numberSize, (v) => { DETAIL.numberSize = v; }, 7, 16, 0.5,
    'Chapter numbers. When they would crowd, every 2nd, 5th or 10th shows; zoom in for the rest.');
  slider('title size', () => DETAIL.titleSize, (v) => { DETAIL.titleSize = v; }, 10, 24, 0.5);
  slider('room above', () => DETAIL.padTop, (v) => { DETAIL.padTop = v; }, 20, 100, 1);
  slider('room below', () => DETAIL.padBottom, (v) => { DETAIL.padBottom = v; }, 0, 80, 1);

  heading('Detail: headings');
  note('Section headings from the headings pack, beside each axis. Where two would touch, the first keeps its place.');
  checks([
    ['show headings', () => DETAIL.headings, (v) => { DETAIL.headings = v; }],
    ['also the smaller ones', () => DETAIL.minorHeadings, (v) => { DETAIL.minorHeadings = v; }],
  ]);
  slider('heading size', () => DETAIL.headingSize, (v) => { DETAIL.headingSize = v; }, 7, 16, 0.5);

  heading('Detail: lighting', { label: 'Replay', onClick: replayLit });
  note('Tap a chapter, a heading or a book name. Its lines draw across from the side you tapped, rolling down the passage.');
  slider('flight time', () => DETAIL.flightMs, (v) => { DETAIL.flightMs = v; replayLit(); }, 100, 3000, 25,
    'How long one line takes to cross, in milliseconds.');
  slider('stagger', () => DETAIL.staggerMs, (v) => { DETAIL.staggerMs = v; replayLit(); }, 0, 4000, 25,
    'Spread the launches over this long, top of the passage first. 0 sends them all at once.');
  slider('dot size', () => DETAIL.dotSize, (v) => { DETAIL.dotSize = v; replayLit(); }, 0, 6, 0.1,
    'The dot at the head of each line in flight. 0 is no dot.');

  heading('Motion');
  note('The app follows the Motion setting. With motion reduced or off the lit lines are simply there.');
  choice('level', ['setting', 'full', 'reduced', 'off'] as const, () => motionMode, (v) => { motionMode = v; },
    { setting: 'follow the app setting' });

  heading('Look');
  choice('theme', ['reader', 'dark', 'light', 'sepia'] as const, () => themeName, (v) => {
    themeName = v;
    refreshPalette();
    repaint();
  }, { reader: 'the app’s theme' });

  heading('Copy values', { label: 'Copy', onClick: copyValues });
  el('textarea', { id: 'readout', readOnly: true, value: readout() }, drawer);
  const reset = el('button', { textContent: 'Reset to what ships' }, drawer);
  reset.style.marginTop = '8px';
  reset.addEventListener('click', resetValues);
}

function replayLit() {
  if (lit) lit = { ...lit, startedAt: performance.now() };
  dirty = true;
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
  return String(Math.round(v * 1000) / 1000);
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
    `// src/lib/connections/grid.ts\nexport const GRID: GridConfig = ${fmt(GRID, '')};\n` +
    `\n// src/lib/connections/detail.ts\nexport const DETAIL: DetailConfig = ${fmt(DETAIL, '')};\n`
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
refreshPalette();
new ResizeObserver(() => measure()).observe(stage);

ensurePack()
  .then(() => loadConnections())
  .then((loaded) => {
    data = loaded;
    measure();
    status('Building the grid…');
    // Let the status paint before the first build holds the thread.
    requestAnimationFrame(() =>
      setTimeout(() => {
        rebuildGrid();
        buildDrawer();
        setMode('grid');
        requestAnimationFrame(frame);
      }, 0),
    );
  })
  .catch((error) => {
    status(`Couldn’t load the connections. ${error instanceof Error ? error.message : ''}`);
  });
