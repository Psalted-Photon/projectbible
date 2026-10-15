/**
 * The chord ring: the 66 books around a circle, a ribbon between every pair
 * that links, as wide as the links between them (roadmap Connections, Phase 8).
 *
 * Where the arcs show every link and the grid shows where they gather, the
 * ring answers the plainest question: which books talk to which, and how
 * much. Each book's stretch of the circle is sized by how many links it has
 * with the others, and each ribbon takes that pair's share of both ends, so a
 * ribbon's width at Isaiah and its width at Matthew are both true.
 *
 * Links within one book have nowhere to go on a ring and are left out; the
 * grid's diagonal is where those are shown.
 *
 * At most 2,145 ribbons (66 × 65 / 2), so the ring is drawn live every frame
 * rather than cached into an image like the grid: it stays sharp at any zoom
 * and a picked book can dim the rest without a rebuild. The lab's readout
 * says what a draw costs.
 *
 * Nothing here reads the clock or the Motion setting; the caller passes both,
 * the same as lights.ts, so a saved image is a still of a known moment.
 */

import { BIBLE_BOOKS } from '../bibleData';
import { linkMask, type ConnectionsData } from './data';
import { BOOK_CATEGORIES, bookIndexAt, bookRgba, type ConnectionsPalette } from './palette';

const FULL_NAMES = BIBLE_BOOKS.map((b) => b.name);

/** Everything the ring is tuned by. The lab writes straight into one of these. */
export interface ChordConfig {
  /** The ring's radius, as a share of half the picture's short side. Room past it is for the names. */
  ringSize: number;
  /** How thick each book's band on the ring is, in pixels. */
  bandWidth: number;
  /** The gap between two books, as a share of the whole circle. */
  gap: number;
  /** The wider gap where one book category ends and the next begins, as a multiple of `gap`. */
  groupGap: number;
  /**
   * How a book's stretch of the circle follows its link count. 0 gives every
   * book the same stretch; 1 is strictly by count, so Psalms dwarfs Obadiah.
   */
  bookSize: number;
  /** Draw only the busiest this-many pairs. 0 draws every pair that links. */
  pairs: number;
  /** The busiest ribbon's opacity. */
  opacity: number;
  /** The quietest ribbon's opacity, as a share of `opacity`. */
  opacityFloor: number;
  /**
   * How a ribbon bends. 0 pulls it through the middle of the ring; toward 1 it
   * stays near the rim, so neighbors' ribbons stay short.
   */
  pinch: number;
  /** Room between a book's band and where its ribbons start, in pixels. */
  inset: number;
  /** Links with fewer votes than this are not counted. */
  voteFloor: number;
  /** Count only the most-voted this-many links. 0 counts them all. */
  maxLinks: number;
  /** Book name size, in screen pixels. Names that would not fit their stretch are left off. */
  labelSize: number;
  /** Full names, or the short forms. */
  labelNames: 'full' | 'short';
  /** While a book or ribbon is picked, how faint the rest go, as a share of their opacity. */
  dimFloor: number;
  /** How long the others take to dim when something is picked. */
  fadeMs: number;
}

/** What the app ships, and what the lab's Reset puts back. */
export const CHORD: ChordConfig = {
  ringSize: 0.83,
  bandWidth: 2,
  gap: 0.0007,
  groupGap: 1,
  bookSize: 1,
  pairs: 400,
  opacity: 0.9,
  opacityFloor: 0.45,
  pinch: 0.13,
  inset: 3,
  voteFloor: 1,
  maxLinks: 0,
  labelSize: 9.5,
  labelNames: 'short',
  dimFloor: 0.08,
  fadeMs: 260,
};

/** The short forms the ring labels with when space is tight. */
export const SHORT_NAMES: string[] = [
  'Gen', 'Ex', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1 Sam', '2 Sam', '1 Kgs', '2 Kgs',
  '1 Chr', '2 Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer',
  'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph',
  'Hag', 'Zech', 'Mal', 'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1 Cor', '2 Cor', 'Gal',
  'Eph', 'Phil', 'Col', '1 Thess', '2 Thess', '1 Tim', '2 Tim', 'Titus', 'Phlm', 'Heb', 'Jas',
  '1 Pet', '2 Pet', '1 John', '2 John', '3 John', 'Jude', 'Rev',
];

