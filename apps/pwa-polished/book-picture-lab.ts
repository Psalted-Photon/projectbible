/**
 * Book picture lab v1.3: one book per page, its whole text set inside a
 * symbol. Zoomed out you see the symbol, zoomed in you read the book.
 *
 * Runs the real code: lib/bookPicture/shapes.ts for the symbols and
 * layout.ts for setting the text, and the app's own verse cleanup
 * (cleanVersePreviewText) to strip notes from the NET in public/starter.sqlite.
 * Nothing in the app uses any of this yet; it is here to try the look.
 *
 * Two views. "One book" is the book picture. "All books" is the Bubbles map
 * (bubbles.ts): every book a circle sized by its length, splitting into its
 * chapters and then its verses as you zoom in, with a word box that lights up
 * every verse holding a word, and word clouds (cloud.ts) inside the bubbles.
 * Under both is the small map (miniMap.ts), the share card and Read Aloud look.
 *
 * Looks in One book: "Shape only" sets the text inside the symbol and nowhere
 * else. "Whole page" sets it across the whole page, paints the symbol's part
 * in the book color and leaves the rest faint. "Both" puts them side by side.
 * "Word cloud" packs the book's most used words into the symbol instead.
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
  outlineColorFor,
  type BookInfo,
} from './src/lib/bibleData';
import { cleanVersePreviewText, extractHeading } from './src/lib/verseRendering';
import { normalizeRepeatWord } from './src/stores/repeatsStore';
import { FILLER_WORDS } from './src/lib/fillerWords';
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
import {
  bubbleZoomLimits,
  layoutBubbles,
  type BookBubble,
  type BubbleMap,
  type ChapterBubble,
} from './src/lib/bookPicture/bubbles';
import {
  ZoomView,
  bookZoomK,
  drawBubbles,
  hashSeed,
  hitBubbles,
  queueBubbleClouds as packBubbleClouds,
  type BubbleGlow,
  type BubbleLook,
} from './src/lib/bookPicture/bubbleScene';
import { cloudWordAt, countCloudWords, packCloud, type Cloud, type CloudWord } from './src/lib/bookPicture/cloud';
import {
  bookVerseCounts,
  drawMiniMap,
  miniMapLayout,
  verseAtIndex,
  verseEnd,
  verseMiddle,
  type MiniMap,
} from './src/lib/bookPicture/miniMap';

// ─── Settings ──────────────────────────────────────────────────────────────

type View = 'book' | 'bubbles';
type Look = 'shape' | 'page' | 'both' | 'cloud';
type MiniLook = 'mark' | 'fill';
type ThemeId = 'dark' | 'light' | 'black';

interface Values {
  /** One book's picture, or every book as Bubbles. */
  view: View;
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
  /** Word cloud look: the most words it places. */
  cloudWords: number;
  /** Each book's word cloud inside its bubble, zoomed out. */
  bubbleClouds: boolean;
  /** The word lit up on the Bubbles, as typed. */
  glow: string;
  miniLook: MiniLook;
  miniLines: number;
  theme: ThemeId;
}

