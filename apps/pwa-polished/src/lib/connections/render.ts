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
import { BOOK_RGB, bookIndexAt, rgbOf, type ConnectionsPalette } from './palette';
import { inSpans, type FlightFrame, type Span } from './lights';
import type { SetLayer } from './sets';

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
  /**
   * The shown sets. When present only arcs touching a set are drawn, each in
   * its set's color instead of the book colors. Null or absent draws as usual.
   */
  sets?: SetLayer | null;
  /**
   * The picked link, drawn again over everything with a halo so it stands out.
   * Nothing else is hidden or dimmed for it. A saved image never passes one.
   */
  selected?: number | null;
  /** The link under the mouse, drawn with a fainter halo than a picked one. */
  hovered?: number | null;
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

/**
 * One batch of arcs: every link from one book to another, sharing one gradient
 * and one path — or, with sets shown, every arc wearing one set's color.
 */
interface Batch {
  /** The two books, or -1 for a set's batch. */
  fromBook: number;
  toBook: number;
  /** The set this batch is colored by, or -1 for book colors. */
  set: number;
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
  fill: number;
  fromAt: Float32Array;
  toAt: Float32Array;
}
const feetCache = new WeakMap<ConnectionsData, FeetCache>();

function feetFor(data: ConnectionsData, axis: Axis, width: ChapterWidth, fill: number): FeetCache {
  const cached = feetCache.get(data);
  if (cached && cached.width === width && cached.fill === fill) return cached;

  const fromAt = new Float32Array(data.count);
  const toAt = new Float32Array(data.count);
  for (let i = 0; i < data.count; i++) {
    fromAt[i] = fractionOf(axis, data.from[i], fill);
    toAt[i] = fractionOf(axis, data.toStart[i], fill);
  }
  const entry = { width, fill, fromAt, toAt };
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
  sets: SetLayer | null;
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

function batchesFor(
  data: ConnectionsData,
  config: ConnectionsConfig,
  spans: Span[] | undefined,
  sets: SetLayer | null = null,
): BatchCache {
  const litKey = litKeyOf(spans);
  const cached = batchCache.get(data);
  if (
    cached &&
    cached.floor === config.voteFloor &&
    cached.maxArcs === config.maxArcs &&
    cached.litKey === litKey &&
    cached.sets === sets
  ) {
    return cached;
  }

  const starts = bookStarts(data);
  const { order, skipped: culled } = orderFor(data, config);
  let skipped = culled;
  let lo = Infinity;
  let hi = -Infinity;

  const batches = new Map<number, Batch>();
  const mask = sets?.mask ?? null;
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

    // With sets shown, an arc touching none is hidden, and one touching two
    // wears the set higher in the list — the mask already holds the first set
    // at each verse, so the arc's is the lower of its two feet's.
    if (mask) {
      const a = mask[from] ?? -1;
      const b = mask[to] ?? -1;
      const set = a < 0 ? b : b < 0 ? a : Math.min(a, b);
      if (set < 0) {
        skipped++;
        continue;
      }
      if (from < lo) lo = from;
      if (from > hi) hi = from;
      let batch = batches.get(set);
      if (!batch) {
        batch = { fromBook: -1, toBook: -1, set, indexes: [] };
        batches.set(set, batch);
      }
      batch.indexes.push(i);
      continue;
    }

    if (from < lo) lo = from;
    if (from > hi) hi = from;

    const fromBook = bookIndexAt(starts, from);
    const toBook = bookIndexAt(starts, to);
    const key = fromBook * 66 + toBook;
    let batch = batches.get(key);
    if (!batch) {
      batch = { fromBook, toBook, set: -1, indexes: [] };
      batches.set(key, batch);
    }
    batch.indexes.push(i);
  }

  const entry: BatchCache = {
    floor: config.voteFloor,
    maxArcs: config.maxArcs,
    litKey,
    sets,
    // Sets in reverse, so the first in the list is stroked last and lies on top.
    sorted: mask ? [...batches.values()].sort((x, y) => y.set - x.set) : [...batches.values()],
    skipped,
    lo: Number.isFinite(lo) ? lo : 0,
    hi: Number.isFinite(hi) ? hi : 0,
  };
  batchCache.set(data, entry);
  return entry;
}

/**
 * The heads of arcs in flight, reused between frames: x, y pairs, and what
 * each wears — its source book, or SET_HEAD plus its set.
 */
