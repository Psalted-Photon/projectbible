/**
 * The Connections detail: one cell of the grid, opened up.
 *
 * Two upright axes, the source on the left and the target on the right, each
 * running from its first verse at the top to its last at the bottom. Chapters
 * are ticked and numbered, the section headings from the headings pack sit
 * beside them, and every link between the two is one line across. A cell on
 * the grid's diagonal opens a book against itself, which is just the same axis
 * drawn twice.
 *
 * Tapping a chapter or a heading lights its lines and dims the rest, and the
 * lit lines draw themselves across from the side that was tapped — the light
 * travels outward from the tap, as it does on the arcs. A group lane works too:
 * its axis is ticked by book instead of by chapter, and carries no headings.
 *
 * Every link is drawn alike, as on the arcs: votes decide only which are shown.
 */

import { openDB, type DBSectionHeading } from '../../adapters/db';
import { linkMask, type ConnectionsData } from './data';
import type { ConnectionsPalette } from './palette';
import { BOOK_COLORS, rgbOf } from './palette';
import { shortBookName } from '../bibleData';
import type { Span } from './lights';

export type DetailColorBy = 'books' | 'rainbow' | 'ink';
export type DetailScale = 'fill' | 'true';

export interface DetailConfig {
  /** Hide links fewer readers voted for. */
  voteFloor: number;
  /** The most links shown, keeping the most-voted, as on the arcs. 0 shows every one past the floor. */
  maxLinks: number;
  /** 'fill' stretches both axes the full height; 'true' keeps a short book short. */
  scale: DetailScale;
  /** The room each side keeps for its numbers and headings, as a share of the width. */
  sideRoom: number;
  /** 0 is straight lines; 1 leaves and lands level, like a ribbon. */
  curve: number;
  /** Line width, in CSS pixels. */
  thickness: number;
  /** How solid a line is. Crossings add up, so a bright band means many links. */
  opacity: number;
  /** How faint the unlit lines go while something is lit, as a share of `opacity`. 0 hides them. */
  dimFloor: number;
  /** What colors a line. */
  colorBy: DetailColorBy;
  /** With book colors, each line leaves wearing the other book's color, like the arcs. */
  crossed: boolean;
  /** Where along the line the color changes over, 0 to 1. */
  crossfadeAt: number;
  /** How long the change takes, 0 (hard step) to 1 (the whole line). */
  crossfadeWidth: number;
  /** The axis line's width. */
  axisWidth: number;
  /** The chapter tick's length. */
  tickLength: number;
  numberSize: number;
  headings: boolean;
  /** Also place the smaller (level 2) headings where there is room. */
  minorHeadings: boolean;
  headingSize: number;
  /** The book names above the axes. */
  titleSize: number;
  /** Room above and below the axes. */
  padTop: number;
  padBottom: number;
  /** A lit line's travel, from the tapped side to the far one. */
  flightMs: number;
  /** First launch to last, in reading order of the tapped passage. */
  staggerMs: number;
  /** The dot at the head of a line in flight, in CSS pixels. */
  dotSize: number;
}

/** What the app ships, and what the lab's Reset puts back. */
export const DETAIL: DetailConfig = {
  voteFloor: 1,
  maxLinks: 0,
  scale: 'true',
  sideRoom: 0.23,
  curve: 1,
  thickness: 0.7,
  opacity: 0.35,
  dimFloor: 0.12,
  colorBy: 'rainbow',
  crossed: true,
  crossfadeAt: 0.5,
  crossfadeWidth: 0.45,
  axisWidth: 2.2,
  tickLength: 5.5,
  numberSize: 12,
  headings: true,
  minorHeadings: false,
  headingSize: 8,
  titleSize: 15,
  padTop: 39,
  padBottom: 38,
  flightMs: 1125,
  staggerMs: 1300,
  dotSize: 1.8,
};

/* --------------------------------------------------------------------------- *
 * Headings
 * ------------------------------------------------------------------------- */

export interface DetailHeading {
  chapter: number;
  verse: number;
  /** Absolute verse position, counted from Gen 1:1 = 0. */
  position: number;
  text: string;
  level: number;
}

