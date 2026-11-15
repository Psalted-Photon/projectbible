/**
 * Book picture lab v1.1: one book per page, its whole text set inside a
 * symbol. Zoomed out you see the symbol, zoomed in you read the book.
 *
 * Runs the real code: lib/bookPicture/shapes.ts for the symbols and
 * layout.ts for setting the text, and the app's own verse cleanup
 * (cleanVersePreviewText) to strip notes from the NET in public/starter.sqlite.
 * Nothing in the app uses any of this yet; it is here to try the look.
 *
 * Two looks: "Shape only" sets the text inside the symbol and nowhere else.
 * "Whole page" sets it across the whole page, paints the symbol's part in the
 * book color and leaves the rest faint. "Both" puts them side by side.
 *
 * Size: normally every symbol fills the page and the letter size changes per
 * book. With "Size follows the book's length", the longest book fills the
 * page and every other book's symbol shrinks by area to match its text, so
 * the letters come out about the same size and the symbol shows how big the
 * book is.
 *
 * Drawing: a full-page picture is rendered once per change and stretched
 * while a pinch or scroll is moving; when it settles, just the words on
 * screen are drawn sharp at the real size. Text below about 2 device pixels
 * is drawn as small bars, which reads the same from that far and is much
 * faster than tens of thousands of unreadable letters.
 *
 * The settings are kept in this browser between visits (localStorage).
 */

import type { Database } from 'sql.js';
import {
  BIBLE_BOOKS,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  bookTitle,
  normalizeBookName,
  type BookInfo,
} from './src/lib/bibleData';
import { cleanVersePreviewText, extractHeading } from './src/lib/verseRendering';
import {
  SHAPES,
  GROUP_SYMBOLS,
  shapeById,
  fitShape,
  paintFitted,
  shrinkFit,
  type BookShape,
  type ShapeFit,
} from './src/lib/bookPicture/shapes';
import {
  buildMask,
  layoutBook,
  measureWords,
  type Layout,
  type Mask,
  type WordSet,
} from './src/lib/bookPicture/layout';

// ─── Settings ──────────────────────────────────────────────────────────────

type Look = 'shape' | 'page' | 'both';
type ThemeId = 'dark' | 'light' | 'black';

interface Values {
  book: string;
  symbol: string;
  /** 'book', 'cream' (chapter starts in the book color), or a category whose color to borrow. */
  color: string;
  look: Look;
  font: string;
  weight: number;
  lineSpacing: number;
  chapterMarks: boolean;
  faint: number;
  faintInColor: boolean;
  page: string;
  margin: number;
  thicken: number;
  minSpan: number;
  /** The longest book fills the page; the rest shrink so the letters match. */
  sizeByLength: boolean;
  theme: ThemeId;
}

const DEFAULTS: Values = {
  book: 'Mark',
  symbol: 'cross',
  color: 'book',
  look: 'shape',
  font: 'gentium',
  weight: 400,
  lineSpacing: 1.15,
  chapterMarks: true,
  faint: 0.18,
  faintInColor: false,
  page: 'portrait',
  margin: 6,
  thicken: 0,
  minSpan: 1.5,
  sizeByLength: true,
  theme: 'dark',
};

const STORE_KEY = 'book-picture-lab-values';

function loadValues(): Values {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Private window or blocked storage: start from the defaults.
  }
  return { ...DEFAULTS };
}

function saveValues(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(V));
  } catch {
    // Not kept between visits, which is fine.
  }
}

const V: Values = loadValues();