/* --------------------------------------------------------------------------- *
 * Counting
 * ------------------------------------------------------------------------- */

/** How many links join each pair of books, either way round. */
export interface ChordCounts {
  /** 66 × 66, symmetric, zero on the diagonal. `counts[a * 66 + b]`. */
  counts: Float64Array;
  /** The same one way only: links written in book a that land in book b. */
  directed: Float64Array;
  /** Each book's links with the other 65. */
  totals: Float64Array;
  /** The busiest pair's count. */
  max: number;
  /** Links counted: those kept by the floor and cap that join two different books. */
  links: number;
  ms: number;
}

const BOOKS = 66;

/** Sort every shown link into its pair of books. */
export function countChords(data: ConnectionsData, config: Pick<ChordConfig, 'voteFloor' | 'maxLinks'>): ChordCounts {
  const t0 = performance.now();
  const { mask } = linkMask(data, config.voteFloor, config.maxLinks);
  const starts = new Int32Array(data.books.map((b) => b.start));
  const counts = new Float64Array(BOOKS * BOOKS);
  const directed = new Float64Array(BOOKS * BOOKS);
  let links = 0;
  for (let i = 0; i < data.count; i++) {
    if (!mask[i]) continue;
    const a = bookIndexAt(starts, data.from[i]);
    const b = bookIndexAt(starts, data.toStart[i]);
    if (a === b) continue;
    counts[a * BOOKS + b]++;
    counts[b * BOOKS + a]++;
    directed[a * BOOKS + b]++;
    links++;
  }
  const totals = new Float64Array(BOOKS);
  let max = 0;
  for (let a = 0; a < BOOKS; a++) {
    for (let b = 0; b < BOOKS; b++) {
      const n = counts[a * BOOKS + b];
      totals[a] += n;
      if (b > a && n > max) max = n;
    }
  }
  return { counts, directed, totals, max, links, ms: performance.now() - t0 };
}

/* --------------------------------------------------------------------------- *
 * Layout
 * ------------------------------------------------------------------------- */

/** One book's stretch of the circle, in radians, clockwise from the top. */
export interface ChordBook {
  start: number;
  end: number;
}

