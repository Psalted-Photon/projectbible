/**
 * Drawing the Connections picture.
 *
 * One canvas: the axis of all 1,189 chapters, and an arc for every
 * cross-reference over it. This is the real draw — the lab
 * (connections-lab.html) runs this module rather than a copy of it, so what is
 * tuned there is what the app shows.
 *
 * Each arc wears both books' colors, the source's at its own foot and the
 * target's at the other, crossing over in between. That is the one thing that
 * makes a picture of 344,799 links legible: a band leaving Genesis is brown at
 * the Genesis end whatever it reaches, so where the Law is answered reads as
 * color rather than as counting.
 *
 * Two things are done for the sake of drawing this many arcs at 60fps:
 *
 *   - Arcs are batched by the pair of books they join. A canvas gradient costs
 *     far more to build than a line does to stroke, so one gradient is built
 *     per book pair (a few hundred at most) rather than per arc.
 *   - The strokes inside a batch are one path. Stroking 344,799 separate paths
 *     is most of the frame; stroking a few hundred is not.
 *
 * Both are why `draw` takes the whole set and not an arc at a time.
 */

import type { ConnectionsData } from './data';
import {
  arcShape,
  buildAxis,
  chapterIndexAt,
  fractionOf,
  frameFor,
  pointAt,
  strengthOf,
  type Axis,
  type ChapterWidth,
  type ConnectionsConfig,
  type Frame,
  type Viewport,
} from './layout';
import { BOOK_RGB, bookIndexAt, type ConnectionsPalette } from './palette';

/** What one draw needs beyond the data and the dials. */
export interface DrawOptions {
  palette: ConnectionsPalette;
  /**
   * The lit set, as verse positions: only arcs with a foot inside one of these
   * spans are drawn at full strength, the rest fall to `dimFloor`. Empty or
   * absent means everything is lit, which is the resting state.
   */
  lit?: Array<{ start: number; end: number }>;
  /** Draw the book names and the chapter ruler. */
  labels?: boolean;
  /** Pan and zoom, applied around the canvas centre. */
  view?: { x: number; y: number; k: number };
}

/** What a draw reports back, for the lab's readout. */
export interface DrawStats {
  /** Arcs actually stroked, after the vote floor and the arc cap. */
  drawn: number;
  /** Arcs skipped by the vote floor or the cap. */
  skipped: number;
  /** How many gradient batches it took. */
  batches: number;
  /** Milliseconds spent in this draw. */
  ms: number;
}

/**
 * The book-start positions, as the draw loop wants them: an Int32Array, so
 * finding an arc's book is a binary search over numbers.
 */
function bookStartsOf(data: ConnectionsData): Int32Array {
  const out = new Int32Array(data.books.length);
  data.books.forEach((b, i) => {
    out[i] = b.start;
  });
  return out;
}

/** Cached per data set: these never change while a pack is loaded. */
const bookStartsCache = new WeakMap<ConnectionsData, Int32Array>();
function bookStarts(data: ConnectionsData): Int32Array {
  let cached = bookStartsCache.get(data);
  if (!cached) {
    cached = bookStartsOf(data);
    bookStartsCache.set(data, cached);
  }
  return cached;
}

/**
 * The axis and the draw order, kept between frames.
 *
 * Both are pure functions of the data and a couple of dials, and both allocate:
 * the axis builds three arrays, and the order sorts up to 344,799 indices.
 * Rebuilding them per frame was most of a pan or a zoom, which change neither.
 */
const axisCache = new WeakMap<ConnectionsData, { width: ChapterWidth; axis: Axis }>();
function axisFor(data: ConnectionsData, width: ChapterWidth): Axis {
  const cached = axisCache.get(data);
  if (cached && cached.width === width) return cached.axis;
  const axis = buildAxis(data, width);
  axisCache.set(data, { width, axis });
  return axis;
}

interface OrderCache {
  floor: number;
  maxArcs: number;
  order: Int32Array | number[];
  skipped: number;
}
const orderCache = new WeakMap<ConnectionsData, OrderCache>();

