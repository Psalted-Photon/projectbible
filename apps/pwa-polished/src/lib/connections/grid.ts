/**
 * The Connections grid: every book against every book.
 *
 * Rows are where a link starts, columns are where it lands. Each cell is the
 * detail view of its book pair in miniature: the source book's axis down the
 * cell's left edge, the target's down its right, and one line across for every
 * link between them — the same curve and the same colors the detail draws
 * (lib/connections/detail.ts), because a cell is the detail seen from further
 * off. Seven group rows and columns (Law, History, Wisdom/Poetry, Prophets,
 * Gospels, Pauline Epistles, General Epistles) sum their books up the same way: a group is a run of whole
 * books, so it squeezes onto one axis exactly as a book does.
 *
 * The whole grid is drawn once into an image, and that image is what pans and
 * zooms. Zoomed in past the image's own pixels, the cells on screen are drawn
 * again live at screen sharpness, as long as there are few enough lines on
 * screen to do it at a good frame rate. So the grid stays a picture of lines at
 * every zoom rather than turning into blurred squares.
 *
 * The labels are not in the image. They are drawn on top, pinned to the top and
 * left edges, so they stay sharp at any zoom and never scroll off — the same
 * idea as the arcs' ruler.
 */

import { linkMask, type ConnectionsData } from './data';
import { BOOK_RGB, BOOK_COLORS, rgbOf } from './palette';
import type { ConnectionsPalette } from './palette';
import type { DetailConfig } from './detail';
import { CATEGORY_COLORS, shortBookName, type BookInfo } from '../bibleData';

export type GroupPlacement = 'start' | 'each' | 'off';

/**
 * The grid's own dials. How a line looks — its curve, its colors, whether the
 * axes are to scale — comes from the detail's dials, so a cell and the detail
 * it opens into always match.
 */
export interface GridConfig {
  /** Hide links fewer readers voted for. 0 keeps every one. */
  voteFloor: number;
  /** The most links shown, keeping the most-voted, as on the arcs. 0 shows every one past the floor. */
  maxLinks: number;
  /** 0 gives every book the same lane; 1 sizes lanes by verse count. Between bends toward it. */
  bookSize: number;
  /** Where the group rows and columns go. */
  groups: GroupPlacement;
  /** A group lane, as a multiple of the average book lane. */
  groupSize: number;
  /** The gap between two lanes, as a share of the average book lane. */
  gap: number;
  /** The extra gap where one group of books ends and the next begins. */
  groupGap: number;
  /** The cached image's side, in pixels. Bigger is sharper and slower to build. */
  imageSize: number;
  /** Line width, in image pixels — and in screen pixels once zoomed in and drawn live. */
  lineWidth: number;
  /** How solid one line is. Where many cross they add up. */
  opacity: number;
  /** Lines on the diagonal, where a book links to itself, relative to the rest. */
  diagonal: number;
  /** How far the two axes sit in from the cell's edges, as a share of its width. */
  inset: number;
  /** How strongly the two axes in every cell are drawn. 0 leaves them out. */
  axisAlpha: number;
  /** A wash of each cell in its column's color, so empty cells still show. */
  cellTint: number;
  /** Book names along the top and left, in CSS pixels. */
  labelSize: number;
  /** Draw the cells on screen live once zoomed past the image, so lines stay sharp. */
  sharpZoom: boolean;
  /** The most lines drawn live; more than this on screen and the image is used. */
  liveLimit: number;
}

/** What the app ships, and what the lab's Reset puts back. */
export const GRID: GridConfig = {
  voteFloor: 1,
  maxLinks: 0,
  bookSize: 0,
  groups: 'each',
  groupSize: 2,
  gap: 0.12,
  groupGap: 0.5,
  imageSize: 3072,
  lineWidth: 0.15,
  opacity: 0.79,
  diagonal: 0.86,
  inset: 0.04,
  axisAlpha: 0.29,
  cellTint: 0.05,
  labelSize: 12,
  sharpZoom: true,
  liveLimit: 80000,
};

