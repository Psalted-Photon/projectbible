/**
 * The timeline's data, read out of the installed study pack.
 *
 * Three stores back it. `chronological_eras` and `chronological_events` are the
 * twelve bands and the forty markers — tiny, read whole. `chronological_order`
 * is 31,092 rows, and the only thing this module wants from it is the first
 * verse of each event, so it is scanned once and reduced to forty entries.
 *
 * Cached for as long as the window is open, released when it closes, the same
 * discipline as lib/atlas/data.ts.
 */

import { openDB, readTransaction } from '../../adapters/db';

/** One of the twelve bands. Years are signed; there is no year 0. */
export interface TimelineEra {
  era_id: string;
  name: string;
  year_start: number;
  year_end: number;
  description: string | null;
}

/** One of the forty markers, with the verse it opens. */
export interface TimelineEvent {
  event_id: string;
  name: string;
  year_start: number;
  year_end: number;
  era: string | null;
  description: string | null;
  /** The first verse of the event in chronological order, if the pack has one. */
  first: { book: string; chapter: number; verse: number } | null;
  /** How many verses the event covers, for the marker's weight. */
  verseCount: number;
}

export interface TimelineData {
  eras: TimelineEra[];
  events: TimelineEvent[];
  /** The span every layout works in, widened to whole centuries. */
  minYear: number;
  maxYear: number;
}

let dataPromise: Promise<TimelineData> | null = null;

/**
 * Drop what is held in memory.
 *
 * Called when the pane closes. The 31k-row scan is already reduced by then, so
 * this is only the forty events and twelve eras — but the same rule applies as
 * for the map: a window that was opened once should not be carried all session.
 */
export function releaseTimeline(): void {
  dataPromise = null;
}

/** Is the study pack installed with the eras and events in it? */
export async function timelineInstalled(): Promise<boolean> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('chronological_events')) return false;
    if (!db.objectStoreNames.contains('chronological_eras')) return false;
    const count = await readTransaction<number>('chronological_events', (store) => store.count());
    return count > 0;
  } catch {
    return false;
  }
}

function all<T>(storeName: string): Promise<T[]> {
  return readTransaction<T[]>(storeName, (store) => store.getAll() as IDBRequest<T[]>);
}

/** A chronological_order row, as pack-import writes it. */
interface ChronoRow {
  order_index: number;
  book: string;
  chapter: number;
  verse: number;
  event_id?: string | null;
}

/**
 * Everything the window draws.
 *
 * The one expensive step is the getAll of chronological_order. It is done here
 * rather than in the component so the pane can await a single promise, and it
 * is reduced to forty entries before it is kept — the 31k rows themselves are
 * released as soon as this returns.
 */
export async function loadTimeline(): Promise<TimelineData> {
  if (dataPromise) return dataPromise;

  dataPromise = (async () => {
    const [eraRows, eventRows] = await Promise.all([
      all<TimelineEra>('chronological_eras'),
      all<Omit<TimelineEvent, 'first' | 'verseCount'>>('chronological_events'),
    ]);

    // The lowest order_index per event, and how many verses carry it.
    const firstByEvent = new Map<string, ChronoRow>();
    const countByEvent = new Map<string, number>();
    try {
      const rows = await all<ChronoRow>('chronological_order');
      for (const row of rows) {
        const id = row.event_id;
        if (!id) continue;
        countByEvent.set(id, (countByEvent.get(id) ?? 0) + 1);
        const held = firstByEvent.get(id);
        if (!held || row.order_index < held.order_index) firstByEvent.set(id, row);
      }
    } catch {
      // A pack imported before event_id was carried: the markers still draw,
      // they just have no verse to open. Better than an empty window.
    }

    const eras = eraRows
      .map((era) => ({
        ...era,
        year_start: Number(era.year_start),
        year_end: Number(era.year_end),
      }))
      .filter((era) => Number.isFinite(era.year_start) && Number.isFinite(era.year_end))
      .sort((a, b) => a.year_start - b.year_start || a.year_end - b.year_end);

    const events: TimelineEvent[] = eventRows
      .map((ev) => {
        const row = firstByEvent.get(ev.event_id);
        return {
          ...ev,
          year_start: Number(ev.year_start),
          year_end: Number(ev.year_end ?? ev.year_start),
          first: row ? { book: row.book, chapter: row.chapter, verse: row.verse } : null,
          verseCount: countByEvent.get(ev.event_id) ?? 0,
        };
      })
      .filter((ev) => Number.isFinite(ev.year_start))
      .sort((a, b) => a.year_start - b.year_start || a.name.localeCompare(b.name));

    // The eras overlap and leave gaps, so the span is taken from both lists
    // rather than assuming the bands tile it, then rounded out to centuries so
    // the axis labels land on round numbers.
    const years = [
      ...eras.flatMap((e) => [e.year_start, e.year_end]),
      ...events.flatMap((e) => [e.year_start, e.year_end]),
    ];
    const rawMin = years.length ? Math.min(...years) : -4004;
    const rawMax = years.length ? Math.max(...years) : 100;

    return {
      eras,
      events,
      minYear: Math.floor(rawMin / 100) * 100,
      maxYear: Math.ceil(rawMax / 100) * 100,
    };
  })();

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

/** A span of years, collapsed when it is a single one. */
export function formatSpan(start: number, end: number): string {
  if (!Number.isFinite(end) || end === start) return formatYear(start);
  return `${formatYear(start)} – ${formatYear(end)}`;
}
