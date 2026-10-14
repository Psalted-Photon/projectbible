/**
 * The Connections grid: every book against every book.
 *
 * Rows are where a link starts, columns are where it lands. Each cell is a tiny
 * verse-by-verse picture of one book pair — the source book's verses running
 * top to bottom, the target's left to right — so a dot in Psalms × Proverbs is
 * one psalm verse pointing at one proverb. Seven group rows and columns (Law,
 * History, Poetry, Prophets, Gospels, Paul, Letters) sum their books up, and are
 * verse pictures too: a group is a run of whole books, so it squeezes into one
 * lane exactly as a book does.
 *
 * The whole grid is drawn once into an image and that image is what pans and
 * zooms. 344,799 links splatted into a count buffer is a few hundred
 * milliseconds; scaling a finished image is free. The splat and the coloring
 * are separate steps so the dials that only change color (brightness, curve,
 * tint) don't redo the counting.
 *
 * The labels are not in the image. They are drawn on top, pinned to the top and
 * left edges, so they stay sharp at any zoom and never scroll off — the same
 * idea as the arcs' ruler.
 */

import type { ConnectionsData } from './data';
import { BOOK_RGB, BOOK_COLORS } from './palette';
import type { ConnectionsPalette } from './palette';
import { CATEGORY_COLORS, shortBookName, type BookInfo } from '../bibleData';

export type GroupPlacement = 'start' | 'each' | 'off';
export type GridColorBy = 'source' | 'target' | 'ink';

export interface GridConfig {
  /** Hide links fewer readers voted for. 0 keeps every one. */
  voteFloor: number;
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
  /** The cached image's side, in pixels. Bigger is sharper zoomed in and slower to build. */
  imageSize: number;
  /** Each link's dot in the image, in image pixels. */
  dotSize: number;
  /** How fast a pixel saturates as links pile onto it. */
  brightness: number;
  /** Below 1 lifts the faint dots; above 1 leaves only the dense ones bright. */
  curve: number;
  /** Which book's color a dot wears. */
  colorBy: GridColorBy;
  /** How strongly each cell is tinted in its color, so empty cells still show. */
  cellTint: number;
  /** Brightness on the diagonal, where a book links to itself, relative to the rest. */
  diagonal: number;
  /** Book names along the top and left, in CSS pixels. */
  labelSize: number;
  /** Smooth the image when zoomed in, rather than showing its pixels square. */
  smooth: boolean;
}

/** What the app ships, and what the lab's Reset puts back. */
export const GRID: GridConfig = {
  voteFloor: 1,
  bookSize: 0.5,
  groups: 'start',
  groupSize: 2.5,
  gap: 0.12,
  groupGap: 0.5,
  imageSize: 2048,
  dotSize: 1,
  brightness: 0.6,
  curve: 0.7,
  colorBy: 'target',
  cellTint: 0.07,
  diagonal: 0.5,
  labelSize: 11,
  smooth: false,
};

/* --------------------------------------------------------------------------- *
 * Groups
 * ------------------------------------------------------------------------- */

export interface BookGroup {
  name: string;
  first: string;
  last: string;
  category: BookInfo['category'];
}

/**
 * The seven groups, each a run of whole books in canonical order.
 *
 * Acts rides with the Gospels and Revelation with the Letters: the plan names
 * seven groups, and both are a single book whose neighbours are their nearest
 * kin. Each group wears its first category's color.
 */