function orderFor(data: ConnectionsData, config: ConnectionsConfig): OrderCache {
  const floor = config.voteFloor;
  const maxArcs = config.maxArcs;
  const cached = orderCache.get(data);
  if (cached && cached.floor === floor && cached.maxArcs === maxArcs) return cached;

  let order: Int32Array | number[];
  let skipped = 0;

  if (maxArcs > 0 && maxArcs < data.count) {
    // The cap keeps the strongest links: a reader who asks for 20,000 arcs out
    // of 344,799 wants the 20,000 that matter, not the first 20,000 in Genesis.
    const kept: number[] = [];
    for (let i = 0; i < data.count; i++) {
      if (data.votes[i] >= floor) kept.push(i);
      else skipped++;
    }
    kept.sort((a, b) => data.votes[b] - data.votes[a]);
    skipped += Math.max(0, kept.length - maxArcs);
    order = kept.slice(0, maxArcs);
  } else if (floor > 0) {
    const kept: number[] = [];
    for (let i = 0; i < data.count; i++) {
      if (data.votes[i] >= floor) kept.push(i);
      else skipped++;
    }
    order = kept;
  } else {
    // Every link, in pack order — which is already sorted by source verse.
    const all = new Int32Array(data.count);
    for (let i = 0; i < data.count; i++) all[i] = i;
    order = all;
  }

  const entry = { floor, maxArcs, order, skipped };
  orderCache.set(data, entry);
  return entry;
}

/** Is a position inside any lit span? */
function isLit(lit: Array<{ start: number; end: number }> | undefined, position: number): boolean {
  if (!lit?.length) return true;
  for (const span of lit) if (position >= span.start && position < span.end) return true;
  return false;
}

/**
 * One batch of arcs: every link joining the same pair of books, at the same
 * rounded thickness and brightness, so they share one gradient and one path.
 *
 * The key mixes the two books with the quantised strength, because a gradient
 * carries the alpha and two arcs of different brightness cannot share one.
 */
interface Batch {
  fromBook: number;
  toBook: number;
  /** Quantised strength, 0..STRENGTH_STEPS. */
  step: number;
  dim: boolean;
  indexes: number[];
}

/**
 * How many brightness levels the batching collapses to.
 *
 * Every extra level is another gradient per book pair, and a gradient is the
 * expensive object in this draw. Measured over the real set: 4 steps costs
 * 6,045 batches, 8 costs 8,706, 16 costs 11,402 and 32 costs 17,020. Eight is
 * where the curve turns — past it the batch count climbs faster than the eye
 * can separate the levels on a thin translucent line.
 */
const STRENGTH_STEPS = 8;

export function draw(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  options: DrawOptions,
): DrawStats {
  const t0 = performance.now();
  const { palette } = options;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, view.width, view.height);

  if (options.view) {
    const { x, y, k } = options.view;
    ctx.translate(view.width / 2, view.height / 2);
    ctx.scale(k, k);
    ctx.translate(-view.width / 2 + x, -view.height / 2 + y);
  }

  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  const starts = bookStarts(data);
  const { order, skipped: culled } = orderFor(data, config);
  // Arcs the vote floor and the cap took out, plus the ones a dimFloor of 0
  // hides entirely — so the readout's count adds up to the whole set.
  let skipped = culled;

  // ── Batch by book pair and strength ────────────────────────────────────
  const batches = new Map<number, Batch>();
  const total = order.length;
  for (let n = 0; n < total; n++) {
    const i = order[n];
    const from = data.from[i];
    const to = data.toStart[i];
    const fromBook = bookIndexAt(starts, from);
    const toBook = bookIndexAt(starts, to);

    const strength = strengthOf(config, data.votes[i], data.maxVotes);
    const step = Math.round(strength * STRENGTH_STEPS);
    // An arc counts as lit if either foot is in the lit set, so a tapped book
    // shows what it reaches and what reaches it.
    const dim = !(isLit(options.lit, from) || isLit(options.lit, to));
    if (dim && config.dimFloor <= 0) {
      skipped++;
      continue;
    }

    const key = (fromBook * 66 + toBook) * (STRENGTH_STEPS + 1) * 2 + step * 2 + (dim ? 1 : 0);
    let batch = batches.get(key);
    if (!batch) {
      batch = { fromBook, toBook, step, dim, indexes: [] };
      batches.set(key, batch);
    }
    batch.indexes.push(i);
  }

  // ── Stroke ─────────────────────────────────────────────────────────────
  //
  // Dimmed arcs go down first, so the lit ones read on top of them rather than
  // through them.
  const sorted = [...batches.values()].sort((a, b) => Number(b.dim) - Number(a.dim) || a.step - b.step);
  ctx.lineCap = 'round';

  let drawn = 0;
  for (const batch of sorted) {
    const t = batch.step / STRENGTH_STEPS;
    const alpha = (config.alphaMin + (config.alphaMax - config.alphaMin) * t) * (batch.dim ? config.dimFloor : 1);
    // Too faint to leave a mark: not worth a gradient and a path, and counted
    // as skipped rather than silently vanishing from both totals.
    if (alpha <= 0.002) {
      skipped += batch.indexes.length;
      continue;
    }
    const lineWidth = config.thicknessMin + (config.thicknessMax - config.thicknessMin) * t;

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = gradientFor(ctx, axis, frame, config, data, batch, alpha);

    ctx.beginPath();
    for (const i of batch.indexes) {
      const shape = arcShape(axis, frame, config, data.from[i], data.toStart[i]);
      const a = pointAt(frame, shape.fromAlong, 0);
      const b = pointAt(frame, shape.toAlong, 0);
      const mid = pointAt(
        frame,
        (shape.fromAlong + shape.toAlong) / 2,
        // A quadratic reaches half its control height, so the control point
        // goes to twice the height wanted.
        shape.height * 2 * shape.direction,
      );
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
      drawn++;
    }
    ctx.stroke();
  }

  // ── The axis and its labels ────────────────────────────────────────────
  drawAxis(ctx, data, axis, frame, palette, options.labels !== false);

  ctx.restore();
  return { drawn, skipped, batches: sorted.length, ms: performance.now() - t0 };
}

