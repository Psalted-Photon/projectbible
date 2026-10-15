/**
 * The reader strip: a thin line of the whole Bible under a chapter's title,
 * with an arc from this chapter to everywhere it reaches (roadmap Connections,
 * Phase 8).
 *
 * It shows the same links the Arcs tab lights when that chapter is tapped —
 * the ones that leave it and the ones that arrive in it — so the strip is a
 * preview of the picture it opens, not a different count of the same thing.
 *
 * Nothing goes on the verse text. The strip sits in the chapter header and
 * draws on its own canvas, in the reader's theme with the app's book colors.
 */

import { linksFrom, type ConnectionsData } from './data';
import { buildAxis, fractionOf, type Axis, type ChapterWidth } from './layout';
import { bookIndexAt, bookRgba, type ConnectionsPalette } from './palette';
import type { Span } from './lights';

/** Everything the strip is tuned by. The lab writes straight into one of these. */
export interface StripConfig {
  /** The strip's height, in pixels, from the tallest arc to the bottom of the line. */
  height: number;
  /** Room left and right of the line, in pixels. */
  sidePad: number;
  /** The book-colored line's thickness, in pixels. */
  lineWidth: number;
  /**
   * 'above' raises every arc over the line. 'split' sends links to later in
   * the Bible over it and links to earlier under it, as the Arcs tab does.
   */
  side: 'above' | 'split';
  /** Chapters the same width, or as wide as their verse counts. */
  width: ChapterWidth;
  /** The tallest arc, as a share of the room it has. */
  lift: number;
  /** How arc height grows with distance, as an exponent. Below 1 lifts the short ones. */
  heightCurve: number;
  /** The shortest arc's height, in pixels, so a link next door still shows. */
  heightMin: number;
  /** Each arc's line width, in pixels. */
  thickness: number;
  /** The most-voted arc's opacity. */
  opacity: number;
  /** The least-voted arc's opacity, as a share of `opacity`. */
  opacityFloor: number;
  /** Links with fewer votes than this are left off. */
  voteFloor: number;
  /** Draw only the most-voted this-many. 0 draws them all. */
  maxArcs: number;
  /** 'both' fades each arc from the far book's color to this chapter's; 'far' paints it the far book's only. */
  colorBy: 'both' | 'far';
  /** The small mark under the line where this chapter is. */
  marker: boolean;
  /** "Gen" and "Rev" at the two ends. */
  ends: boolean;
}

/** What the app ships, and what the lab's Reset puts back. */
export const STRIP: StripConfig = {
  height: 46,
  sidePad: 14,
  lineWidth: 3,
  side: 'above',
  width: 'equal',
  lift: 0.92,
  heightCurve: 0.6,
  heightMin: 6,
  thickness: 1,
  opacity: 0.9,
  opacityFloor: 0.25,
  voteFloor: 5,
  maxArcs: 300,
  colorBy: 'both',
  marker: true,
  ends: true,
};

/* --------------------------------------------------------------------------- *
 * A chapter's reach
 * ------------------------------------------------------------------------- */

/** One link touching the chapter, from its near end to its far one. */
export interface StripLink {
  /** The end in this chapter. */
  near: number;
  /** The other end. */
  far: number;
  votes: number;
}

export interface ChapterReach {
  span: Span;
  /** Least-voted first, so the best-voted are drawn on top. */
  links: StripLink[];
  /** The most votes any of them has, for the opacity scale. */
  maxVotes: number;
}

/**
 * Every link that leaves the chapter or lands in it, under a vote floor and a
 * cap. A link from one verse of the chapter to another is counted once.
 *
 * Arriving links need a pass over every link, since the columns are sorted by
 * source; that is a few milliseconds, so callers keep the answer per chapter.
 */
export function chapterReach(data: ConnectionsData, span: Span, floor: number, cap: number): ChapterReach {
  const links: StripLink[] = [];
  for (const i of linksFrom(data, span.start, span.end)) {
    if (data.votes[i] >= floor) links.push({ near: data.from[i], far: data.toStart[i], votes: data.votes[i] });
  }
  for (let i = 0; i < data.count; i++) {
    const to = data.toStart[i];
    if (to < span.start || to >= span.end) continue;
    const from = data.from[i];
    if (from >= span.start && from < span.end) continue;
    if (data.votes[i] >= floor) links.push({ near: to, far: from, votes: data.votes[i] });
  }
  links.sort((a, b) => b.votes - a.votes);
  const kept = cap > 0 ? links.slice(0, cap) : links;
  const maxVotes = kept.length ? kept[0].votes : 0;
  kept.reverse();
  return { span, links: kept, maxVotes };
}