/* --------------------------------------------------------------------------- *
 * Groups
 * ------------------------------------------------------------------------- */

export interface BookGroup {
  name: string;
  /** What a lane too narrow for the full name shows. */
  short: string;
  first: string;
  last: string;
  category: BookInfo['category'];
}

/**
 * The seven groups, each a run of whole books in canonical order.
 *
 * Acts rides with the Gospels and Revelation with the General Epistles: the plan names
 * seven groups, and both are a single book whose neighbours are their nearest
 * kin. Each group wears its first category's color.
 */
export const BOOK_GROUPS: BookGroup[] = [
  { name: 'Law', short: 'Law', first: 'Genesis', last: 'Deuteronomy', category: 'pentateuch' },
  { name: 'History', short: 'History', first: 'Joshua', last: 'Esther', category: 'historical' },
  { name: 'Wisdom/Poetry', short: 'Wisdom', first: 'Job', last: 'Song of Solomon', category: 'wisdom' },
  { name: 'Prophets', short: 'Prophets', first: 'Isaiah', last: 'Malachi', category: 'major-prophets' },
  { name: 'Gospels', short: 'Gospels', first: 'Matthew', last: 'Acts', category: 'gospels' },
  { name: 'Pauline Epistles', short: 'Pauline', first: 'Romans', last: 'Philemon', category: 'pauline' },
  { name: 'General Epistles', short: 'General', first: 'Hebrews', last: 'Revelation', category: 'general' },
];

/* --------------------------------------------------------------------------- *
 * Lanes
 * ------------------------------------------------------------------------- */

/** One row and its matching column. Rows and columns share one list of lanes. */
export interface GridLane {
  kind: 'book' | 'group';
  name: string;
  short: string;
  /** The verses it covers, [start, end). */
  start: number;
  end: number;
  /** Where it begins along the side, 0 to 1, and how much of the side it takes. */
  at: number;
  size: number;
  rgb: [number, number, number];
  color: string;
  /** The book's index for a book lane, the group's for a group lane. */
  index: number;
}

export interface GridLayout {
  lanes: GridLane[];
  /** Each book's lane. */
  bookLane: Int16Array;
  /** Each group's lane, or -1 when groups are off. */
  groupLane: Int16Array;
  /** The group each book belongs to. */
  groupOfBook: Int8Array;
}