/**
 * The gradient a batch is stroked with: the source book's color at one end, the
 * target's at the other.
 *
 * Built across the batch's own extent rather than per arc, which is the whole
 * point of batching — a gradient is the expensive object here. Arcs in a batch
 * share a book pair, so they share the two colors; they differ only in where
 * along the axis they sit, and over a batch that spans two books the error that
 * costs is smaller than a line width.
 */
function gradientFor(
  ctx: CanvasRenderingContext2D,
  axis: Axis,
  frame: Frame,
  config: ConnectionsConfig,
  data: ConnectionsData,
  batch: Batch,
  alpha: number,
): CanvasGradient | string {
  const [r1, g1, b1] = BOOK_RGB[batch.fromBook] ?? [138, 143, 152];
  const [r2, g2, b2] = BOOK_RGB[batch.toBook] ?? [138, 143, 152];

  // A link inside one book has one color; no gradient needed.
  if (batch.fromBook === batch.toBook) {
    return `rgba(${r1}, ${g1}, ${b1}, ${alpha})`;
  }

  const fromBook = data.books[batch.fromBook];
  const toBook = data.books[batch.toBook];
  const a = pointAt(frame, fractionOf(axis, (fromBook.start + fromBook.end) / 2) * frame.along, 0);
  const b = pointAt(frame, fractionOf(axis, (toBook.start + toBook.end) / 2) * frame.along, 0);

  const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  // The changeover sits where the dials put it, and takes as much of the arc as
  // crossfadeWidth asks: a hard edge at 0, a long blend at 1.
  const at = Math.min(Math.max(config.crossfadeAt, 0), 1);
  const half = Math.min(Math.max(config.crossfadeWidth, 0), 1) / 2;
  const lo = Math.max(0, at - half);
  const hi = Math.min(1, at + half);

  grad.addColorStop(0, `rgba(${r1}, ${g1}, ${b1}, ${alpha})`);
  if (lo > 0) grad.addColorStop(lo, `rgba(${r1}, ${g1}, ${b1}, ${alpha})`);
  if (hi < 1) grad.addColorStop(hi, `rgba(${r2}, ${g2}, ${b2}, ${alpha})`);
  grad.addColorStop(1, `rgba(${r2}, ${g2}, ${b2}, ${alpha})`);
  return grad;
}

/**
 * The axis: a rule along the whole Bible, a tick at each book, and the book
 * names where there is room for them.
 *
 * The names are drawn in the book's own color, which is the legend: a reader
 * who sees a brown arc has brown "Genesis" under one end of it.
 */