const FONTS: Record<string, { label: string; css: string }> = {
  gentium: { label: 'Gentium Plus', css: '"Gentium Plus", serif' },
  bitter: { label: 'Bitter', css: '"Bitter", serif' },
  cormorant: { label: 'Cormorant Garamond', css: '"CormorantGaramond", serif' },
  sans: { label: 'System sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

/** Page width is always 1000 units; the height sets the shape of the page. */
const PAGES: Record<string, { label: string; h: number }> = {
  portrait: { label: 'Portrait 3:4', h: 1333 },
  square: { label: 'Square', h: 1000 },
  tall: { label: 'Tall 9:16 (phone)', h: 1778 },
};
const PAGE_W = 1000;
/** Space between the two pages in the Both look, in page units. */
const PAGE_GAP = 60;
/** Mask pixels per page unit. */
const MASK_SCALE = 2;

const THEMES: Record<ThemeId, { label: string; bg: string; page: string; border: string; neutral: string; light: boolean }> = {
  dark: { label: 'Dark', bg: '#0a0908', page: '#15130f', border: '#2a2520', neutral: '#cdbfa8', light: false },
  light: { label: 'Light (cream page)', bg: '#d6d0c3', page: '#fffaed', border: '#c4bba8', neutral: '#3a3226', light: true },
  black: { label: 'Black', bg: '#000000', page: '#000000', border: '#1d1b18', neutral: '#bdb4a4', light: false },
};

// ─── Elements ──────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $<HTMLDivElement>('stage');
const canvas = $<HTMLCanvasElement>('page');
const ctx = canvas.getContext('2d')!;
const busy = $<HTMLDivElement>('busy');
const readout = $<HTMLDivElement>('readout');
const statsBox = $<HTMLDivElement>('stats');
const tappedBox = $<HTMLDivElement>('tapped');
const symbolNote = $<HTMLParagraphElement>('symbolNote');
const valuesBox = $<HTMLTextAreaElement>('values');

// ─── Book text ─────────────────────────────────────────────────────────────

interface BookText {
  words: string[];
  /** chapter * 1000 + verse, per word. */
  refs: Int32Array;
  /** 1 on the first word of each chapter. */
  chapterStart: Uint8Array;
}

let db: Database | null = null;
/** App book name → the name the starter pack stores it under. */
const packNames = new Map<string, string>();
const bookTexts = new Map<string, BookText>();

async function openStarter(): Promise<void> {
  const mod: any = await import('sql.js');
  const initSqlJs = mod.default || mod;
  const SQL = await initSqlJs({ locateFile: (file: string) => `/${file}` });
  const res = await fetch('/starter.sqlite');
  if (!res.ok) throw new Error(`starter.sqlite: HTTP ${res.status}`);
  db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
  const rows = db!.exec("SELECT DISTINCT book FROM verses WHERE translation_id = 'net'");
  for (const [name] of rows[0]?.values ?? []) {
    packNames.set(normalizeBookName(String(name)), String(name));
  }
}

function bookText(book: string): BookText {
  const cached = bookTexts.get(book);
  if (cached) return cached;
  const words: string[] = [];
  const refs: number[] = [];
  const starts: number[] = [];
  const rows = db!.exec(
    "SELECT chapter, verse, text FROM verses WHERE translation_id = 'net' AND book = ? ORDER BY chapter, verse",
    [packNames.get(book) ?? book],
  );
  let lastChapter = -1;
  for (const [ch, vs, text] of rows[0]?.values ?? []) {
    const chapter = Number(ch), verse = Number(vs);
    const clean = cleanVersePreviewText(extractHeading(String(text)).textWithoutHeading);
    if (!clean) continue;
    const ref = chapter * 1000 + verse;
    if (chapter !== lastChapter) {
      starts.push(words.length);
      lastChapter = chapter;
    }
    for (const word of clean.split(' ')) {
      if (!word) continue;
      words.push(word);
      refs.push(ref);
    }
  }
  const chapterStart = new Uint8Array(words.length);
  for (const i of starts) if (i < words.length) chapterStart[i] = 1;
  const out = { words, refs: Int32Array.from(refs), chapterStart };
  bookTexts.set(book, out);
  return out;
}

// ─── Building the picture ──────────────────────────────────────────────────

interface Built {
  text: BookText;
  set: WordSet;
  shape: BookShape;
  fit: ShapeFit;
  mask: Mask;
  pageH: number;
  /** Symbol width next to the longest book's (1 when it fills the page). */
  size: number;
  shapeLayout: Layout | null;
  pageLayout: Layout | null;
}

let built: Built | null = null;
let measureKey = '';
let measured: WordSet | null = null;
let maskKey = '';
let maskBuilt: { shape: BookShape; fit: ShapeFit; mask: Mask } | null = null;
const layoutCache = new Map<string, Layout>();

function bookInfo(book: string): BookInfo | undefined {
  return BIBLE_BOOKS.find((b) => b.name === book);
}

function bookColor(): string {
  const info = bookInfo(V.book);
  return info ? CATEGORY_COLORS[info.category] : '#8a8f98';
}

/** The app's cream; on the cream page it would vanish, so that page gets dark ink. */
const CREAM = '#fffaed';
const CREAM_ON_LIGHT = '#3a3226';

function textColor(): string {
  if (V.color === 'cream') return (THEMES[V.theme] ?? THEMES.dark).light ? CREAM_ON_LIGHT : CREAM;
  if (V.color !== 'book' && V.color in CATEGORY_COLORS) {
    return CATEGORY_COLORS[V.color as BookInfo['category']];
  }
  return bookColor();
}

/** Chapter-start words: the book color on cream text, otherwise a brighter text color. */
function markColor(color: string, light: boolean): string {
  if (V.color === 'cream') return bookColor();
  return mix(color, light ? '#000000' : '#ffffff', light ? 0.4 : 0.55);
}

function mix(hex: string, toward: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(toward.slice(1), 16);
  const ch = (s: number) => {
    const x = (a >> s) & 255, y = (b >> s) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

// ─── Size by length ────────────────────────────────────────────────────────

let longest: string | null = null;
let refKey = '';
let refTotal = 1;

/** The book with the most words in the NET (every book is read once to find it). */
function longestBook(): string {
  if (longest) return longest;
  let best = BIBLE_BOOKS[0].name, bestN = -1;
  for (const b of BIBLE_BOOKS) {
    const n = bookText(b.name).words.length;
    if (n > bestN) {
      bestN = n;
      best = b.name;
    }
  }
  return (longest = best);
}

/**
 * How wide this book's symbol is next to the longest book's, which fills the
 * page. Scaled by area (square root of the text's length), so the font size
 * that fills it comes out about the same in every book.
 */
function sizeFactor(set: WordSet, fontCss: string): number {
  const ref = longestBook();
  const key = `${V.font}|${V.weight}`;
  if (key !== refKey) {
    refTotal = ref === V.book ? set.total : measureWords(bookText(ref).words, fontCss, V.weight).total;
    refKey = key;
  }
  return Math.min(1, Math.sqrt(set.total / Math.max(1e-6, refTotal)));
}

let buildGen = 0;

async function rebuild(): Promise<void> {
  if (!db) return;
  const gen = ++buildGen;
  busy.textContent = 'Setting the text…';
  busy.hidden = false;
  const font = FONTS[V.font] ?? FONTS.gentium;
  const shape = shapeById(V.symbol);
  await Promise.all([
    document.fonts.load(`${V.weight} 16px ${font.css}`, 'The LORD'),
    shape.font ? document.fonts.load(shape.font, 'ΑΩ') : Promise.resolve([]),
  ]).catch(() => undefined);
  // Let the "Setting the text" note paint before the work starts.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  if (gen !== buildGen) return;

  const text = bookText(V.book);
  const mk = `${V.book}|${V.font}|${V.weight}`;
  if (mk !== measureKey || !measured) {
    measured = measureWords(text.words, font.css, V.weight);
    measureKey = mk;
    layoutCache.clear();
  }
  const pageH = (PAGES[V.page] ?? PAGES.portrait).h;
  const margin = (V.margin / 100) * PAGE_W;
  const size = V.sizeByLength ? sizeFactor(measured, font.css) : 1;
  const sk = `${V.symbol}|${V.page}|${V.margin}|${V.thicken}|${size}`;
  if (sk !== maskKey || !maskBuilt) {
    const fit = shrinkFit(fitShape(shape, V.thicken, PAGE_W, pageH, margin), size, PAGE_W, pageH);
    const mask = buildMask(PAGE_W, pageH, MASK_SCALE, (c) => paintFitted(c, shape, fit, V.thicken));
    maskBuilt = { shape, fit, mask };
    maskKey = sk;
    layoutCache.clear();
  }
  const layoutFor = (mode: 'shape' | 'page'): Layout => {
    const key = `${mk}|${sk}|${V.lineSpacing}|${V.minSpan}|${mode}`;
    let lay = layoutCache.get(key);
    if (!lay) {
      lay = layoutBook(measured!, {
        pageW: PAGE_W,
        pageH,
        margin,
        lineSpacing: V.lineSpacing,
        minSpan: V.minSpan,
        mode,
        mask: maskBuilt!.mask,
      });
      layoutCache.set(key, lay);
      // A slider drag makes a new layout at every step; keep only the latest few.
      while (layoutCache.size > 6) layoutCache.delete(layoutCache.keys().next().value!);
    }
    return lay;
  };
  const wantShape = V.look !== 'page';
  const wantPage = V.look !== 'shape';
  const prevWorld = built ? worldSize() : null;
  built = {
    text,
    set: measured,
    shape: maskBuilt.shape,
    fit: maskBuilt.fit,
    mask: maskBuilt.mask,
    pageH,
    size,
    shapeLayout: wantShape ? layoutFor('shape') : null,
    pageLayout: wantPage ? layoutFor('page') : null,
  };
  busy.hidden = true;
  const world = worldSize();
  // A new page shape or a change between one and two pages starts at the whole view.
  if (!prevWorld || prevWorld.w !== world.w || prevWorld.h !== world.h || !viewSet) fitView();
  clampView();
  renderBase();
  renderCrisp();
  showStats();
}

// ─── Scene ─────────────────────────────────────────────────────────────────

interface PageDraw {
  layout: Layout;
  mode: 'shape' | 'page';
  /** Left edge of this page in world units. */
  ox: number;
}

function pages(): PageDraw[] {
  if (!built) return [];
  const out: PageDraw[] = [];
  let ox = 0;
  if (built.shapeLayout) {
    out.push({ layout: built.shapeLayout, mode: 'shape', ox });
    ox += PAGE_W + PAGE_GAP;
  }
  if (built.pageLayout) out.push({ layout: built.pageLayout, mode: 'page', ox });
  return out;
}

function worldSize(): { w: number; h: number } {
  const n = pages().length || 1;
  return { w: n * PAGE_W + (n - 1) * PAGE_GAP, h: built?.pageH ?? 1333 };
}

/** First line whose bottom is below y. */
function firstLineAt(lay: Layout, y: number): number {
  let lo = 0, hi = lay.lines;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lay.lineTop[mid] + lay.lineH < y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Paint {
  color: string;
  mark: string | null;
  alpha: number;
  only: Uint8Array | null;
}

/**
 * Draw a page's words onto `c`, whose pixels map to page units as
 * device = unit * K + (X, Y). Only words inside the visible box are drawn.
 */
function drawWords(
  c: CanvasRenderingContext2D,
  lay: Layout,
  K: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  p: Paint,
): void {
  if (!built) return;
  const words = built.set.words;
  const marks = built.text.chapterStart;
  const f = lay.f;
  const fpx = f * K;
  const vx0 = -X / K - f, vx1 = (W - X) / K + f;
  const vy0 = -Y / K, vy1 = (H - Y) / K;
  const l0 = firstLineAt(lay, vy0);
  let l1 = firstLineAt(lay, vy1 + lay.lineH);
  if (l1 > lay.lines - 1) l1 = lay.lines - 1;
  if (l0 > l1) return;
  const i0 = lay.lineFirst[l0], i1 = lay.lineFirst[l1 + 1];
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = p.color;
  const only = p.only;
  if (fpx < 2) {
    // Too small to read: bars the size of the letters' bodies.
    c.globalAlpha = p.alpha * 0.6;
    const bh = Math.max(0.5, 0.46 * fpx);
    for (let i = i0; i < i1; i++) {
      if (only && !only[i]) continue;
      const x = lay.x[i];
      if (x > vx1 || x + lay.w[i] < vx0) continue;
      const mark = p.mark && marks[i];
      if (mark) c.fillStyle = p.mark!;
      c.fillRect(X + x * K, Y + lay.y[i] * K - bh, lay.w[i] * K, bh);
      if (mark) c.fillStyle = p.color;
    }
    c.globalAlpha = 1;
    return;
  }
  const font = FONTS[V.font] ?? FONTS.gentium;
  c.font = `${V.weight} ${fpx}px ${font.css}`;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.globalAlpha = p.alpha;
  for (let i = i0; i < i1; i++) {
    if (only && !only[i]) continue;
    const x = lay.x[i];
    if (x > vx1 || x + lay.w[i] < vx0) continue;
    const mark = p.mark && marks[i];
    if (mark) c.fillStyle = p.mark!;
    const dx = X + x * K, dy = Y + lay.y[i] * K;
    const sx = lay.sx[i];
    if (sx > 0.995 && sx < 1.005) {
      c.fillText(words[i], dx, dy);
    } else {
      c.setTransform(sx, 0, 0, 1, dx, dy);
      c.fillText(words[i], 0, 0);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (mark) c.fillStyle = p.color;
  }
  c.globalAlpha = 1;
}

/** One scratch layer per target, so the screen and the stretch picture don't keep resizing one. */
const scratches = new Map<string, HTMLCanvasElement>();

/**
 * Draw the whole scene onto `c` (W × H device px). World units map to device
 * px as device = (world * k + t) * ratio.
 */
function renderScene(
  c: CanvasRenderingContext2D,
  W: number,
  H: number,
  k: number,
  tx: number,
  ty: number,
  ratio: number,
  slot: 'screen' | 'base',
): void {
  const theme = THEMES[V.theme] ?? THEMES.dark;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = theme.bg;
  c.fillRect(0, 0, W, H);
  if (!built) return;
  const color = textColor();
  const mark = V.chapterMarks ? markColor(color, theme.light) : null;
  const K = k * ratio;
  for (const pg of pages()) {
    const X = (tx + pg.ox * k) * ratio, Y = ty * ratio;
    if (X > W || X + PAGE_W * K < 0 || Y > H || Y + built.pageH * K < 0) continue;
    c.fillStyle = theme.page;
    c.fillRect(X, Y, PAGE_W * K, built.pageH * K);
    c.strokeStyle = theme.border;
    c.lineWidth = Math.max(1, ratio);
    c.strokeRect(X, Y, PAGE_W * K, built.pageH * K);
    if (pg.mode === 'shape') {
      drawWords(c, pg.layout, K, X, Y, W, H, { color, mark, alpha: 1, only: null });
      continue;
    }
    // Whole page: everything faint, then the words touching the symbol again
    // in full color on a scratch layer, cut to the symbol's exact outline.
    const faintColor = V.faintInColor ? color : theme.neutral;
    drawWords(c, pg.layout, K, X, Y, W, H, { color: faintColor, mark: null, alpha: V.faint, only: null });
    let scratch = scratches.get(slot);
    if (!scratch) {
      scratch = document.createElement('canvas');
      scratches.set(slot, scratch);
    }
    if (scratch.width !== W || scratch.height !== H) {
      scratch.width = W;
      scratch.height = H;
    }
    const s = scratch.getContext('2d')!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, W, H);
    drawWords(s, pg.layout, K, X, Y, W, H, { color, mark, alpha: 1, only: pg.layout.inShape });
    s.globalCompositeOperation = 'destination-in';
    s.setTransform(K, 0, 0, K, X, Y);
    s.fillStyle = '#000';
    paintFitted(s, built.shape, built.fit, V.thicken);
    s.globalCompositeOperation = 'source-over';
    s.setTransform(1, 0, 0, 1, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(scratch, 0, 0);
  }
}

// ─── View ──────────────────────────────────────────────────────────────────

let dpr = 1;
let cssW = 1, cssH = 1;
/** World → CSS px: css = world * k + t. */
let k = 1, tx = 0, ty = 0;
let viewSet = false;

function fitK(): number {
  const { w, h } = worldSize();
  const pad = 16;
  return Math.max(1e-4, Math.min((cssW - pad * 2) / w, (cssH - pad * 2) / h));
}

function smallestF(): number {
  const fs = pages().map((p) => p.layout.f);
  return fs.length ? Math.min(...fs) : 1;
}

function kLimits(): [number, number] {
  const kf = fitK();
  return [kf * 0.5, Math.max(kf * 2, 56 / smallestF())];
}

function fitView(): void {
  const { w, h } = worldSize();
  k = fitK();
  tx = (cssW - w * k) / 2;
  ty = (cssH - h * k) / 2;
  viewSet = true;
}

/** Keep some of the pages on screen. */
function clampView(): void {
  const { w, h } = worldSize();
  const [kMin, kMax] = kLimits();
  k = Math.min(kMax, Math.max(kMin, k));
  const keep = 60;
  tx = Math.min(cssW - keep, Math.max(keep - w * k, tx));
  ty = Math.min(cssH - keep, Math.max(keep - h * k, ty));
}

function zoomAt(cx: number, cy: number, factor: number): void {
  const [kMin, kMax] = kLimits();
  const nk = Math.min(kMax, Math.max(kMin, k * factor));
  tx = cx - (cx - tx) * (nk / k);
  ty = cy - (cy - ty) * (nk / k);
  k = nk;
  clampView();
}

function resize(): void {
  const r = stage.getBoundingClientRect();
  const cx = (cssW / 2 - tx) / k, cy = (cssH / 2 - ty) / k;
  cssW = Math.max(1, r.width);
  cssH = Math.max(1, r.height);
  dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  if (!viewSet) fitView();
  else {
    // Keep the same point in the middle.
    tx = cssW / 2 - cx * k;
    ty = cssH / 2 - cy * k;
    clampView();
  }
  if (built) renderCrisp();
}

// ─── Rendering ─────────────────────────────────────────────────────────────

/**
 * The whole scene at one fixed scale, stretched while a gesture moves. It
 * depends only on the picture, not the view, and it is the slow part (every
 * word of the book), so a change only marks it stale; it is redrawn when
 * things go quiet, or at once if a gesture starts first.
 */
let base: HTMLCanvasElement | null = null;
let baseK = 1;
let baseStale = true;
let baseTimer = 0;

function renderBase(): void {
  baseStale = true;
  clearTimeout(baseTimer);
  baseTimer = window.setTimeout(ensureBase, 350);
}

function ensureBase(): void {
  clearTimeout(baseTimer);
  if (!built || !baseStale) return;
  baseStale = false;
  const { w, h } = worldSize();
  const maxSide = 4096, maxPx = 8e6;
  let kb = Math.min(maxSide / w, maxSide / h);
  if (w * h * kb * kb > maxPx) kb = Math.sqrt(maxPx / (w * h));
  base ??= document.createElement('canvas');
  base.width = Math.max(1, Math.round(w * kb));
  base.height = Math.max(1, Math.round(h * kb));
  baseK = kb;
  renderScene(base.getContext('2d')!, base.width, base.height, kb, 0, 0, 1, 'base');
}

function renderCrisp(): void {
  renderScene(ctx, canvas.width, canvas.height, k, tx, ty, dpr, 'screen');
  updateReadout();
}

function drawStretched(): void {
  ensureBase();
  const theme = THEMES[V.theme] ?? THEMES.dark;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (base) {
    const s = (k * dpr) / baseK;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, tx * dpr, ty * dpr, base.width * s, base.height * s);
  }
  updateReadout();
}

/** About how many words are on screen, to decide whether a sharp frame is cheap. */
function wordsOnScreen(): number {
  let total = 0;
  for (const pg of pages()) {
    const lay = pg.layout;
    const y0 = -ty / k, y1 = (cssH - ty) / k;
    const x0 = Math.max(0, -tx / k - pg.ox), x1 = Math.min(PAGE_W, (cssW - tx) / k - pg.ox);
    if (x1 <= x0) continue;
    const l0 = firstLineAt(lay, y0);
    const l1 = Math.min(lay.lines, firstLineAt(lay, y1 + lay.lineH));
    if (l1 <= l0) continue;
    total += (lay.lineFirst[l1] - lay.lineFirst[l0]) * ((x1 - x0) / PAGE_W) * (pg.mode === 'page' ? 2 : 1);
  }
  return total;
}

let raf = 0;
let settleTimer = 0;

function requestFrame(): void {
  if (!raf) {
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (wordsOnScreen() < 2500) renderCrisp();
      else drawStretched();
    });
  }
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => renderCrisp(), 160);
}

let anim = 0;

function animateTo(nk: number, ntx: number, nty: number): void {
  cancelAnimationFrame(anim);
  const k0 = k, tx0 = tx, ty0 = ty;
  const t0 = performance.now();
  const dur = 240;
  // Interpolate the zoom in log space so it feels even, and keep the
  // screen centre moving in a straight line.
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    k = k0 * Math.pow(nk / k0, e);
    const c0x = (cssW / 2 - tx0) / k0, c1x = (cssW / 2 - ntx) / nk;
    const c0y = (cssH / 2 - ty0) / k0, c1y = (cssH / 2 - nty) / nk;
    tx = cssW / 2 - (c0x + (c1x - c0x) * e) * k;
    ty = cssH / 2 - (c0y + (c1y - c0y) * e) * k;
    if (t < 1) {
      requestFrame();
      anim = requestAnimationFrame(step);
    } else {
      k = nk;
      tx = ntx;
      ty = nty;
      clampView();
      clearTimeout(settleTimer);
      renderCrisp();
    }
  };
  anim = requestAnimationFrame(step);
}

function animateZoomAt(cx: number, cy: number, factor: number): void {
  const [kMin, kMax] = kLimits();
  const nk = Math.min(kMax, Math.max(kMin, k * factor));
  animateTo(nk, cx - (cx - tx) * (nk / k), cy - (cy - ty) * (nk / k));
}

function updateReadout(): void {
  if (!built) {
    readout.textContent = '';
    return;
  }
  const f = pages()[0]?.layout.f ?? 1;
  readout.textContent = `zoom ${(k / fitK()).toFixed(1)}× · text ${(f * k).toFixed(1)} px`;
}

// ─── Gestures ──────────────────────────────────────────────────────────────

const pointers = new Map<number, { x: number; y: number }>();
let pinch: { d: number; mx: number; my: number; k: number; tx: number; ty: number } | null = null;
let press: { x: number; y: number; t: number; moved: boolean } | null = null;
let lastTap = { t: 0, x: 0, y: 0 };

function localPoint(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function startPinch(): void {
  const [a, b] = [...pointers.values()];
  pinch = {
    d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    mx: (a.x + b.x) / 2,
    my: (a.y + b.y) / 2,
    k,
    tx,
    ty,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  cancelAnimationFrame(anim);
  canvas.setPointerCapture(e.pointerId);
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) press = { x: p.x, y: p.y, t: performance.now(), moved: false };
  else {
    press = null;
    if (pointers.size === 2) startPinch();
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    if (press && Math.hypot(p.x - press.x, p.y - press.y) > 6) press.moved = true;
    if (press && !press.moved) return;
    tx += p.x - prev.x;
    ty += p.y - prev.y;
    clampView();
    requestFrame();
  } else if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const [kMin, kMax] = kLimits();
    const nk = Math.min(kMax, Math.max(kMin, pinch.k * (d / pinch.d)));
    // The world point that was under the starting midpoint stays under the fingers.
    const wx = (pinch.mx - pinch.tx) / pinch.k, wy = (pinch.my - pinch.ty) / pinch.k;
    k = nk;
    tx = mx - wx * nk;
    ty = my - wy * nk;
    clampView();
    requestFrame();
  }
});

