/**
 * The timeline's data, read out of the installed Timeline pack.
 *
 * One store, `timeline_items`, holds everything on the strip whatever lane it
 * sits in: events, eras, reigns, prophets, world powers, lives and books. It is
 * about six hundred rows, read whole when the window opens and sorted once.
 * The pack is built by scripts/build-timeline-pack.mjs from Theographic and the
 * hand-written files in data-manifests/timeline/.
 *
 * The old study-tools tables (chronological_events / _eras / _order) are not
 * read here any more; Chronological reading mode still uses them.
 *
 * Cached for as long as the window is open, released when it closes, the same
 * discipline as lib/atlas/data.ts.
 */

import { openDB, readTransaction } from '../../adapters/db';

export type TimelineLane = 'events' | 'eras' | 'kings' | 'prophets' | 'world' | 'lives' | 'books';
export type TimelineKind = 'event' | 'era' | 'reign' | 'prophet' | 'empire' | 'ruler' | 'life' | 'book';

/** A verse range, with the label the build printed for it ("Genesis 46:1–47:12"). */
export interface TimelinePassage {
  b: string;
  c: number;
  v: number;
  ec: number;
  ev: number;
  label: string;
}

export interface TimelinePerson {
  /** The People pack's id, e.g. `hezekiah_1512`. */
  id: string;
  name: string;
}

export interface TimelinePlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** One row of the pack. Years are signed (negative = BC) with no year 0. */
export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  lane: TimelineLane;
  /** kings: united | judah | israel; world: empire | ruler. */
  sub?: string;
  title: string;
  /** The kind line: "King of Judah", "Lived 930 years". */
  subtitle?: string;
  year_start: number;
  year_end: number;
  /** Print "c." in front of the date. */
  approx: boolean;
  /** Events only: 1 headline, 2 main, 3 detail. */
  tier?: 1 | 2 | 3;
  parent_id?: string;
  era_id?: string;
  /** The year plus a fraction for the order inside it. */
  sort_key: number;
  summary?: string;
  verdict?: 'right' | 'evil' | 'mixed';
  verdict_ref?: string;
  /** Kings: where the sole reign began, after a co-regency from year_start. */
  co_start?: number;
  covers_start?: number;
  covers_end?: number;
  /** The book whose color it takes. */
  book?: string;
  /** The first verse of the first passage. */
  first?: { book: string; chapter: number; verse: number };
  passages: TimelinePassage[];
  people: TimelinePerson[];
  places: TimelinePlace[];
  search: string;
}

export interface TimelineData {
  /** Every row, in order along the axis. */
  items: TimelineItem[];
  eras: TimelineItem[];
  /** The events lane, in story order. */
  events: TimelineItem[];
  byId: Map<string, TimelineItem>;
  /** Children of each parent, in story order. */
  children: Map<string, TimelineItem[]>;
  /** The span every layout works in, widened to whole centuries. */
  minYear: number;
  maxYear: number;
}

const STORE = 'timeline_items';

let dataPromise: Promise<TimelineData> | null = null;

/**
 * Drop what is held in memory.
 *
 * Called when the pane closes: a window that was opened once should not be
 * carried all session.
 */
export function releaseTimeline(): void {
  dataPromise = null;
}

/** Is the Timeline pack installed? */
export async function timelineInstalled(): Promise<boolean> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE)) return false;
    const count = await readTransaction<number>(STORE, (store) => store.count());
    return count > 0;
  } catch {
    return false;
  }
}

/** Everything the window draws. */
export async function loadTimeline(): Promise<TimelineData> {
  if (dataPromise) return dataPromise;

  dataPromise = (async () => {
    const rows = await readTransaction<TimelineItem[]>(STORE, (store) => store.getAll() as IDBRequest<TimelineItem[]>);
    const items = rows
      .filter((r) => Number.isFinite(r.year_start) && Number.isFinite(r.year_end))
      .sort((a, b) => a.sort_key - b.sort_key || a.title.localeCompare(b.title));

    const byId = new Map(items.map((r) => [r.id, r]));
    const children = new Map<string, TimelineItem[]>();
    for (const r of items) {
      if (!r.parent_id) continue;
      if (!children.has(r.parent_id)) children.set(r.parent_id, []);
      children.get(r.parent_id)!.push(r);
    }

    const eras = items.filter((r) => r.lane === 'eras');
    const events = items.filter((r) => r.lane === 'events');

    const years = items.flatMap((r) => [r.year_start, r.year_end]);
    const rawMin = years.length ? Math.min(...years) : -4004;
    const rawMax = years.length ? Math.max(...years) : 100;

    return {
      items,
      eras,
      events,
      byId,
      children,
      minYear: Math.floor(rawMin / 100) * 100,
      maxYear: Math.ceil(rawMax / 100) * 100,
    };
  })();

  // A failed read should not be cached as the answer for the rest of the session.
  dataPromise.catch(() => {
    dataPromise = null;
  });
  return dataPromise;
}

/**
 * How a signed year is written.
 *
 * There is no year 0 in the data, so a negative is simply BC and a positive AD.
 */
export function formatYear(year: number): string {
  if (year < 0) return `${Math.abs(year)} BC`;
  if (year === 0) return '1 BC';
  return `AD ${year}`;
}

/** A span of years, collapsed when it is a single one, with the era written once. */
export function formatSpan(start: number, end: number, approx = false): string {
  const c = approx ? 'c. ' : '';
  if (!Number.isFinite(end) || end === start) return `${c}${formatYear(start)}`;
  if (start < 0 && end < 0) return `${c}${Math.abs(start)}–${Math.abs(end)} BC`;
  if (start > 0 && end > 0) return `${c}AD ${start}–${end}`;
  return `${c}${formatYear(start)} – ${formatYear(end)}`;
}

/** An item's dates as the card prints them. */
export function formatItemSpan(item: TimelineItem): string {
  return formatSpan(item.year_start, item.year_end, item.approx);
}