/** One ribbon: a pair of books and where it lands on each. */
export interface ChordRibbon {
  a: number;
  b: number;
  count: number;
  /** Its stretch of book a, then of book b, in radians. */
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/**
 * Where everything sits, independent of the screen: angles only. The scene
 * below turns it into pixels for one picture size.
 */
export interface ChordLayout {
  books: ChordBook[];
  /** The ribbons drawn, quietest first, so the busiest lie on top. */
  ribbons: ChordRibbon[];
  /** Every pair that links, whether drawn or not, for the readouts. */
  pairCount: number;
}

const TOP = -Math.PI / 2;

export function buildChordLayout(counts: ChordCounts, config: ChordConfig): ChordLayout {
  // Gaps first: one between every two books, wider where the category changes.
  let gapUnits = 0;
  for (let b = 0; b < BOOKS; b++) {
    const next = (b + 1) % BOOKS;
    gapUnits += BOOK_CATEGORIES[b] === BOOK_CATEGORIES[next] ? 1 : config.groupGap;
  }
  const gapTotal = Math.min(gapUnits * config.gap * Math.PI * 2, Math.PI);
  const unit = gapUnits > 0 ? gapTotal / gapUnits : 0;

  const weights = Array.from(counts.totals, (n) => Math.pow(Math.max(n, 1), config.bookSize));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const room = Math.PI * 2 - gapTotal;

  const books: ChordBook[] = [];
  let at = TOP + unit / 2;
  for (let b = 0; b < BOOKS; b++) {
    const len = (weights[b] / weightSum) * room;
    books.push({ start: at, end: at + len });
    const next = (b + 1) % BOOKS;
    at += len + unit * (BOOK_CATEGORIES[b] === BOOK_CATEGORIES[next] ? 1 : config.groupGap);
  }

  // Each book hands out its stretch to its partners in proportion to their
  // links. Partners just clockwise get the clockwise end and partners just
  // counter-clockwise the other end, so ribbons leaving one book never cross
  // each other on the way out.
  const slots = new Map<number, [number, number]>();
  for (let a = 0; a < BOOKS; a++) {
    const total = counts.totals[a];
    if (!total) continue;
    const partners: number[] = [];
    for (let b = 0; b < BOOKS; b++) if (counts.counts[a * BOOKS + b] > 0) partners.push(b);
    partners.sort((p, q) => ((q - a + BOOKS) % BOOKS) - ((p - a + BOOKS) % BOOKS));
    const { start, end } = books[a];
    let used = 0;
    for (const b of partners) {
      const n = counts.counts[a * BOOKS + b];
      const s = start + (used / total) * (end - start);
      used += n;
      slots.set(a * BOOKS + b, [s, start + (used / total) * (end - start)]);
    }
  }

  const pairs: ChordRibbon[] = [];
  for (let a = 0; a < BOOKS; a++) {
    for (let b = a + 1; b < BOOKS; b++) {
      const count = counts.counts[a * BOOKS + b];
      if (!count) continue;
      const [a0, a1] = slots.get(a * BOOKS + b)!;
      const [b0, b1] = slots.get(b * BOOKS + a)!;
      pairs.push({ a, b, count, a0, a1, b0, b1 });
    }
  }
  pairs.sort((p, q) => q.count - p.count);
  const pairCount = pairs.length;
  const drawn = config.pairs > 0 ? pairs.slice(0, config.pairs) : pairs;
  drawn.reverse();
  return { books, ribbons: drawn, pairCount };
}

/* --------------------------------------------------------------------------- *
 * Drawing
 * ------------------------------------------------------------------------- */

/** Pan and zoom, about the picture's center. */
export interface ChordView {
  x: number;
  y: number;
  k: number;
}

/** What is picked: a book keeps its own ribbons, a pair keeps just that one. */
export type ChordPick = { kind: 'book'; book: number } | { kind: 'pair'; a: number; b: number } | null;

/** The layout in pixels for one picture size, with a path per ribbon for the drawing and the taps. */
export interface ChordScene {
  layout: ChordLayout;
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Where the ribbons start, just inside the bands. */
  radius: number;
  paths: Path2D[];
}

export function chordScene(layout: ChordLayout, config: ChordConfig, viewport: { width: number; height: number }): ChordScene {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const outer = (Math.min(viewport.width, viewport.height) / 2) * config.ringSize;
  const radius = Math.max(outer - config.bandWidth - config.inset, 10);
  const pinch = Math.min(Math.max(config.pinch, 0), 0.95);
  const pt = (th: number): [number, number] => [cx + Math.cos(th) * radius, cy + Math.sin(th) * radius];

  const paths = layout.ribbons.map((r) => {
    const p = new Path2D();
    const [ax, ay] = pt(r.a0);
    const [bx, by] = pt(r.b0);
    // The bend's pull: the ring's middle, drawn toward the midpoint of the two
    // ends as `pinch` rises.
    const bend = (x0: number, y0: number, x1: number, y1: number): [number, number] => [
      cx + ((x0 + x1) / 2 - cx) * pinch,
      cy + ((y0 + y1) / 2 - cy) * pinch,
    ];
    const [a1x, a1y] = pt(r.a1);
    const [b1x, b1y] = pt(r.b1);
    p.moveTo(ax, ay);
    p.arc(cx, cy, radius, r.a0, r.a1);
    p.quadraticCurveTo(...bend(a1x, a1y, bx, by), bx, by);
    p.arc(cx, cy, radius, r.b0, r.b1);
    p.quadraticCurveTo(...bend(b1x, b1y, ax, ay), ax, ay);
    p.closePath();
    return p;
  });

  return { layout, width: viewport.width, height: viewport.height, cx, cy, radius, paths };
}

export interface ChordDrawOptions {
  palette: ConnectionsPalette;
  view: ChordView;
  pick: ChordPick;
  /** When the pick changed, on the clock `now` runs on. */
  pickedAt: number;
  /** The pick before this one, which fades out as the new one fades in. */
  previous: ChordPick;
  now: number;
  motion: 'full' | 'reduced' | 'off';
  /** The busiest pair's count, which the opacity scale is built on. */
  max: number;
}

export interface ChordDrawStats {
  ms: number;
  /** Still fading toward the pick, so the caller keeps drawing. */
  fading: boolean;
}

/** How strongly a ribbon shows under a pick: 1 is untouched. */
function weightUnder(pick: ChordPick, r: ChordRibbon, dim: number): number {
  if (!pick) return 1;
  if (pick.kind === 'book') return r.a === pick.book || r.b === pick.book ? 1 : dim;
  return (r.a === pick.a && r.b === pick.b) || (r.a === pick.b && r.b === pick.a) ? 1 : dim;
}

function bookUnder(pick: ChordPick, b: number, dim: number, counts: ChordRibbon[]): number {
  if (!pick) return 1;
  if (pick.kind === 'pair') return b === pick.a || b === pick.b ? 1 : Math.max(dim, 0.25);
  if (b === pick.book) return 1;
  // A book the picked one links to keeps its band lit too.
  return counts.some((r) => (r.a === pick.book && r.b === b) || (r.b === pick.book && r.a === b)) ? 1 : Math.max(dim, 0.25);
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function drawChord(
  ctx: CanvasRenderingContext2D,
  scene: ChordScene,
  config: ChordConfig,
  options: ChordDrawOptions,
): ChordDrawStats {
  const t0 = performance.now();
  const { palette, view, pick, previous, max } = options;
  const { layout, cx, cy, radius } = scene;

  ctx.save();
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, scene.width, scene.height);

  // Pan and zoom about the middle of the picture.
  ctx.translate(cx + view.x, cy + view.y);
  ctx.scale(view.k, view.k);
  ctx.translate(-cx, -cy);

  const fadeMs = options.motion === 'full' ? config.fadeMs : 0;
  const t = fadeMs > 0 ? Math.min(Math.max((options.now - options.pickedAt) / fadeMs, 0), 1) : 1;
  const mixT = ease(t);
  const dim = config.dimFloor;

  // Ribbons.
  layout.ribbons.forEach((r, i) => {
    const share = max > 0 ? Math.sqrt(r.count / max) : 1;
    const base = config.opacity * (config.opacityFloor + (1 - config.opacityFloor) * share);
    const w = weightUnder(previous, r, dim) * (1 - mixT) + weightUnder(pick, r, dim) * mixT;
    const alpha = base * w;
    if (alpha < 0.003) return;
    const ma = (r.a0 + r.a1) / 2;
    const mb = (r.b0 + r.b1) / 2;
    const grad = ctx.createLinearGradient(
      cx + Math.cos(ma) * radius,
      cy + Math.sin(ma) * radius,
      cx + Math.cos(mb) * radius,
      cy + Math.sin(mb) * radius,
    );
    grad.addColorStop(0, bookRgba(r.a, alpha));
    grad.addColorStop(1, bookRgba(r.b, alpha));
    ctx.fillStyle = grad;
    ctx.fill(scene.paths[i]);
  });

  // Bands, then names. Both hold their screen size under zoom.
  const bandR = radius + config.inset + config.bandWidth / 2;
  ctx.lineCap = 'butt';
  for (let b = 0; b < BOOKS; b++) {
    const { start, end } = layout.books[b];
    const w = bookUnder(previous, b, dim, layout.ribbons) * (1 - mixT) + bookUnder(pick, b, dim, layout.ribbons) * mixT;
    ctx.beginPath();
    ctx.arc(cx, cy, bandR, start, end);
    ctx.strokeStyle = bookRgba(b, w);
    ctx.lineWidth = config.bandWidth;
    ctx.stroke();
  }

  const size = config.labelSize / view.k;
  const labelR = bandR + config.bandWidth / 2 + 5 / view.k;
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  for (let b = 0; b < BOOKS; b++) {
    const { start, end } = layout.books[b];
    // A name stands out from the ring, so it needs its letter height of room
    // along the circle at the ring's edge.
    if ((end - start) * labelR * view.k < config.labelSize * 0.85) continue;
    const mid = (start + end) / 2;
    const name = config.labelNames === 'short' ? SHORT_NAMES[b] : FULL_NAMES[b];
    const flip = Math.cos(mid) < 0;
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * labelR, cy + Math.sin(mid) * labelR);
    ctx.rotate(flip ? mid + Math.PI : mid);
    ctx.textAlign = flip ? 'right' : 'left';
    const w = bookUnder(previous, b, dim, layout.ribbons) * (1 - mixT) + bookUnder(pick, b, dim, layout.ribbons) * mixT;
    ctx.globalAlpha = Math.max(w, 0.3);
    ctx.fillStyle = palette.text;
    ctx.fillText(name, 0, 0);
    ctx.restore();
  }