const DEFAULTS: Values = {
  view: 'book',
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
  cloudWords: 160,
  bubbleClouds: true,
  glow: '',
  miniLook: 'mark',
  miniLines: 18,
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
const glowInput = $<HTMLInputElement>('glow');
const glowStats = $<HTMLDivElement>('glowStats');
const miniBig = $<HTMLCanvasElement>('miniBig');
const miniSmall = $<HTMLCanvasElement>('miniSmall');
const miniVerseInput = $<HTMLInputElement>('miniVerse');
const miniVerseOut = $<HTMLOutputElement>('miniVerseOut');

const TAP_HINT_BOOK = 'Tap a word to see where it is in the book.';
const TAP_HINT_BUBBLES = 'Tap a book, a chapter or a verse to see it.';

function nextPaint(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

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

/** A book cut into chapters and verses, for the Bubbles and the word glow. */
interface BookIndex {
  text: BookText;
  /** Per verse: chapter * 1000 + verse. */
  verseRef: Int32Array;
  /** Per verse: its first word. One extra entry at the end. */
  verseTok: Int32Array;
  /** Per verse: which chapter (index into `chapters`) and its place in that chapter. */
  verseChapter: Int32Array;
  verseInChapter: Int32Array;
  /** `first` is the chapter's first verse, as an index into the verse arrays. */
  chapters: Array<{ chapter: number; words: number; verses: number; first: number }>;
  /** Every word normalized the way Repeats does, made when first needed. */
  norm: string[] | null;
  cloud: CloudWord[] | null;
}

const bookIndexes = new Map<string, BookIndex>();

function bookIndex(book: string): BookIndex {
  const cached = bookIndexes.get(book);
  if (cached) return cached;
  const text = bookText(book);
  const refs = text.refs;
  const vRef: number[] = [], vTok: number[] = [], vCh: number[] = [], vIn: number[] = [];
  const chapters: BookIndex['chapters'] = [];
  let last = -1;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (ref !== last) {
      const ch = Math.floor(ref / 1000);
      if (!chapters.length || chapters[chapters.length - 1].chapter !== ch) {
        chapters.push({ chapter: ch, words: 0, verses: 0, first: vRef.length });
      }
      const cur = chapters[chapters.length - 1];
      vRef.push(ref);
      vTok.push(i);
      vCh.push(chapters.length - 1);
      vIn.push(cur.verses);
      cur.verses++;
      last = ref;
    }
    chapters[chapters.length - 1].words++;
  }
  vTok.push(refs.length);
  const out: BookIndex = {
    text,
    verseRef: Int32Array.from(vRef),
    verseTok: Int32Array.from(vTok),
    verseChapter: Int32Array.from(vCh),
    verseInChapter: Int32Array.from(vIn),
    chapters,
    norm: null,
    cloud: null,
  };
  bookIndexes.set(book, out);
  return out;
}

function normOf(ix: BookIndex): string[] {
  return (ix.norm ??= ix.text.words.map(normalizeRepeatWord));
}

/** The book's words counted for its cloud, most used first, filler left out. */
function cloudWordsOf(ix: BookIndex): CloudWord[] {
  return (ix.cloud ??= countCloudWords(ix.text.words, normalizeRepeatWord, FILLER_WORDS));
}

function colorOf(book: string): string {
  const info = bookInfo(book);
  return info ? CATEGORY_COLORS[info.category] : '#8a8f98';
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
  /** The Word cloud look, packed into the same symbol. */
  cloud: Cloud | null;
}

let built: Built | null = null;
/** The book changed while the Bubbles were showing; set it again on the way back. */
let bookStale = false;
let cloudKey = '';
let bookCloud: Cloud | null = null;
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
  if (V.view !== 'book') {
    bookStale = true;
    return;
  }
  bookStale = false;
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
  await nextPaint();
  if (gen !== buildGen) return;
  if (V.view !== 'book') {
    bookStale = true;
    busy.hidden = true;
    return;
  }

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
  const wantShape = V.look === 'shape' || V.look === 'both';
  const wantPage = V.look === 'page' || V.look === 'both';
  let cloud: Cloud | null = null;
  if (V.look === 'cloud') {
    const ck = `${mk}|${sk}|${V.cloudWords}`;
    if (ck !== cloudKey || !bookCloud) {
      bookCloud = packCloud(cloudWordsOf(bookIndex(V.book)), maskBuilt.mask, {
        family: font.css,
        weight: V.weight,
        maxWords: V.cloudWords,
        fill: 0.5,
        seed: hashSeed(V.book),
      });
      cloudKey = ck;
    }
    cloud = bookCloud;
  }
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
    cloud,
  };
  busy.hidden = true;
  const world = worldSize();
  // A new page shape or a change between one and two pages starts at the whole view.
  if (!prevWorld || prevWorld.w !== world.w || prevWorld.h !== world.h || !view.viewSet) view.fitView();
  view.clampView();
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
  if (V.view === 'bubbles') return { w: BUBBLE_WORLD, h: BUBBLE_WORLD };
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
  if (V.view === 'bubbles') {
    if (bubbles) drawBubbles(c, bubbles, bubbleLook(), W, H, k, tx, ty, ratio);
    return;
  }
  if (!built) return;
  const color = textColor();
  const mark = V.chapterMarks ? markColor(color, theme.light) : null;
  const K = k * ratio;
  if (built.cloud) {
    const X = tx * ratio, Y = ty * ratio;
    c.fillStyle = theme.page;
    c.fillRect(X, Y, PAGE_W * K, built.pageH * K);
    c.strokeStyle = theme.border;
    c.lineWidth = Math.max(1, ratio);
    c.strokeRect(X, Y, PAGE_W * K, built.pageH * K);
    drawCloud(c, built.cloud, K, X, Y, W, H, color);
    return;
  }
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

