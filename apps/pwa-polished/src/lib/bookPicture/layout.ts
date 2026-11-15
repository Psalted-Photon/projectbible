/**
 * Sets a book's whole text inside a symbol (book-picture-lab.html).
 *
 * The page is a fixed size in page units and the font size is whatever makes
 * the book exactly fill the shape, so Psalms comes out as a fine weave and
 * 3 John as chunky letters. Each line runs from the shape's left edge to its
 * right edge and is justified to fit, so the outline stays crisp; where a line
 * crosses a gap (the hole in an anchor) the text jumps it and keeps reading
 * left to right. Pieces of a line too narrow for a word are left empty.
 *
 * The shape is painted once onto a mask, and each mask row is kept as a list
 * of covered runs. A line's spans are the runs common to every row its
 * letters' bodies cross, so letters stay inside slanted edges.
 */

/** A painted shape, as covered runs per row. */
export interface Mask {
  /** Mask pixels per page unit. */
  scale: number;
  w: number;
  h: number;
  /** Per mask row: covered runs as [x0, x1, x0, x1, …], x1 exclusive, in mask px. */
  rows: Int32Array[];
  /** First and last covered row, in mask px (top > bottom when empty). */
  top: number;
  bottom: number;
  /** Covered area in page units². */
  area: number;
}

export function buildMask(
  pageW: number,
  pageH: number,
  scale: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Mask {
  const w = Math.ceil(pageW * scale);
  const h = Math.ceil(pageH * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#000';
  paint(ctx);
  const data = ctx.getImageData(0, 0, w, h).data;
  const rows: Int32Array[] = new Array(h);
  const empty = new Int32Array(0);
  const runs: number[] = [];
  let top = h, bottom = -1, covered = 0;
  for (let y = 0; y < h; y++) {
    runs.length = 0;
    let start = -1;
    let i = y * w * 4 + 3;
    for (let x = 0; x < w; x++, i += 4) {
      const on = data[i] >= 128;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        runs.push(start, x);
        covered += x - start;
        start = -1;
      }
    }
    if (start >= 0) {
      runs.push(start, w);
      covered += w - start;
    }
    if (runs.length) {
      rows[y] = Int32Array.from(runs);
      if (y < top) top = y;
      bottom = y;
    } else {
      rows[y] = empty;
    }
  }
  // Release the backing store now rather than whenever the canvas is collected.
  c.width = c.height = 0;
  return { scale, w, h, rows, top, bottom, area: covered / (scale * scale) };
}

function intersect(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out: number[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i], b[j]);
    const hi = Math.min(a[i + 1], b[j + 1]);
    if (hi > lo) out.push(lo, hi);
    if (a[i + 1] < b[j + 1]) i += 2;
    else j += 2;
  }
  return out;
}

/** Does any covered run in mask row `r` overlap [x0, x1) (page units)? */
function rowTouches(mask: Mask, r: number, x0: number, x1: number): boolean {
  if (r < 0 || r >= mask.h) return false;
  const row = mask.rows[r];
  const a = x0 * mask.scale, b = x1 * mask.scale;
  for (let i = 0; i < row.length; i += 2) {
    if (row[i] < b && row[i + 1] > a) return true;
  }
  return false;
}

/** The words of a book, measured once at font size 1. */
export interface WordSet {
  words: string[];
  width: Float32Array;
  space: number;
  /** Every word plus one space after each, at size 1. */
  total: number;
}

export function measureWords(words: string[], family: string, weight: number): WordSet {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `${weight} 100px ${family}`;
  const cache = new Map<string, number>();
  const width = new Float32Array(words.length);
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let wd = cache.get(word);
    if (wd === undefined) {
      wd = ctx.measureText(word).width / 100;
      cache.set(word, wd);
    }
    width[i] = wd;
    total += wd;
  }
  const space = ctx.measureText(' ').width / 100;
  total += space * words.length;
  return { words, width, space, total };
}

