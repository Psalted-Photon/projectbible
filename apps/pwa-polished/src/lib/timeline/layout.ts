/**
 * Where everything sits on the axis.
 *
 * Kept out of the component for the same reason the map's maths is: the
 * component is about chrome and gestures, and none of this needs a DOM to be
 * reasoned about.
 *
 * Two scales, one shape. True years puts every year the same height, which is
 * honest but leaves the forty years of Jesus and the apostles as a sliver under
 * four thousand years of Genesis to Malachi. Story spacing gives each event the
 * room it needs instead, with a little extra for long stretches of time, so the
 * strip reads like the story and the year ticks show where time runs fast.
 *
 * Positions are worked out in "zoomed pixels": content pixels times the zoom.
 * The pane adds its scroll offset and draws in screen space, so labels and
 * lines are crisp at any zoom and only what is on screen is drawn.
 *
 * The eras do not tile the span cleanly (Judah Alone and the Exile overlap), so
 * each era is a band in its own lane where it has to be.
 */

import type { TimelineItem } from './data';
import { getBookColor } from '../bibleData';

/** How tall one year is at zoom 1 in true-years mode, in CSS pixels. */
export const PX_PER_YEAR = 0.28;

/** Breathing room above the first year and below the last, true years. */
const PAD_YEARS = 60;

/** The neutral colour for anything with no book behind it. */
const NEUTRAL = '#8a8f98';

export type ScaleMode = 'story' | 'true';

export interface TimelineScale {
  mode: ScaleMode;
  minYear: number;
  maxYear: number;
  /** Total height of the axis content at zoom 1. */
  height: number;
  /** Year (fractional, as sort keys are) → y, in content pixels before zoom. */
  y: (year: number) => number;
  /** y → year, for reading a position back. */
  yearAt: (y: number) => number;
}

export function makeScale(minYear: number, maxYear: number): TimelineScale {
  const lo = minYear - PAD_YEARS;
  const hi = maxYear + PAD_YEARS;
  const height = Math.max(1, (hi - lo) * PX_PER_YEAR);
  return {
    mode: 'true',
    minYear: lo,
    maxYear: hi,
    height,
    y: (year: number) => (year - lo) * PX_PER_YEAR,
    yearAt: (y: number) => lo + y / PX_PER_YEAR,
  };
}

// ===== Story spacing =====

/**
 * The room each event reserves at zoom 1, by tier. An event only shows once
 * the zoom makes its own room at least a label tall (see visibleTier), so a
 * label never has to fight the one before it for space it was promised.
 */
const TIER_ROOM: Record<1 | 2 | 3, number> = { 1: 30, 2: 14, 3: 5 };
/** Room at the top of each era for its name. */
const ERA_ROOM = 20;
/** Height of one label slot on screen, in pixels. */
export const LABEL_GAP = 22;
const STORY_PAD = 40;

/** A long stretch of time with nothing in it still takes some room, but only logarithmically. */
const timeRoom = (years: number) => 6 * Math.log2(1 + Math.max(0, years) / 10);

/**
 * A scale that spaces the strip by what happens rather than by years.
 *
 * Built as a list of knots (year → y), one per event and per era start, each
 * pushed below the last by that event's room plus a little for the time
 * between them. Between knots, years are spread evenly, so a year still maps to
 * one place and the ticks can be labelled.
 */