/** The Word cloud look: biggest words first, fading a little down the list. */
function drawCloud(
  c: CanvasRenderingContext2D,
  cloud: Cloud,
  K: number,
  X: number,
  Y: number,
  W: number,
  H: number,
  color: string,
): void {
  const font = FONTS[V.font] ?? FONTS.gentium;
  const accent = bookColor();
  const n = cloud.placed.length;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  for (let i = 0; i < n; i++) {
    const p = cloud.placed[i];
    const dx = X + p.x * K, dy = Y + p.y * K, fpx = p.f * K;
    if (dx > W || dx + p.w * K < 0 || dy - fpx > H || dy + fpx * 0.4 < 0) continue;
    // On cream white text the top few words carry the book color.
    c.fillStyle = V.color === 'cream' && i < 5 ? accent : color;
    c.globalAlpha = 1 - 0.35 * (i / Math.max(1, n - 1));
    if (fpx < 2) {
      c.fillRect(dx, dy - 0.46 * fpx, p.w * K, Math.max(0.5, 0.46 * fpx));
      continue;
    }
    c.font = `${V.weight} ${fpx}px ${font.css}`;
    c.fillText(p.text, dx, dy);
  }
  c.globalAlpha = 1;
}

// ─── Bubbles ───────────────────────────────────────────────────────────────
// The drawing, the taps and the pan and zoom are shared with the app's Bubble
// view (src/lib/bookPicture/bubbleScene.ts), so the two stay alike.

/** The Bubbles world is a square this many units wide. */
const BUBBLE_WORLD = 1000;

let bubbles: BubbleMap | null = null;
const bubbleByBook = new Map<string, BookBubble>();

/** Read every book once, then pack the map. */
async function ensureBubbles(): Promise<void> {
  if (bubbles || !db) return;
  busy.textContent = 'Measuring all 66 books…';
  busy.hidden = false;
  await nextPaint();
  bubbles = layoutBubbles(
    BIBLE_BOOKS.map((b) => {
      const ix = bookIndex(b.name);
      return { book: b.name, words: ix.text.words.length, chapters: ix.chapters };
    }),
    BUBBLE_WORLD,
  );
  for (const b of bubbles.books) bubbleByBook.set(b.book, b);
  busy.hidden = true;
}

// Clouds in the bubbles: one per book, packed a few at a time between frames.
let bubbleCloudKey = '';
const bubbleClouds = new Map<string, Cloud>();
let stopClouds: () => void = () => {};

function queueBubbleClouds(): void {
  const font = FONTS[V.font] ?? FONTS.gentium;
  const key = `${V.font}|${V.weight}`;
  stopClouds();
  if (key !== bubbleCloudKey) {
    bubbleClouds.clear();
    bubbleCloudKey = key;
  }
  stopClouds = packBubbleClouds(
    BIBLE_BOOKS.map((b) => b.name),
    (name) => cloudWordsOf(bookIndex(name)),
    { family: font.css, weight: V.weight },
    bubbleClouds,
    () => {
      if (V.view === 'bubbles') view.requestFrame();
    },
  );
}

function cloudsShown(): boolean {
  return V.bubbleClouds && !glow;
}

// The word glow: every verse holding the word, per book.
interface Glow {
  word: string;
  label: string;
  /** Book → the verses (indexes into its BookIndex) with the word. */
  perBook: Map<string, Int32Array>;
  verses: number;
  books: number;
}

let glow: Glow | null = null;

function computeGlow(raw: string): Glow | null {
  const word = normalizeRepeatWord(raw);
  if (!word) return null;
  const perBook = new Map<string, Int32Array>();
  let verses = 0;
  for (const b of BIBLE_BOOKS) {
    const ix = bookIndex(b.name);
    const norm = normOf(ix);
    const hits: number[] = [];
    let v = 0;
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] !== word) continue;
      while (ix.verseTok[v + 1] <= i) v++;
      if (hits[hits.length - 1] !== v) hits.push(v);
    }
    if (hits.length) {
      perBook.set(b.name, Int32Array.from(hits));
      verses += hits.length;
    }
  }
  return { word, label: raw.trim(), perBook, verses, books: perBook.size };
}

let normsReady = false;

async function setGlow(raw: string): Promise<void> {
  const label = raw.trim();
  V.glow = label;
  saveValues();
  if (glowInput.value.trim() !== label) glowInput.value = label;
  if (!label || !db) {
    glow = null;
  } else {
    if (!normsReady) {
      busy.textContent = 'Reading every book…';
      busy.hidden = false;
      await nextPaint();
    }
    glow = computeGlow(label);
    normsReady = true;
    busy.hidden = true;
  }
  showGlowStats();
  if (V.view === 'bubbles') renderCrisp();
}

