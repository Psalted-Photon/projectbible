/**
 * The small map of a book (book-picture-lab.html): the book's circle drawn as
 * faint lines, like a page of text seen from far away. The book runs along
 * the lines in reading order, so a point on them is a place in the book.
 *
 * Two uses: one bright mark where a verse sits (the share card look), and the
 * lines filled up to a verse (the Read Aloud look). Positions come from verse
 * counts only, every verse an equal share, so nothing has to load the book's
 * text and it draws at once.
 */

import { getBookChapters } from '../bibleData';
import { verseCount } from '../bibleRefs';

/** Verses in each chapter of a book (a chapter the table doesn't know counts as 1). */
export function bookVerseCounts(book: string): number[] {
  const out: number[] = [];
  const chapters = getBookChapters(book);
  for (let c = 1; c <= chapters; c++) out.push(Math.max(1, verseCount(book, c) ?? 1));
  return out;
}

interface MiniLine {
  /** Height in the unit circle (radius 1, centre 0,0). */
  y: number;
  x0: number;
  x1: number;
  /** "Word" pieces along the line as [start, end, start, end, …]. */
  words: number[];
  /** Length of the lines before this one. */
  before: number;
}

export interface MiniMap {
  counts: number[];
  totalVerses: number;
  /** Verses before each chapter. */
  chapterBefore: number[];
  lines: MiniLine[];
  /** Line gap in the unit circle. */
  step: number;
  totalLength: number;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Lay out `lineCount` lines inside the unit circle, broken into word-like pieces. */
export function miniMapLayout(counts: number[], lineCount: number, seed = 1): MiniMap {
  const rand = seeded(seed);
  const n = Math.max(3, Math.round(lineCount));
  const step = 2 / n;
  const lines: MiniLine[] = [];
  let before = 0;
  for (let i = 0; i < n; i++) {
    const y = -1 + (i + 0.5) * step;
    const half = Math.sqrt(Math.max(0, 1 - y * y)) * 0.97;
    if (half < step * 0.6) continue;
    const x0 = -half, x1 = half;
    const words: number[] = [];
    const gap = step * 0.55;
    for (let x = x0; x < x1 - step * 0.3; ) {
      const len = step * (0.8 + rand() * 2.6);
      const end = Math.min(x1, x + len);
      words.push(x, end);
      x = end + gap;
    }
    lines.push({ y, x0, x1, words, before });
    before += x1 - x0;
  }
  const chapterBefore: number[] = [];
  let total = 0;
  for (const c of counts) {
    chapterBefore.push(total);
    total += c;
  }
  return { counts, totalVerses: Math.max(1, total), chapterBefore, lines, step, totalLength: before };
}

/** How far through the book (0 to 1) the middle of a verse is. */
export function verseMiddle(map: MiniMap, chapter: number, verse: number): number {
  const before = map.chapterBefore[chapter - 1] ?? 0;
  return Math.min(1, (before + verse - 0.5) / map.totalVerses);
}

/** How far through the book (0 to 1) the end of a verse is. */
export function verseEnd(map: MiniMap, chapter: number, verse: number): number {
  const before = map.chapterBefore[chapter - 1] ?? 0;
  return Math.min(1, (before + verse) / map.totalVerses);
}

/** Verse `index` (0-based, through the whole book) as chapter and verse. */
export function verseAtIndex(map: MiniMap, index: number): { chapter: number; verse: number } {
  const i = Math.max(0, Math.min(map.totalVerses - 1, Math.floor(index)));
  let ch = 0;
  while (ch + 1 < map.counts.length && map.chapterBefore[ch + 1] <= i) ch++;
  return { chapter: ch + 1, verse: i - map.chapterBefore[ch] + 1 };
}

/** The point on the lines (unit circle) that is `t` of the way through the book. */
export function pointAt(map: MiniMap, t: number): { x: number; y: number } {
  const at = Math.max(0, Math.min(1, t)) * map.totalLength;
  let line = map.lines[map.lines.length - 1];
  for (const l of map.lines) {
    if (at <= l.before + (l.x1 - l.x0)) {
      line = l;
      break;
    }
  }
  if (!line) return { x: 0, y: 0 };
  return { x: Math.min(line.x1, line.x0 + (at - line.before)), y: line.y };
}

export interface MiniDraw {
  /** Centre and radius in the context's units. */
  cx: number;
  cy: number;
  r: number;
  /** The book color: the mark and the filled lines. */
  color: string;
  /** The faint lines. */
  ink: string;
  inkAlpha: number;
  /** A bright mark this far through the book (0 to 1), or null. */
  mark?: number | null;
  /** Fill the lines this far through the book (0 to 1), or null. */
  fill?: number | null;
  /** The smallest a mark is drawn, in the context's units. */
  minMark?: number;
}

/** Draw the small map. */
export function drawMiniMap(ctx: CanvasRenderingContext2D, map: MiniMap, d: MiniDraw): void {
  const { cx, cy, r } = d;
  const thick = Math.max(0.6, map.step * r * 0.42);
  const fillAt = d.fill == null ? -1 : Math.max(0, Math.min(1, d.fill)) * map.totalLength;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = thick;
  const pass = (bright: boolean) => {
    ctx.beginPath();
    for (const l of map.lines) {
      const y = cy + l.y * r;
      for (let i = 0; i < l.words.length; i += 2) {
        const a = l.words[i], b = l.words[i + 1];
        const pa = l.before + (a - l.x0), pb = l.before + (b - l.x0);
        let s: number, e: number;
        if (bright) {
          if (pa >= fillAt) continue;
          s = a;
          e = pb <= fillAt ? b : a + (fillAt - pa);
        } else {
          if (pb <= fillAt) continue;
          s = pa >= fillAt ? a : a + (fillAt - pa);
          e = b;
        }
        // A round cap adds half the thickness at each end; keep pieces inside the circle.
        const inset = thick / 2 / r;
        const x0 = s + inset, x1 = Math.max(x0, e - inset);
        ctx.moveTo(cx + x0 * r, y);
        ctx.lineTo(cx + x1 * r, y);
      }
    }
    ctx.stroke();
  };
  ctx.strokeStyle = d.ink;
  ctx.globalAlpha = d.inkAlpha;
  pass(false);
  if (fillAt > 0) {
    ctx.strokeStyle = d.color;
    ctx.globalAlpha = 1;
    pass(true);
  }
  if (d.mark != null) {
    const p = pointAt(map, d.mark);
    const mr = Math.max(d.minMark ?? 2, map.step * r * 0.75);
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.color;
    ctx.shadowColor = d.color;
    ctx.shadowBlur = mr * 2.5;
    ctx.beginPath();
    ctx.arc(cx + p.x * r, cy + p.y * r, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx + p.x * r, cy + p.y * r, mr * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