function drawAxis(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  axis: Axis,
  frame: Frame,
  palette: ConnectionsPalette,
  labels: boolean,
): void {
  const horizontal = frame.orientation === 'horizontal';

  // The rule itself.
  const start = pointAt(frame, 0, 0);
  const end = pointAt(frame, frame.along, 0);
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // A tick at every book boundary.
  ctx.strokeStyle = palette.muted;
  ctx.beginPath();
  for (const book of data.books) {
    const along = fractionOf(axis, book.start) * frame.along;
    const a = pointAt(frame, along, 0);
    const b = pointAt(frame, along, -5);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  if (!labels) return;

  // Book names, skipped where a neighbour would collide. Measured once per
  // book, which is 66 measurements and not worth caching.
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = horizontal ? 'top' : 'middle';
  ctx.textAlign = horizontal ? 'center' : 'left';

  let lastEdge = -Infinity;
  data.books.forEach((book, i) => {
    const mid = fractionOf(axis, (book.start + book.end) / 2) * frame.along;
    const label = book.name.length > 12 ? shortName(book.name) : book.name;
    const w = horizontal ? ctx.measureText(label).width : 11;
    if (mid - w / 2 < lastEdge + 3) return;
    lastEdge = mid + w / 2;

    const at = pointAt(frame, mid, -9);
    ctx.fillStyle = `rgba(${BOOK_RGB[i][0]}, ${BOOK_RGB[i][1]}, ${BOOK_RGB[i][2]}, 0.95)`;
    ctx.fillText(label, at.x, at.y);
  });
}

/** "1 Thessalonians" in a space meant for "Ruth". */
function shortName(name: string): string {
  const m = name.match(/^([123])\s+(.*)$/);
  if (m) return `${m[1]} ${m[2].slice(0, 4)}`;
  return name.slice(0, 5);
}

/**
 * Which arc is under a tap, or null.
 *
 * Walked rather than indexed: a tap happens once, and the alternative is
 * keeping a spatial index of 344,799 curves up to date through every pan, zoom
 * and dial change. Arcs are tested strongest-last so the brightest one under
 * the finger wins, which is the one the reader was aiming at.
 */
export function pick(
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  at: { x: number; y: number },
  tolerance = 6,
): number | null {
  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  let best: number | null = null;
  let bestVotes = -Infinity;

  for (let i = 0; i < data.count; i++) {
    if (data.votes[i] < config.voteFloor) continue;
    if (data.votes[i] <= bestVotes) continue;
    const shape = arcShape(axis, frame, config, data.from[i], data.toStart[i]);
    const a = pointAt(frame, shape.fromAlong, 0);
    const b = pointAt(frame, shape.toAlong, 0);
    const c = pointAt(frame, (shape.fromAlong + shape.toAlong) / 2, shape.height * 2 * shape.direction);
    if (nearQuadratic(at, a, c, b, tolerance)) {
      best = i;
      bestVotes = data.votes[i];
    }
  }
  return best;
}

/** Is a point within `tolerance` of a quadratic curve? Sampled, not solved. */
function nearQuadratic(
  p: { x: number; y: number },
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  tolerance: number,
): boolean {
  // A cheap reject first: the curve never leaves the box its three points span.
  const minX = Math.min(a.x, b.x, c.x) - tolerance;
  const maxX = Math.max(a.x, b.x, c.x) + tolerance;
  const minY = Math.min(a.y, b.y, c.y) - tolerance;
  const maxY = Math.max(a.y, b.y, c.y) + tolerance;
  if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return false;

  const steps = 24;
  const limit = tolerance * tolerance;
  let px = a.x;
  let py = a.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
    const y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
    if (distanceToSegment(p, px, py, x, y) <= limit) return true;
    px = x;
    py = y;
  }
  return false;
}

/** Squared distance from a point to a segment. */
function distanceToSegment(
  p: { x: number; y: number },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - x1) * dx + (p.y - y1) * dy) / len : 0;
  t = Math.min(Math.max(t, 0), 1);
  const ox = p.x - (x1 + dx * t);
  const oy = p.y - (y1 + dy * t);
  return ox * ox + oy * oy;
}

/** Which chapter is under a position along the axis, for the tap-to-light. */
export function chapterAt(
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  at: { x: number; y: number },
): number | null {
  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  const along = (frame.orientation === 'horizontal' ? at.x : at.y) - frame.originAlong;
  const fraction = along / frame.along;
  if (fraction < 0 || fraction > 1) return null;

  // Walk the offsets for the chapter whose slot contains this fraction.
  const offsets = axis.offsets;
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= fraction) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export { chapterIndexAt };