/* --------------------------------------------------------------------------- *
 * Drawing
 * ------------------------------------------------------------------------- */

const axes = new WeakMap<ConnectionsData, Partial<Record<ChapterWidth, Axis>>>();

/** The axis for a spacing, built once per data and kept. */
export function stripAxis(data: ConnectionsData, width: ChapterWidth): Axis {
  let held = axes.get(data);
  if (!held) axes.set(data, (held = {}));
  return (held[width] ??= buildAxis(data, width));
}

/** Where the line sits, for drawing and for the taps. */
export interface StripFrame {
  x0: number;
  x1: number;
  /** The line's top edge. */
  y: number;
}

/** The ends' labels need this much room under the line. */
const END_ROOM = 12;

export function stripFrame(config: StripConfig, size: { width: number; height: number }): StripFrame {
  const below = config.marker || config.ends ? END_ROOM : 2;
  const y =
    config.side === 'split'
      ? Math.round((size.height - config.lineWidth) / 2)
      : size.height - below - config.lineWidth;
  return { x0: config.sidePad, x1: size.width - config.sidePad, y };
}

export interface StripDrawOptions {
  palette: ConnectionsPalette;
  /** Fill the background too. The reader leaves it off, so the page shows through. */
  background: boolean;
}

export function drawStrip(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  reach: ChapterReach,
  config: StripConfig,
  size: { width: number; height: number },
  options: StripDrawOptions,
): void {
  const { palette } = options;
  if (options.background) {
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  const axis = stripAxis(data, config.width);
  const frame = stripFrame(config, size);
  const along = frame.x1 - frame.x0;
  const xAt = (pos: number) => frame.x0 + fractionOf(axis, pos) * along;
  const starts = new Int32Array(data.books.map((b) => b.start));

  // Room for arcs: over the line, or half each side when split.
  const roomAbove = frame.y - 1;
  const roomBelow = config.side === 'split' ? size.height - (frame.y + config.lineWidth) - 1 : 0;
  const hereBook = bookIndexAt(starts, reach.span.start);

  ctx.lineCap = 'round';
  ctx.lineWidth = config.thickness;
  for (const link of reach.links) {
    const a = xAt(link.near);
    const b = xAt(link.far);
    const below = config.side === 'split' && link.far < link.near;
    const room = below ? roomBelow : roomAbove;
    const dist = Math.min(Math.abs(b - a) / along, 1);
    const h = Math.min(room, config.heightMin + (room * config.lift - config.heightMin) * Math.pow(dist, config.heightCurve));
    const base = below ? frame.y + config.lineWidth : frame.y;
    const lift = below ? h * 1.33 : -h * 1.33;

    const share = reach.maxVotes > 0 ? Math.sqrt(Math.max(link.votes, 0) / reach.maxVotes) : 1;
    const alpha = config.opacity * (config.opacityFloor + (1 - config.opacityFloor) * share);
    const farBook = bookIndexAt(starts, link.far);
    if (config.colorBy === 'both' && farBook !== hereBook && Math.abs(b - a) > 1) {
      const grad = ctx.createLinearGradient(a, 0, b, 0);
      grad.addColorStop(0.15, bookRgba(hereBook, alpha));
      grad.addColorStop(0.85, bookRgba(farBook, alpha));
      ctx.strokeStyle = grad;
    } else {
      ctx.strokeStyle = bookRgba(farBook, alpha);
    }
    ctx.beginPath();
    ctx.moveTo(a, base);
    ctx.bezierCurveTo(a, base + lift, b, base + lift, b, base);
    ctx.stroke();
  }

  // The line of the Bible, each book in its color.
  for (let i = 0; i < data.books.length; i++) {
    const book = data.books[i];
    const left = frame.x0 + axis.offsets[book.firstChapter] * along;
    const right = frame.x0 + axis.offsets[book.firstChapter + book.chapters] * along;
    ctx.fillStyle = bookRgba(i, 1);
    ctx.fillRect(left, frame.y, Math.max(1, right - left - 0.6), config.lineWidth);
  }

  const under = frame.y + config.lineWidth;
  if (config.marker) {
    const mid = xAt((reach.span.start + reach.span.end - 1) / 2);
    ctx.fillStyle = palette.text;
    ctx.beginPath();
    ctx.moveTo(mid, under + 2);
    ctx.lineTo(mid - 4, under + 8);
    ctx.lineTo(mid + 4, under + 8);
    ctx.closePath();
    ctx.fill();
  }
  if (config.ends && config.side === 'above') {
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = palette.muted;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('Gen', frame.x0, under + 2);
    ctx.textAlign = 'right';
    ctx.fillText('Rev', frame.x1, under + 2);
  }
}