export const BOOK_GROUPS: BookGroup[] = [
  { name: 'Law', first: 'Genesis', last: 'Deuteronomy', category: 'pentateuch' },
  { name: 'History', first: 'Joshua', last: 'Esther', category: 'historical' },
  { name: 'Poetry', first: 'Job', last: 'Song of Solomon', category: 'wisdom' },
  { name: 'Prophets', first: 'Isaiah', last: 'Malachi', category: 'major-prophets' },
  { name: 'Gospels', first: 'Matthew', last: 'Acts', category: 'gospels' },
  { name: 'Paul', first: 'Romans', last: 'Philemon', category: 'pauline' },
  { name: 'Letters', first: 'Hebrews', last: 'Revelation', category: 'general' },
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

function rgbOfHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
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
      short: g.name,
      start: first.start,
      end: last.end,
      rgb: rgbOfHex(color),
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

/* --------------------------------------------------------------------------- *
 * The cached image
 * ------------------------------------------------------------------------- */

/** The counting pass: how many links landed on every pixel. */
export interface GridCounts {
  size: number;
  counts: Float32Array;
  /** Links per cell, lanes × lanes, row-major (row = source lane). */
  cells: Int32Array;
  /** Links that passed the vote floor. */
  links: number;
  ms: number;
}

/**
 * Splat every link into a count buffer.
 *
 * Each link lands up to four times: its book cell, and when groups are on, the
 * group row, the group column and the group-by-group corner. A link to a range
 * of verses marks each column it covers, so a reference to a whole psalm reads
 * as a short dash rather than a single dot.
 */
export function countGrid(data: ConnectionsData, config: GridConfig, layout: GridLayout): GridCounts {
  const t0 = performance.now();
  const S = Math.max(64, Math.round(config.imageSize));
  const counts = new Float32Array(S * S);
  const L = layout.lanes.length;
  const cells = new Int32Array(L * L);
  const total = data.totalVerses;

  // Every verse's book, and its pixel within its book lane and its group lane.
  const verseBook = new Int8Array(total);
  const bookPx = new Int32Array(total);
  const groupPx = new Int32Array(total).fill(-1);
  const pixelIn = (lane: GridLane, v: number) =>
    Math.min(S - 1, Math.floor((lane.at + ((v - lane.start + 0.5) / (lane.end - lane.start)) * lane.size) * S));
  for (let b = 0; b < data.books.length; b++) {
    const book = data.books[b];
    const lane = layout.lanes[layout.bookLane[b]];
    const gl = layout.groupLane[layout.groupOfBook[b]];
    const group = gl >= 0 ? layout.lanes[gl] : null;
    for (let v = book.start; v < book.end; v++) {
      verseBook[v] = b;
      bookPx[v] = pixelIn(lane, v);
      if (group) groupPx[v] = pixelIn(group, v);
    }
  }

  const d = Math.max(1, Math.round(config.dotSize));
  const splat = (row: number, col: number) => {
    for (let dy = 0; dy < d; dy++) {
      const r = row + dy;
      if (r >= S) break;
      const base = r * S;
      for (let dx = 0; dx < d; dx++) {
        const c = col + dx;
        if (c >= S) break;
        counts[base + c] += 1;
      }
    }
  };

  const rows = [0, 0];
  let links = 0;
  for (let i = 0; i < data.count; i++) {
    if (data.votes[i] < config.voteFloor) continue;
    const from = data.from[i];
    const t0v = data.toStart[i];
    // A runaway range would smear a whole row; no real reference spans more.
    const t1v = Math.min(data.toEnd[i], t0v + 200, total - 1);
    if (from < 0 || from >= total || t0v < 0 || t0v >= total) continue;
    links++;

    const nRows = groupPx[from] >= 0 ? 2 : 1;
    rows[0] = bookPx[from];
    rows[1] = groupPx[from];

    for (let r = 0; r < nRows; r++) {
      let lastBook = -1;
      let lastGroup = -1;
      for (let t = t0v; t <= t1v; t++) {
        const bp = bookPx[t];
        if (bp !== lastBook) {
          splat(rows[r], bp);
          lastBook = bp;
        }
        const gp = groupPx[t];
        if (gp >= 0 && gp !== lastGroup) {
          splat(rows[r], gp);
          lastGroup = gp;
        }
      }
    }

    // Cell totals go by the first target verse, once per cell.
    const fb = verseBook[from];
    const tb = verseBook[t0v];
    const rowLanes = [layout.bookLane[fb], layout.groupLane[layout.groupOfBook[fb]]];
    const colLanes = [layout.bookLane[tb], layout.groupLane[layout.groupOfBook[tb]]];
    for (const rl of rowLanes) {
      if (rl < 0) continue;
      for (const cl of colLanes) if (cl >= 0) cells[rl * L + cl]++;
    }
  }

  return { size: S, counts, cells, links, ms: performance.now() - t0 };
}

/** A color the canvas was given, as numbers. Takes #rgb, #rrggbb and rgb(). */
export function rgbOf(color: string): [number, number, number] {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  let h = color.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(h)) return [128, 128, 128];
  return rgbOfHex(h);
}

/**
 * Turn the counts into a picture.
 *
 * A pixel's strength is 1 − e^(−count × brightness), bent by the curve, so the
 * first few links on a pixel show clearly and a pile of hundreds saturates
 * rather than blowing out. The diagonal is scaled separately: a book's links to
 * its own next verses are by far the densest cells and would otherwise drown
 * the rest.
 */