/** Where every lane sits, from the dials. */
export function buildGridLayout(data: ConnectionsData, config: GridConfig): GridLayout {
  const books = data.books;
  const index = (name: string) => books.findIndex((b) => b.name === name);

  const groupOfBook = new Int8Array(books.length);
  BOOK_GROUPS.forEach((g, gi) => {
    for (let b = index(g.first); b <= index(g.last); b++) groupOfBook[b] = gi;
  });

  // Lane weights, before they are scaled to fit the side.
  const weight = books.map((b) => Math.pow(Math.max(1, b.end - b.start), config.bookSize));
  const avg = weight.reduce((s, w) => s + w, 0) / weight.length;
  const gap = config.gap * avg;
  const groupGap = config.groupGap * avg;
  const groupWeight = config.groupSize * avg;

  type Pending = Omit<GridLane, 'at' | 'size'> & { w: number };
  const order: Array<Pending | { spacer: number }> = [];

  const groupEntry = (gi: number): Pending => {
    const g = BOOK_GROUPS[gi];
    const first = books[index(g.first)];
    const last = books[index(g.last)];
    const color = CATEGORY_COLORS[g.category];
    return {
      kind: 'group',
      name: g.name,
      short: g.short,
      start: first.start,
      end: last.end,
      rgb: rgbOf(color),
      color,
      index: gi,
      w: groupWeight,
    };
  };
  const bookEntry = (b: number): Pending => ({
    kind: 'book',
    name: books[b].name,
    short: shortBookName(books[b].name),
    start: books[b].start,
    end: books[b].end,
    rgb: BOOK_RGB[b],
    color: BOOK_COLORS[b],
    index: b,
    w: weight[b],
  });

  // Spacers go between entries; a run of them collapses to the widest.
  const push = (entry: Pending, spacer: number) => {
    if (order.length) order.push({ spacer });
    order.push(entry);
  };

  if (config.groups === 'start') {
    BOOK_GROUPS.forEach((_, gi) => push(groupEntry(gi), gap));
  }
  let lastGroup = -1;
  for (let b = 0; b < books.length; b++) {
    const gi = groupOfBook[b];
    if (gi !== lastGroup) {
      if (config.groups === 'each') push(groupEntry(gi), groupGap);
      push(bookEntry(b), config.groups === 'each' ? gap : groupGap);
      lastGroup = gi;
    } else {
      push(bookEntry(b), gap);
    }
  }
  // After the group strip at the start, the first book wants the group gap.
  if (config.groups === 'start') {
    const firstBook = order.findIndex((e) => 'kind' in e && e.kind === 'book');
    const before = order[firstBook - 1];
    if (before && 'spacer' in before) before.spacer = groupGap;
  }

  const total = order.reduce((s, e) => s + ('spacer' in e ? e.spacer : e.w), 0);
  const lanes: GridLane[] = [];
  let at = 0;
  for (const e of order) {
    if ('spacer' in e) {
      at += e.spacer / total;
      continue;
    }
    const { w, ...rest } = e;
    lanes.push({ ...rest, at, size: w / total });
    at += w / total;
  }

  const bookLane = new Int16Array(books.length).fill(-1);
  const groupLane = new Int16Array(BOOK_GROUPS.length).fill(-1);
  lanes.forEach((lane, i) => {
    if (lane.kind === 'book') bookLane[lane.index] = i;
    else groupLane[lane.index] = i;
  });

  return { lanes, bookLane, groupLane, groupOfBook };
}

/** The lane at a fraction of the side, or -1 in a gap or off the grid. */
export function laneAt(layout: GridLayout, fraction: number): number {
  const lanes = layout.lanes;
  let lo = 0;
  let hi = lanes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lanes[mid].at <= fraction) lo = mid;
    else hi = mid - 1;
  }
  const lane = lanes[lo];
  return fraction >= lane.at && fraction < lane.at + lane.size ? lo : -1;
}

/** A book or a group by name, as a detail axis wants it, whatever the grid's layout. */
export function laneNamed(
  data: ConnectionsData,
  name: string,
): { kind: 'book' | 'group'; name: string; color: string; rgb: [number, number, number]; start: number; end: number } | null {
  const b = data.books.findIndex((book) => book.name === name);
  if (b >= 0) {
    return { kind: 'book', name, color: BOOK_COLORS[b], rgb: BOOK_RGB[b], start: data.books[b].start, end: data.books[b].end };
  }
  const g = BOOK_GROUPS.find((group) => group.name === name);
  if (!g) return null;
  const first = data.books.find((book) => book.name === g.first);
  const last = data.books.find((book) => book.name === g.last);
  if (!first || !last) return null;
  const color = CATEGORY_COLORS[g.category];
  return { kind: 'group', name, color, rgb: rgbOf(color), start: first.start, end: last.end };
}

/* --------------------------------------------------------------------------- *
 * Sorting the links into cells
 * ------------------------------------------------------------------------- */

/** Every cell's links, so a cell can be drawn without a pass over all of them. */
export interface GridCells {
  /** Links per cell, lanes × lanes, row-major (row = source lane). */
  counts: Int32Array;
  /** Where each cell's links begin in `links`, with one extra entry at the end. */
  offsets: Int32Array;
  /** Link indexes, grouped by cell. A link is in every cell it lands in — up to four. */
  links: Int32Array;
  /** Links that passed the vote floor. */
  passed: number;
  ms: number;
}