let heads = new Float32Array(4096);
let headBooks = new Uint8Array(2048);
/** The most arrowheads a volley shows, so the dots stay dots. */
const HEAD_LIMIT = 4000;
/** Where set colors start in `headBooks`, past the 66 books. */
const SET_HEAD = 66;

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
  const sets = options.sets ?? null;
  const { sorted, skipped: culled, lo, hi } = batchesFor(data, config, lit, sets);
  // Feet land on their chapter's bar, so they move with the bar width.
  const { fromAt, toAt } = feetFor(data, axis, config.width, Math.min(Math.max(config.barFill, 0.05), 1));
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
      ctx.strokeStyle = gradientFor(ctx, axis, frame, config, data, batch, alpha, sets);
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
              const grownBooks = new Uint8Array(headBooks.length * 2);
              grownBooks.set(headBooks);
              headBooks = grownBooks;
            }
            heads[headCount * 2] = horizontal ? ea : ec;
            heads[headCount * 2 + 1] = horizontal ? ec : ea;
            headBooks[headCount] = batch.set >= 0 ? SET_HEAD + batch.set : batch.fromBook;
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

  // The dots at the front of every arc still flying: the arrowheads, drawn over
  // the arcs so each reads as pulling its line behind it. A dot wears the color
  // of the book it was shot from and keeps it all the way down — the arc's own
  // colors cross over mid-flight, but the dot's movement already says where it
  // is going, so it only has to say where it came from. One path per book.
  // A set's arcs are all one color, so its dots are that color too.
  if (headCount > 0) {
    const r = Math.max(options.flight?.dotSize ?? 1.8, 0.2) / k;
    const wearers = sets ? SET_HEAD + sets.colors.length : data.books.length;
    for (let b = sets ? SET_HEAD : 0; b < wearers; b++) {
      let any = false;
      for (let n = 0; n < headCount; n++) {
        if (headBooks[n] !== b) continue;
        if (!any) {
          ctx.beginPath();
          any = true;
        }
        const x = heads[n * 2];
        const y = heads[n * 2 + 1];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      if (!any) continue;
      const [cr, cg, cb] = (b >= SET_HEAD ? sets?.colors[b - SET_HEAD] : BOOK_RGB[b]) ?? [138, 143, 152];
      ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
      ctx.fill();
    }
  }

  // The hovered and picked arcs, last so they sit on top of every other arc.
  if (options.hovered != null && options.hovered !== options.selected) {
    glowArc(ctx, data, axis, frame, config, palette, sets, options.hovered, k, false);
  }
  if (options.selected != null) {
    glowArc(ctx, data, axis, frame, config, palette, sets, options.selected, k, true);
  }

  ctx.restore();

  // The ruler is drawn at screen size, after the zoom is undone: see drawRuler.
  const names = drawRuler(ctx, data, axis, frame, config, palette, view, options.view, options.labels !== false);

  return { drawn, skipped, flying, batches: sorted.length, ms: performance.now() - t0, names };
}

/**
 * One arc drawn over the rest: a soft halo in the picture's ink, then the arc
 * itself, thicker, in the colors it already wears — crossed book colors, or
 * its set's one color. `strong` is a picked arc; otherwise a hovered one.
 */
function glowArc(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  axis: Axis,
  frame: Frame,
  config: ConnectionsConfig,
  palette: ConnectionsPalette,
  sets: SetLayer | null,
  link: number,
  k: number,
  strong: boolean,
): void {
  if (link < 0 || link >= data.count) return;
  const from = data.from[link];
  const to = data.toStart[link];
  const shape = arcShape(axis, frame, config, from, to);
  const a = pointAt(frame, shape.fromAlong, 0);
  const b = pointAt(frame, shape.toAlong, 0);
  const c = pointAt(frame, (shape.fromAlong + shape.toAlong) / 2, shape.height * 2 * shape.direction);
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
  };

  ctx.lineCap = 'round';
  const [ir, ig, ib] = rgbOf(palette.text);
  trace();
  ctx.strokeStyle = `rgba(${ir}, ${ig}, ${ib}, ${strong ? 0.45 : 0.3})`;
  ctx.lineWidth = (strong ? 9 : 6) / k;
  ctx.stroke();

  let core: CanvasGradient | string;
  const mask = sets?.mask;
  if (sets && mask) {
    const fa = mask[from] ?? -1;
    const fb = mask[to] ?? -1;
    const set = fa < 0 ? fb : fb < 0 ? fa : Math.min(fa, fb);
    const [r, g, bl] = sets.colors[set] ?? [255, 255, 255];
    core = `rgb(${r}, ${g}, ${bl})`;
  } else {
    // Crossed, like every arc: the target's color at the source end.
    const starts = bookStarts(data);
    const [r1, g1, b1] = BOOK_RGB[bookIndexAt(starts, to)] ?? [138, 143, 152];
    const [r2, g2, b2] = BOOK_RGB[bookIndexAt(starts, from)] ?? [138, 143, 152];
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, `rgb(${r1}, ${g1}, ${b1})`);
    grad.addColorStop(1, `rgb(${r2}, ${g2}, ${b2})`);
    core = grad;
  }
  trace();
  ctx.strokeStyle = core;
  ctx.lineWidth = (strong ? 3 : 2) / k;
  ctx.stroke();
}