/**
 * Every section heading in a book, in order.
 *
 * Same rule as HeadingsStore: a translation's own headings for a chapter, or
 * BSB's where it has none — chosen per chapter, so two translations' section
 * breaks never mix in one chapter. Read in one go for the whole book, because
 * the detail view shows the whole book at once.
 */
export async function bookHeadings(
  data: ConnectionsData,
  book: string,
  translation?: string,
): Promise<DetailHeading[]> {
  const info = data.books.find((b) => b.name === book);
  if (!info) return [];
  let rows: DBSectionHeading[] = [];
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('section_headings')) return [];
    rows = await new Promise<DBSectionHeading[]>((resolve, reject) => {
      const tx = db.transaction('section_headings', 'readonly');
      const index = tx.objectStore('section_headings').index('book_chapter');
      const request = index.getAll(IDBKeyRange.bound([book, 0], [book, 10000]));
      request.onsuccess = () => resolve(request.result as DBSectionHeading[]);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }

  const wanted = translation?.toLowerCase();
  const byChapter = new Map<number, DBSectionHeading[]>();
  for (const row of rows) {
    const list = byChapter.get(row.chapter) ?? [];
    list.push(row);
    byChapter.set(row.chapter, list);
  }

  const out: DetailHeading[] = [];
  for (const [chapter, list] of byChapter) {
    if (chapter < 1 || chapter > info.chapters) continue;
    const of = (id: string) => list.filter((r) => (r.translation ?? 'bsb') === id);
    const own = wanted ? of(wanted) : [];
    const chosen = own.length ? own : of('bsb');
    const chapterStart = data.chapterStarts[info.firstChapter + chapter - 1];
    for (const row of chosen) {
      out.push({
        chapter,
        verse: row.verse,
        position: chapterStart + Math.max(1, row.verse) - 1,
        text: row.heading,
        level: row.level ?? 1,
      });
    }
  }
  return out.sort((a, b) => a.position - b.position || a.level - b.level);
}

/* --------------------------------------------------------------------------- *
 * The model: what one cell holds
 * ------------------------------------------------------------------------- */

export interface DetailMark {
  position: number;
  label: string;
  /** A book mark's own color; chapter numbers go muted. */
  color?: string;
}

export interface DetailAxis {
  name: string;
  color: string;
  rgb: [number, number, number];
  start: number;
  end: number;
  /** Chapter starts for a book, book starts for a group. */
  marks: DetailMark[];
  /** True when the marks are books, not chapters. */
  byBook: boolean;
  headings: DetailHeading[];
}

export interface DetailModel {
  left: DetailAxis;
  right: DetailAxis;
  /** The links between them that pass the vote floor, as indexes into the columns. */
  links: Int32Array;
}

/** An axis for a span: a book's, or a group's. */
export function detailAxis(
  data: ConnectionsData,
  span: { name: string; color: string; rgb: [number, number, number]; start: number; end: number },
  headings: DetailHeading[] = [],
): DetailAxis {
  const books = data.books.filter((b) => b.start < span.end && b.end > span.start);
  const byBook = books.length > 1;
  const marks: DetailMark[] = [];
  if (byBook) {
    for (const b of books) {
      marks.push({ position: b.start, label: shortBookName(b.name), color: BOOK_COLORS[data.books.indexOf(b)] });
    }
  } else if (books.length === 1) {
    const b = books[0];
    for (let c = 1; c <= b.chapters; c++) {
      marks.push({ position: data.chapterStarts[b.firstChapter + c - 1], label: String(c) });
    }
  }
  return {
    name: span.name,
    color: span.color,
    rgb: span.rgb,
    start: span.start,
    end: span.end,
    marks,
    byBook,
    headings: byBook ? [] : headings,
  };
}