  ctx.restore();
  return { ms: performance.now() - t0, fading: t < 1 };
}

/* --------------------------------------------------------------------------- *
 * Taps
 * ------------------------------------------------------------------------- */

export type ChordHit = { kind: 'book'; book: number } | { kind: 'pair'; a: number; b: number; count: number };

let hitCtx: CanvasRenderingContext2D | null = null;

/** What is under a screen point: a book's band or name, or a ribbon. */
export function chordHit(
  scene: ChordScene,
  config: ChordConfig,
  view: ChordView,
  at: { x: number; y: number },
): ChordHit | null {
  const { cx, cy, radius, layout } = scene;
  // Undo the pan and zoom, back into the scene's own pixels.
  const x = (at.x - cx - view.x) / view.k + cx;
  const y = (at.y - cy - view.y) / view.k + cy;
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);

  // The band and the names past it: anything from the band out is that book.
  if (r >= radius + config.inset - 2 / view.k) {
    if (r > radius + config.inset + config.bandWidth + (config.labelSize * 6) / view.k) return null;
    let th = Math.atan2(dy, dx);
    if (th < TOP) th += Math.PI * 2;
    for (let b = 0; b < BOOKS; b++) {
      const { start, end } = layout.books[b];
      // Half the gap either side counts, so a thin book can still be hit.
      const slack = Math.max(0, (6 / view.k / r - (end - start)) / 2);
      if (th >= start - slack && th <= end + slack) return { kind: 'book', book: b };
    }
    return null;
  }

  hitCtx ??= document.createElement('canvas').getContext('2d');
  if (!hitCtx) return null;
  // The busiest lie on top, so test from the top down.
  for (let i = layout.ribbons.length - 1; i >= 0; i--) {
    if (hitCtx.isPointInPath(scene.paths[i], x, y)) {
      const rb = layout.ribbons[i];
      return { kind: 'pair', a: rb.a, b: rb.b, count: rb.count };
    }
  }
  return null;
}

/**
 * A pair the way round more of its links run, for opening it on the Detail
 * tab, which shows one direction: where links start on the left, where they
 * land on the right.
 */
export function busierWay(counts: ChordCounts, a: number, b: number): { from: number; to: number } {
  return counts.directed[a * BOOKS + b] >= counts.directed[b * BOOKS + a] ? { from: a, to: b } : { from: b, to: a };
}

/** A book's busiest partners, for the card a tapped book shows. */
export function partnersOf(counts: ChordCounts, book: number, limit = 8): Array<{ book: number; count: number }> {
  const out: Array<{ book: number; count: number }> = [];
  for (let b = 0; b < BOOKS; b++) {
    const n = counts.counts[book * BOOKS + b];
    if (n > 0) out.push({ book: b, count: n });
  }
  out.sort((p, q) => q.count - p.count);
  return out.slice(0, limit);
}