export interface LayoutOptions {
  pageW: number;
  pageH: number;
  margin: number;
  /** Line height as a multiple of the font size. */
  lineSpacing: number;
  /** The narrowest piece of a line that takes text, in em. Narrower pieces are jumped. */
  minSpan: number;
  /** 'shape': text only inside the shape. 'page': text fills the page box. */
  mode: 'shape' | 'page';
  mask: Mask;
}

export interface Layout {
  /** Font size in page units. */
  f: number;
  lineH: number;
  /** Words placed (all of them when `fits`). */
  n: number;
  fits: boolean;
  /** Per placed word: left edge, baseline, drawn width, horizontal scale. */
  x: Float32Array;
  y: Float32Array;
  w: Float32Array;
  sx: Float32Array;
  /** Per line: its top, and the first word on it. lineFirst has lines + 1 entries. */
  lineTop: Float32Array;
  lineFirst: Int32Array;
  lines: number;
  /** Whole-page look: 1 where a word touches the shape. */
  inShape: Uint8Array | null;
}

// Justification limits.
const MIN_SQUASH = 0.55; // a lone word may be squeezed to this width to fit a narrow piece
const SHRINK = 0.9; // a line may be squeezed 10% to take one more word
const MAX_GAP = 2.2; // widest word gap, in spaces, before the words widen instead
const MAX_WORD_STRETCH = 1.3; // widest words get in a line of several
const MAX_LONE_STRETCH = 1.8; // widest a lone word gets; past that it is centred

/** Where a line's text body sits, relative to the line's top. */
function baselineOf(top: number, lineH: number, f: number): number {
  return top + lineH * 0.5 + f * 0.3;
}

function lineSpans(mask: Mask, base: number, f: number, minSpan: number): number[] {
  const ms = mask.scale;
  const ra = Math.floor((base - 0.66 * f) * ms);
  const rb = Math.floor((base - 0.05 * f) * ms);
  if (ra < 0 || rb >= mask.h) return [];
  let cur: ArrayLike<number> = mask.rows[ra];
  for (let r = ra + 1; r <= rb && cur.length; r++) cur = intersect(cur, mask.rows[r]);
  const merged: number[] = [];
  const mergeGap = 0.35 * f;
  for (let i = 0; i < cur.length; i += 2) {
    const a = cur[i] / ms, b = cur[i + 1] / ms;
    if (merged.length && a - merged[merged.length - 1] < mergeGap) merged[merged.length - 1] = b;
    else merged.push(a, b);
  }
  const out: number[] = [];
  const minW = minSpan * f;
  for (let i = 0; i < merged.length; i += 2) {
    if (merged[i + 1] - merged[i] >= minW) out.push(merged[i], merged[i + 1]);
  }
  return out;
}

interface Out {
  x: Float32Array;
  y: Float32Array;
  w: Float32Array;
  sx: Float32Array;
  lineTop: number[];
  lineFirst: number[];
}