/**
 * The top of a link's arc, in screen pixels under the given pan and zoom —
 * where a card about that arc is pinned.
 */
export function arcPeak(
  data: ConnectionsData,
  config: ConnectionsConfig,
  view: Viewport,
  pan: Pan | undefined,
  link: number,
): { x: number; y: number } {
  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  const shape = arcShape(axis, frame, config, data.from[link], data.toStart[link]);
  const p = pointAt(frame, (shape.fromAlong + shape.toAlong) / 2, shape.height * shape.direction);
  const k = pan?.k ?? 1;
  return {
    x: (p.x - view.width / 2 + (pan?.x ?? 0)) * k + view.width / 2,
    y: (p.y - view.height / 2 + (pan?.y ?? 0)) * k + view.height / 2,
  };
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
  sets: SetLayer | null,
): CanvasGradient | string {
  // A set's arcs wear its one color, end to end.
  if (batch.set >= 0) {
    const [r, g, b] = sets?.colors[batch.set] ?? [255, 255, 255];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

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
/** How strongly a chapter bar wears its book's color. */
const BAR_ALPHA = 0.7;

/** The most verses in any chapter (Psalm 119), kept per axis. */
const longestCache = new WeakMap<Axis, number>();

/** How long a chapter's bar is drawn, in screen pixels off the rule. */
function barLengthOf(axis: Axis, chapter: number): number {
  let longest = longestCache.get(axis);
  if (longest === undefined) {
    longest = 1;
    for (let i = 0; i < axis.chapterVerses.length; i++) {
      if (axis.chapterVerses[i] > longest) longest = axis.chapterVerses[i];
    }
    longestCache.set(axis, longest);
  }
  return BAR_MIN + (BAR_MAX - BAR_MIN) * Math.pow(axis.chapterVerses[chapter] / longest, BAR_CURVE);
}
/** The gap between the bars and the book names. */
const NAME_GAP = 8;
/**
 * The smallest and largest letters a book name may use. Every name is sized to
 * the same height, so the longest ("1 Thessalonians") gets the smallest
 * letters and the shortest ("Job") the largest — within these bounds, so a
 * fifteen-letter name stays legible and a three-letter one doesn't shout.
 */
const NAME_FONT_MIN = 7;
const NAME_FONT_MAX = 24;
/**
 * How many chapters' worth of room a number may take, by rank: a round number
 * (1 and the tens) may be ten slots wide, a five five slots, and any other
 * three — so where numbers have to climb they stay a few steps deep, and the
 * round numbers show first as you zoom in.
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

/** A stacked name's letter size: whatever makes it `nameHeight` tall, within bounds. */
function nameFont(config: ConnectionsConfig, letters: number): number {
  return Math.min(Math.max(config.nameHeight / Math.max(letters, 1), NAME_FONT_MIN), NAME_FONT_MAX);
}

/** How much room the ruler takes across the axis, in screen pixels. */
export function axisDepth(labels: boolean, config: ConnectionsConfig): number {
  return labels ? BAR_MAX + NAME_GAP + config.nameHeight + 4 : BAR_MAX + 4;
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
 * Where the ruler sits on screen: hanging off the rule, wherever the pan and
 * zoom have put it. `rule` is the screen coordinate across the axis (y for a
 * horizontal axis), and the ruler hangs `depth` past it.
 *
 * It moves with the picture and scrolls off the screen with it. Pinning it to
 * the bottom edge kept the names in view but took a third of the screen from
 * the arcs, which are the point.
 */
export function rulerAt(
  view: Viewport,
  config: ConnectionsConfig,
  labels: boolean,
  pan?: Pan,
): { rule: number; depth: number } {
  const frame = frameFor(view, config);
  const horizontal = frame.orientation === 'horizontal';
  const k = pan?.k ?? 1;
  const size = horizontal ? view.height : view.width;
  const shift = (horizontal ? pan?.y : pan?.x) ?? 0;
  const natural = size / 2 + k * (frame.originAcross + shift - size / 2);
  return { rule: natural, depth: axisDepth(labels, config) };
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
 * The ruler: a bar per chapter, a number at each bar's tip, a divider at every
 * book, and the 66 book names.
 *
 * It hangs off the rule and moves with the picture, but is drawn at screen
 * size rather than scaled with the zoom. Zooming widens the chapters — that is
 * what the reader zooms for — while the bars keep their length and the numbers
 * and names a readable size. Scaled with the zoom, a 30× view put the names
 * 1,700 pixels below the bars and the text shrank to nothing.
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

  // Off the screen altogether: nothing to draw.
  if (rule - BOOK_NOTCH > acrossSize || rule + depth < 0) return [];

  // Only the chapters on screen are drawn.
  const offsets = axis.offsets;
  const chapters = offsets.length - 1;
  const startF = toFraction(0);
  const endF = toFraction(alongSize);
  if (endF < 0 || startF > 1) return [];
  const firstVisible = chapterAtFraction(offsets, Math.max(startF, 0));
  const lastVisible = Math.min(chapters - 1, chapterAtFraction(offsets, Math.min(endF, 1)));

  const barLength = (c: number) => barLengthOf(axis, c);
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

  // ── Chapter numbers, at the bars' tips ─────────────────────────────────
  //
  // Each number is its book's color with a thin edge — dark on a dark theme,
  // light on a pale one — the way the family tree writes its names, so it reads
  // on top of its own bar without a box around it. It sits at the bar's tip.
  // Bars differ in length, so neighboring tips are already at different
  // heights and most numbers clear each other without help; where two would
  // still touch, the later one climbs its own bar toward the rule, and if the
  // bar has no room left it goes unnumbered rather than floating loose.
  //
  // They grow a little as you zoom in, and stay in screen pixels so a deep
  // zoom can't blow them up past the ruler.
  const spread = Math.max(k * Math.max(config.stretch, 0.1), 1);
  const numberFont = config.numberSize * Math.min(1.6, 1 + 0.15 * Math.log2(spread));
  ctx.font = `bold ${numberFont}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const digitWidth = [0, 1, 2, 3].map((d) => (d ? ctx.measureText('0'.repeat(d)).width : 0));
  // A digit's height: digits are cap height, about 0.72 of the font size.
  const digitHeight = numberFont * 0.72;
  const edge = Math.max(config.numberOutline, 0);

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
      // The number's size along and across the axis, its edge included. On a
      // vertical axis it still reads left to right, so the two swap.
      const la = (horizontal ? textWidth : digitHeight) + edge * 2;
      const lc = (horizontal ? digitHeight : textWidth) + edge * 2;
      const rank = n === 1 || n % 10 === 0 ? 0 : n % 5 === 0 ? 1 : 2;
      if (s1 - s0 < NUMBER_MIN_SLOT || (s1 - s0) * TAG_SHARE[rank] < la) continue;
      wanted.push({ c, book: b, rank, s0, s1, text, la, lc });
    }
  }
  wanted.sort((x, y) => x.rank - y.rank || x.c - y.c);

  // Placed numbers, filed by where they sit along the axis so a clash test only
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
  const numbers: Array<{ book: number; along: number; c: number; lc: number; text: string }> = [];

  for (const w of wanted) {
    const mid = (w.s0 + w.s1) / 2;
    const a0 = mid - w.la / 2;
    const a1 = mid + w.la / 2;
    // Start with the number's far edge on the bar's tip — or, for a bar shorter
    // than its number, just past the rule — and climb toward the rule.
    let c0 = Math.max(barLength(w.c), w.lc + 2) - w.lc;
    while (c0 >= 1 && clashes(a0, a1, c0, c0 + w.lc)) c0 -= w.lc + 1;
    if (c0 < 1) continue;
    const box = { a0, a1, c0, c1: c0 + w.lc };
    for (let k = Math.floor(a0 / BUCKET); k <= Math.floor(a1 / BUCKET); k++) {
      const list = filed.get(k);
      if (list) list.push(box);
      else filed.set(k, [box]);
    }
    numbers.push({ book: w.book, along: mid, c: c0, lc: w.lc, text: w.text });
  }

  // Stroke then fill, a book at a time so the color is set once per book.
  ctx.lineJoin = 'round';
  ctx.lineWidth = edge * 2;
  ctx.strokeStyle = palette.pale ? '#fff' : '#0c0c0c';
  if (!horizontal) ctx.textAlign = 'left';
  numbers.sort((x, y) => x.book - y.book);
  let inked = -1;
  for (const t of numbers) {
    if (t.book !== inked) {
      inked = t.book;
      ctx.fillStyle = nameColor(BOOK_RGB[t.book] ?? [138, 143, 152], palette);
    }
    // Horizontal: centered on the bar, baseline at the number's far edge.
    // Vertical: starting at its near edge, centered on the bar.
    const x = horizontal ? t.along : rule + t.c + edge;
    const y = horizontal ? rule + t.c + t.lc - edge : t.along + digitHeight / 2;
    if (edge > 0) ctx.strokeText(t.text, x, y);
    ctx.fillText(t.text, x, y);
  }

  // ── Book names ─────────────────────────────────────────────────────────
  //
  // Bold capitals, one upright letter under the next, with a word's space kept
  // as a gap. Every name is sized to stand the same height, so the band they
  // make is level: long names get small letters, short names big ones. Each
  // sits in the middle of the part of its book that is on screen, so panning
  // along a long book keeps its name in view.
  //
  // Where two names would collide the wider book wins — at rest the twelve
  // minor prophets share about forty pixels and can't all be named — and the
  // rest appear as you zoom in and they get room.
  //
  // Letters wear the same edge as the chapter numbers. The edge is what keeps
  // a divider from striking through a name; no block behind the letters.
  ctx.textBaseline = 'middle';
  const top = BAR_MAX + NAME_GAP;

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
    const name = data.books[n.book].name.toUpperCase();
    const size = nameFont(config, name.length);
    ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    // A column is the widest capital plus a little air.
    const column = horizontal ? ctx.measureText('W').width + 3 : size + 3;
    const from = n.mid - column / 2;
    const to = n.mid + column / 2;
    if (names.some((p) => p.to > from && p.from < to)) continue;
    names.push({ book: n.book, from, to });

    // Centered in the band, so a name that couldn't reach the full height
    // (the clamps on letter size) sits in the middle rather than up top.
    const nameTop = horizontal ? top + (config.nameHeight - name.length * size) / 2 : top;
    ctx.fillStyle = nameColor(BOOK_RGB[n.book] ?? [138, 143, 152], palette);
    if (horizontal) {
      ctx.textAlign = 'center';
      for (let i = 0; i < name.length; i++) {
        if (name[i] === ' ') continue;
        const y = rule + nameTop + i * size + size / 2;
        if (edge > 0) ctx.strokeText(name[i], n.mid, y);
        ctx.fillText(name[i], n.mid, y);
      }
    } else {
      // A vertical axis runs down the screen already, so the name reads across
      // it as an ordinary word.
      ctx.textAlign = 'left';
      if (edge > 0) ctx.strokeText(name, rule + top, n.mid);
      ctx.fillText(name, rule + top, n.mid);
    }
  }
  return names;
}

/**
 * What a tap on the ruler landed on: a book name, a chapter, or nothing.
 *
 * `at` is in screen pixels, and `grab` is how far above the rule a tap still
 * counts as the ruler. Below the rule the ruler only claims what it draws: a
 * chapter's own bar, as long as that bar is, and a book's name. When arcs
 * also hang below the rule ('split' or 'bottom'), a tap in the room around
 * the bars and between the names is theirs — the ruler once claimed its whole
 * depth there, and that swallowed two of every three taps on a visible arc.
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
  const arcsBelow = config.side !== 'top';

  if (labels && across >= BAR_MAX + NAME_GAP / 2) {
    const name = names.find((n) => along >= n.from - 4 && along <= n.to + 4);
    if (name) return { kind: 'book', book: name.book };
    if (arcsBelow) return null;
  }

  const chapter = chapterAtScreen(data, config, view, pan, at);
  if (chapter === null) return null;
  // Past the tip of a short bar is open field when arcs are drawn there.
  if (arcsBelow && across > barLengthOf(axisFor(data, config.width), chapter) + 3) return null;
  return { kind: 'chapter', chapter };
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
 * Only arcs that are actually drawn can be picked — the vote floor, the cap,
 * the lit set and the shown sets all apply — so a tap never finds a hidden arc. Walked rather than
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
  sets?: SetLayer | null,
): number | null {
  const axis = axisFor(data, config.width);
  const frame = frameFor(view, config);
  const { sorted } = batchesFor(data, config, lit, sets ?? null);
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