/**
 * Sort every link into the cells it belongs to.
 *
 * A link lands in its book cell and, when groups are on, the group row, the
 * group column and the group-by-group corner. Two passes: count, then fill, so
 * the lists are one flat array rather than five thousand small ones.
 */
export function sortIntoCells(data: ConnectionsData, config: GridConfig, layout: GridLayout): GridCells {
  const t0 = performance.now();
  const L = layout.lanes.length;
  const total = data.totalVerses;

  const verseBook = new Int8Array(total);
  data.books.forEach((book, b) => verseBook.fill(b, book.start, book.end));

  const rowA = new Int16Array(data.books.length);
  const rowB = new Int16Array(data.books.length);
  for (let b = 0; b < data.books.length; b++) {
    rowA[b] = layout.bookLane[b];
    rowB[b] = layout.groupLane[layout.groupOfBook[b]];
  }

  const { mask } = linkMask(data, config.voteFloor, config.maxLinks);
  const keep = (i: number) => {
    if (!mask[i]) return false;
    const f = data.from[i];
    const t = data.toStart[i];
    return f >= 0 && f < total && t >= 0 && t < total;
  };

  const counts = new Int32Array(L * L);
  let passed = 0;
  let entries = 0;
  for (let i = 0; i < data.count; i++) {
    if (!keep(i)) continue;
    passed++;
    const fb = verseBook[data.from[i]];
    const tb = verseBook[data.toStart[i]];
    for (const r of [rowA[fb], rowB[fb]]) {
      if (r < 0) continue;
      for (const c of [rowA[tb], rowB[tb]]) {
        if (c < 0) continue;
        counts[r * L + c]++;
        entries++;
      }
    }
  }

  const offsets = new Int32Array(L * L + 1);
  for (let k = 0; k < L * L; k++) offsets[k + 1] = offsets[k] + counts[k];
  const cursor = offsets.slice(0, L * L);
  const links = new Int32Array(entries);
  for (let i = 0; i < data.count; i++) {
    if (!keep(i)) continue;
    const fb = verseBook[data.from[i]];
    const tb = verseBook[data.toStart[i]];
    for (const r of [rowA[fb], rowB[fb]]) {
      if (r < 0) continue;
      for (const c of [rowA[tb], rowB[tb]]) {
        if (c < 0) continue;
        links[cursor[r * L + c]++] = i;
      }
    }
  }

  return { counts, offsets, links, passed, ms: performance.now() - t0 };
}

/* --------------------------------------------------------------------------- *
 * Drawing cells
 * ------------------------------------------------------------------------- */

/** Where the grid's top-left corner is and how long its side is, in whatever space is being drawn. */
interface Placement {
  ox: number;
  oy: number;
  unit: number;
}

const RAINBOW = 12;

/**
 * Draw a block of cells: the wash, the two axes in each, and the lines.
 *
 * The same code builds the cached image (every cell, in image pixels) and the
 * live drawing when zoomed in (only the cells on screen, in screen pixels), so
 * the two match where one hands over to the other.
 *
 * With the books' colors every cell needs its own gradient, so each cell is one
 * stroke. The rainbow and the single ink don't depend on the cell, so their
 * lines from every cell share a few paths and a few strokes.
 */