/** Lay the words out at font size f; returns how many were placed. */
function place(set: WordSet, o: LayoutOptions, f: number, lineH: number, out: Out | null): number {
  const N = set.words.length;
  const width = set.width;
  const space = set.space * f;
  const mask = o.mask;
  let top: number, bottom: number;
  if (o.mode === 'page') {
    top = o.margin;
    bottom = o.pageH - o.margin;
  } else {
    if (mask.bottom < mask.top) return 0;
    top = mask.top / mask.scale - lineH * 0.3;
    bottom = (mask.bottom + 1) / mask.scale + lineH * 0.3;
  }
  const pageSpan = [o.margin, o.pageW - o.margin];
  let wi = 0;
  for (; top + lineH <= bottom + 1e-6 && wi < N; top += lineH) {
    const base = baselineOf(top, lineH, f);
    const spans = o.mode === 'page' ? pageSpan : lineSpans(mask, base, f, o.minSpan);
    if (out) {
      out.lineTop.push(top);
      out.lineFirst.push(wi);
    }
    for (let k = 0; k < spans.length && wi < N; k += 2) {
      const L = spans[k];
      const S = spans[k + 1] - L;
      let n = 0, sum = 0, j = wi;
      while (j < N) {
        const ww = width[j] * f;
        const need = sum + ww + n * space;
        if (need <= S) {
          sum += ww;
          n++;
          j++;
          continue;
        }
        if (n === 0) {
          if (ww * MIN_SQUASH <= S) {
            sum = ww;
            n = 1;
            j++;
          }
          break;
        }
        if (need * SHRINK <= S) {
          sum += ww;
          n++;
          j++;
        }
        break;
      }
      if (n === 0) continue;
      if (out) {
        const last = j === N;
        const gaps = n - 1;
        const natural = sum + gaps * space;
        let sx = 1, gap = space, x = L;
        if (n === 1) {
          sx = last ? Math.min(1, S / sum) : Math.max(MIN_SQUASH, Math.min(MAX_LONE_STRETCH, S / sum));
          if (!last) x = L + (S - sum * sx) / 2;
        } else if (natural > S) {
          sx = (S - gaps * space) / sum;
        } else if (!last) {
          const extra = (S - natural) / gaps;
          if (extra <= space * (MAX_GAP - 1)) {
            gap = space + extra;
          } else {
            gap = space * MAX_GAP;
            sx = Math.min(MAX_WORD_STRETCH, (S - gaps * gap) / sum);
            gap = (S - sum * sx) / gaps;
          }
        }
        for (let i = wi; i < j; i++) {
          const ww = width[i] * f * sx;
          out.x[i] = x;
          out.y[i] = base;
          out.w[i] = ww;
          out.sx[i] = sx;
          x += ww + gap;
        }
      }
      wi = j;
    }
  }
  if (out) out.lineFirst.push(wi);
  return wi;
}

/**
 * The largest font size at which the whole book fits, then the line spacing
 * opened up a little so the text runs right down to the bottom of the shape.
 */
export function layoutBook(set: WordSet, o: LayoutOptions): Layout {
  const N = set.words.length;
  const L = o.lineSpacing;
  const area = o.mode === 'page'
    ? Math.max(1, (o.pageW - 2 * o.margin) * (o.pageH - 2 * o.margin))
    : Math.max(1, o.mask.area);
  const f0 = Math.sqrt(area / Math.max(1e-6, set.total * L));
  const fits = (f: number, t = 1) => place(set, o, f, f * L * t, null) >= N;

  let lo = f0 * 0.5, hi = f0 * 1.2;
  for (let g = 0; g < 12 && !fits(lo); g++) lo *= 0.75;
  for (let g = 0; g < 20 && fits(hi); g++) hi *= 1.3;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const f = lo;

  let tlo = 1, thi = 1.12;
  if (fits(f, thi)) tlo = thi;
  else {
    for (let i = 0; i < 12; i++) {
      const mid = (tlo + thi) / 2;
      if (fits(f, mid)) tlo = mid;
      else thi = mid;
    }
  }
  const lineH = f * L * tlo;

  const out: Out = {
    x: new Float32Array(N),
    y: new Float32Array(N),
    w: new Float32Array(N),
    sx: new Float32Array(N),
    lineTop: [],
    lineFirst: [],
  };
  const n = place(set, o, f, lineH, out);

  let inShape: Uint8Array | null = null;
  if (o.mode === 'page') {
    inShape = new Uint8Array(n);
    const ms = o.mask.scale;
    for (let i = 0; i < n; i++) {
      const x0 = out.x[i], x1 = x0 + out.w[i], b = out.y[i];
      if (
        rowTouches(o.mask, Math.floor((b - 0.75 * f) * ms), x0, x1) ||
        rowTouches(o.mask, Math.floor((b - 0.35 * f) * ms), x0, x1) ||
        rowTouches(o.mask, Math.floor((b + 0.2 * f) * ms), x0, x1)
      ) inShape[i] = 1;
    }
  }

  return {
    f,
    lineH,
    n,
    fits: n >= N,
    x: out.x,
    y: out.y,
    w: out.w,
    sx: out.sx,
    lineTop: Float32Array.from(out.lineTop),
    lineFirst: Int32Array.from(out.lineFirst),
    lines: out.lineTop.length,
    inShape,
  };
}
