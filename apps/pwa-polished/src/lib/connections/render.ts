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
 * Every arc is drawn the same: one width, one opacity. Votes decide only which
 * links are drawn at all (the vote floor and the cap), never how loud one is,
 * because a thick line covers the thin ones beneath it — weighting by votes
 * let a few favorites hide thousands of others. With every arc alike, a bright
 * band means many links, and nothing is hidden behind anything.
 *
 * Two things are done for the sake of drawing this many arcs at 60fps:
 *
 *   - Arcs are batched by the pair of books they join. A canvas gradient costs
 *     far more to build than a line does to stroke, so one gradient is built
 *     per book pair rather than per arc.
 *   - The strokes inside a batch are one path. Stroking 344,799 separate paths
 *     is most of the frame; stroking a few thousand is not.
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
  type Axis,
  type ChapterWidth,
  type ConnectionsConfig,
  type Frame,
  type Viewport,
} from './layout';
import { BOOK_RGB, bookIndexAt, type ConnectionsPalette } from './palette';
import { inSpans, type FlightFrame, type Span } from './lights';

/** Pan and zoom: the picture is scaled by `k` around the canvas centre and moved by x/y. */
export interface Pan {
  x: number;
  y: number;
  k: number;
}

/** What one draw needs beyond the data and the dials. */
export interface DrawOptions {
  palette: ConnectionsPalette;
  /**
   * The lit set, as verse positions: only arcs with a foot inside one of these
   * spans are drawn, and the rest are hidden. Empty or absent means everything
   * is lit, which is the resting state.
   */
  lit?: Span[];
  /**
   * The volley in the air, if one is. Absent or settled means every arc has
   * landed and the draw skips the flight arithmetic entirely.
   */
  flight?: FlightFrame;
  /** Draw the book names and the chapter numbers. */
  labels?: boolean;
  /** Pan and zoom, applied around the canvas centre. */
  view?: Pan;
}

/** A book name as it was placed on screen, so a tap on it can find its book. */
export interface PlacedName {
  book: number;
  /** Its extent along the axis, in screen pixels. */
  from: number;
  to: number;
}

/** What a draw reports back, for the lab's readout. */
export interface DrawStats {
  /** Arcs actually stroked, whole or in flight. */
  drawn: number;
  /** Arcs not drawn: below the vote floor, past the cap, unlit, or not yet launched. */
  skipped: number;
  /** Of the drawn, how many are still in the air. */
  flying: number;
  /** How many gradient batches it took. */
  batches: number;
  /** Milliseconds spent in this draw. */
  ms: number;
  /** Where the book names landed, for tapping them. */
  names: PlacedName[];
}

/**
 * The book-start positions, as the draw loop wants them: an Int32Array, so
 * finding an arc's book is a binary search over numbers. Cached per data set:
 * these never change while a pack is loaded.
 */