function drawCells(
  ctx: CanvasRenderingContext2D,
  data: ConnectionsData,
  cells: GridCells,
  layout: GridLayout,
  grid: GridConfig,
  detail: DetailConfig,
  palette: ConnectionsPalette,
  at: Placement,
  rows: number[],
  cols: number[],
  width: number,
  axisWidth: number,
): number {
  const lanes = layout.lanes;
  const L = lanes.length;
  /** A lane's start and length, measured from the grid's corner. */
  const box = (lane: GridLane) => [lane.at * at.unit, lane.size * at.unit] as const;

  // The wash.
  if (grid.cellTint > 0) {
    for (const r of rows) {
      const [y, h] = box(lanes[r]);
      for (const c of cols) {
        const [x, w] = box(lanes[c]);
        ctx.fillStyle = rgba(lanes[c].rgb, grid.cellTint);
        ctx.fillRect(at.ox + x, at.oy + y, w, h);
      }
    }
  }

  // Where each cell's two axes stand, and how tall each is.
  const geometry = (r: number, c: number) => {
    const row = lanes[r];
    const col = lanes[c];
    const [bx, w] = box(col);
    const [by, h] = box(row);
    const x = at.ox + bx;
    const y = at.oy + by;
    const inset = w * grid.inset;
    const spanL = row.end - row.start;
    const spanR = col.end - col.start;
    const longest = Math.max(spanL, spanR);
    const hL = detail.scale === 'true' ? (h * spanL) / longest : h;
    const hR = detail.scale === 'true' ? (h * spanR) / longest : h;
    return { x0: x + inset, x1: x + w - inset, y, hL, hR, row, col, spanL, spanR };
  };

  // The axes.
  if (grid.axisAlpha > 0) {
    const axes = new Path2D();
    for (const r of rows) {
      for (const c of cols) {
        const g = geometry(r, c);
        axes.moveTo(g.x0, g.y);
        axes.lineTo(g.x0, g.y + g.hL);
        axes.moveTo(g.x1, g.y);
        axes.lineTo(g.x1, g.y + g.hR);
      }
    }
    ctx.strokeStyle = rgba(rgbOf(palette.rule), grid.axisAlpha);
    ctx.lineWidth = axisWidth;
    ctx.stroke(axes);
  }

  // The lines.
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  const ink = rgbOf(palette.text);
  const shared = detail.colorBy === 'books' ? null : [0, 1].map(() => Array.from({ length: RAINBOW }, () => new Path2D()));
  let drawn = 0;

  for (const r of rows) {
    for (const c of cols) {
      const k = r * L + c;
      const n = cells.counts[k];
      if (!n) continue;
      const g = geometry(r, c);
      const reach = ((g.x1 - g.x0) / 2) * detail.curve;
      const diag = r === c ? 1 : 0;
      const own = shared ? null : new Path2D();

      for (let j = cells.offsets[k]; j < cells.offsets[k + 1]; j++) {
        const i = cells.links[j];
        const sf = (data.from[i] - g.row.start + 0.5) / g.spanL;
        const ya = g.y + sf * g.hL;
        const yb = g.y + (((data.toStart[i] + data.toEnd[i] + 1) / 2 - g.col.start) / g.spanR) * g.hR;
        const path = own ?? shared![diag][detail.colorBy === 'rainbow' ? Math.min(RAINBOW - 1, Math.floor(sf * RAINBOW)) : 0];
        path.moveTo(g.x0, ya);
        path.bezierCurveTo(g.x0 + reach, ya, g.x1 - reach, yb, g.x1, yb);
        drawn++;
      }

      if (own) {
        const alpha = grid.opacity * (diag ? grid.diagonal : 1);
        const leave = detail.crossed ? g.col.rgb : g.row.rgb;
        const land = detail.crossed ? g.row.rgb : g.col.rgb;
        const gradient = ctx.createLinearGradient(g.x0, 0, g.x1, 0);
        const half = detail.crossfadeWidth / 2;
        const a = clamp01(detail.crossfadeAt - half);
        const b = Math.max(a, clamp01(detail.crossfadeAt + half));
        gradient.addColorStop(0, rgba(leave, alpha));
        gradient.addColorStop(a, rgba(leave, alpha));
        gradient.addColorStop(b, rgba(land, alpha));
        gradient.addColorStop(1, rgba(land, alpha));
        ctx.strokeStyle = gradient;
        ctx.stroke(own);
      }
    }
  }

  if (shared) {
    for (const diag of [0, 1]) {
      const alpha = grid.opacity * (diag ? grid.diagonal : 1);
      for (let bucket = 0; bucket < RAINBOW; bucket++) {
        ctx.strokeStyle =
          detail.colorBy === 'rainbow'
            ? `hsla(${(bucket / RAINBOW) * 300}, 80%, ${palette.pale ? 42 : 62}%, ${alpha})`
            : rgba(ink, alpha);
        ctx.stroke(shared[diag][bucket]);
        if (detail.colorBy === 'ink') break;
      }
    }
  }
  return drawn;
}