export function colorGrid(
  grid: GridCounts,
  config: GridConfig,
  layout: GridLayout,
  palette: ConnectionsPalette,
): { image: HTMLCanvasElement; ms: number } {
  const t0 = performance.now();
  const S = grid.size;
  const lanes = layout.lanes;

  const laneOfPx = new Int16Array(S).fill(-1);
  lanes.forEach((lane, i) => {
    const a = Math.floor(lane.at * S);
    const b = Math.min(S, Math.ceil((lane.at + lane.size) * S));
    for (let p = a; p < b; p++) laneOfPx[p] = i;
  });

  const [br, bg, bb] = rgbOf(palette.bg);
  const ink = rgbOf(palette.text);
  const tint = config.cellTint;
  const gain = config.brightness;
  const curve = config.curve;
  const diagonal = config.diagonal;

  const image = document.createElement('canvas');
  image.width = S;
  image.height = S;
  const ctx = image.getContext('2d')!;
  const out = ctx.createImageData(S, S);
  const px = out.data;
  const counts = grid.counts;

  for (let y = 0; y < S; y++) {
    const ly = laneOfPx[y];
    const rowBase = y * S;
    for (let x = 0; x < S; x++) {
      const o = (rowBase + x) * 4;
      const lx = laneOfPx[x];
      if (ly < 0 || lx < 0) {
        px[o] = br;
        px[o + 1] = bg;
        px[o + 2] = bb;
        px[o + 3] = 255;
        continue;
      }
      const base = config.colorBy === 'source' ? lanes[ly].rgb : config.colorBy === 'target' ? lanes[lx].rgb : ink;
      const cr = br + (base[0] - br) * tint;
      const cg = bg + (base[1] - bg) * tint;
      const cb = bb + (base[2] - bb) * tint;
      let c = counts[rowBase + x];
      let a = 0;
      if (c > 0) {
        if (ly === lx) c *= diagonal;
        a = Math.pow(1 - Math.exp(-c * gain), curve);
      }
      px[o] = cr + (base[0] - cr) * a;
      px[o + 1] = cg + (base[1] - cg) * a;
      px[o + 2] = cb + (base[2] - cb) * a;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
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

export interface GridDrawOptions {
  palette: ConnectionsPalette;
  view: GridView;
  /** The cell to ring, if one is picked. */
  picked?: { row: number; col: number } | null;
  /** A row or column to keep bright while the rest dims. */
  focus?: { axis: 'row' | 'col'; lane: number } | null;
  /** How dim the rest goes around a focused row or column, 0 to 1. */
  dimTo?: number;
}

/**
 * One frame: the cached image under the pan and zoom, then the pinned names.
 * Cheap enough to run on every pointer move.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  layout: GridLayout,
  config: GridConfig,
  viewport: { width: number; height: number },
  opts: GridDrawOptions,
): void {
  const { width: W, height: H } = viewport;
  const { palette, view } = opts;
  const frame = gridFrame(viewport, config);
  const unit = frame.side * view.k;
  const gx = frame.left + view.x;
  const gy = frame.top + view.y;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.band, frame.band, W - frame.band, H - frame.band);
  ctx.clip();
  // Zoomed past one image pixel per screen pixel, square pixels are honest:
  // each one is a run of verses, and blurring them pretends to detail.
  ctx.imageSmoothingEnabled = config.smooth || unit < image.width;
  ctx.drawImage(image, gx, gy, unit, unit);

  if (opts.focus) {
    const lane = layout.lanes[opts.focus.lane];
    const [a, b] = laneOnScreen(lane, frame, view, opts.focus.axis === 'col' ? 'x' : 'y');
    ctx.fillStyle = withAlpha(palette.bg, 1 - (opts.dimTo ?? 0.3));
    if (opts.focus.axis === 'col') {
      ctx.fillRect(frame.band, frame.band, a - frame.band, H);
      ctx.fillRect(b, frame.band, W - b, H);
    } else {
      ctx.fillRect(frame.band, frame.band, W, a - frame.band);
      ctx.fillRect(frame.band, b, W, H - b);
    }
  }

  if (opts.picked) {
    const [x0, x1] = laneOnScreen(layout.lanes[opts.picked.col], frame, view, 'x');
    const [y0, y1] = laneOnScreen(layout.lanes[opts.picked.row], frame, view, 'y');
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  }
  ctx.restore();

  drawBands(ctx, layout, config, frame, view, viewport, palette, opts.focus ?? null);
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

function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = rgbOf(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