export function makeStoryScale(eras: TimelineItem[], events: TimelineItem[]): TimelineScale {
  const points: { t: number; w: number }[] = [
    ...eras.map((e) => ({ t: e.year_start, w: ERA_ROOM })),
    ...events.map((e) => ({ t: e.sort_key, w: TIER_ROOM[e.tier ?? 3] })),
  ].sort((a, b) => a.t - b.t);

  if (!points.length) return makeScale(-4004, 100);

  const knotsT: number[] = [points[0].t - 1];
  const knotsY: number[] = [0];
  let y = STORY_PAD;
  for (const p of points) {
    const prevT = knotsT[knotsT.length - 1];
    if (p.t <= prevT) {
      // Same moment as the last knot: its room adds to that knot's.
      y += p.w;
      knotsY[knotsY.length - 1] = y;
      continue;
    }
    y += timeRoom(p.t - prevT) + p.w;
    knotsT.push(p.t);
    knotsY.push(y);
  }
  // The last era's end, and a margin under it.
  const lastT = Math.max(knotsT[knotsT.length - 1] + 1, ...eras.map((e) => e.year_end));
  y += timeRoom(lastT - knotsT[knotsT.length - 1]) + STORY_PAD;
  knotsT.push(lastT);
  knotsY.push(y);

  const n = knotsT.length;
  const EDGE = 0.5; // px per year beyond the ends
  const yOf = (t: number) => {
    if (t <= knotsT[0]) return knotsY[0] - (knotsT[0] - t) * EDGE;
    if (t >= knotsT[n - 1]) return knotsY[n - 1] + (t - knotsT[n - 1]) * EDGE;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (knotsT[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - knotsT[lo]) / (knotsT[hi] - knotsT[lo]);
    return knotsY[lo] + f * (knotsY[hi] - knotsY[lo]);
  };
  const tOf = (yy: number) => {
    if (yy <= knotsY[0]) return knotsT[0] - (knotsY[0] - yy) / EDGE;
    if (yy >= knotsY[n - 1]) return knotsT[n - 1] + (yy - knotsY[n - 1]) / EDGE;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (knotsY[mid] <= yy) lo = mid;
      else hi = mid;
    }
    const span = knotsY[hi] - knotsY[lo];
    const f = span > 0 ? (yy - knotsY[lo]) / span : 0;
    return knotsT[lo] + f * (knotsT[hi] - knotsT[lo]);
  };

  return {
    mode: 'story',
    minYear: knotsT[0],
    maxYear: knotsT[n - 1],
    height: y,
    y: yOf,
    yearAt: tOf,
  };
}

// ===== Zoom detail =====

/**
 * The deepest tier that shows at this zoom.
 *
 * In story spacing it falls straight out of the room each tier reserves: tier
 * 2 appears once its 14px have grown to a label's height. True years has no
 * such promise, so it uses fixed steps and lets clusters take up the slack.
 */
export function visibleTier(zoom: number, mode: ScaleMode): 1 | 2 | 3 {
  if (mode === 'story') {
    if (zoom * TIER_ROOM[3] >= LABEL_GAP) return 3;
    if (zoom * TIER_ROOM[2] >= LABEL_GAP) return 2;
    return 1;
  }
  if (zoom >= 40) return 3;
  if (zoom >= 4) return 2;
  return 1;
}

export const ZOOM_LIMITS: Record<ScaleMode, { min: number; max: number }> = {
  story: { min: 0.08, max: 10 },
  // AD 30 alone holds some sixty events, Holy Week and Acts 1-7; they need
  // about 1,300px for the year, which is 4,700x.
  true: { min: 0.1, max: 6000 },
};

/** The zoom at which a tier first shows, so a cluster tap can be sure to open it. */
export function zoomForTier(tier: 1 | 2 | 3, mode: ScaleMode): number {
  if (mode === 'story') return (LABEL_GAP / TIER_ROOM[tier]) * 1.02;
  return tier === 3 ? 40 : tier === 2 ? 4 : 0;
}

// ===== Colour =====

/**
 * Colours come off the app's own book ramp rather than a new palette, so the
 * timeline reads as part of the same app.
 */
export function itemColor(item: TimelineItem | null | undefined): string {
  const book = item?.book ?? item?.first?.book;
  return book ? getBookColor(book) : NEUTRAL;
}

// ===== Eras =====

export interface EraBand {
  era: TimelineItem;
  /** Zoomed pixels. */
  top: number;
  bottom: number;
  color: string;
  /** Which lane it draws in, so overlapping eras sit side by side. */
  lane: number;
}

/**
 * Place the bands, giving an overlapping pair its own lane each.
 *
 * Greedy by start year: a band takes the first lane whose last band ends before
 * it starts.
 */