function endPointer(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 1) {
    pinch = null;
    press = null;
  } else if (pointers.size === 0) {
    pinch = null;
    if (press && !press.moved && e.type === 'pointerup') {
      const p = localPoint(e);
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        animateZoomAt(p.x, p.y, 3);
        lastTap = { t: 0, x: 0, y: 0 };
      } else {
        lastTap = { t: now, x: p.x, y: p.y };
        showTapped(p.x, p.y);
      }
    }
    press = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const p = localPoint(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    requestFrame();
  },
  { passive: false },
);

$('fit').addEventListener('click', () => {
  const { w, h } = worldSize();
  const nk = fitK();
  animateTo(nk, (cssW - w * nk) / 2, (cssH - h * nk) / 2);
});
$('zoomIn').addEventListener('click', () => animateZoomAt(cssW / 2, cssH / 2, 2));
$('zoomOut').addEventListener('click', () => animateZoomAt(cssW / 2, cssH / 2, 0.5));
$('readSize').addEventListener('click', () => {
  const f = pages()[0]?.layout.f;
  if (!f) return;
  animateZoomAt(cssW / 2, cssH / 2, 16 / f / k);
});

// ─── Word under a tap ──────────────────────────────────────────────────────

function wordAt(cx: number, cy: number): number {
  if (!built) return -1;
  const wx = (cx - tx) / k, wy = (cy - ty) / k;
  for (const pg of pages()) {
    const px = wx - pg.ox;
    if (px < 0 || px > PAGE_W || wy < 0 || wy > built.pageH) continue;
    const lay = pg.layout;
    const li = firstLineAt(lay, wy);
    if (li >= lay.lines || lay.lineTop[li] > wy) return -1;
    let best = -1, bestD = lay.f * 1.5;
    for (let i = lay.lineFirst[li]; i < lay.lineFirst[li + 1]; i++) {
      const x0 = lay.x[i], x1 = x0 + lay.w[i];
      const d = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  return -1;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function showTapped(cx: number, cy: number): void {
  const i = wordAt(cx, cy);
  if (!built || i < 0) return;
  const ref = built.text.refs[i];
  const ch = Math.floor(ref / 1000), vs = ref % 1000;
  tappedBox.innerHTML = `<b style="color:${V.color === 'cream' ? bookColor() : textColor()}">${escapeHtml(bookTitle(V.book))} ${ch}:${vs}</b> · “${escapeHtml(built.set.words[i])}”`;
}

// ─── Stats ─────────────────────────────────────────────────────────────────

function showStats(): void {
  if (!built) return;
  const lines: string[] = [];
  const total = built.set.words.length;
  lines.push(`<b>${escapeHtml(bookTitle(V.book))}</b> · ${total.toLocaleString()} words`);
  if (V.sizeByLength && longest) {
    lines.push(longest === V.book || built.size >= 1
      ? `The longest book, so its symbol fills the page.`
      : `Its symbol is ${Math.round(built.size * 100)}% as wide as ${escapeHtml(bookTitle(longest))}'s, the longest book, which fills the page.`);
  }
  const describe = (lay: Layout, label: string) => {
    let used = 0;
    for (let l = 0; l < lay.lines; l++) if (lay.lineFirst[l + 1] > lay.lineFirst[l]) used++;
    const perLine = used ? total / used : 0;
    const zoom = 16 / lay.f / fitK();
    let s = `${label}: ${used.toLocaleString()} lines, about ${perLine.toFixed(1)} words a line. ` +
      `The letters are ${lay.f.toFixed(2)} units on a 1,000-wide page; on this screen they need about ${zoom.toFixed(1)}× zoom to read at 16 px.`;
    if (!lay.fits) s += ` <span class="warn">${(total - lay.n).toLocaleString()} words didn't fit.</span>`;
    if (lay.inShape) {
      let inside = 0;
      for (let i = 0; i < lay.n; i++) inside += lay.inShape[i];
      s += ` ${Math.round((inside / Math.max(1, lay.n)) * 100)}% of the words touch the symbol.`;
    }
    lines.push(s);
  };
  if (built.shapeLayout) describe(built.shapeLayout, 'Shape only');
  if (built.pageLayout) describe(built.pageLayout, 'Whole page');
  statsBox.innerHTML = lines.join('<br>');
}

function showSymbolNote(): void {
  const info = bookInfo(V.book);
  if (!info) {
    symbolNote.textContent = '';
    return;
  }
  const group = GROUP_SYMBOLS[info.category];
  const groupName = CATEGORY_LABELS[info.category];
  if (!group.id) {
    symbolNote.innerHTML = `<span class="warn">${groupName}'s group symbol (${group.name}) isn't drawn yet</span>, so any of the drawn ones can stand in.`;
  } else if (group.id !== V.symbol) {
    symbolNote.textContent = `${groupName}'s group symbol is the ${group.name.toLowerCase()}.`;
  } else {
    symbolNote.textContent = `The ${groupName} group symbol.`;
  }
}

// ─── Controls ──────────────────────────────────────────────────────────────

function fillSelect(sel: HTMLSelectElement, items: Array<[string, string]>, groups?: Array<[string, Array<[string, string]>]>): void {
  sel.innerHTML = '';
  if (groups) {
    for (const [label, opts] of groups) {
      const g = document.createElement('optgroup');
      g.label = label;
      for (const [value, text] of opts) g.append(new Option(text, value));
      sel.append(g);
    }
  } else {
    for (const [value, text] of items) sel.append(new Option(text, value));
  }
}

const bookSel = $<HTMLSelectElement>('book');
const symbolSel = $<HTMLSelectElement>('symbol');
const colorSel = $<HTMLSelectElement>('color');
const fontSel = $<HTMLSelectElement>('font');
const pageSel = $<HTMLSelectElement>('pageShape');
const themeSel = $<HTMLSelectElement>('theme');

const categories = Object.keys(CATEGORY_LABELS) as Array<BookInfo['category']>;
fillSelect(bookSel, [], categories.map((cat) => [
  CATEGORY_LABELS[cat],
  BIBLE_BOOKS.filter((b) => b.category === cat).map((b) => [b.name, bookTitle(b.name)] as [string, string]),
]));
fillSelect(symbolSel, SHAPES.map((s) => [s.id, s.label]));
fillSelect(colorSel, [['book', 'Book color'], ['cream', 'Cream white'], ...categories.map((c) => [c, CATEGORY_LABELS[c]] as [string, string])]);
fillSelect(fontSel, Object.entries(FONTS).map(([id, f]) => [id, f.label]));
fillSelect(pageSel, Object.entries(PAGES).map(([id, p]) => [id, p.label]));
fillSelect(themeSel, Object.entries(THEMES).map(([id, t]) => [id, t.label]));

const sliders: Array<{ key: 'lineSpacing' | 'faint' | 'margin' | 'thicken' | 'minSpan'; fmt: (v: number) => string; rebuild: boolean }> = [
  { key: 'lineSpacing', fmt: (v) => v.toFixed(2), rebuild: true },
  { key: 'faint', fmt: (v) => `${Math.round(v * 100)}%`, rebuild: false },
  { key: 'margin', fmt: (v) => `${v}%`, rebuild: true },
  { key: 'thicken', fmt: (v) => v.toFixed(1), rebuild: true },
  { key: 'minSpan', fmt: (v) => v.toFixed(1), rebuild: true },
];

function syncControls(): void {
  bookSel.value = V.book;
  symbolSel.value = V.symbol;
  colorSel.value = V.color;
  fontSel.value = V.font;
  pageSel.value = V.page;
  themeSel.value = V.theme;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#look button')) {
    b.setAttribute('aria-pressed', String(b.dataset.look === V.look));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#weight button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.weight) === V.weight));
  }
  $<HTMLInputElement>('chapterMarks').checked = V.chapterMarks;
  $<HTMLInputElement>('faintInColor').checked = V.faintInColor;
  $<HTMLInputElement>('sizeByLength').checked = V.sizeByLength;
  for (const s of sliders) {
    $<HTMLInputElement>(s.key).value = String(V[s.key]);
    $<HTMLOutputElement>(`${s.key}Out`).textContent = s.fmt(V[s.key]);
  }
  showSymbolNote();
}

let rebuildQueued = false;

/** Coalesce slider drags into one rebuild per frame. */
function changed(needsRebuild: boolean): void {
  saveValues();
  showSymbolNote();
  if (!needsRebuild) {
    renderBase();
    renderCrisp();
    return;
  }
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    void rebuild();
  });
}