/** Gather the links from the left axis that land on the right one. */
export function buildDetail(
  data: ConnectionsData,
  left: DetailAxis,
  right: DetailAxis,
  config: DetailConfig,
): DetailModel {
  const out: number[] = [];
  const { mask } = linkMask(data, config.voteFloor, config.maxLinks);
  // Sources are sorted, so the left axis is one binary search and a walk.
  let lo = 0;
  let hi = data.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (data.from[mid] < left.start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < data.count && data.from[i] < left.end; i++) {
    if (!mask[i]) continue;
    const t = data.toStart[i];
    if (t >= right.start && t < right.end) out.push(i);
  }
  return { left, right, links: Int32Array.from(out) };
}

/* --------------------------------------------------------------------------- *
 * Geometry
 * ------------------------------------------------------------------------- */

/** Vertical pan and zoom. The axes stay where they are across; only up and down moves. */
export interface DetailView {
  y: number;
  k: number;
}

export interface DetailFrame {
  leftX: number;
  rightX: number;
  top: number;
  /** The full axis length at zoom 1. */
  length: number;
  /** Where a position falls on each side, on screen. */
  yLeft: (position: number) => number;
  yRight: (position: number) => number;
}

export function detailFrame(
  viewport: { width: number; height: number },
  config: DetailConfig,
  model: DetailModel,
  view: DetailView,
): DetailFrame {
  const { width: W, height: H } = viewport;
  const room = Math.round(W * config.sideRoom);
  const leftX = room;
  const rightX = W - room;
  const top = config.padTop;
  const length = Math.max(40, H - config.padTop - config.padBottom);
  const spanL = model.left.end - model.left.start;
  const spanR = model.right.end - model.right.start;
  const longest = Math.max(spanL, spanR);
  const lenL = config.scale === 'true' ? (length * spanL) / longest : length;
  const lenR = config.scale === 'true' ? (length * spanR) / longest : length;
  const y0 = top + view.y;
  return {
    leftX,
    rightX,
    top,
    length,
    yLeft: (p) => y0 + ((p - model.left.start) / spanL) * lenL * view.k,
    yRight: (p) => y0 + ((p - model.right.start) / spanR) * lenR * view.k,
  };
}

/** A line's four control points: it leaves its verse level and lands level, by `curve`. */
function linePoints(frame: DetailFrame, config: DetailConfig, ya: number, yb: number) {
  const reach = ((frame.rightX - frame.leftX) / 2) * config.curve;
  return [frame.leftX, ya, frame.leftX + reach, ya, frame.rightX - reach, yb, frame.rightX, yb] as const;
}

/** Where a link touches each axis: its source verse, and the middle of its target. */
function ends(data: ConnectionsData, frame: DetailFrame, i: number): [number, number] {
  const ya = frame.yLeft(data.from[i] + 0.5);
  const yb = frame.yRight((data.toStart[i] + data.toEnd[i] + 1) / 2);
  return [ya, yb];
}

/* --------------------------------------------------------------------------- *
 * Lighting
 * ------------------------------------------------------------------------- */

/** What is lit: a passage on one side, and when its lines were loosed. */
export interface DetailLit {
  side: 'left' | 'right';
  span: Span;
  startedAt: number;
}

function isLit(data: ConnectionsData, lit: DetailLit, i: number): boolean {
  if (lit.side === 'left') return data.from[i] >= lit.span.start && data.from[i] < lit.span.end;
  // A ranged target is lit if any of it falls in the span.
  return data.toStart[i] < lit.span.end && data.toEnd[i] >= lit.span.start;
}

/**
 * How far a lit line has drawn itself, 0 to 1.
 *
 * Lines launch in reading order through the tapped passage, so the light rolls
 * down it; each then crosses with an ease-out, quick off the axis and settling
 * as it lands.
 */
function progressOf(
  data: ConnectionsData,
  lit: DetailLit,
  config: DetailConfig,
  i: number,
  elapsed: number,
): number {
  const at = lit.side === 'left' ? data.from[i] : data.toStart[i];
  const share = Math.min(1, Math.max(0, (at - lit.span.start) / Math.max(1, lit.span.end - lit.span.start)));
  const p = (elapsed - share * config.staggerMs) / Math.max(1, config.flightMs);
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 1 - (1 - p) * (1 - p);
}