export function layoutEras(eras: TimelineItem[], scale: TimelineScale, zoom: number): { bands: EraBand[]; lanes: number } {
  const laneEnds: number[] = [];
  const bands: EraBand[] = eras.map((era) => {
    let lane = laneEnds.findIndex((end) => end <= era.year_start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(era.year_end);
    } else {
      laneEnds[lane] = era.year_end;
    }
    const top = scale.y(era.year_start) * zoom;
    const bottom = Math.max(top + 6, scale.y(era.year_end) * zoom);
    return { era, top, bottom, color: itemColor(era), lane };
  });
  return { bands, lanes: Math.max(1, laneEnds.length) };
}

// ===== Events, clusters and bars =====

export interface Mark {
  /** Stable key for the keyed each: an item id, or the cluster's first and last ids. */
  key: string;
  kind: 'item' | 'cluster';
  /** The event, for an item; the first event, for a cluster. */
  item: TimelineItem;
  /** Everything a cluster stands for, in order. One entry for an item. */
  items: TimelineItem[];
  /** The label: an event's title, or "Holy Week · 12". */
  title: string;
  /** Zoomed pixels: the dot, and for a cluster the last dot it covers. */
  z: number;
  zEnd: number;
  /** Where the label is drawn, which may be off the dot with a leader to it. */
  labelZ: number;
  color: string;
}

export interface Bar {
  item: TimelineItem;
  top: number;
  bottom: number;
  lane: number;
  color: string;
}

function place(marks: Mark[], gap: number) {
  let last = -Infinity;
  for (const m of marks) {
    m.labelZ = Math.max(m.z, last + gap);
    last = m.labelZ;
  }
}

function clusterOf(marks: Mark[], byId: Map<string, TimelineItem>): Mark {
  const items = marks.flatMap((m) => m.items);
  // Named by the parent they share, where they share one: "Holy Week · 12".
  const keys = new Set(items.map((it) => it.parent_id ?? it.id));
  const shared = keys.size === 1 ? byId.get([...keys][0]) : undefined;
  const first = marks[0];
  const last = marks[marks.length - 1];
  return {
    key: `c:${items[0].id}:${items[items.length - 1].id}`,
    kind: 'cluster',
    item: items[0],
    items,
    title: shared ? `${shared.title} · ${items.length}` : `${items.length} events`,
    z: first.z,
    zEnd: last.zEnd,
    labelZ: first.z,
    color: shared ? itemColor(shared) : first.color,
  };
}

/** Consecutive marks that share a parent (or are that parent) become one cluster each. */
function groupByParent(marks: Mark[], byId: Map<string, TimelineItem>): Mark[] {
  const out: Mark[] = [];
  let run: Mark[] = [];
  let runKey: string | null = null;
  const flush = () => {
    if (run.length >= 2) out.push(clusterOf(run, byId));
    else out.push(...run);
    run = [];
  };
  for (const m of marks) {
    const keys = new Set(m.items.map((it) => it.parent_id ?? it.id));
    const key = keys.size === 1 ? [...keys][0] : null;
    if (key !== null && key === runKey) {
      run.push(m);
      continue;
    }
    flush();
    run = [m];
    runKey = key;
  }
  flush();
  return out;
}

/**
 * Place the event markers, and keep every one of them findable.
 *
 * The dot stays at the event's place on the axis; the label may slide down
 * where two would print on top of each other, with a leader back to the dot.
 * Where a run of labels would end up more than three slots from their dots,
 * it is folded into one chip instead: first the events that share a parent
 * ("Holy Week · 12"), and if that is still not enough, the whole run. Tapping a
 * chip zooms in until it opens. Finally, a pass from the bottom lifts anything
 * that would have been pushed past the end of the axis, where it was clipped.
 */