function showGlowStats(): void {
  if (!glow) {
    glowStats.textContent = 'No word lit. Type one above, or tap a word in a cloud.';
    return;
  }
  if (!glow.verses) {
    glowStats.innerHTML = `No verse in the NET has “${escapeHtml(glow.label)}”.`;
    return;
  }
  const top = [...glow.perBook].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  glowStats.innerHTML =
    `<b>“${escapeHtml(glow.label)}”</b> is in ${glow.verses.toLocaleString()} verse${glow.verses === 1 ? '' : 's'} ` +
    `across ${glow.books} book${glow.books === 1 ? '' : 's'}.<br>Most: ` +
    top.map(([book, h]) => `<span style="color:${colorOf(book)}">${escapeHtml(bookTitle(book))}</span> ${h.length}`).join(', ') +
    (FILLER_WORDS.has(glow.word) ? `<br><span class="warn">A filler word: Repeats won't list its verses.</span>` : '');
}

let glowsFor: Glow | null = null;
let glowsList: BubbleGlow[] = [];

/** The one glow word, drawn in each book's own color. One list per word, so its counts are worked out once. */
function glowList(): BubbleGlow[] {
  if (glowsFor !== glow) {
    glowsFor = glow;
    glowsList = glow ? [{ color: null, perBook: glow.perBook }] : [];
  }
  return glowsList;
}

/** The lab's settings as the shared drawing reads them. */
function bubbleLook(): BubbleLook {
  const theme = THEMES[V.theme] ?? THEMES.dark;
  const font = FONTS[V.font] ?? FONTS.gentium;
  return {
    ground: { bg: theme.bg, neutral: theme.neutral, light: theme.light },
    family: font.css,
    weight: V.weight,
    colorOf,
    ringOf: outlineColorFor,
    verses: bookIndex,
    clouds: cloudsShown() ? bubbleClouds : null,
    glows: glowList(),
  };
}

function zoomToBook(book: string): void {
  const b = bubbleByBook.get(book);
  if (b) view.animateCenter(b.x, b.y, bookZoomK(b, view.cssW, view.cssH));
}

// ─── View ──────────────────────────────────────────────────────────────────

function smallestF(): number {
  const fs = pages().map((p) => p.layout.f);
  return fs.length ? Math.min(...fs) : 1;
}

/** The Word cloud look's smallest word, in page units. */
function smallestCloudF(): number {
  const placed = built?.cloud?.placed;
  if (!placed?.length) return 1;
  let f = Infinity;
  for (const p of placed) f = Math.min(f, p.f);
  return f;
}

function kLimits(kf: number): [number, number] {
  if (V.view === 'bubbles') {
    // Far enough in that every chapter shows its verse numbers.
    return bubbles ? bubbleZoomLimits(bubbles, kf) : [kf * 0.5, kf * 8];
  }
  if (built?.cloud) return [kf * 0.5, Math.max(kf * 2, 24 / smallestCloudF())];
  return [kf * 0.5, Math.max(kf * 2, 56 / smallestF())];
}

/** Pinch, scroll, drag and double-tap (bubbleScene.ts). World → CSS px: css = world * k + t. */
const view = new ZoomView(canvas, {
  world: worldSize,
  limits: kLimits,
  draw: (settled) => {
    if (settled || V.view === 'bubbles' || wordsOnScreen() < 2500) renderCrisp();
    else drawStretched();
  },
  tap: (x, y) => {
    if (V.view === 'bubbles') tapBubbles(x, y);
    else showTapped(x, y);
  },
});

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
  // The Bubbles are cheap enough to draw sharp every frame.
  if (V.view === 'bubbles' || !built || !baseStale) return;
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
  renderScene(ctx, canvas.width, canvas.height, view.k, view.tx, view.ty, view.dpr, 'screen');
  updateReadout();
}

function drawStretched(): void {
  ensureBase();
  const theme = THEMES[V.theme] ?? THEMES.dark;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (base) {
    const s = (view.k * view.dpr) / baseK;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, view.tx * view.dpr, view.ty * view.dpr, base.width * s, base.height * s);
  }
  updateReadout();
}