/** First launch to last landing. */
export function detailVolleyMs(config: DetailConfig): number {
  return Math.max(0, config.staggerMs) + Math.max(1, config.flightMs);
}

/* --------------------------------------------------------------------------- *
 * Drawing
 * ------------------------------------------------------------------------- */

export interface DetailDrawOptions {
  palette: ConnectionsPalette;
  view: DetailView;
  lit?: DetailLit | null;
  /** The clock, and the Motion level: lines only fly at 'full'. */
  now: number;
  motion: 'full' | 'reduced' | 'off';
  /** A picked link to draw on top, solid. */
  picked?: number | null;
}

export interface DetailStats {
  ms: number;
  drawn: number;
  lit: number;
  /** True while lit lines are still crossing, so the caller keeps asking for frames. */
  flying: boolean;
  /** The headings that found room, for hit-testing. */
  placed: PlacedHeading[];
}

export interface PlacedHeading {
  side: 'left' | 'right';
  heading: DetailHeading;
  /** Its box on screen. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The span it heads: from its verse to the next heading on that axis. */
  span: Span;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function drawDetail(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  model: DetailModel,
  config: DetailConfig,
  viewport: { width: number; height: number },
  opts: DetailDrawOptions,
): DetailStats {
  const t0 = performance.now();
  const { width: W, height: H } = viewport;
  const { palette, view } = opts;
  const frame = detailFrame(viewport, config, model, view);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);

  const lit = opts.lit ?? null;
  const elapsed = lit ? opts.now - lit.startedAt : Infinity;
  const flyingNow = !!lit && opts.motion === 'full' && elapsed < detailVolleyMs(config);

  // ── Lines ──
  // Lines are sorted into a few batches by how they look, so each batch is one
  // path and one stroke rather than a stroke per line.
  const restAlpha = lit ? config.opacity * config.dimFloor : config.opacity;
  const rainbowBuckets = 12;
  const nBatches = config.colorBy === 'rainbow' ? rainbowBuckets : 1;
  const rest: Path2D[] = Array.from({ length: nBatches }, () => new Path2D());
  const litPaths: Path2D[] = Array.from({ length: nBatches }, () => new Path2D());
  const heads: Array<[number, number]> = [];
  let drawn = 0;
  let litCount = 0;

  const spanL = model.left.end - model.left.start;
  const bucketOf = (i: number) =>
    config.colorBy === 'rainbow'
      ? Math.min(rainbowBuckets - 1, Math.floor(((data.from[i] - model.left.start) / spanL) * rainbowBuckets))
      : 0;

  for (let n = 0; n < model.links.length; n++) {
    const i = model.links[n];
    const [ya, yb] = ends(data, frame, i);
    // Off screen at both ends and not crossing the screen: skip.
    if ((ya < 0 && yb < 0) || (ya > H && yb > H)) continue;
    const on = lit ? isLit(data, lit, i) : false;
    if (!on && restAlpha <= 0.001) continue;
    const pts = linePoints(frame, config, ya, yb);
    const bucket = bucketOf(i);

    if (on) {
      litCount++;
      const p = flyingNow ? progressOf(data, lit!, config, i, elapsed) : 1;
      if (p <= 0) continue;
      const seg = p >= 1 ? pts : partial(pts, p, lit!.side === 'right');
      const path = litPaths[bucket];
      path.moveTo(seg[0], seg[1]);
      path.bezierCurveTo(seg[2], seg[3], seg[4], seg[5], seg[6], seg[7]);
      if (p < 1) heads.push([seg[6], seg[7]]);
    } else {
      const path = rest[bucket];
      path.moveTo(pts[0], pts[1]);
      path.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
    }
    drawn++;
  }