bookSel.addEventListener('change', () => {
  // A new book shows its group's symbol when that one is drawn, unless a
  // different symbol (the circle, say) was picked on purpose.
  const prev = bookInfo(V.book);
  const prevGroup = prev ? GROUP_SYMBOLS[prev.category] : null;
  const followGroup = !prevGroup?.id || V.symbol === prevGroup.id;
  V.book = bookSel.value;
  tappedBox.textContent = 'Tap a word to see where it is in the book.';
  const info = bookInfo(V.book);
  const group = info ? GROUP_SYMBOLS[info.category] : null;
  if (followGroup && group?.id) {
    V.symbol = group.id;
    symbolSel.value = V.symbol;
  }
  viewSet = false;
  changed(true);
});
symbolSel.addEventListener('change', () => {
  V.symbol = symbolSel.value;
  changed(true);
});
colorSel.addEventListener('change', () => {
  V.color = colorSel.value;
  changed(false);
});
fontSel.addEventListener('change', () => {
  V.font = fontSel.value;
  changed(true);
});
pageSel.addEventListener('change', () => {
  V.page = pageSel.value;
  viewSet = false;
  changed(true);
});
themeSel.addEventListener('change', () => {
  V.theme = themeSel.value as ThemeId;
  changed(false);
});
for (const b of document.querySelectorAll<HTMLButtonElement>('#look button')) {
  b.addEventListener('click', () => {
    V.look = b.dataset.look as Look;
    syncControls();
    viewSet = false;
    changed(true);
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#weight button')) {
  b.addEventListener('click', () => {
    V.weight = Number(b.dataset.weight);
    syncControls();
    changed(true);
  });
}
$<HTMLInputElement>('chapterMarks').addEventListener('change', (e) => {
  V.chapterMarks = (e.target as HTMLInputElement).checked;
  changed(false);
});
$<HTMLInputElement>('faintInColor').addEventListener('change', (e) => {
  V.faintInColor = (e.target as HTMLInputElement).checked;
  changed(false);
});
$<HTMLInputElement>('sizeByLength').addEventListener('change', (e) => {
  V.sizeByLength = (e.target as HTMLInputElement).checked;
  changed(true);
});
for (const s of sliders) {
  const input = $<HTMLInputElement>(s.key);
  input.addEventListener('input', () => {
    V[s.key] = Number(input.value);
    $<HTMLOutputElement>(`${s.key}Out`).textContent = s.fmt(V[s.key]);
    changed(s.rebuild);
  });
}

$('copy').addEventListener('click', async () => {
  const text = JSON.stringify(V, null, 2);
  valuesBox.value = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    valuesBox.select();
  }
});
$('reset').addEventListener('click', () => {
  Object.assign(V, DEFAULTS);
  syncControls();
  viewSet = false;
  changed(true);
});

// ─── Start ─────────────────────────────────────────────────────────────────

new ResizeObserver(() => resize()).observe(stage);
syncControls();
resize();

openStarter()
  .then(() => rebuild())
  .catch((err) => {
    console.error(err);
    busy.textContent = `Couldn't load the NET: ${err instanceof Error ? err.message : String(err)}`;
  });
