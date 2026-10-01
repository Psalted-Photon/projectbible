/**
 * Reading the devotionals pack out of IndexedDB.
 *
 * Two stores, filled by the 'devotionals' branch of importPackFromBytes:
 * devotional_works (three rows) and devotional_readings (one per work, date and
 * slot, keyed `workId:MM-DD:slot`). A day's reading is a single get.
 */

import { openDB } from '../../adapters/db';

export type DevotionalSlot = 'morning' | 'evening' | 'day';

export interface DevotionalWork {
  workId: string;
  title: string;
  shortTitle: string;
  author: string;
  year: number;
  /** True for morning + evening readings, false for one a day. */
  hasSlots: boolean;
  sortOrder: number;
  about: string;
}

/**
 * A verse the reading is built on. For Spurgeon it is the headline, and
 * kjvText is his own wording of it. For Daily Light there is one per fragment:
 * `fragment` is Bagster's text, `para` the paragraph it sits in.
 */
export interface DevotionalKeyRef {
  book: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
  /** Only when the verses don't run on, e.g. [1, 20] for "John 17:1, 20". */
  verses?: number[];
  osis: string;
  label: string;
  kjvText: string;
  fragment?: string;
  para?: number;
}

/** A note on an old word or phrase; html may carry Scripture links (a.devo-ref). */
export interface DevotionalNote {
  term: string;
  html: string;
}

export interface DevotionalReading {
  id: string;
  workId: string;
  month: number;
  day: number;
  slot: DevotionalSlot;
  title: string;
  bodyHtml: string;
  plainText: string;
  keyRefs: DevotionalKeyRef[];
  /**
   * Spurgeon in plain modern English, where it has been written. Every element
   * carries data-b, the index of the original block (bodyHtml's nth child) it renders.
   */
  modernHtml?: string;
  /** Notes on the old words and phrases, where they have been written. */
  notes?: DevotionalNote[];
}

export function readingId(workId: string, month: number, day: number, slot: DevotionalSlot): string {
  return `${workId}:${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}:${slot}`;
}

async function storeAvailable(name: string): Promise<IDBDatabase | null> {
  const db = await openDB();
  return db.objectStoreNames.contains(name) ? db : null;
}

/** Is the pack in? Counts works rather than trusting the registry row, so a half-finished install reads as not installed. */
export async function isDevotionalsInstalled(): Promise<boolean> {
  const db = await storeAvailable('devotional_works');
  if (!db) return false;
  return new Promise((resolve) => {
    const req = db.transaction('devotional_works', 'readonly').objectStore('devotional_works').count();
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => resolve(false);
  });
}

export async function listWorks(): Promise<DevotionalWork[]> {
  const db = await storeAvailable('devotional_works');
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction('devotional_works', 'readonly').objectStore('devotional_works').getAll();
    req.onsuccess = () => resolve(((req.result as DevotionalWork[]) ?? []).sort((a, b) => a.sortOrder - b.sortOrder));
    req.onerror = () => resolve([]);
  });
}

async function getById(id: string): Promise<DevotionalReading | null> {
  const db = await storeAvailable('devotional_readings');
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction('devotional_readings', 'readonly').objectStore('devotional_readings').get(id);
    req.onsuccess = () => resolve((req.result as DevotionalReading) ?? null);
    req.onerror = () => resolve(null);
  });
}

/** One reading. A work with no Feb 29 gives Feb 28 instead. */
export async function getReading(
  workId: string,
  month: number,
  day: number,
  slot: DevotionalSlot,
): Promise<DevotionalReading | null> {
  const hit = await getById(readingId(workId, month, day, slot));
  if (hit || !(month === 2 && day === 29)) return hit;
  return getById(readingId(workId, 2, 28, slot));
}

let allReadings: DevotionalReading[] | null = null;

/** Every reading, held in memory after the first call — search runs over this. */
export async function getAllReadings(): Promise<DevotionalReading[]> {
  if (allReadings) return allReadings;
  const db = await storeAvailable('devotional_readings');
  if (!db) return [];
  const rows = await new Promise<DevotionalReading[]>((resolve) => {
    const req = db.transaction('devotional_readings', 'readonly').objectStore('devotional_readings').getAll();
    req.onsuccess = () => resolve((req.result as DevotionalReading[]) ?? []);
    req.onerror = () => resolve([]);
  });
  // An empty result isn't kept, so installing the pack later is seen straight away.
  if (rows.length) allReadings = rows;
  return rows;
}

/** Forget the in-memory copy (after the pack is installed again or removed). */
export function clearDevotionalsCache(): void {
  allReadings = null;
}

// ── Stepping through the year ──────────────────────────────────────────────

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The calendar date `delta` days from month/day, wrapping round the year (Feb 29 included). */
export function shiftDate(month: number, day: number, delta: number): { month: number; day: number } {
  let m = month, d = day + delta;
  while (d < 1) { m = m === 1 ? 12 : m - 1; d += DAYS_IN_MONTH[m - 1]; }
  while (d > DAYS_IN_MONTH[m - 1]) { d -= DAYS_IN_MONTH[m - 1]; m = m === 12 ? 1 : m + 1; }
  return { month: m, day: d };
}

/**
 * The reading before or after this one. With both slots in play, morning and
 * evening alternate; with one fixed slot, or none, it moves a day at a time.
 */
export function stepReading(
  target: { month: number; day: number; slot: DevotionalSlot },
  dir: 1 | -1,
  bothSlots: boolean,
): { month: number; day: number; slot: DevotionalSlot } {
  if (bothSlots && target.slot !== 'day') {
    if (dir === 1 && target.slot === 'morning') return { month: target.month, day: target.day, slot: 'evening' };
    if (dir === -1 && target.slot === 'evening') return { month: target.month, day: target.day, slot: 'morning' };
    const next = shiftDate(target.month, target.day, dir);
    return { ...next, slot: dir === 1 ? 'morning' : 'evening' };
  }
  return { ...shiftDate(target.month, target.day, dir), slot: target.slot };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

/** "January 1" */
export function formatMonthDay(month: number, day: number): string {
  return `${monthName(month)} ${day}`;
}

/** "Jan 1, Morning" — for search results and other tight spots. */
export function shortReadingLabel(month: number, day: number, slot: DevotionalSlot): string {
  const d = `${monthName(month).slice(0, 3)} ${day}`;
  return slot === 'day' ? d : `${d}, ${slot === 'morning' ? 'Morning' : 'Evening'}`;
}
