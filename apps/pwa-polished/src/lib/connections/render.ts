/**
 * Drawing the Connections picture.
 *
 * One canvas: the axis of all 1,189 chapters, and an arc for every
 * cross-reference over it. This is the real draw — the lab
 * (connections-lab.html) runs this module rather than a copy of it, so what is
 * tuned there is what the app shows.
 *
 * Each arc wears both books' colors crossed over: it leaves its source wearing
 * the color of where it is *going*, and lands wearing the color of where it
 * came *from*. That inversion is the whole legibility trick. An arc leaving
 * Genesis for Revelation lifts off Genesis in Revelation's cyan and touches
 * down in Revelation wearing Genesis's brown — so standing anywhere on the
 * axis, the colors arriving at your feet tell you where they came from, which
 * is the question a reader actually has. Coloring each end with its own book
 * would say nothing: everything leaving Genesis would be brown, and brown is
 * already what Genesis is.
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

/**
 * Every link's two feet as fractions along the axis, 0 to 1, kept between
 * frames.
 *
 * `fractionOf` is two binary searches and a division, and the draw loop wanted
 * it 689,598 times a frame — twice per link — which was the rest of the cost of
 * a pan. A verse's place along the axis depends only on the pack and the
 * spacing, so it is computed once per spacing and multiplied by the frame
 * length at stroke time. Float32 is plenty: the error is a fraction of a pixel
 * across a 1,189-chapter axis, and it halves the memory against Float64.
 */
interface FeetCache {
  width: ChapterWidth;
  fromAt: Float32Array;
  toAt: Float32Array;
}
const feetCache = new WeakMap<ConnectionsData, FeetCache>();

function feetFor(data: ConnectionsData, axis: Axis, width: ChapterWidth): FeetCache {
  const cached = feetCache.get(data);
  if (cached && cached.width === width) return cached;

  const fromAt = new Float32Array(data.count);
  const toAt = new Float32Array(data.count);
  for (let i = 0; i < data.count; i++) {
    fromAt[i] = fractionOf(axis, data.from[i]);
    toAt[i] = fractionOf(axis, data.toStart[i]);
  }
  const entry = { width, fromAt, toAt };
  feetCache.set(data, entry);
  return entry;
}

/**
 * The batches, kept between frames.
 *
 * This is the one that matters for a smooth pan. Sorting 344,799 links into
 * batches walks the whole set, binary-searches two book indexes per link and
 * pushes into 8,700 arrays — tens of milliseconds, and it was running on every
 * frame of a drag even though a pan cannot change which arcs share a gradient.
 * The grouping depends only on the data, the vote dials and the lit set; the
 * viewport, the pan and the zoom are applied later, at stroke time.
 */
interface BatchCache {
  floor: number;
  maxArcs: number;
  dimFloorOff: boolean;
  voteCurve: number;
  litKey: string;
  sorted: Batch[];
  skipped: number;
}
const batchCache = new WeakMap<ConnectionsData, BatchCache>();

/** A lit set as a comparable string, so a cache hit is a string compare. */
function litKeyOf(lit: Array<{ start: number; end: number }> | undefined): string {
  if (!lit?.length) return '';
  return lit.map((s) => `${s.start}-${s.end}`).join(',');
}