  ctx.lineWidth = config.thickness;
  ctx.lineCap = 'round';
  const strokeFor = (bucket: number, alpha: number): string | CanvasGradient => {
    if (config.colorBy === 'ink') return rgba(rgbOf(palette.text), alpha);
    if (config.colorBy === 'rainbow') {
      const hue = (bucket / rainbowBuckets) * 300;
      return `hsla(${hue}, 80%, ${palette.pale ? 42 : 62}%, ${alpha})`;
    }
    // Book colors: one gradient across the whole field, since every line in a
    // cell joins the same two axes.
    const leave = config.crossed ? model.right.rgb : model.left.rgb;
    const land = config.crossed ? model.left.rgb : model.right.rgb;
    const g = ctx.createLinearGradient(frame.leftX, 0, frame.rightX, 0);
    const half = config.crossfadeWidth / 2;
    const a = clamp01(config.crossfadeAt - half);
    const b = clamp01(config.crossfadeAt + half);
    g.addColorStop(0, rgba(leave, alpha));
    g.addColorStop(a, rgba(leave, alpha));
    g.addColorStop(Math.max(a, b), rgba(land, alpha));
    g.addColorStop(1, rgba(land, alpha));
    return g;
  };
  for (let b = 0; b < nBatches; b++) {
    if (restAlpha > 0.001) {
      ctx.strokeStyle = strokeFor(b, restAlpha);
      ctx.stroke(rest[b]);
    }
    if (lit) {
      ctx.strokeStyle = strokeFor(b, config.opacity);
      ctx.stroke(litPaths[b]);
    }
  }

  if (heads.length && config.dotSize > 0) {
    const from = lit!.side === 'left' ? model.left.rgb : model.right.rgb;
    ctx.fillStyle = rgba(from, 1);
    ctx.beginPath();
    for (const [x, y] of heads) {
      ctx.moveTo(x + config.dotSize, y);
      ctx.arc(x, y, config.dotSize, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  if (opts.picked != null && opts.picked >= 0) {
    const [ya, yb] = ends(data, frame, opts.picked);
    const pts = linePoints(frame, config, ya, yb);
    ctx.lineWidth = Math.max(2, config.thickness * 3);
    ctx.strokeStyle = palette.text;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    ctx.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
    ctx.stroke();
  }

  // ── Axes ──
  const placed: PlacedHeading[] = [];
  drawAxis(ctx, model.left, 'left', frame, config, palette, viewport, lit, placed);
  drawAxis(ctx, model.right, 'right', frame, config, palette, viewport, lit, placed);

  // The titles, pinned above the axes so they never scroll away.
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, Math.max(0, config.padTop - 8));
  ctx.font = `700 ${config.titleSize}px ${FONT}`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';
  const titleY = Math.max(config.titleSize + 2, config.padTop - 14);
  ctx.fillStyle = model.left.color;
  ctx.fillText(model.left.name, frame.leftX, titleY);
  ctx.fillStyle = model.right.color;
  ctx.fillText(model.right.name, frame.rightX, titleY);
  ctx.fillStyle = palette.muted;
  ctx.font = `${Math.max(9, config.titleSize - 4)}px ${FONT}`;
  ctx.fillText('→', (frame.leftX + frame.rightX) / 2, titleY);

  return { ms: performance.now() - t0, drawn, lit: litCount, flying: flyingNow, placed };
}

/** One axis: the rule, the chapter ticks and numbers, and the headings beyond them. */
function drawAxis(
  ctx: CanvasRenderingContext2D,
  axis: DetailAxis,
  side: 'left' | 'right',
  frame: DetailFrame,
  config: DetailConfig,
  palette: ConnectionsPalette,
  viewport: { width: number; height: number },
  lit: DetailLit | null,
  placed: PlacedHeading[],
) {
  const { width: W, height: H } = viewport;
  const x = side === 'left' ? frame.leftX : frame.rightX;
  const out = side === 'left' ? -1 : 1;
  const yOf = side === 'left' ? frame.yLeft : frame.yRight;
  const yTop = yOf(axis.start);
  const yBottom = yOf(axis.end);

  // The rule, with the lit stretch drawn bolder in the book's color.
  ctx.strokeStyle = palette.rule;
  ctx.lineWidth = config.axisWidth;
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x, yBottom);
  ctx.stroke();
  if (lit && lit.side === side) {
    ctx.strokeStyle = axis.color;
    ctx.lineWidth = config.axisWidth * 2;
    ctx.beginPath();
    ctx.moveTo(x, yOf(lit.span.start));
    ctx.lineTo(x, yOf(lit.span.end));
    ctx.stroke();
  }

  // Ticks on every mark; numbers on as many as fit, at an even step.
  const marks = axis.marks;
  const spacing = marks.length > 1 ? Math.abs(yBottom - yTop) / marks.length : Infinity;
  const need = config.numberSize * 1.35;
  const steps = [1, 2, 5, 10, 25, 50];
  const step = axis.byBook ? 1 : steps.find((s) => spacing * s >= need) ?? 100;

  ctx.strokeStyle = palette.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const m of marks) {
    const y = yOf(m.position);
    if (y < -2 || y > H + 2) continue;
    ctx.moveTo(x, y);
    ctx.lineTo(x + out * config.tickLength, y);
  }
  ctx.stroke();