/** The axes' width in the image: never thinner than half a pixel, or they vanish. */
function axisWidthOf(grid: GridConfig): number {
  return Math.max(0.5, grid.lineWidth);
}

/** The whole grid, drawn once into an image. */
export function paintGrid(
  data: ConnectionsData,
  cells: GridCells,
  layout: GridLayout,
  grid: GridConfig,
  detail: DetailConfig,
  palette: ConnectionsPalette,
): { image: HTMLCanvasElement; ms: number } {
  const t0 = performance.now();
  const S = Math.max(256, Math.round(grid.imageSize));
  const image = document.createElement('canvas');
  image.width = S;
  image.height = S;
  const ctx = image.getContext('2d')!;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, S, S);
  const all = layout.lanes.map((_, i) => i);
  drawCells(ctx, data, cells, layout, grid, detail, palette, { ox: 0, oy: 0, unit: S }, all, all, grid.lineWidth, axisWidthOf(grid));
  return { image, ms: performance.now() - t0 };
}

/* --------------------------------------------------------------------------- *
 * On screen
 * ------------------------------------------------------------------------- */

/** Pan and zoom: the grid's top-left moves by x/y and its side scales by k. */
export interface GridView {
  x: number;
  y: number;
  k: number;
}

/** Where the grid sits on a canvas before any pan or zoom. */
export interface GridFrame {
  /** The width of the pinned name bands, top and left. */
  band: number;
  left: number;
  top: number;
  side: number;
}

export function gridFrame(viewport: { width: number; height: number }, config: GridConfig): GridFrame {
  const band = Math.ceil(config.labelSize * 4.6);
  const pad = 6;
  const side = Math.max(40, Math.min(viewport.width - band - pad, viewport.height - band - pad));
  return { band, left: band, top: band, side };
}

/** A lane's two edges on screen, along x (columns) or y (rows). */
function laneOnScreen(lane: GridLane, frame: GridFrame, view: GridView, axis: 'x' | 'y'): [number, number] {
  const origin = axis === 'x' ? frame.left + view.x : frame.top + view.y;
  const unit = frame.side * view.k;
  return [origin + lane.at * unit, origin + (lane.at + lane.size) * unit];
}

/** The cell under a screen point, as row and column lanes, or null. */
export function cellAt(
  layout: GridLayout,
  frame: GridFrame,
  view: GridView,
  at: { x: number; y: number },
): { row: number; col: number } | null {
  if (at.x < frame.band || at.y < frame.band) return null;
  const unit = frame.side * view.k;
  const u = (at.x - frame.left - view.x) / unit;
  const v = (at.y - frame.top - view.y) / unit;
  const col = laneAt(layout, u);
  const row = laneAt(layout, v);
  return row >= 0 && col >= 0 ? { row, col } : null;
}

/** A name in the pinned bands under a screen point, so a tap there can light a row or column. */
export function bandAt(
  layout: GridLayout,
  frame: GridFrame,
  view: GridView,
  at: { x: number; y: number },
): { axis: 'row' | 'col'; lane: number } | null {
  const unit = frame.side * view.k;
  if (at.y < frame.band && at.x >= frame.band) {
    const lane = laneAt(layout, (at.x - frame.left - view.x) / unit);
    return lane >= 0 ? { axis: 'col', lane } : null;
  }
  if (at.x < frame.band && at.y >= frame.band) {
    const lane = laneAt(layout, (at.y - frame.top - view.y) / unit);
    return lane >= 0 ? { axis: 'row', lane } : null;
  }
  return null;
}

