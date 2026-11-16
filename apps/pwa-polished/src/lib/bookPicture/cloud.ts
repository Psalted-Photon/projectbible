/**
 * A book's word cloud (book-picture-lab.html): each of the book's words once,
 * sized by how often the book uses it, packed inside a shape.
 *
 * Words are counted the way Repeats counts them (normalizeRepeatWord, passed
 * in), so "Lord," and "LORD" are one word; the spelling shown is the one the
 * book uses most. Filler words are left out.
 *
 * A word's size follows the square root of its count, so the space it takes
 * up follows the count itself. The biggest word goes in the middle and the
 * rest spiral out from there, each taking the first free spot that sits
 * wholly inside the shape. The shape is the same mask the text pictures use
 * (buildMask in layout.ts), turned into a grid of free cells; a word is a
 * box of cells, so the check is a few bit tests per row.
 */

import type { Mask } from './layout';

export interface CloudWord {
  /** How it is shown: the book's most used spelling, punctuation trimmed. */
  text: string;
  /** The normalized word it was counted under. */
  key: string;
  count: number;
}

const EDGE_PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Count a book's words, most used first, leaving out `skip` and bare numbers. */
export function countCloudWords(
  tokens: readonly string[],
  normalize: (word: string) => string,
  skip: ReadonlySet<string>,
): CloudWord[] {
  const byKey = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const tok of tokens) {
    const key = normalize(tok);
    if (!key || skip.has(key) || /^\d+$/.test(key)) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { count: 0, forms: new Map() };
      byKey.set(key, entry);
    }
    entry.count++;
    const form = tok.replace(EDGE_PUNCT, '');
    entry.forms.set(form, (entry.forms.get(form) ?? 0) + 1);
  }
  const out: CloudWord[] = [];
  for (const [key, { count, forms }] of byKey) {
    let text = key, best = -1;
    for (const [form, n] of forms) {
      if (n > best) {
        best = n;
        text = form;
      }
    }
    out.push({ text, key, count });
  }
  out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return out;
}

export interface CloudOptions {
  family: string;
  weight: number;
  /** The most words to place. */
  maxWords: number;
  /** Share of the shape the word boxes should cover. */
  fill?: number;
  /** The smallest word, as a share of the biggest. */
  minRel?: number;
  /** Seeds where each word starts its spiral, so a cloud comes out the same every time. */
  seed?: number;
}

export interface PlacedWord {
  /** Index into the words given. */
  word: number;
  text: string;
  /** Left edge and baseline, in page units. */
  x: number;
  y: number;
  /** Font size and drawn width, in page units. */
  f: number;
  w: number;
  /** Top and bottom of the letters, for taps. */
  top: number;
  bottom: number;
}

export interface Cloud {
  placed: PlacedWord[];
  /** Words tried that found no room. */
  skipped: number;
}

/** A grid of cells, one bit each, set where a word may not go. */
class BitGrid {
  readonly stride: number;
  readonly bits: Uint32Array;
  constructor(readonly cols: number, readonly rows: number) {
    this.stride = (cols + 31) >>> 5;
    this.bits = new Uint32Array(this.stride * rows).fill(0xffffffff);
  }

  private apply(r: number, c0: number, c1: number, set: boolean): void {
    const w0 = c0 >>> 5, w1 = c1 >>> 5;
    const base = r * this.stride;
    for (let w = w0; w <= w1; w++) {
      const m = wordMask(w === w0 ? c0 & 31 : 0, w === w1 ? c1 & 31 : 31);
      if (set) this.bits[base + w] |= m;
      else this.bits[base + w] &= ~m;
    }
  }

  open(r: number, c0: number, c1: number): void {
    if (c1 >= c0) this.apply(r, c0, c1, false);
  }

  fill(r0: number, r1: number, c0: number, c1: number): void {
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
      this.apply(r, Math.max(0, c0), Math.min(this.cols - 1, c1), true);
    }
  }

  cellFree(r: number, c: number): boolean {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return false;
    return (this.bits[r * this.stride + (c >>> 5)] & (1 << (c & 31))) === 0;
  }

  boxFree(r0: number, r1: number, c0: number, c1: number): boolean {
    if (r0 < 0 || c0 < 0 || r1 >= this.rows || c1 >= this.cols) return false;
    const w0 = c0 >>> 5, w1 = c1 >>> 5;
    const m0 = wordMask(c0 & 31, w0 === w1 ? c1 & 31 : 31);
    const m1 = wordMask(0, c1 & 31);
    for (let r = r0; r <= r1; r++) {
      const base = r * this.stride;
      if (this.bits[base + w0] & m0) return false;
      for (let w = w0 + 1; w < w1; w++) if (this.bits[base + w]) return false;
      if (w1 > w0 && this.bits[base + w1] & m1) return false;
    }
    return true;
  }
}