  ctx.font = `${axis.byBook ? 600 : 500} ${config.numberSize}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = side === 'left' ? 'right' : 'left';
  const numberX = x + out * (config.tickLength + 3);
  let numberWidth = 0;
  marks.forEach((m, n) => {
    const label = Number(m.label);
    if (!axis.byBook && label !== 1 && label % step !== 0) return;
    // Numbers sit at the middle of their chapter, which is what a tap there picks.
    const next = n + 1 < marks.length ? marks[n + 1].position : axis.end;
    const y = (yOf(m.position) + yOf(next)) / 2;
    if (y < -need || y > H + need) return;
    if (axis.byBook && Math.abs(yOf(next) - yOf(m.position)) < config.numberSize * 1.1) return;
    ctx.fillStyle = m.color ?? palette.muted;
    ctx.fillText(m.label, numberX, y);
    numberWidth = Math.max(numberWidth, ctx.measureText(m.label).width);
  });

  // Headings, beyond the numbers, as many as fit without touching.
  if (!config.headings || !axis.headings.length) return;
  const gutter = config.tickLength + 3 + Math.max(numberWidth, config.numberSize * 1.8) + 8;
  const textX = x + out * gutter;
  const room = side === 'left' ? textX - 6 : W - textX - 6;
  if (room < config.headingSize * 3) return;
  const lineH = config.headingSize * 1.3;

  // Major headings get first claim on the space, then the minor ones fill in.
  const candidates = axis.headings
    .map((h, n) => ({ h, n }))
    .filter(({ h }) => config.minorHeadings || h.level <= 1);
  const order = [...candidates].sort((a, b) => a.h.level - b.h.level || a.h.position - b.h.position);
  const taken: Array<[number, number]> = [];
  ctx.textAlign = side === 'left' ? 'right' : 'left';
  for (const { h, n } of order) {
    const y = yOf(h.position + 0.5);
    if (y < config.padTop - lineH || y > H + lineH) continue;
    if (taken.some(([a, b]) => y + lineH / 2 > a && y - lineH / 2 < b)) continue;
    taken.push([y - lineH / 2, y + lineH / 2]);

    ctx.font = `${h.level <= 1 ? 500 : 400} ${config.headingSize}px ${FONT}`;
    const text = fit(ctx, h.text, room);
    const nextPos = axis.headings.slice(n + 1).find((o) => o.level <= h.level)?.position ?? axis.end;
    const inLit = lit && lit.side === side && h.position >= lit.span.start && h.position < lit.span.end;
    ctx.fillStyle = inLit ? axis.color : h.level <= 1 ? palette.text : palette.muted;
    ctx.fillText(text, textX, y);
    const w = ctx.measureText(text).width;
    placed.push({
      side,
      heading: h,
      x0: side === 'left' ? textX - w : textX,
      x1: side === 'left' ? textX : textX + w,
      y0: y - lineH / 2,
      y1: y + lineH / 2,
      span: { start: h.position, end: Math.max(h.position + 1, nextPos) },
    });
  }
}

/** Trim to fit a width, with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + '…' : '';
}

/* --------------------------------------------------------------------------- *
 * Taps
 * ------------------------------------------------------------------------- */

export type DetailHit =
  | { kind: 'mark'; side: 'left' | 'right'; span: Span; label: string }
  | { kind: 'heading'; side: 'left' | 'right'; span: Span; heading: DetailHeading }
  | { kind: 'line'; link: number }
  | { kind: 'title'; side: 'left' | 'right' };

/**
 * What a tap landed on.
 *
 * Out beyond an axis it is a heading if one is under the finger, otherwise the
 * chapter (or, on a group axis, the book) at that height. Between the axes it is
 * the nearest line, and only lit lines count while something is lit.
 */
export function detailHit(
  data: ConnectionsData,
  model: DetailModel,
  config: DetailConfig,
  viewport: { width: number; height: number },
  view: DetailView,
  placed: PlacedHeading[],
  lit: DetailLit | null,
  at: { x: number; y: number },
): DetailHit | null {
  const frame = detailFrame(viewport, config, model, view);

  if (at.y < config.padTop - 6) {
    return { kind: 'title', side: at.x < viewport.width / 2 ? 'left' : 'right' };
  }

  for (const p of placed) {
    if (at.x >= p.x0 - 4 && at.x <= p.x1 + 4 && at.y >= p.y0 && at.y <= p.y1) {
      return { kind: 'heading', side: p.side, span: p.span, heading: p.heading };
    }
  }

  const grab = 18;
  const sideHit: 'left' | 'right' | null =
    at.x <= frame.leftX + grab ? 'left' : at.x >= frame.rightX - grab ? 'right' : null;
  if (sideHit) {
    const axis = sideHit === 'left' ? model.left : model.right;
    const yOf = sideHit === 'left' ? frame.yLeft : frame.yRight;
    for (let n = 0; n < axis.marks.length; n++) {
      const a = axis.marks[n].position;
      const b = n + 1 < axis.marks.length ? axis.marks[n + 1].position : axis.end;
      if (at.y >= yOf(a) && at.y < yOf(b)) {
        return { kind: 'mark', side: sideHit, span: { start: a, end: b }, label: axis.marks[n].label };
      }
    }
    return null;
  }

  // Between the axes: the line nearest the finger at this x.
  let best = -1;
  let bestD = 10;
  for (let n = 0; n < model.links.length; n++) {
    const i = model.links[n];
    if (lit && !isLit(data, lit, i)) continue;
    const [ya, yb] = ends(data, frame, i);
    const pts = linePoints(frame, config, ya, yb);
    const y = yAtX(pts, at.x);
    const d = Math.abs(y - at.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best >= 0 ? { kind: 'line', link: best } : null;
}

/* --------------------------------------------------------------------------- *
 * Curve arithmetic
 * ------------------------------------------------------------------------- */

type Pts = readonly [number, number, number, number, number, number, number, number];

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** The curve's height where it crosses x. x runs one way along every line, so a bisection finds it. */
function yAtX(p: Pts, x: number): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    if (cubic(p[0], p[2], p[4], p[6], mid) < x) lo = mid;
    else hi = mid;
  }
  return cubic(p[1], p[3], p[5], p[7], (lo + hi) / 2);
}

/**
 * The first `t` of a curve, by de Casteljau — from the far end when `reverse`,
 * so a line lit from the right draws leftward. The returned points run from the
 * starting end to the head, so the head is always the last point.
 */
function partial(p: Pts, t: number, reverse: boolean): Pts {
  const q: Pts = reverse ? [p[6], p[7], p[4], p[5], p[2], p[3], p[0], p[1]] : p;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const x01 = lerp(q[0], q[2]), y01 = lerp(q[1], q[3]);
  const x12 = lerp(q[2], q[4]), y12 = lerp(q[3], q[5]);
  const x23 = lerp(q[4], q[6]), y23 = lerp(q[5], q[7]);
  const xa = lerp(x01, x12), ya = lerp(y01, y12);
  const xb = lerp(x12, x23), yb = lerp(y12, y23);
  const xm = lerp(xa, xb), ym = lerp(ya, yb);
  return [q[0], q[1], x01, y01, xa, ya, xm, ym];
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
