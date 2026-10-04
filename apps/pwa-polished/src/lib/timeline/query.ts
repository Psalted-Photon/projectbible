/**
 * Questions the Timeline window asks of its data: where is the chapter I am
 * reading, what was going on in a given year, what matches a search, and what
 * comes before and after an item. Pure functions over TimelineData, so the
 * component stays about drawing.
 */

import type { TimelineData, TimelineItem } from './data';

// ===== You are here =====

/** Lanes whose passages can place a chapter, best first. Eras and books are not specific enough. */
const HERE_LANES = new Set(['events', 'kings', 'prophets', 'world', 'lives']);

export type HereIndex = Map<string, TimelineItem[]>;

/** "Book|chapter" → every item whose passages include that chapter. Built once per load. */
export function buildHereIndex(data: TimelineData): HereIndex {
  const index: HereIndex = new Map();
  for (const item of data.items) {
    if (!HERE_LANES.has(item.lane)) continue;
    for (const p of item.passages) {
      for (let c = p.c; c <= p.ec; c++) {
        const key = `${p.b}|${c}`;
        const list = index.get(key);
        if (list) list.push(item);
        else index.set(key, [item]);
      }
    }
  }
  return index;
}

/** How much of the Bible a passage list takes up in chapters, for "most specific". */
function chapterSpan(item: TimelineItem, book: string): number {
  let n = 0;
  for (const p of item.passages) if (p.b === book) n += p.ec - p.c + 1;
  return n || 999;
}

/** How many verses of this one chapter an item's passages take in; a whole chapter counts as plenty. */
function coverage(item: TimelineItem, book: string, chapter: number): number {
  let n = 0;
  for (const p of item.passages) {
    if (p.b !== book || chapter < p.c || chapter > p.ec) continue;
    const from = p.c === chapter ? p.v : 1;
    const to = p.ec === chapter ? p.ev : from + 50;
    n += to - from + 1;
  }
  return n;
}

/** Fewer verses than this and a passage only cites the chapter; it does not happen in it. */
const REAL_COVERAGE = 3;

export interface Here {
  item: TimelineItem;
  /** A span to shade rather than one point: a reign, a prophet, a book's whole stretch. */
  range: boolean;
  start: number;
  end: number;
}

/**
 * Where a chapter sits on the strip.
 *
 * An event that actually happens in the chapter (its passages take in at least
 * a few verses of it): the narrowest in years, then the one that takes in most
 * of the chapter, then the fewest chapters. So Isaiah 7 is "The sign of
 * Immanuel", not Isaiah's whole ministry, and John 11 is Lazarus rather than
 * Pompey, whom John 11:48 only foresees. Failing that, the narrowest reign,
 * prophet, ruler or life that cites it, shown as a span; then an event that
 * only cites a verse of it; then the stretch of time the book itself covers.
 */
export function findHere(data: TimelineData, index: HereIndex, book: string, chapter: number): Here | null {
  const found = index.get(`${book}|${chapter}`) ?? [];
  const better = (a: TimelineItem, b: TimelineItem) =>
    (b.year_end - b.year_start) - (a.year_end - a.year_start) ||
    coverage(a, book, chapter) - coverage(b, book, chapter) ||
    chapterSpan(b, book) - chapterSpan(a, book);
  const best = (list: TimelineItem[]) => list.reduce<TimelineItem | null>((a, b) => (!a || better(b, a) > 0 ? b : a), null);
  const point = (it: TimelineItem): Here => ({ item: it, range: false, start: it.sort_key, end: it.sort_key });

  const events = found.filter((it) => it.lane === 'events');
  const event = best(events.filter((it) => coverage(it, book, chapter) >= REAL_COVERAGE));
  if (event) return point(event);

  const other = best(found.filter((it) => it.lane !== 'events'));
  if (other) {
    return { item: other, range: other.year_end > other.year_start, start: other.year_start, end: other.year_end };
  }

  const cited = best(events);
  if (cited) return point(cited);

  const bookItem = data.items.find((it) => it.kind === 'book' && it.book === book);
  if (bookItem && bookItem.covers_start !== undefined && bookItem.covers_end !== undefined) {
    return {
      item: bookItem,
      range: bookItem.covers_end > bookItem.covers_start,
      start: bookItem.covers_start,
      end: bookItem.covers_end,
    };
  }
  return null;
}