/** Everything the grid draws from. */
export interface GridScene {
  data: ConnectionsData;
  cells: GridCells;
  layout: GridLayout;
  image: HTMLCanvasElement;
}

export interface GridDrawOptions {
  palette: ConnectionsPalette;
  view: GridView;
  /** The cell to ring, if one is picked. */
  picked?: { row: number; col: number } | null;
  /** The cell under the mouse, ringed more softly. */
  hovered?: { row: number; col: number } | null;
  /** A row or column to keep bright while the rest dims. */
  focus?: { axis: 'row' | 'col'; lane: number } | null;
  /** How dim the rest goes around a focused row or column, 0 to 1. */
  dimTo?: number;
  /**
   * Draw every cell on screen as lines, whatever the zoom or the count, with
   * lines as fine as the image would show them. For the saved image, which is
   * drawn far larger than the screen and would otherwise be the cached image
   * blown up.
   */
  everyCell?: boolean;
}

export interface GridDrawStats {
  /** True when the cells on screen were drawn live rather than from the image. */
  live: boolean;
  /** Lines on screen: drawn live, or the count that was too many to. */
  lines: number;
  ms: number;
}

/**
 * One frame: the grid under the pan and zoom, then the pinned names.
 *
 * Within the image's own resolution the cached image is drawn, which costs
 * nothing. Zoomed past it, the cells on screen are drawn live if their lines
 * fit under the limit, so they stay lines rather than blurring.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  scene: GridScene,
  grid: GridConfig,
  detail: DetailConfig,
  viewport: { width: number; height: number },
  opts: GridDrawOptions,
): GridDrawStats {
  const t0 = performance.now();
  const { width: W, height: H } = viewport;
  const { palette, view } = opts;
  const { layout, image } = scene;
  const frame = gridFrame(viewport, grid);
  const unit = frame.side * view.k;
  const gx = frame.left + view.x;
  const gy = frame.top + view.y;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.band, frame.band, W - frame.band, H - frame.band);
  ctx.clip();

  let live = false;
  let lines = 0;
  if (opts.everyCell || (grid.sharpZoom && unit > image.width)) {
    // The lanes on screen, and how many lines their cells hold.
    const seen = (axis: 'x' | 'y', lo: number, hi: number) =>
      layout.lanes
        .map((lane, i) => ({ i, edge: laneOnScreen(lane, frame, view, axis) }))
        .filter(({ edge }) => edge[1] > lo && edge[0] < hi)
        .map(({ i }) => i);
    const cols = seen('x', frame.band, W);
    const rows = seen('y', frame.band, H);
    const L = layout.lanes.length;
    for (const r of rows) for (const c of cols) lines += scene.cells.counts[r * L + c];
    if (opts.everyCell || lines <= grid.liveLimit) {
      live = true;
      // Lines keep the width the image gives them on screen, so the hand-over
      // from image to live drawing (or to the saved image) doesn't jump.
      const f = Math.min(1, unit / image.width);
      lines = drawCells(ctx, scene.data, scene.cells, layout, grid, detail, palette, { ox: gx, oy: gy, unit }, rows, cols, grid.lineWidth * f, axisWidthOf(grid) * f);
    }
  }
  if (!live) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, gx, gy, unit, unit);
  }

  if (opts.focus) {
    const lane = layout.lanes[opts.focus.lane];
    const [a, b] = laneOnScreen(lane, frame, view, opts.focus.axis === 'col' ? 'x' : 'y');
    ctx.fillStyle = rgba(rgbOf(palette.bg), 1 - (opts.dimTo ?? 0.3));
    if (opts.focus.axis === 'col') {
      ctx.fillRect(frame.band, frame.band, a - frame.band, H);
      ctx.fillRect(b, frame.band, W - b, H);
    } else {
      ctx.fillRect(frame.band, frame.band, W, a - frame.band);
      ctx.fillRect(frame.band, b, W, H - b);
    }
  }

  // The hovered and picked squares: a soft halo in the ink, then the ring —
  // the same glow the Arcs tab gives an arc.
  const ring = (cell: { row: number; col: number }, strong: boolean) => {
    const [x0, x1] = laneOnScreen(layout.lanes[cell.col], frame, view, 'x');
    const [y0, y1] = laneOnScreen(layout.lanes[cell.row], frame, view, 'y');
    const ink = rgbOf(palette.text);
    ctx.strokeStyle = rgba(ink, strong ? 0.45 : 0.3);
    ctx.lineWidth = strong ? 7 : 5;
    ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
    ctx.strokeStyle = strong ? palette.text : rgba(ink, 0.8);
    ctx.lineWidth = strong ? 1.5 : 1;
    ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  };
  const hov = opts.hovered;
  if (hov && !(opts.picked && opts.picked.row === hov.row && opts.picked.col === hov.col)) ring(hov, false);
  if (opts.picked) ring(opts.picked, true);
  ctx.restore();

  drawBands(ctx, layout, grid, frame, view, viewport, palette, opts.focus ?? null);
  return { live, lines, ms: performance.now() - t0 };
}

/** The names, pinned to the top and left edges. */
function drawBands(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  config: GridConfig,
  frame: GridFrame,
  view: GridView,
  viewport: { width: number; height: number },
  palette: ConnectionsPalette,
  focus: { axis: 'row' | 'col'; lane: number } | null,
) {
  const { width: W, height: H } = viewport;
  const size = config.labelSize;
  const band = frame.band;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, band);
  ctx.fillRect(0, 0, band, H);

  const font = (lane: GridLane) =>
    `${lane.kind === 'group' ? 700 : 500} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  // Columns: across the top. Wide lanes read level; narrow ones stand on end.
  ctx.save();
  ctx.beginPath();
  ctx.rect(band, 0, W - band, band);
  ctx.clip();
  layout.lanes.forEach((lane, i) => {
    const [a, b] = laneOnScreen(lane, frame, view, 'x');
    if (b < band || a > W) return;
    const w = b - a;
    ctx.font = font(lane);
    ctx.fillStyle = lane.color;
    ctx.globalAlpha = focus && !(focus.axis === 'col' && focus.lane === i) ? 0.45 : 1;
    const full = ctx.measureText(lane.name).width;
    const short = ctx.measureText(lane.short).width;
    const text = w >= full + 4 ? lane.name : w >= short + 4 ? lane.short : null;
    if (text) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, (a + b) / 2, band - 4);
    } else if (w >= size * 0.9) {
      ctx.save();
      ctx.translate((a + b) / 2, band - 4);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(lane.short, 0, 0);
      ctx.restore();
    }
  });
  ctx.restore();

  // Rows: down the left, level, ending at the band's edge.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, band, band, H - band);
  ctx.clip();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  layout.lanes.forEach((lane, i) => {
    const [a, b] = laneOnScreen(lane, frame, view, 'y');
    if (b < band || a > H) return;
    if (b - a < size * 0.9) return;
    ctx.font = font(lane);
    ctx.fillStyle = lane.color;
    ctx.globalAlpha = focus && !(focus.axis === 'row' && focus.lane === i) ? 0.45 : 1;
    const text = ctx.measureText(lane.name).width <= band - 6 ? lane.name : lane.short;
    ctx.fillText(text, band - 4, (a + b) / 2);
  });
  ctx.restore();
  ctx.globalAlpha = 1;

  // The corner: which way the grid reads.
  ctx.fillStyle = palette.muted;
  ctx.font = `${Math.max(8, size - 2)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('from ↓', 4, 4);
  ctx.fillText('to →', 4, 4 + size + 2);
}

function rgba(c: readonly [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