/** Bits lo..hi (inclusive) of a 32-bit word. */
function wordMask(lo: number, hi: number): number {
  const top = hi >= 31 ? -1 : (1 << (hi + 1)) - 1;
  return top & ~((1 << lo) - 1);
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pack the most used words into the mask's shape. Positions are in page units. */
export function packCloud(words: readonly CloudWord[], mask: Mask, o: CloudOptions): Cloud {
  const list = words.slice(0, Math.max(0, o.maxWords));
  if (!list.length || mask.bottom < mask.top) return { placed: [], skipped: 0 };
  const ms = mask.scale;

  // The shape as free cells: a cell is free when the mask covers its middle.
  let x0 = Infinity, x1 = -Infinity, cxSum = 0, cySum = 0, n = 0;
  for (let r = mask.top; r <= mask.bottom; r++) {
    const row = mask.rows[r];
    for (let i = 0; i < row.length; i += 2) {
      x0 = Math.min(x0, row[i]);
      x1 = Math.max(x1, row[i + 1]);
      const len = row[i + 1] - row[i];
      cxSum += ((row[i] + row[i + 1]) / 2) * len;
      cySum += (r + 0.5) * len;
      n += len;
    }
  }
  const boxW = (x1 - x0) / ms, boxH = (mask.bottom - mask.top + 1) / ms;
  const cx = cxSum / n / ms, cy = cySum / n / ms;
  const cell = Math.max(0.2, Math.sqrt(mask.area) / 360);
  const cols = Math.ceil(mask.w / ms / cell), rows = Math.ceil(mask.h / ms / cell);
  const grid = new BitGrid(cols, rows);
  for (let gr = 0; gr < rows; gr++) {
    const my = Math.floor((gr + 0.5) * cell * ms);
    if (my < mask.top || my > mask.bottom) continue;
    const row = mask.rows[my];
    for (let i = 0; i < row.length; i += 2) {
      const a = row[i] / ms / cell - 0.5, b = row[i + 1] / ms / cell - 0.5;
      grid.open(gr, Math.max(0, Math.ceil(a)), Math.min(cols - 1, Math.ceil(b) - 1));
    }
  }

  // Each word measured once at size 1.
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `${o.weight} 100px ${o.family}`;
  const dims = list.map((wd) => {
    const m = ctx.measureText(wd.text);
    const asc = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent / 100 : 0.72;
    const desc = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent / 100 : 0.2;
    return { w: m.width / 100, asc: Math.max(0.3, asc), desc: Math.max(0, desc) };
  });

  // Sizes: square root of the count, scaled so the boxes cover `fill` of the shape.
  const minRel = o.minRel ?? 0.16;
  const top = list[0].count;
  const rel = list.map((wd) => Math.max(minRel, Math.sqrt(wd.count / top)));
  let boxArea = 0;
  for (let i = 0; i < list.length; i++) boxArea += dims[i].w * (dims[i].asc + dims[i].desc) * rel[i] * rel[i];
  let F = Math.sqrt(((o.fill ?? 0.5) * mask.area) / Math.max(1e-6, boxArea));
  F = Math.min(F, (boxW * 0.8) / Math.max(1e-6, dims[0].w), (boxH * 0.3) / (dims[0].asc + dims[0].desc));

  const rand = seeded(o.seed ?? 1);
  const aspect = Math.min(3, Math.max(0.33, boxW / Math.max(1e-6, boxH)));
  const maxR = Math.hypot(boxW, boxH) / 2 + cell;
  const turn = cell * 0.4; // spiral arms are about 2.5 cells apart
  const placed: PlacedWord[] = [];
  let skipped = 0;

  const tryPlace = (i: number, f: number): boolean => {
    const d = dims[i];
    const pad = 0.07 * f + cell * 0.5;
    const bw = d.w * f + pad * 2, bh = (d.asc + d.desc) * f + pad * 2;
    const start = rand() * Math.PI * 2;
    const dir = rand() < 0.5 ? 1 : -1;
    for (let t = 0; ; ) {
      const r = turn * t;
      if (r > maxR) return false;
      const a = start + dir * t;
      const px = cx + r * Math.cos(a) * Math.sqrt(aspect);
      const py = cy + r * Math.sin(a) / Math.sqrt(aspect);
      t += Math.min(0.6, cell / Math.max(cell, r));
      if (!grid.cellFree(Math.floor(py / cell), Math.floor(px / cell))) continue;
      const left = px - bw / 2, topY = py - bh / 2;
      const c0 = Math.floor(left / cell), c1 = Math.floor((left + bw) / cell);
      const r0 = Math.floor(topY / cell), r1 = Math.floor((topY + bh) / cell);
      if (!grid.boxFree(r0, r1, c0, c1)) continue;
      grid.fill(r0, r1, c0, c1);
      const base = topY + pad + d.asc * f;
      placed.push({
        word: i,
        text: list[i].text,
        x: left + pad,
        y: base,
        f,
        w: d.w * f,
        top: base - d.asc * f,
        bottom: base + d.desc * f,
      });
      return true;
    }
  };

  for (let i = 0; i < list.length; i++) {
    const f = F * rel[i];
    // The top words matter most: give them a second and third try a bit smaller.
    if (tryPlace(i, f) || (i < 12 && (tryPlace(i, f * 0.8) || tryPlace(i, f * 0.64)))) continue;
    skipped++;
  }
  return { placed, skipped };
}

/** The placed word under a point (page units), or -1. */
export function cloudWordAt(cloud: Cloud, x: number, y: number, slop = 0): number {
  for (let i = cloud.placed.length - 1; i >= 0; i--) {
    const p = cloud.placed[i];
    if (x >= p.x - slop && x <= p.x + p.w + slop && y >= p.top - slop && y <= p.bottom + slop) return i;
  }
  return -1;
}