// ===== At this moment =====

export interface Moment {
  year: number;
  judah: TimelineItem[];
  israel: TimelineItem[];
  prophets: TimelineItem[];
  empires: TimelineItem[];
  rulers: TimelineItem[];
  writing: TimelineItem[];
  alive: TimelineItem[];
  /** Headline and main events within five years, nearest first. */
  nearby: TimelineItem[];
}

const covers = (it: TimelineItem, year: number) => it.year_start <= year && year <= it.year_end;

/** Everything going on in one year, across every lane. */
export function momentAt(data: TimelineData, year: number): Moment {
  const m: Moment = { year, judah: [], israel: [], prophets: [], empires: [], rulers: [], writing: [], alive: [], nearby: [] };
  for (const it of data.items) {
    switch (it.lane) {
      case 'kings':
        if (!covers(it, year)) break;
        if (it.sub === 'israel') m.israel.push(it);
        else m.judah.push(it);
        break;
      case 'prophets':
        if (covers(it, year)) m.prophets.push(it);
        break;
      case 'world':
        if (covers(it, year)) (it.sub === 'empire' ? m.empires : m.rulers).push(it);
        break;
      case 'books':
        if (covers(it, year)) m.writing.push(it);
        break;
      case 'lives':
        if (covers(it, year)) m.alive.push(it);
        break;
      case 'events':
        if ((it.tier ?? 3) <= 2 && it.year_end >= year - 5 && it.year_start <= year + 5) m.nearby.push(it);
        break;
    }
  }
  const distance = (it: TimelineItem) => (covers(it, year) ? 0 : Math.min(Math.abs(it.year_start - year), Math.abs(it.year_end - year)));
  m.nearby.sort((a, b) => distance(a) - distance(b) || (a.tier ?? 3) - (b.tier ?? 3) || a.sort_key - b.sort_key);
  m.nearby = m.nearby.slice(0, 5);
  return m;
}

// ===== Search =====

/** Items matching every word typed, best first: title starts, then title contains, then anywhere. */
export function searchItems(data: TimelineData, query: string, limit = 8): TimelineItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: { it: TimelineItem; score: number }[] = [];
  for (const it of data.items) {
    if (!words.every((w) => it.search.includes(w))) continue;
    const title = it.title.toLowerCase();
    let score = title.startsWith(words[0]) ? 0 : words.every((w) => title.includes(w)) ? 1 : 2;
    // Headline events before detail, eras and reigns alongside headlines.
    score = score * 10 + (it.lane === 'events' ? (it.tier ?? 3) : 1);
    hits.push({ it, score });
  }
  hits.sort((a, b) => a.score - b.score || a.it.sort_key - b.it.sort_key);
  return hits.slice(0, limit).map((h) => h.it);
}

// ===== Back and next =====

/**
 * The items either side of this one in its own lane: the events showing at
 * this zoom, the other reigns of the same kingdom, and so on.
 */
export function neighbours(data: TimelineData, item: TimelineItem, tier: 1 | 2 | 3): { prev?: TimelineItem; next?: TimelineItem } {
  let list: TimelineItem[];
  if (item.lane === 'events') {
    const t = Math.max(tier, item.tier ?? 3);
    list = data.events.filter((e) => (e.tier ?? 3) <= t);
  } else if (item.lane === 'kings') {
    // United-kingdom kings walk on into Judah, David's line.
    const kingdom = item.sub === 'israel' ? ['israel'] : ['united', 'judah'];
    list = data.items.filter((it) => it.lane === 'kings' && kingdom.includes(it.sub ?? ''));
    list.sort((a, b) => (a.co_start ?? a.year_start) - (b.co_start ?? b.year_start));
  } else if (item.lane === 'world') {
    list = data.items.filter((it) => it.lane === 'world' && it.sub === item.sub);
  } else {
    list = data.items.filter((it) => it.lane === item.lane);
  }
  const i = list.findIndex((it) => it.id === item.id);
  if (i === -1) return {};
  return { prev: list[i - 1], next: list[i + 1] };
}