const bookStartsCache = new WeakMap<ConnectionsData, Int32Array>();
function bookStarts(data: ConnectionsData): Int32Array {
  let cached = bookStartsCache.get(data);
  if (!cached) {
    const starts = new Int32Array(data.books.length);
    data.books.forEach((b, i) => {
      starts[i] = b.start;
    });
    bookStartsCache.set(data, starts);
    cached = starts;
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
    // The cap keeps the most-voted links: a reader who asks for 20,000 arcs out
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

/** One batch of arcs: every link from one book to another, sharing one gradient and one path. */
interface Batch {
  fromBook: number;
  toBook: number;
  indexes: number[];
}

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
 * Sorting 344,799 links into batches walks the whole set and binary-searches
 * two book indexes per link — tens of milliseconds, and a pan, a zoom or a
 * volley in flight cannot change which arcs share a gradient. So the grouping
 * depends only on the data, the vote dials and the lit set, and everything
 * else is applied at stroke time.
 *
 * `lo`/`hi` are the first and last source verse in the set, which is what a
 * volley's launch order is measured across.
 */
interface BatchCache {
  floor: number;
  maxArcs: number;
  litKey: string;
  sorted: Batch[];
  skipped: number;
  lo: number;
  hi: number;
}
const batchCache = new WeakMap<ConnectionsData, BatchCache>();

/** A lit set as a comparable string, so a cache hit is a string compare. */
function litKeyOf(lit: Span[] | undefined): string {
  if (!lit?.length) return '';
  return lit.map((s) => `${s.start}-${s.end}`).join(',');
}

function batchesFor(data: ConnectionsData, config: ConnectionsConfig, spans: Span[] | undefined): BatchCache {
  const litKey = litKeyOf(spans);
  const cached = batchCache.get(data);
  if (
    cached &&
    cached.floor === config.voteFloor &&
    cached.maxArcs === config.maxArcs &&
    cached.litKey === litKey
  ) {
    return cached;
  }

  const starts = bookStarts(data);
  const { order, skipped: culled } = orderFor(data, config);
  let skipped = culled;
  let lo = Infinity;
  let hi = -Infinity;

  const batches = new Map<number, Batch>();
  const total = order.length;
  for (let n = 0; n < total; n++) {
    const i = order[n];
    const from = data.from[i];
    const to = data.toStart[i];
    // An arc counts as lit if either foot is in the lit set, so a tapped book
    // shows what it reaches and what reaches it. Unlit arcs are not drawn.
    if (!(inSpans(spans, from) || inSpans(spans, to))) {
      skipped++;
      continue;
    }
    if (from < lo) lo = from;
    if (from > hi) hi = from;

    const fromBook = bookIndexAt(starts, from);
    const toBook = bookIndexAt(starts, to);
    const key = fromBook * 66 + toBook;
    let batch = batches.get(key);
    if (!batch) {
      batch = { fromBook, toBook, indexes: [] };
      batches.set(key, batch);
    }
    batch.indexes.push(i);
  }

  const entry: BatchCache = {
    floor: config.voteFloor,
    maxArcs: config.maxArcs,
    litKey,
    sorted: [...batches.values()],
    skipped,
    lo: Number.isFinite(lo) ? lo : 0,
    hi: Number.isFinite(hi) ? hi : 0,
  };
  batchCache.set(data, entry);
  return entry;
}

/** The heads of arcs in flight, reused between frames: x, y pairs. */
let heads = new Float32Array(4096);

/** The arrowhead on an arc in flight, in screen pixels. */
const HEAD_RADIUS = 1.8;
/** The most arrowheads a volley shows, so the dots stay dots. */
const HEAD_LIMIT = 4000;

export function draw(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  options: DrawOptions,
): DrawStats {
  const t0 = performance.now();
  const { palette } = options;
  const k = options.view?.k ?? 1;

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
    const { x, y } = options.view;
    ctx.translate(view.width / 2, view.height / 2);
    ctx.scale(k, k);
    ctx.translate(-view.width / 2 + x, -view.height / 2 + y);
  }

  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  const lit = options.flight ? options.flight.spans : options.lit;
  const { sorted, skipped: culled, lo, hi } = batchesFor(data, config, lit);
  const { fromAt, toAt } = feetFor(data, axis, config.width);
  let skipped = culled;

  // Everything the inner loop would otherwise recompute 344,799 times.
  const horizontal = frame.orientation === 'horizontal';
  const { originAlong, originAcross } = frame;
  const heightMin = config.heightMin;
  const heightRange = config.heightMax - config.heightMin;
  const splitSide = config.side === 'split';
  const sideSign: 1 | -1 = config.side === 'bottom' ? -1 : 1;

  // The volley, if one is in the air. Each arc launches at its source's place
  // in the lit set — Genesis first — and then flies for `flightMs`.
  const volley = options.flight && !options.flight.settled ? options.flight.volley : null;
  const elapsed = options.flight?.elapsedMs ?? 0;
  const staggerMs = volley ? Math.max(volley.staggerMs, 0) : 0;
  const flightMs = volley ? Math.max(volley.flightMs, 1) : 1;
  const launchSpan = hi - lo;
  let headCount = 0;
  // A head on every arc in the air is a white blanket once the whole Bible
  // flies — 190,000 dots mid-opening. So only every `headEvery`th arc wears
  // one, chosen so a volley never shows more than about HEAD_LIMIT at once.
  let inSet = 0;
  for (const batch of sorted) inSet += batch.indexes.length;
  const headEvery = Math.max(1, Math.ceil(inSet / HEAD_LIMIT));

  // One width for every arc, held in screen pixels: dividing by the zoom keeps
  // a hairline a hairline at 30×, instead of swelling until it covers its
  // neighbors.
  ctx.lineWidth = config.thickness / k;
  ctx.lineCap = 'round';
  const alpha = Math.min(Math.max(config.opacity, 0), 1);

  let drawn = 0;
  let flying = 0;
  if (alpha > 0.002) {
    for (const batch of sorted) {
      ctx.strokeStyle = gradientFor(ctx, axis, frame, config, data, batch, alpha);
      ctx.beginPath();
      for (const i of batch.indexes) {
        // How far this arc has flown, 0 to 1. Worked out first, because an arc
        // still waiting to launch costs nothing else.
        let p = 1;
        if (volley) {
          const rank = launchSpan > 0 ? (data.from[i] - lo) / launchSpan : 0;
          p = (elapsed - staggerMs * rank) / flightMs;
          if (p <= 0) {
            skipped++;
            continue;
          }
        }

        // `arcShape` inlined, and the feet read from the cache: this body runs
        // 344,799 times a frame, so an object per arc and two binary searches
        // per foot are the difference between a pan that tracks the finger and
        // one that does not. The math is `arcShape`'s, kept in step with it.
        const fromAlong = fromAt[i] * frame.along;
        const toAlong = toAt[i] * frame.along;
        const span = Math.abs(toAlong - fromAlong) / frame.along;
        const curved = Math.pow(span < 0 ? 0 : span > 1 ? 1 : span, config.heightCurve);
        const height = frame.across * (heightMin + heightRange * curved);
        const direction = splitSide ? (data.toStart[i] >= data.from[i] ? 1 : -1) : sideSign;

        const a0 = originAlong + fromAlong;
        const b0 = originAlong + toAlong;
        const m0 = originAlong + (fromAlong + toAlong) / 2;
        // A quadratic reaches half its control height, so the control point
        // goes to twice the height wanted.
        const mc = originAcross - height * 2 * direction;

        if (p < 1) {
          // In flight: the front part of the same curve, cut at p. The first
          // control point slides along the first leg and the end is the curve's
          // own point at p — de Casteljau's split — so the drawn piece lies
          // exactly on the arc it will become.
          const u = 1 - p;
          const qa = a0 + (m0 - a0) * p;
          const qc = originAcross + (mc - originAcross) * p;
          const ea = u * u * a0 + 2 * u * p * m0 + p * p * b0;
          const ec = u * u * originAcross + 2 * u * p * mc + p * p * originAcross;
          if (horizontal) {
            ctx.moveTo(a0, originAcross);
            ctx.quadraticCurveTo(qa, qc, ea, ec);
          } else {
            ctx.moveTo(originAcross, a0);
            ctx.quadraticCurveTo(qc, qa, ec, ea);
          }
          if (i % headEvery === 0) {
            if (headCount * 2 + 2 > heads.length) {
              const grown = new Float32Array(heads.length * 2);
              grown.set(heads);
              heads = grown;
            }
            heads[headCount * 2] = horizontal ? ea : ec;
            heads[headCount * 2 + 1] = horizontal ? ec : ea;
            headCount++;
          }
          flying++;
        } else if (horizontal) {
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
  } else {
    for (const batch of sorted) skipped += batch.indexes.length;
  }

  // The dots at the front of every arc still flying: the arrowheads. One path,
  // drawn over the arcs so each reads as pulling its line behind it. Past a few
  // thousand they are squares, which are far cheaper than circles and look the
  // same at this size.
  if (headCount > 0) {
    const r = HEAD_RADIUS / k;
    ctx.fillStyle = palette.text;
    ctx.beginPath();
    if (headCount <= HEAD_LIMIT) {
      for (let n = 0; n < headCount; n++) {
        const x = heads[n * 2];
        const y = heads[n * 2 + 1];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    } else {
      for (let n = 0; n < headCount; n++) ctx.rect(heads[n * 2] - r, heads[n * 2 + 1] - r, r * 2, r * 2);
    }
    ctx.fill();
  }

  ctx.restore();

  // The ruler is drawn in screen space, after the zoom is undone: see drawRuler.
  const names = drawRuler(ctx, data, axis, frame, config, palette, view, options.view, options.labels !== false);

  return { drawn, skipped, flying, batches: sorted.length, ms: performance.now() - t0, names };
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

// ── The ruler ────────────────────────────────────────────────────────────

/** How long the longest chapter bar gets, in screen pixels off the rule. */
const BAR_MAX = 58;
/** How far a book divider reaches past the rule, on the arcs' side. */
const BOOK_NOTCH = 5;
/**
 * The curve verse counts are drawn through, as an exponent.
 *
 * Straight proportion wastes the ruler. Psalm 119's 176 verses is an outlier —
 * the median chapter is about 25 verses, so on a linear scale half the Bible
 * is squeezed into the bottom seventh of the bar height and reads as a flat
 * fuzz. A square root spends the height where the chapters actually are: 25
 * verses reaches 38% of full rather than 14%, while 176 still stands clearly
 * tallest. The ordering is untouched, since a root is monotonic.
 */
const BAR_CURVE = 0.5;
/** The shortest bar, so a one-verse chapter is still a mark and not a gap. */
const BAR_MIN = 2;
/**
 * How strongly a chapter bar wears its book's color. The number tags at the
 * tips are full strength, so they stand out as the thing to read.
 */
const BAR_ALPHA = 0.7;
/** The gap between the bars and the book names. */
const NAME_GAP = 8;
/** The most letters a book name stacks: "1 Thessalonians" and "Song of Solomon". */
const NAME_LETTERS = 15;
/**
 * How many chapters' worth of room a number tag may take, by rank: a round
 * number (1 and the tens) may be ten slots wide, a five five slots, and any
 * other three — so the staircase of tags stays a few steps deep and the round
 * numbers show first as you zoom in.
 */
const TAG_SHARE = [10, 5, 3];
/**
 * The narrowest chapter that gets a number at all, in screen pixels. Below
 * this the round-number rule alone sprinkled stray 1s and 20s along the
 * resting ruler, where nothing can be read anyway; at rest only Psalm 119 is
 * this wide.
 */
const NUMBER_MIN_SLOT = 4;

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** One step down a stacked name: a capital's height plus air. */
function nameStep(config: ConnectionsConfig): number {
  return config.nameSize;
}

/** How much room the ruler takes across the axis, in screen pixels. */
export function axisDepth(labels: boolean, config: ConnectionsConfig): number {
  return labels ? BAR_MAX + NAME_GAP + NAME_LETTERS * nameStep(config) + 4 : BAR_MAX + 4;
}

/** Relative luminance, 0 for black to 1 for white. */
function luminanceOf([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The luminance where black and white give equal contrast. Only the two
 * darkest categories — the major prophets and Paul — fall under it.
 */
const DARK_COLOR = 0.179;

/** The text color for a book color: black, unless the color is too dark to read black on. */
function inkOn(color: [number, number, number]): string {
  return luminanceOf(color) > DARK_COLOR ? '#000' : '#fff';
}

/**
 * A book's color as name text. On a dark background the two darkest colors
 * are lifted part way to white — the major prophets' deep purple is barely
 * there as thin letters on near-black — while staying recognizably theirs.
 */
function nameColor(color: [number, number, number], palette: ConnectionsPalette): string {
  if (palette.pale || luminanceOf(color) > DARK_COLOR) return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
  const lift = (c: number) => Math.round(c + (255 - c) * 0.4);
  return `rgb(${lift(color[0])}, ${lift(color[1])}, ${lift(color[2])})`;
}

/**
 * Where the ruler sits on screen.
 *
 * Under the rule while the rule is on screen, and pinned to the bottom edge
 * once zooming or panning carries the rule off it — so the chapter bars and the
 * book names are always in view to steer by. `rule` is the screen coordinate
 * across the axis (y for a horizontal axis), and the ruler hangs `depth` past it.
 */
export function rulerAt(
  view: Viewport,
  config: ConnectionsConfig,
  labels: boolean,
  pan?: Pan,
): { rule: number; depth: number; pinned: boolean } {
  const frame = frameFor(view, config);
  const horizontal = frame.orientation === 'horizontal';
  const k = pan?.k ?? 1;
  const size = horizontal ? view.height : view.width;
  const shift = (horizontal ? pan?.y : pan?.x) ?? 0;
  const natural = size / 2 + k * (frame.originAcross + shift - size / 2);
  const depth = axisDepth(labels, config);
  const rule = Math.max(0, Math.min(natural, size - depth - 2));
  return { rule, depth, pinned: Math.abs(rule - natural) > 0.5 };
}

/** The chapter whose slot holds a fraction along the axis. */
function chapterAtFraction(offsets: Float64Array, fraction: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= fraction) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The ruler: a bar per chapter, a number tag at each bar's tip, a divider at
 * every book, and the 66 book names.
 *
 * Drawn in screen pixels, not in the zoomed picture. Zooming widens the
 * chapters — that is what the reader zooms for — but the bars keep their
 * length, the numbers and names keep a readable size, and the whole ruler stays
 * on screen. Drawn inside the zoom, a 30× view put the names 1,700 pixels below
 * the bottom edge and shrank the text to nothing.
 *
 * Returns where the names landed, so a tap on a name can light its book.
 */
function drawRuler(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  axis: Axis,
  frame: Frame,
  config: ConnectionsConfig,
  palette: ConnectionsPalette,
  view: Viewport,
  pan: Pan | undefined,
  labels: boolean,
): PlacedName[] {
  const horizontal = frame.orientation === 'horizontal';
  const k = pan?.k ?? 1;
  const alongSize = horizontal ? view.width : view.height;
  const acrossSize = horizontal ? view.height : view.width;
  const shiftAlong = (horizontal ? pan?.x : pan?.y) ?? 0;
  const { rule, depth } = rulerAt(view, config, labels, pan);

  // A fraction of the axis to a screen coordinate along it, and back.
  const toScreen = (f: number) =>
    alongSize / 2 + k * (frame.originAlong + f * frame.along + shiftAlong - alongSize / 2);
  const toFraction = (s: number) =>
    ((s - alongSize / 2) / k + alongSize / 2 - shiftAlong - frame.originAlong) / frame.along;

  // An along/across rectangle as a canvas one. `c` counts away from the arcs.
  const rect = (a: number, c: number, la: number, lc: number) => {
    if (horizontal) ctx.rect(a, rule + c, la, lc);
    else ctx.rect(rule + c, a, lc, la);
  };
  const line = (a: number, c0: number, c1: number) => {
    if (horizontal) {
      ctx.moveTo(a, rule + c0);
      ctx.lineTo(a, rule + c1);
    } else {
      ctx.moveTo(rule + c0, a);
      ctx.lineTo(rule + c1, a);
    }
  };

  // The ruler's own ground, so arcs under a pinned ruler don't show through it.
  ctx.fillStyle = palette.bg;
  ctx.beginPath();
  rect(0, 0, alongSize, Math.min(depth + 2, acrossSize - rule));
  ctx.fill();

  // Only the chapters on screen are drawn.
  const offsets = axis.offsets;
  const chapters = offsets.length - 1;
  const startF = toFraction(0);
  const endF = toFraction(alongSize);
  if (endF < 0 || startF > 1) return [];
  const firstVisible = chapterAtFraction(offsets, Math.max(startF, 0));
  const lastVisible = Math.min(chapters - 1, chapterAtFraction(offsets, Math.min(endF, 1)));

  let longest = 1;
  for (let i = 0; i < axis.chapterVerses.length; i++) {
    if (axis.chapterVerses[i] > longest) longest = axis.chapterVerses[i];
  }
  const barLength = (c: number) =>
    BAR_MIN + (BAR_MAX - BAR_MIN) * Math.pow(axis.chapterVerses[c] / longest, BAR_CURVE);
  const fill = Math.min(Math.max(config.barFill, 0.05), 1);

  const bookOf = (c: number) => {
    let lo = 0;
    let hi = data.books.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (axis.bookFirstChapter[mid] <= c) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const firstBook = bookOf(firstVisible);
  const lastBook = bookOf(lastVisible);

  // ── Chapter bars, one path per book in that book's color ───────────────
  for (let b = firstBook; b <= lastBook; b++) {
    const from = Math.max(axis.bookFirstChapter[b], firstVisible);
    const to = Math.min(axis.bookFirstChapter[b + 1] - 1, lastVisible);
    if (to < from) continue;
    const [r, g, bl] = BOOK_RGB[b] ?? [138, 143, 152];
    ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${BAR_ALPHA})`;
    ctx.beginPath();
    for (let c = from; c <= to; c++) {
      const s0 = toScreen(offsets[c]);
      const s1 = toScreen(offsets[c + 1]);
      // A gap between bars once there is room for one; never under a pixel.
      const w = Math.max(1, (s1 - s0) * fill);
      rect((s0 + s1) / 2 - w / 2, 1, w, barLength(c));
    }
    ctx.fill();
  }

  // ── The rule, and a divider at every book ──────────────────────────────
  //
  // The dividers run the full depth of the ruler, through the bars and down
  // past the names, so which bars belong to which name is never a guess.
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = palette.rule;
  ctx.beginPath();
  const ruleFrom = Math.max(toScreen(0), 0);
  const ruleTo = Math.min(toScreen(1), alongSize);
  if (horizontal) {
    ctx.moveTo(ruleFrom, rule + 0.5);
    ctx.lineTo(ruleTo, rule + 0.5);
  } else {
    ctx.moveTo(rule + 0.5, ruleFrom);
    ctx.lineTo(rule + 0.5, ruleTo);
  }
  ctx.stroke();

  ctx.strokeStyle = palette.muted;
  ctx.beginPath();
  for (let b = firstBook; b <= lastBook + 1 && b <= data.books.length; b++) {
    const s = Math.round(toScreen(offsets[axis.bookFirstChapter[b]])) + 0.5;
    if (s < -1 || s > alongSize + 1) continue;
    line(s, -BOOK_NOTCH, labels ? depth : BAR_MAX + 2);
  }
  ctx.stroke();

  if (!labels) return [];

  // ── Chapter numbers, on tags at the bars' tips ─────────────────────────
  //
  // Each number sits on a tag of its book's full color at the tip of its own
  // bar, in black (white on the two darkest colors). Bars differ in length, so
  // neighboring tips are already at different heights and most numbers clear
  // each other without help. Where two would still touch, the later one climbs
  // its own bar toward the rule until it is clear, and if the bar has no room
  // left it goes unnumbered rather than floating loose.
  //
  // They grow a little as you zoom in, and stay in screen pixels so a deep
  // zoom can't blow them up past the ruler.
  const spread = Math.max(k * Math.max(config.stretch, 0.1), 1);
  const numberFont = config.numberSize * Math.min(1.6, 1 + 0.15 * Math.log2(spread));
  ctx.font = `bold ${numberFont}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const digitWidth = [0, 1, 2, 3].map((d) => (d ? ctx.measureText('0'.repeat(d)).width : 0));

  // Every visible chapter that has room for a number, with how much it matters.
  // When there isn't room for all of them, the round ones go first — chapter
  // 1, the tens, then the fives — so a sparse ruler reads 1, 10, 20, 30 like a
  // ruler does, not as a scatter of whichever numbers happened to fit. Each
  // rank needs less room per chapter than the next: a ten only has to share
  // its stretch with nine neighbors, so it can show where the ones cannot.
  const wanted: Array<{ c: number; book: number; rank: number; s0: number; s1: number; text: string; la: number; lc: number }> = [];
  for (let b = firstBook; b <= lastBook; b++) {
    const first = axis.bookFirstChapter[b];
    const from = Math.max(first, firstVisible);
    const to = Math.min(axis.bookFirstChapter[b + 1] - 1, lastVisible);
    for (let c = from; c <= to; c++) {
      const s0 = toScreen(offsets[c]);
      const s1 = toScreen(offsets[c + 1]);
      const n = c - first + 1;
      const text = String(n);
      const textWidth = digitWidth[text.length] ?? ctx.measureText(text).width;
      // The tag's size along and across the axis. On a vertical axis the
      // number still reads left to right, so the two swap.
      const la = horizontal ? textWidth + 5 : numberFont + 3;
      const lc = horizontal ? numberFont + 3 : textWidth + 5;
      const rank = n === 1 || n % 10 === 0 ? 0 : n % 5 === 0 ? 1 : 2;
      if (s1 - s0 < NUMBER_MIN_SLOT || (s1 - s0) * TAG_SHARE[rank] < la) continue;
      wanted.push({ c, book: b, rank, s0, s1, text, la, lc });
    }
  }
  wanted.sort((x, y) => x.rank - y.rank || x.c - y.c);

  // Placed tags, filed by where they sit along the axis so a clash test only
  // looks at its neighbors.
  const BUCKET = 48;
  const filed = new Map<number, Array<{ a0: number; a1: number; c0: number; c1: number }>>();
  const clashes = (a0: number, a1: number, c0: number, c1: number) => {
    for (let k = Math.floor((a0 - 1) / BUCKET); k <= Math.floor((a1 + 1) / BUCKET); k++) {
      const list = filed.get(k);
      if (list?.some((t) => t.a1 > a0 - 1 && t.a0 < a1 + 1 && t.c1 > c0 - 1 && t.c0 < c1 + 1)) return true;
    }
    return false;
  };
  const tags: Array<{ book: number; a: number; c: number; la: number; lc: number; text: string }> = [];

  for (const w of wanted) {
    const mid = (w.s0 + w.s1) / 2;
    const a0 = mid - w.la / 2;
    const a1 = mid + w.la / 2;
    // Start with the tag's far edge on the bar's tip — or, for a bar shorter
    // than its tag, as the bar's own continuation — and climb toward the rule.
    let c0 = Math.max(barLength(w.c), w.lc + 1) - w.lc;
    while (c0 >= 1 && clashes(a0, a1, c0, c0 + w.lc)) c0 -= w.lc + 1;
    if (c0 < 1) continue;
    const box = { a0, a1, c0, c1: c0 + w.lc };
    for (let k = Math.floor(a0 / BUCKET); k <= Math.floor(a1 / BUCKET); k++) {
      const list = filed.get(k);
      if (list) list.push(box);
      else filed.set(k, [box]);
    }
    tags.push({ book: w.book, a: a0, c: c0, la: w.la, lc: w.lc, text: w.text });
  }

  // Drawn a book at a time: one path of tags in its color, then its numbers.
  tags.sort((x, y) => x.book - y.book);
  for (let start = 0; start < tags.length; ) {
    let end = start;
    while (end < tags.length && tags[end].book === tags[start].book) end++;
    const color = BOOK_RGB[tags[start].book] ?? [138, 143, 152];
    ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.beginPath();
    for (let i = start; i < end; i++) rect(tags[i].a, tags[i].c, tags[i].la, tags[i].lc);
    ctx.fill();
    ctx.fillStyle = inkOn(color);
    for (let i = start; i < end; i++) {
      const t = tags[i];
      const along = t.a + t.la / 2;
      const across = rule + t.c + t.lc / 2 + 0.5;
      if (horizontal) ctx.fillText(t.text, along, across);
      else ctx.fillText(t.text, across, along);
    }
    start = end;
  }

  // ── Book names ─────────────────────────────────────────────────────────
  //
  // Bold capitals, one upright letter under the next, with a word's space kept
  // as a gap. Each name sits in the middle of the part of its book that is on
  // screen, so panning along a long book keeps its name in view rather than
  // leaving it at a center that has scrolled away.
  //
  // Where two names would collide the wider book wins — at rest the twelve
  // minor prophets share about forty pixels and can't all be named — and the
  // rest appear as you zoom in and they get room.
  const step = nameStep(config);
  ctx.font = `bold ${config.nameSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  const top = BAR_MAX + NAME_GAP;
  // A column is the widest capital plus a little air.
  const column = horizontal ? ctx.measureText('W').width + 3 : config.nameSize + 3;

  const candidates: Array<{ book: number; mid: number; room: number }> = [];
  for (let b = firstBook; b <= lastBook; b++) {
    const s0 = Math.max(toScreen(offsets[axis.bookFirstChapter[b]]), 0);
    const s1 = Math.min(toScreen(offsets[axis.bookFirstChapter[b + 1]]), alongSize);
    if (s1 <= s0) continue;
    candidates.push({ book: b, mid: (s0 + s1) / 2, room: s1 - s0 });
  }
  candidates.sort((x, y) => y.room - x.room);

  const names: PlacedName[] = [];
  for (const n of candidates) {
    const from = n.mid - column / 2;
    const to = n.mid + column / 2;
    if (names.some((p) => p.to > from && p.from < to)) continue;
    names.push({ book: n.book, from, to });

    const name = data.books[n.book].name.toUpperCase();
    // The dividers run through the name band, so a name sitting over one is
    // given its own ground first — otherwise a short book's name is struck
    // through by the lines either side of it.
    ctx.fillStyle = palette.bg;
    ctx.beginPath();
    if (horizontal) rect(from, top, column, name.length * step);
    else rect(n.mid - column / 2, top, column, ctx.measureText(name).width);
    ctx.fill();
    ctx.fillStyle = nameColor(BOOK_RGB[n.book] ?? [138, 143, 152], palette);
    if (horizontal) {
      ctx.textAlign = 'center';
      for (let i = 0; i < name.length; i++) {
        if (name[i] === ' ') continue;
        ctx.fillText(name[i], n.mid, rule + top + i * step + step / 2);
      }
    } else {
      // A vertical axis runs down the screen already, so the name reads across
      // it as an ordinary word.
      ctx.textAlign = 'left';
      ctx.fillText(name, rule + top, n.mid);
    }
  }
  return names;
}

/**
 * What a tap on the ruler landed on: a book name, a chapter, or nothing.
 *
 * `at` is in screen pixels. A tap a little above the rule still counts as the
 * ruler (`grab` pixels of it): every arc has a foot on the rule, so right
 * above it they are packed shoulder to shoulder — measured over the real set,
 * a tap within 40px of the rule hits some arc every time — and a tap there is
 * aimed at the chapter, never at one hairline among thousands.
 */
export function rulerHit(
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  pan: Pan | undefined,
  labels: boolean,
  names: PlacedName[],
  at: { x: number; y: number },
  grab: number,
): { kind: 'chapter'; chapter: number } | { kind: 'book'; book: number } | null {
  const frame = frameFor(view, config);
  const horizontal = frame.orientation === 'horizontal';
  const { rule, depth } = rulerAt(view, config, labels, pan);
  const across = (horizontal ? at.y : at.x) - rule;
  const along = horizontal ? at.x : at.y;
  if (across < -grab || across > depth) return null;

  if (labels && across >= BAR_MAX + NAME_GAP / 2) {
    const name = names.find((n) => along >= n.from - 4 && along <= n.to + 4);
    if (name) return { kind: 'book', book: name.book };
  }

  const chapter = chapterAtScreen(data, config, view, pan, at);
  return chapter === null ? null : { kind: 'chapter', chapter };
}

/**
 * The chapter under a screen point, going by its place along the axis alone —
 * for a range drag, which picks chapters wherever the finger is.
 */
export function chapterAtScreen(
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  pan: Pan | undefined,
  at: { x: number; y: number },
): number | null {
  const frame = frameFor(view, config);
  const horizontal = frame.orientation === 'horizontal';
  const k = pan?.k ?? 1;
  const alongSize = horizontal ? view.width : view.height;
  const shift = (horizontal ? pan?.x : pan?.y) ?? 0;
  const along = horizontal ? at.x : at.y;
  const fraction = ((along - alongSize / 2) / k + alongSize / 2 - shift - frame.originAlong) / frame.along;
  if (fraction < 0 || fraction > 1) return null;
  return chapterAtFraction(axisFor(data, config.width).offsets, fraction);
}

/**
 * Which arc is under a tap, or null. `at` is in the picture's own coordinates.
 *
 * Only arcs that are actually drawn can be picked — the vote floor, the cap and
 * the lit set all apply — so a tap never finds a hidden arc. Walked rather than
 * indexed: a tap happens once, and the alternative is keeping a spatial index
 * of 344,799 curves up to date through every pan, zoom and dial change. Of
 * several arcs under the finger the most-voted wins.
 */
export function pick(
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  at: { x: number; y: number },
  tolerance = 6,
  lit?: Span[],
): number | null {
  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  const { sorted } = batchesFor(data, config, lit);
  let best: number | null = null;
  let bestVotes = -Infinity;

  for (const batch of sorted) {
    for (const i of batch.indexes) {
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

export { chapterIndexAt };