export function layoutMarks(
  events: TimelineItem[],
  byId: Map<string, TimelineItem>,
  scale: TimelineScale,
  zoom: number,
  tier: 1 | 2 | 3,
): Mark[] {
  const gap = LABEL_GAP;
  let marks: Mark[] = events
    .filter((e) => (e.tier ?? 3) <= tier)
    .map((e) => {
      const z = scale.y(e.sort_key) * zoom;
      return { key: e.id, kind: 'item', item: e, items: [e], title: e.title, z, zEnd: z, labelZ: z, color: itemColor(e) };
    });

  for (let pass = 0; pass < 3; pass++) {
    place(marks, gap);
    const out: Mark[] = [];
    let changed = false;
    let i = 0;
    while (i < marks.length) {
      // A chain is a mark and every following one its label pushed along.
      let j = i;
      while (j + 1 < marks.length && marks[j + 1].labelZ > marks[j + 1].z + 0.5) j++;
      let worst = 0;
      for (let k = i; k <= j; k++) worst = Math.max(worst, marks[k].labelZ - marks[k].z);
      if (j > i && worst > 3 * gap) {
        const chain = marks.slice(i, j + 1);
        const folded = pass === 0 ? groupByParent(chain, byId) : [clusterOf(chain, byId)];
        if (folded.length < chain.length) changed = true;
        out.push(...folded);
      } else {
        out.push(...marks.slice(i, j + 1));
      }
      i = j + 1;
    }
    marks = out;
    if (!changed) break;
  }
  place(marks, gap);

  // Nothing past the end of the axis.
  let ceiling = scale.height * zoom - gap / 2 + gap;
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].labelZ > ceiling - gap) marks[i].labelZ = ceiling - gap;
    ceiling = marks[i].labelZ;
  }
  return marks;
}

/**
 * Bars for the events that last: anything a year or longer that would be at
 * least 8px tall gets a thin line from its start to its end beside the dots.
 * Overlapping bars (a ministry and the feast inside it) step into lanes.
 */
export function layoutBars(marks: Mark[], scale: TimelineScale, zoom: number): Bar[] {
  const bars: Bar[] = [];
  const laneEnds: number[] = [];
  for (const m of marks) {
    if (m.kind !== 'item') continue;
    const it = m.item;
    if (it.year_end - it.year_start < 1) continue;
    const top = m.z;
    const bottom = scale.y(it.year_end) * zoom;
    if (bottom - top < 8) continue;
    let lane = laneEnds.findIndex((end) => end <= top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bottom);
    } else {
      laneEnds[lane] = bottom;
    }
    if (lane > 3) continue;
    bars.push({ item: it, top, bottom, lane, color: m.color });
  }
  return bars;
}

// ===== Year ticks =====

const TICK_STEPS = [1000, 500, 250, 100, 50, 25, 10, 5, 2, 1];
const TICK_GAP = 34;

/**
 * The year lines down the side, for what is on screen.
 *
 * Coarse steps first, then finer ones wherever there is room for them, so a
 * stretch the story scale has opened up gets single years while a long empty
 * one keeps its centuries. There is no year 0.
 */
export function yearTicks(scale: TimelineScale, zoom: number, fromZ: number, toZ: number): { year: number; z: number }[] {
  const lo = Math.floor(scale.yearAt(fromZ / zoom));
  const hi = Math.ceil(scale.yearAt(toZ / zoom));
  const taken: number[] = [];
  const out: { year: number; z: number }[] = [];
  const free = (z: number) => {
    // Binary search the sorted list for the nearest taken tick.
    let a = 0;
    let b = taken.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (taken[mid] < z) a = mid + 1;
      else b = mid;
    }
    const before = a > 0 ? z - taken[a - 1] : Infinity;
    const after = a < taken.length ? taken[a] - z : Infinity;
    return { ok: before >= TICK_GAP && after >= TICK_GAP, at: a };
  };
  for (const step of TICK_STEPS) {
    if ((hi - lo) / step > 4000) continue;
    for (let year = Math.ceil(lo / step) * step; year <= hi; year += step) {
      if (year === 0) continue;
      const z = scale.y(year) * zoom;
      const { ok, at } = free(z);
      if (!ok) continue;
      taken.splice(at, 0, z);
      out.push({ year, z });
    }
  }
  return out;
}