/** About how many words are on screen, to decide whether a sharp frame is cheap. */
function wordsOnScreen(): number {
  let total = 0;
  const { k, tx, ty, cssW, cssH } = view;
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

function updateReadout(): void {
  if (V.view === 'bubbles') {
    readout.textContent = bubbles ? `zoom ${(view.k / view.fitK()).toFixed(1)}×` : '';
    return;
  }
  if (!built) {
    readout.textContent = '';
    return;
  }
  if (built.cloud) {
    const big = built.cloud.placed[0]?.f ?? 0;
    readout.textContent = `zoom ${(view.k / view.fitK()).toFixed(1)}× · biggest word ${(big * view.k).toFixed(0)} px`;
    return;
  }
  const f = pages()[0]?.layout.f ?? 1;
  readout.textContent = `zoom ${(view.k / view.fitK()).toFixed(1)}× · text ${(f * view.k).toFixed(1)} px`;
}

$('fit').addEventListener('click', () => view.animateFit());
$('zoomIn').addEventListener('click', () => view.animateZoomAt(view.cssW / 2, view.cssH / 2, 2));
$('zoomOut').addEventListener('click', () => view.animateZoomAt(view.cssW / 2, view.cssH / 2, 0.5));
$('readSize').addEventListener('click', () => {
  if (V.view !== 'book') return;
  const f = built?.cloud ? smallestCloudF() : pages()[0]?.layout.f;
  if (!f) return;
  view.animateZoomAt(view.cssW / 2, view.cssH / 2, 16 / f / view.k);
});

// ─── Word under a tap ──────────────────────────────────────────────────────

function wordAt(cx: number, cy: number): number {
  if (!built) return -1;
  const wx = (cx - view.tx) / view.k, wy = (cy - view.ty) / view.k;
  if (built.cloud) return cloudWordAt(built.cloud, wx, wy, 4 / view.k);
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
  if (built.cloud) {
    void tapCloudWord(V.book, built.cloud.placed[i].word);
    return;
  }
  const ref = built.text.refs[i];
  const ch = Math.floor(ref / 1000), vs = ref % 1000;
  tappedBox.innerHTML = `<b style="color:${V.color === 'cream' ? bookColor() : textColor()}">${escapeHtml(bookTitle(V.book))} ${ch}:${vs}</b> · “${escapeHtml(built.set.words[i])}”`;
  setMiniVerse(ch, vs);
}

/** A cloud word was tapped (in One book or in a bubble): it becomes the glow word. */
async function tapCloudWord(book: string, wordIndex: number): Promise<void> {
  const w = cloudWordsOf(bookIndex(book))[wordIndex];
  if (!w) return;
  const said = `<b style="color:${colorOf(book)}">“${escapeHtml(w.text)}”</b> · ${w.count.toLocaleString()} time${w.count === 1 ? '' : 's'} in ${escapeHtml(bookTitle(book))}.`;
  tappedBox.innerHTML = said;
  await setGlow(w.text);
  if (!glow) return;
  tappedBox.innerHTML = said +
    ` Now lit on All books: ${glow.verses.toLocaleString()} verses in ${glow.books} books.` +
    (V.view === 'book' ? ` <button data-act="bubbles">See it on All books</button>` : '');
}

// ─── Taps on the Bubbles ───────────────────────────────────────────────────

/** What a tap on the Bubbles picks: a glow dot, a cloud word, a verse, a chapter, then a book. */
function tapBubbles(cx: number, cy: number): void {
  if (!bubbles) return;
  const hit = hitBubbles(bubbles, bubbleLook(), view.k, view.tx, view.ty, cx, cy);
  if (!hit) return;
  if (hit.kind === 'verse') {
    showVerse(hit.book, hit.v);
    return;
  }
  if (hit.kind === 'cloud') {
    void tapCloudWord(hit.book, hit.word);
    return;
  }
  const b = bubbleByBook.get(hit.book);
  if (!b) return;
  if (hit.kind === 'chapter') showChapter(b, b.chapters[hit.ci], hit.ci);
  else showBook(b);
}

/** How many of a book's lit verses fall in [from, to). */
function litBetween(book: string, from: number, to: number): number {
  const hits = glow?.perBook.get(book);
  if (!hits) return 0;
  let n = 0;
  for (const v of hits) if (v >= from && v < to) n++;
  return n;
}

function showVerse(book: string, v: number): void {
  const ix = bookIndex(book);
  const ref = ix.verseRef[v];
  const ch = Math.floor(ref / 1000), vs = ref % 1000;
  const words = ix.text.words.slice(ix.verseTok[v], ix.verseTok[v + 1]);
  const color = colorOf(book);
  const html = words
    .map((w) => (glow && normalizeRepeatWord(w) === glow.word ? `<b style="color:${color}">${escapeHtml(w)}</b>` : escapeHtml(w)))
    .join(' ');
  tappedBox.innerHTML = `<b style="color:${color}">${escapeHtml(bookTitle(book))} ${ch}:${vs}</b> · ${html}`;
  pickBook(book);
  setMiniVerse(ch, vs);
}

function showChapter(b: BookBubble, ch: ChapterBubble, ci: number): void {
  const first = bookIndex(b.book).chapters[ci]?.first ?? 0;
  const lit = glow ? litBetween(b.book, first, first + ch.verses) : 0;
  tappedBox.innerHTML =
    `<b style="color:${colorOf(b.book)}">${escapeHtml(bookTitle(b.book))} ${ch.chapter}</b> · ` +
    `${ch.verses} verses · ${ch.words.toLocaleString()} words` +
    (glow ? ` · “${escapeHtml(glow.label)}” in ${lit}` : '');
  pickBook(b.book);
  setMiniVerse(ch.chapter, 1);
}

function showBook(b: BookBubble): void {
  const verses = bookIndex(b.book).verseRef.length;
  const lit = glow?.perBook.get(b.book)?.length ?? 0;
  tappedBox.innerHTML =
    `<b style="color:${colorOf(b.book)}">${escapeHtml(bookTitle(b.book))}</b> · ` +
    `${b.chapters.length} chapter${b.chapters.length === 1 ? '' : 's'} · ${verses.toLocaleString()} verses · ${b.words.toLocaleString()} words` +
    (glow ? ` · “${escapeHtml(glow.label)}” in ${lit}` : '');
  pickBook(b.book);
}

/** A tap on the Bubbles makes that the book: the small map shows it, and One book opens on it. */
function pickBook(book: string): void {
  if (book === V.book) return;
  setBook(book);
  bookStale = true;
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
    const zoom = 16 / lay.f / view.fitK();
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
  if (built.cloud) {
    const all = cloudWordsOf(bookIndex(V.book));
    const placed = built.cloud.placed.length;
    lines.push(
      `Word cloud: ${all.length.toLocaleString()} different words once filler words are left out; ` +
      `the ${placed.toLocaleString()} most used are in the cloud` +
      (built.cloud.skipped ? ` <span class="warn">(${built.cloud.skipped} more found no room)</span>` : '') +
      `. Most used: ${all.slice(0, 6).map((w) => `${escapeHtml(w.text)} ${w.count.toLocaleString()}`).join(', ')}.`,
    );
  }
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

// ─── Small map ─────────────────────────────────────────────────────────────

let mini: MiniMap | null = null;
let miniKey = '';
/** The chosen verse, counted through the whole book from 0. */
let miniVerse = 0;
let playTimer = 0;

function miniMap(): MiniMap {
  const key = `${V.book}|${V.miniLines}`;
  if (!mini || key !== miniKey) {
    if (!mini || !miniKey.startsWith(`${V.book}|`)) miniVerse = 0;
    mini = miniMapLayout(bookVerseCounts(V.book), V.miniLines, hashSeed(V.book));
    miniKey = key;
    miniVerseInput.max = String(mini.totalVerses - 1);
  }
  return mini;
}

function drawMini(): void {
  const map = miniMap();
  miniVerse = Math.max(0, Math.min(miniVerse, map.totalVerses - 1));
  miniVerseInput.value = String(miniVerse);
  const { chapter, verse } = verseAtIndex(map, miniVerse);
  miniVerseOut.textContent = `${chapter}:${verse}`;
  const theme = THEMES[V.theme] ?? THEMES.dark;
  const color = bookColor();
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  for (const cv of [miniBig, miniSmall]) {
    const css = cv.clientWidth || (cv === miniBig ? 168 : 44);
    const px = Math.max(1, Math.round(css * ratio));
    if (cv.width !== px || cv.height !== px) {
      cv.width = px;
      cv.height = px;
    }
    const c = cv.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = theme.page;
    c.fillRect(0, 0, px, px);
    drawMiniMap(c, map, {
      cx: px / 2,
      cy: px / 2,
      r: (px / 2) * 0.9,
      color,
      ink: theme.neutral,
      inkAlpha: theme.light ? 0.3 : 0.24,
      mark: V.miniLook === 'mark' ? verseMiddle(map, chapter, verse) : null,
      fill: V.miniLook === 'fill' ? verseEnd(map, chapter, verse) : null,
      minMark: 1.6 * ratio,
    });
  }
}

/** Point the small map at a verse of the current book. */
function setMiniVerse(chapter: number, verse: number): void {
  const map = miniMap();
  miniVerse = (map.chapterBefore[chapter - 1] ?? 0) + verse - 1;
  drawMini();
}

function stopPlay(): void {
  clearInterval(playTimer);
  playTimer = 0;
  $('miniPlay').textContent = 'Play';
}

$('miniPlay').addEventListener('click', () => {
  if (playTimer) {
    stopPlay();
    return;
  }
  V.miniLook = 'fill';
  saveValues();
  syncControls();
  const map = miniMap();
  if (miniVerse >= map.totalVerses - 1) miniVerse = 0;
  $('miniPlay').textContent = 'Stop';
  drawMini();
  // One redraw per verse, the beat the player's verse highlight keeps.
  playTimer = window.setInterval(() => {
    if (miniVerse >= miniMap().totalVerses - 1) {
      stopPlay();
      return;
    }
    miniVerse++;
    drawMini();
  }, 600);
});

miniVerseInput.addEventListener('input', () => {
  miniVerse = Number(miniVerseInput.value);
  drawMini();
});

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

type SliderKey = 'lineSpacing' | 'faint' | 'margin' | 'thicken' | 'minSpan' | 'cloudWords' | 'miniLines';
const sliders: Array<{ key: SliderKey; fmt: (v: number) => string; rebuild: boolean; mini?: boolean }> = [
  { key: 'lineSpacing', fmt: (v) => v.toFixed(2), rebuild: true },
  { key: 'faint', fmt: (v) => `${Math.round(v * 100)}%`, rebuild: false },
  { key: 'margin', fmt: (v) => `${v}%`, rebuild: true },
  { key: 'thicken', fmt: (v) => v.toFixed(1), rebuild: true },
  { key: 'minSpan', fmt: (v) => v.toFixed(1), rebuild: true },
  { key: 'cloudWords', fmt: (v) => String(v), rebuild: true },
  { key: 'miniLines', fmt: (v) => String(v), rebuild: false, mini: true },
];

const VIEW_HINTS: Record<View, string> = {
  book: "One book's whole text set inside a symbol, or its words as a cloud.",
  bubbles:
    'Every book as a circle, sized by how much text it has and colored by its group: Genesis in the middle, Revelation near the edge. ' +
    'Pinch or scroll in and a book splits into its chapters; further in, each chapter shows its verses, verse 1 in the middle and the rest spiraling out.',
};

function syncControls(): void {
  bookSel.value = V.book;
  symbolSel.value = V.symbol;
  colorSel.value = V.color;
  fontSel.value = V.font;
  pageSel.value = V.page;
  themeSel.value = V.theme;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#view button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === V.view));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#look button')) {
    b.setAttribute('aria-pressed', String(b.dataset.look === V.look));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#weight button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.weight) === V.weight));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#miniLook button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mini === V.miniLook));
  }
  $<HTMLInputElement>('chapterMarks').checked = V.chapterMarks;
  $<HTMLInputElement>('faintInColor').checked = V.faintInColor;
  $<HTMLInputElement>('sizeByLength').checked = V.sizeByLength;
  $<HTMLInputElement>('bubbleClouds').checked = V.bubbleClouds;
  if (document.activeElement !== glowInput) glowInput.value = V.glow;
  for (const s of sliders) {
    $<HTMLInputElement>(s.key).value = String(V[s.key]);
    $<HTMLOutputElement>(`${s.key}Out`).textContent = s.fmt(V[s.key]);
  }
  const bubblesView = V.view === 'bubbles';
  $('bookControls').hidden = bubblesView;
  $('bubbleControls').hidden = !bubblesView;
  $('cloudRow').hidden = V.look !== 'cloud';
  $('readSize').hidden = bubblesView;
  $('fit').textContent = bubblesView ? 'All books' : 'Whole page';
  $('viewHint').textContent = VIEW_HINTS[V.view];
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

/**
 * Change the book. It shows its group's symbol when that one is drawn,
 * unless a different symbol (the circle, say) was picked on purpose.
 */
function setBook(name: string): void {
  if (name === V.book) return;
  const prev = bookInfo(V.book);
  const prevGroup = prev ? GROUP_SYMBOLS[prev.category] : null;
  const followGroup = !prevGroup?.id || V.symbol === prevGroup.id;
  V.book = name;
  bookSel.value = name;
  const info = bookInfo(name);
  const group = info ? GROUP_SYMBOLS[info.category] : null;
  if (followGroup && group?.id) {
    V.symbol = group.id;
    symbolSel.value = V.symbol;
  }
  stopPlay();
  saveValues();
  showSymbolNote();
  drawMini();
}

async function setView(next: View): Promise<void> {
  V.view = next;
  saveValues();
  syncControls();
  view.viewSet = false;
  tappedBox.textContent = next === 'bubbles' ? TAP_HINT_BUBBLES : TAP_HINT_BOOK;
  if (next === 'bubbles') {
    await ensureBubbles();
    if (V.view !== 'bubbles') return;
    if (V.glow && glow?.label !== V.glow) await setGlow(V.glow);
    if (V.bubbleClouds) queueBubbleClouds();
    view.fitView();
    view.clampView();
    renderCrisp();
    return;
  }
  if (!built || bookStale) {
    await rebuild();
  } else {
    view.fitView();
    view.clampView();
    renderBase();
    renderCrisp();
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#view button')) {
  b.addEventListener('click', () => {
    if (b.dataset.view !== V.view) void setView(b.dataset.view as View);
  });
}
bookSel.addEventListener('change', () => {
  setBook(bookSel.value);
  if (V.view === 'bubbles') {
    bookStale = true;
    zoomToBook(V.book);
    return;
  }
  tappedBox.textContent = TAP_HINT_BOOK;
  view.viewSet = false;
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
  view.viewSet = false;
  changed(true);
});
themeSel.addEventListener('change', () => {
  V.theme = themeSel.value as ThemeId;
  changed(false);
  drawMini();
});
for (const b of document.querySelectorAll<HTMLButtonElement>('#look button')) {
  b.addEventListener('click', () => {
    V.look = b.dataset.look as Look;
    syncControls();
    view.viewSet = false;
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
for (const b of document.querySelectorAll<HTMLButtonElement>('#miniLook button')) {
  b.addEventListener('click', () => {
    stopPlay();
    V.miniLook = b.dataset.mini as MiniLook;
    saveValues();
    syncControls();
    drawMini();
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
$<HTMLInputElement>('bubbleClouds').addEventListener('change', (e) => {
  V.bubbleClouds = (e.target as HTMLInputElement).checked;
  saveValues();
  if (V.bubbleClouds && V.view === 'bubbles') queueBubbleClouds();
  renderCrisp();
});
for (const s of sliders) {
  const input = $<HTMLInputElement>(s.key);
  input.addEventListener('input', () => {
    V[s.key] = Number(input.value);
    $<HTMLOutputElement>(`${s.key}Out`).textContent = s.fmt(V[s.key]);
    if (s.mini) {
      saveValues();
      drawMini();
      return;
    }
    changed(s.rebuild);
  });
}

let glowTimer = 0;
glowInput.addEventListener('input', () => {
  clearTimeout(glowTimer);
  glowTimer = window.setTimeout(() => void setGlow(glowInput.value), 350);
});
glowInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  clearTimeout(glowTimer);
  void setGlow(glowInput.value);
  glowInput.blur();
});
$('glowClear').addEventListener('click', () => {
  clearTimeout(glowTimer);
  glowInput.value = '';
  void setGlow('');
});
tappedBox.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-act="bubbles"]')) void setView('bubbles');
});

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
  const shown = V.view;
  Object.assign(V, DEFAULTS, { view: shown });
  syncControls();
  view.viewSet = false;
  void setGlow('');
  drawMini();
  if (V.view === 'bubbles' && V.bubbleClouds) queueBubbleClouds();
  changed(true);
});

// ─── Start ─────────────────────────────────────────────────────────────────

function fitStage(): void {
  const r = stage.getBoundingClientRect();
  view.resize(r.width, r.height);
}
new ResizeObserver(fitStage).observe(stage);
syncControls();
fitStage();
drawMini();
showGlowStats();
tappedBox.textContent = V.view === 'bubbles' ? TAP_HINT_BUBBLES : TAP_HINT_BOOK;

openStarter()
  .then(() => (V.view === 'bubbles' ? setView('bubbles') : rebuild()))
  .catch((err) => {
    console.error(err);
    busy.textContent = `Couldn't load the NET: ${err instanceof Error ? err.message : String(err)}`;
  });
