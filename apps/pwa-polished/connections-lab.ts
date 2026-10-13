/**
 * Connections lab v1.0 — tunes the look of the cross-reference arcs: all
 * 344,799 links over one line of the whole Bible.
 *
 * Runs the real code: lib/connections/data.ts for the pack, layout.ts for the
 * shapes and render.ts for the frame. Every slider writes straight into CONFIG,
 * so what is drawn here is what the app will draw. Copy values prints the block
 * ready to paste back into src/lib/connections/layout.ts.
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
import { CONFIG, type ArcSide, type ChapterWidth, type ConnectionsConfig, type Orientation } from './src/lib/connections/layout';
import { chapterAt, draw, pick, type DrawStats } from './src/lib/connections/render';
import { palette, type ConnectionsPalette } from './src/lib/connections/palette';
import { importPackFromBytes } from './src/adapters/pack-import';
import { PACK_BASE_URL } from './src/lib/packInstaller';

const SHIPPED: ConnectionsConfig = JSON.parse(JSON.stringify(CONFIG));
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

/** The lit spans, from a tapped book or chapter. Empty means everything is lit. */
let lit: Array<{ start: number; end: number }> = [];
/** What the last tap landed on, printed in the drawer. */
let picked: string = '';

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
      JSON.stringify({ config: CONFIG, prefs: { showLabels, themeName } }),
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
    if (typeof v?.prefs?.showLabels === 'boolean') showLabels = v.prefs.showLabels;
    if (typeof v?.prefs?.themeName === 'string') themeName = v.prefs.themeName;
  } catch {
    // Nothing saved, or storage blocked.
  }
}

function resetValues() {
  Object.assign(CONFIG, JSON.parse(JSON.stringify(SHIPPED)));
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

function render() {
  if (!data) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  lastStats = draw(ctx, data, CONFIG, { width: W, height: H }, {
    palette: colors,
    lit,
    labels: showLabels,
    view,
  });
}

let fpsFrames = 0;
let fpsT0 = performance.now();
let flashUntil = 0;

function frame() {
  const now = performance.now();

  if (dirty) {
    dirty = false;
    render();
  }

  fpsFrames++;
  if (now - fpsT0 >= 500) {
    if (now > flashUntil) {
      const fps = Math.round((fpsFrames * 1000) / (now - fpsT0));
      const s = lastStats;
      fpsEl.textContent = s
        ? `${fps} fps · ${s.ms.toFixed(1)} ms/draw\n${s.drawn.toLocaleString()} arcs · ${s.batches} batches${s.skipped ? ` · ${s.skipped.toLocaleString()} skipped` : ''}`
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
  view.x += dx / view.k;
  view.y += dy / view.k;
  dirty = true;
});

function endPointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) {
    dragging = false;
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
function tap(e: PointerEvent) {
  if (!data) return;
  const at = toCanvas(e);

  const hit = pick(data, CONFIG, { width: W, height: H }, at, 7 / view.k);
  if (hit !== null) {
    const from = refAt(data.from[hit]);
    const a = refAt(data.toStart[hit]);
    const b = refAt(data.toEnd[hit]);
    const target =
      a && b && data.toStart[hit] !== data.toEnd[hit]
        ? `${a.book} ${a.chapter}:${a.verse}–${b.chapter === a.chapter ? b.verse : `${b.chapter}:${b.verse}`}`
        : a
          ? `${a.book} ${a.chapter}:${a.verse}`
          : '?';
    picked = from
      ? `<b>${from.book} ${from.chapter}:${from.verse}</b> → <b>${target}</b><br>${data.votes[hit]} votes`
      : '';
    lit = [{ start: data.from[hit], end: data.from[hit] + 1 }];
    refreshPicked();
    dirty = true;
    return;
  }

  const chapter = chapterAt(data, CONFIG, { width: W, height: H }, at);
  if (chapter === null) return;
  const start = data.chapterStarts[chapter];
  const ref = refAt(start);
  const span = ref ? chapterSpan(ref.book, ref.chapter) : null;
  if (span && ref) {
    lit = [span];
    const reach = countReach(data, span);
    picked = `<b>${ref.book} ${ref.chapter}</b><br>${reach.out.toLocaleString()} out, ${reach.in.toLocaleString()} in`;
    refreshPicked();
    dirty = true;
  }
}

/** How many links leave a span, and how many arrive in it. */
function countReach(d: ConnectionsData, span: { start: number; end: number }) {
  let out = 0;
  let inward = 0;
  for (let i = 0; i < d.count; i++) {
    const f = d.from[i];
    if (f >= span.start && f < span.end) out++;
    if (d.toStart[i] >= span.start && d.toStart[i] < span.end) inward++;
  }
  return { out, in: inward };
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
  lit = [];
  picked = '';
  bookSel.value = '';
  refreshPicked();
  dirty = true;
});
bookSel.addEventListener('change', () => {
  const span = bookSel.value ? bookSpan(bookSel.value) : null;
  lit = span ? [span] : [];
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
  return `// src/lib/connections/layout.ts\nexport const CONFIG: ConnectionsConfig = ${fmt(CONFIG, '')};\n`;
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
    requestAnimationFrame(frame);
    spin(2000);
  })
  .catch((error) => {
    status(`Couldn’t load the connections. ${error instanceof Error ? error.message : ''}`);
  });
