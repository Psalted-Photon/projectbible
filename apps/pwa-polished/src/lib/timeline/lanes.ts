/**
 * The lanes beside the events: kings, prophets, world powers, lifespans and
 * when each book was written.
 *
 * Each lane is a column of bars, one per item, running from its first year to
 * its last on whichever scale the strip is using. Where items overlap they take
 * side-by-side columns inside the lane, worked out once from the years alone;
 * what is on screen, and where the labels go, is worked out per frame in stage
 * pixels, the same as everything else on the strip.
 */

import type { TimelineItem } from './data';
import { itemColor, type TimelineScale } from './layout';

export type LaneId = 'kings' | 'prophets' | 'world' | 'lives' | 'books';

export const LANES: { id: LaneId; label: string; header: string }[] = [
  { id: 'kings', label: 'Kings of Judah and Israel', header: 'Judah · Israel' },
  { id: 'prophets', label: 'Prophets', header: 'Prophets' },
  { id: 'world', label: 'World powers', header: 'World' },
  { id: 'lives', label: 'Lifespans', header: 'Lives' },
  { id: 'books', label: 'When each book was written', header: 'Written' },
];

/** How many lanes fit beside the events at this width. */
export function laneLimit(width: number): number {
  if (width < 430) return 1;
  if (width < 700) return 2;
  return LANES.length;
}

/** Column widths, narrow and wide. */
export function laneWidth(id: LaneId, narrow: boolean): number {
  const w: Record<LaneId, [number, number]> = {
    kings: [78, 96],
    prophets: [52, 68],
    world: [64, 84],
    lives: [52, 66],
    books: [52, 66],
  };
  return w[id][narrow ? 0 : 1];
}

/**
 * The Bible's own verdict on a king, as a colour. Fixed rather than themed,
 * like the rest of the timeline's dark look: green did right, red did evil,
 * amber did both.
 */
export const VERDICT_COLOR: Record<string, string> = {
  right: '#4ade80',
  evil: '#f87171',
  mixed: '#fbbf24',
};
const NO_VERDICT = '#9ca3af';

/** Empires by where they ruled from, so the world lane reads at a glance. */
const EMPIRE_COLOR: Record<string, string> = {
  'empire-ur3': '#e07a5f',
  'empire-egypt-mk': '#d4a373',
  'empire-hyksos': '#c9a26b',
  'empire-egypt-nk': '#d4a373',
  'empire-assyria': '#e07a5f',
  'empire-babylon': '#d1495b',
  'empire-persia': '#81b29a',
  'empire-greece': '#6c9bd2',
  'empire-ptolemies': '#6c9bd2',
  'empire-seleucids': '#5b8cc0',
  'empire-hasmoneans': '#f2cc8f',
  'empire-rome': '#c77dff',
};

export function laneColor(item: TimelineItem): string {
  if (item.kind === 'reign') return VERDICT_COLOR[item.verdict ?? ''] ?? NO_VERDICT;
  if (item.kind === 'empire') return EMPIRE_COLOR[item.id] ?? '#8a8f98';
  if (item.kind === 'ruler') return '#cbd5e1';
  return itemColor(item);
}

export interface LaneSegment {
  from: number;
  to: number;
  /** Drawn as a thin strip on the right of its column: a co-regency, or a rival reign. */
  narrow: boolean;
}

export interface LaneSlot {
  item: TimelineItem;
  /** Horizontal place inside the lane, as fractions of its width. */
  x0: number;
  x1: number;
  segments: LaneSegment[];
  color: string;
  /** Labels in one group never overlap; groups sit side by side. */
  group: string;
}

export interface LaneLayout {
  id: LaneId;
  slots: LaneSlot[];
  /** Each label group's horizontal extent, as fractions. */
  groups: Record<string, { x0: number; x1: number }>;
}

/** Greedy columns by year: an item takes the first column free before it starts. */
function columnsByYear(items: TimelineItem[]): { cols: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => a.year_start - b.year_start || b.year_end - a.year_end);
  const ends: number[] = [];
  const cols = new Map<string, number>();
  for (const it of sorted) {
    let col = ends.findIndex((end) => end < it.year_start);
    if (col === -1) {
      col = ends.length;
      ends.push(it.year_end);
    } else {
      ends[col] = it.year_end;
    }
    cols.set(it.id, col);
  }
  return { cols, count: Math.max(1, ends.length) };
}

const whole = (it: TimelineItem): LaneSegment[] => [{ from: it.year_start, to: it.year_end, narrow: false }];

/**
 * Where each item of a lane sits across its column. Depends only on the years,
 * so it is worked out once, not on every frame.
 */