function batchesFor(
  data: ConnectionsData,
  config: ConnectionsConfig,
  lit: Array<{ start: number; end: number }> | undefined,
): { sorted: Batch[]; skipped: number } {
  const litKey = litKeyOf(lit);
  // dimFloor only changes the batching when it crosses zero, where dimmed arcs
  // stop being built at all; its exact value is a stroke-time alpha.
  const dimFloorOff = config.dimFloor <= 0;
  const cached = batchCache.get(data);
  if (
    cached &&
    cached.floor === config.voteFloor &&
    cached.maxArcs === config.maxArcs &&
    cached.dimFloorOff === dimFloorOff &&
    cached.voteCurve === config.voteCurve &&
    cached.litKey === litKey
  ) {
    return cached;
  }

  const starts = bookStarts(data);
  const { order, skipped: culled } = orderFor(data, config);
  let skipped = culled;

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
    const dim = !(isLit(lit, from) || isLit(lit, to));
    if (dim && dimFloorOff) {
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

  // Dimmed arcs go down first, so the lit ones read on top of them rather than
  // through them.
  const sorted = [...batches.values()].sort(
    (a, b) => Number(b.dim) - Number(a.dim) || a.step - b.step,
  );

  const entry: BatchCache = {
    floor: config.voteFloor,
    maxArcs: config.maxArcs,
    dimFloorOff,
    voteCurve: config.voteCurve,
    litKey,
    sorted,
    skipped,
  };
  batchCache.set(data, entry);
  return entry;
}

export function draw(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  options: DrawOptions,
): DrawStats {
  const t0 = performance.now();
  const { palette } = options;

  // Clear in device pixels, not CSS pixels. The caller has already scaled the
  // context by the device pixel ratio, so filling `view.width × view.height`
  // under an identity transform would wipe only the top-left 1/dpr of a
  // retina canvas and leave the rest of last frame behind — a sticky trail
  // smeared across every pan and zoom. `canvas.width/height` is the backing
  // store's real size, which is what needs covering.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();

  ctx.save();
  if (options.view) {
    const { x, y, k } = options.view;
    ctx.translate(view.width / 2, view.height / 2);
    ctx.scale(k, k);
    ctx.translate(-view.width / 2 + x, -view.height / 2 + y);
  }

  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  const { sorted, skipped: culled } = batchesFor(data, config, options.lit);
  const { fromAt, toAt } = feetFor(data, axis, config.width);
  // Arcs the vote floor, the cap and a dimFloor of 0 took out — so the
  // readout's count adds up to the whole set.
  let skipped = culled;

  // Everything the inner loop would otherwise recompute 344,799 times.
  const horizontal = frame.orientation === 'horizontal';
  const { originAlong, originAcross } = frame;
  const heightMin = config.heightMin;
  const heightRange = config.heightMax - config.heightMin;
  const splitSide = config.side === 'split';
  const sideSign: 1 | -1 = config.side === 'bottom' ? -1 : 1;

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
      // `arcShape` inlined, and the feet read from the cache: this body runs
      // 344,799 times a frame, so an object per arc and two binary searches per
      // foot are the difference between a pan that tracks the finger and one
      // that does not. The math is `arcShape`'s, kept in step with it.
      const fromAlong = fromAt[i] * frame.along;
      const toAlong = toAt[i] * frame.along;
      const span = Math.abs(toAlong - fromAlong) / frame.along;
      const curved = Math.pow(span < 0 ? 0 : span > 1 ? 1 : span, config.heightCurve);
      const height = frame.across * (heightMin + heightRange * curved);
      const direction = splitSide ? (data.toStart[i] >= data.from[i] ? 1 : -1) : sideSign;

      const a0 = originAlong + fromAlong;
      const b0 = originAlong + toAlong;
      const m0 = originAlong + (fromAlong + toAlong) / 2;
      // A quadratic reaches half its control height, so the control point goes
      // to twice the height wanted.
      const mc = originAcross - height * 2 * direction;

      if (horizontal) {
        ctx.moveTo(a0, originAcross);
        ctx.quadraticCurveTo(m0, mc, b0, originAcross);
      } else {
        ctx.moveTo(originAcross, a0);
        ctx.quadraticCurveTo(mc, m0, originAcross, b0);
      }
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
 * The gradient a batch is stroked with — crossed over, which is the point.
 *
 * The *target* book's color sits at the source end of the gradient and the
 * *source* book's color at the target end, so every arc leaves home wearing
 * where it is headed and arrives wearing where it set out from. See the file
 * header for why that way round.
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
  // Crossed on purpose: r1 is the TARGET's color and sits at the SOURCE end.
  const [r1, g1, b1] = BOOK_RGB[batch.toBook] ?? [138, 143, 152];
  const [r2, g2, b2] = BOOK_RGB[batch.fromBook] ?? [138, 143, 152];

  // A link inside one book is that book's own color either way round, and a
  // gradient between two identical colors is wasted work.
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

/** How long the longest chapter bar gets, in pixels off the axis. */
const BAR_MAX = 26;
/** The gap between the bars and the book names. */
const NAME_GAP = 6;
/** Room a sideways book name is given, in pixels across the axis. */
const NAME_BAND = 62;

/**
 * The axis: a bar per chapter, a tick at each book, and all 66 book names.
 *
 * The chapters are a bar graph pointing away from the arcs, each bar as long as
 * its chapter has verses — so Psalm 119 is the longest bar in the Bible at 176
 * verses and the one-verse chapters are stubs. That gives the axis a texture
 * you can navigate by: the Psalms are a comb, the genealogies are a plateau.
 *
 * The names are drawn in the book's own color, which is the legend: a reader
 * who sees brown arriving has brown "Genesis" somewhere under the other end.
 * Written sideways when the axis is horizontal, because 66 names laid flat need
 * about 2,600 pixels and a phone has 400 — upright they need 66 × 11, which
 * fits anywhere, so every book gets named instead of the back third of the New
 * Testament silently dropping off.
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

  // ── Chapter bars ───────────────────────────────────────────────────────
  //
  // Away from the arcs, so they never fight the picture. One path for all
  // 1,189 of them; the longest chapter in the Bible sets the scale, so the
  // bars mean the same thing whichever spacing the axis is in.
  let longest = 1;
  for (let i = 0; i < axis.chapterVerses.length; i++) {
    if (axis.chapterVerses[i] > longest) longest = axis.chapterVerses[i];
  }

  ctx.strokeStyle = palette.muted;
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let c = 0; c < axis.chapterStarts.length; c++) {
    const a0 = axis.offsets[c];
    const a1 = axis.offsets[c + 1];
    // The middle of the chapter's own slot, so a bar sits under its chapter
    // rather than on the boundary between two.
    const along = ((a0 + a1) / 2) * frame.along;
    const length = BAR_MAX * (axis.chapterVerses[c] / longest);
    const a = pointAt(frame, along, 0);
    const b = pointAt(frame, along, -length);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // ── The rule ───────────────────────────────────────────────────────────
  const start = pointAt(frame, 0, 0);
  const end = pointAt(frame, frame.along, 0);
  ctx.strokeStyle = palette.rule;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // ── A tick at every book boundary, past the bars so it reads as a divider ──
  ctx.strokeStyle = palette.rule;
  ctx.beginPath();
  for (const book of data.books) {
    const along = fractionOf(axis, book.start) * frame.along;
    const a = pointAt(frame, along, 2);
    const b = pointAt(frame, along, -(BAR_MAX + 3));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  if (!labels) return;

  // ── Book names ─────────────────────────────────────────────────────────
  //
  // Sideways on a horizontal axis and upright on a vertical one — either way
  // each name needs only its line height across the axis, so all 66 fit and
  // none has to be dropped or abbreviated.
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const base = BAR_MAX + NAME_GAP;

  data.books.forEach((book, i) => {
    const mid = fractionOf(axis, (book.start + book.end) / 2) * frame.along;
    const at = pointAt(frame, mid, -base);
    ctx.fillStyle = `rgba(${BOOK_RGB[i][0]}, ${BOOK_RGB[i][1]}, ${BOOK_RGB[i][2]}, 0.95)`;

    ctx.save();
    ctx.translate(at.x, at.y);
    if (horizontal) {
      // Reading bottom-to-top, which is the convention for a sideways axis
      // label and keeps the name's start at the axis end.
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
    } else {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
    }
    ctx.fillText(book.name, 0, 0);
    ctx.restore();
  });
}

/** How much room the axis furniture takes across the axis, in pixels. */
export function axisDepth(labels: boolean): number {
  return labels ? BAR_MAX + NAME_GAP + NAME_BAND : BAR_MAX + 4;
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