export function layoutLane(id: LaneId, all: TimelineItem[]): LaneLayout {
  const items = all.filter((it) => it.lane === id);

  if (id === 'kings') {
    // Judah on the left, Israel on the right, the three kings of the united
    // kingdom across both. Inside a kingdom the reigns follow one another; a
    // co-regency, or a rival reign laid over another (Tibni beside Omri), is
    // drawn as a thin strip so the king it overlaps still shows.
    const slots: LaneSlot[] = [];
    for (const kingdom of ['united', 'judah', 'israel']) {
      const reigns = items
        .filter((k) => k.sub === kingdom)
        .sort((a, b) => (a.co_start ?? a.year_start) - (b.co_start ?? b.year_start) || b.year_end - a.year_end);
      let lastEnd = -Infinity;
      for (const k of reigns) {
        const main = k.co_start ?? k.year_start;
        const segments: LaneSegment[] = [];
        if (k.co_start !== undefined && k.co_start > k.year_start) {
          segments.push({ from: k.year_start, to: k.co_start, narrow: true });
        }
        const rival = main < lastEnd - 0.5;
        segments.push({ from: main, to: k.year_end, narrow: rival });
        if (!rival) lastEnd = Math.max(lastEnd, k.year_end);
        const [x0, x1] = kingdom === 'judah' ? [0, 0.5] : kingdom === 'israel' ? [0.5, 1] : [0, 1];
        slots.push({ item: k, x0, x1, segments, color: laneColor(k), group: kingdom });
      }
    }
    return {
      id,
      slots,
      groups: { united: { x0: 0, x1: 1 }, judah: { x0: 0, x1: 0.5 }, israel: { x0: 0.5, x1: 1 } },
    };
  }

  if (id === 'world') {
    // Empires on the left, wider; the rulers in thinner columns beside them.
    const empires = items.filter((it) => it.sub === 'empire');
    const rulers = items.filter((it) => it.sub !== 'empire');
    const e = columnsByYear(empires);
    const r = columnsByYear(rulers);
    const units = e.count * 1.6 + r.count;
    const ew = 1.6 / units;
    const rw = 1 / units;
    const split = e.count * ew;
    return {
      id,
      slots: [
        ...empires.map((it) => {
          const c = e.cols.get(it.id) ?? 0;
          return { item: it, x0: c * ew, x1: (c + 1) * ew, segments: whole(it), color: laneColor(it), group: 'empire' };
        }),
        ...rulers.map((it) => {
          const c = r.cols.get(it.id) ?? 0;
          return { item: it, x0: split + c * rw, x1: split + (c + 1) * rw, segments: whole(it), color: laneColor(it), group: 'ruler' };
        }),
      ],
      groups: { empire: { x0: 0, x1: split }, ruler: { x0: split, x1: 1 } },
    };
  }

  const { cols, count } = columnsByYear(items);
  const w = 1 / count;
  return {
    id,
    slots: items.map((it) => {
      const c = cols.get(it.id) ?? 0;
      return { item: it, x0: c * w, x1: (c + 1) * w, segments: whole(it), color: laneColor(it), group: 'all' };
    }),
    groups: { all: { x0: 0, x1: 1 } },
  };
}

export interface LaneBar {
  key: string;
  item: TimelineItem;
  /** Stage pixels, already clipped to the stage. */
  top: number;
  height: number;
  left: number;
  width: number;
  color: string;
  narrow: boolean;
}

export interface LaneLabel {
  item: TimelineItem;
  top: number;
  left: number;
  maxWidth: number;
}

const LANE_LABEL_H = 13;

/**
 * One lane's bars and labels for what is on screen, in stage pixels.
 *
 * A label sits at the top of the visible part of its bar, so a long reign keeps
 * its name in view while you scroll through it. It only shows where the bar is
 * tall enough and the label above it in the same group has room; the rest are
 * a tap away.
 */
export function laneView(
  layout: LaneLayout,
  scale: TimelineScale,
  zoom: number,
  ty: number,
  stageH: number,
  width: number,
): { bars: LaneBar[]; labels: LaneLabel[] } {
  const bars: LaneBar[] = [];
  const candidates: { slot: LaneSlot; top: number; bottom: number; left: number }[] = [];
  for (const slot of layout.slots) {
    const left0 = slot.x0 * width;
    const full = Math.max(3, (slot.x1 - slot.x0) * width - 2);
    let shownTop = Infinity;
    let shownBottom = -Infinity;
    let mainLeft = left0 + 1;
    slot.segments.forEach((seg, i) => {
      const z0 = scale.y(seg.from) * zoom + ty;
      const z1 = Math.max(z0 + 3, scale.y(seg.to) * zoom + ty);
      if (z1 < -10 || z0 > stageH + 10) return;
      const top = Math.max(z0, -4);
      const bottom = Math.min(z1, stageH + 4);
      const w = seg.narrow ? Math.max(3, Math.min(6, full * 0.35)) : full;
      const left = seg.narrow ? left0 + 1 + full - w : left0 + 1;
      if (!seg.narrow) mainLeft = left;
      bars.push({ key: `${slot.item.id}:${i}`, item: slot.item, top, height: bottom - top, left, width: w, color: slot.color, narrow: seg.narrow });
      if (!seg.narrow) {
        shownTop = Math.min(shownTop, top);
        shownBottom = Math.max(shownBottom, bottom);
      }
    });
    if (shownBottom - shownTop >= LANE_LABEL_H + 1) candidates.push({ slot, top: shownTop, bottom: shownBottom, left: mainLeft });
  }

  const labels: LaneLabel[] = [];
  const lastByGroup = new Map<string, number>();
  candidates.sort((a, b) => a.top - b.top);
  for (const c of candidates) {
    const top = Math.max(c.top, 0) + 2;
    if (top + LANE_LABEL_H > c.bottom) continue;
    const last = lastByGroup.get(c.slot.group) ?? -Infinity;
    if (top < last + LANE_LABEL_H) continue;
    lastByGroup.set(c.slot.group, top);
    const g = layout.groups[c.slot.group] ?? { x0: 0, x1: 1 };
    labels.push({ item: c.slot.item, top, left: c.left, maxWidth: Math.max(10, g.x1 * width - c.left - 1) });
  }
  return { bars, labels };
}
