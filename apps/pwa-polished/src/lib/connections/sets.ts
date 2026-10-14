/**
 * Sets: named groups of verses, chapters and books, each with its own color.
 *
 * With a set shown, only the arcs touching it are drawn, and in its color
 * rather than the book colors — so "everything Isaiah 53 reaches" or "every
 * Old Testament quotation" stands out as one hue. Several sets can show at
 * once; an arc touching two wears the one higher in the list.
 *
 * This colors the picture and nothing else. A set is not a second
 * cross-reference system: it adds no links, it only picks which of the
 * existing ones light up.
 *
 * A set is kept as references (book, chapter, verse), never as verse
 * positions, so a set saved on one device means the same passages everywhere
 * whatever the numbering underneath. Positions are worked out when the set is
 * shown.
 *
 * Ready-made sets are built from data the app already has — the Old
 * Testament quotation index, the parallel accounts index, and the reader's own
 * highlight categories — and are rebuilt each time they are shown, so a new
 * highlight joins its set without anyone editing it.
 */

import { BIBLE_BOOKS } from '../bibleData';
import { BOOK_MAP } from '../parseRefString';
import { otQuotesForChapter, type OtQuoteGrade } from '../otQuotesIndex';
import { parallelGroups } from '../parallelIndex';
import { HIGHLIGHT_CATEGORIES, HIGHLIGHT_PALETTE, categoryKeyFor, categoryMeaning } from '../highlightCategories';
import { syncedUserDataStore } from '../../adapters/SyncedUserDataStore';
import { bookSpan, chapterSpan, positionOf, refAt, type ConnectionRef, type ConnectionsData } from './data';
import type { Span } from './lights';
import type { ArcSide, Orientation } from './layout';
import { getSettings, updateSettings } from '../../adapters/settings';

/** One passage in a set, first verse to last, both included. */
export interface SetItem {
  start: ConnectionRef;
  end: ConnectionRef;
}

/** Where a ready-made set's passages come from. */
export type ReadySource = 'ot-quotes' | 'ot-echoes' | 'parallels' | `highlight:${string}`;

/** A set as it is saved and synced. */
export interface ConnectionSet {
  id: string;
  name: string;
  /** A #rrggbb color. */
  color: string;
  /** The reader's own passages. Empty for a ready-made set. */
  items: SetItem[];
  /** Present on a ready-made set, which is rebuilt from this each time it shows. */
  ready?: ReadySource;
}

/**
 * Colors a new set is given, in turn. Bright enough to read on the dark
 * background and deep enough on the pale ones, and none of them a book
 * category color, so a set never looks like a book.
 */
export const SET_COLORS = ['#ff4d6d', '#ffd23f', '#3ddc84', '#3fa7ff', '#ff8fd1', '#2ee6d6', '#ff9f43', '#b8f35b'];

/** The most sets a picture can show at once. A verse's set is kept in one byte. */
export const MAX_SHOWN_SETS = 12;

/** The next color nobody is wearing, or the next in turn once all are taken. */
export function nextSetColor(sets: ConnectionSet[]): string {
  const used = new Set(sets.map((s) => s.color.toLowerCase()));
  return SET_COLORS.find((c) => !used.has(c)) ?? SET_COLORS[sets.length % SET_COLORS.length];
}

export function newSetId(): string {
  return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* --------------------------------------------------------------------------- *
 * Items
 * ------------------------------------------------------------------------- */

/** A half-open span of verse positions as an item, or null off the line. */
export function itemFromSpan(span: Span): SetItem | null {
  const start = refAt(span.start);
  const end = refAt(span.end - 1);
  return start && end ? { start, end } : null;
}

/** An item as positions, or null if it names something that is not there. */
export function spanOfItem(item: SetItem): Span | null {
  const a = positionOf(item.start.book, item.start.chapter, item.start.verse);
  const b = positionOf(item.end.book, item.end.chapter, item.end.verse);
  if (a === null || b === null) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) + 1 };
}

/** "Genesis", "Genesis 3", "Genesis 3:15", "Genesis 3:1–4:7", "Genesis 50 – Exodus 2". */
export function itemLabel(item: SetItem): string {
  const { start: s, end: e } = item;
  const span = spanOfItem(item);
  const book = bookSpan(s.book);
  if (span && book && s.book === e.book && span.start === book.start && span.end === book.end) return s.book;
  if (s.book === e.book && s.chapter === e.chapter) {
    const chapter = chapterSpan(s.book, s.chapter);
    if (span && chapter && span.start === chapter.start && span.end === chapter.end) return `${s.book} ${s.chapter}`;
    return s.verse === e.verse ? `${s.book} ${s.chapter}:${s.verse}` : `${s.book} ${s.chapter}:${s.verse}–${e.verse}`;
  }
  // Whole chapters across a stretch read as chapters, not as verse numbers.
  const first = chapterSpan(s.book, s.chapter);
  const last = chapterSpan(e.book, e.chapter);
  const wholeChapters = span && first && last && span.start === first.start && span.end === last.end;
  if (s.book === e.book) {
    return wholeChapters ? `${s.book} ${s.chapter}–${e.chapter}` : `${s.book} ${s.chapter}:${s.verse}–${e.chapter}:${e.verse}`;
  }
  return wholeChapters
    ? `${s.book} ${s.chapter} – ${e.book} ${e.chapter}`
    : `${s.book} ${s.chapter}:${s.verse} – ${e.book} ${e.chapter}:${e.verse}`;
}

/** The book name for anything a reader might type: "Gen", "1 cor", "song of solomon", "Psalms". */
function bookNamed(text: string): string | null {
  const key = text.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (!key) return null;
  if (key === 'psalms') return 'Psalm';
  const exact = BIBLE_BOOKS.find((b) => b.name.toLowerCase() === key);
  if (exact) return exact.name;
  const mapped = BOOK_MAP[key] ?? BOOK_MAP[key.replace(/ /g, '')];
  if (mapped) return mapped === 'Psalms' ? 'Psalm' : mapped;
  // A clear start of a name: "rev", "phile". Only when one book fits.
  const starts = BIBLE_BOOKS.filter((b) => b.name.toLowerCase().startsWith(key));
  return starts.length === 1 ? starts[0].name : null;
}

/**
 * A typed passage as an item: a book ("Ruth"), a chapter ("Isaiah 53"), a verse
 * ("John 3:16"), or a range ("Isaiah 52:13-53:12", "Matthew 5-7"). Null when it
 * can't be read.
 */
export function parseItem(text: string): SetItem | null {
  const m = text
    .trim()
    .match(/^(.*?[A-Za-z].*?)\s*(?:(\d+)(?::(\d+))?(?:\s*[-–]\s*(\d+)(?::(\d+))?)?)?$/);
  if (!m) return null;
  const book = bookNamed(m[1]);
  if (!book) return null;
  const whole = bookSpan(book);
  if (!whole) return null;
  const [c1, v1, a, b] = [m[2], m[3], m[4], m[5]].map((n) => (n === undefined ? undefined : parseInt(n, 10)));

  // A book on its own.
  if (c1 === undefined) return itemFromSpan(whole);

  const ch1 = chapterSpan(book, c1);
  if (!ch1) return null;
  const lastVerseOf = (chapter: number) => {
    const span = chapterSpan(book, chapter);
    return span ? span.end - span.start : 0;
  };

  let start: ConnectionRef;
  let end: ConnectionRef;
  if (v1 === undefined) {
    // "Matthew 5" or "Matthew 5-7": whole chapters.
    const c2 = a ?? c1;
    if (!chapterSpan(book, c2)) return null;
    start = { book, chapter: c1, verse: 1 };
    end = { book, chapter: c2, verse: lastVerseOf(c2) };
  } else if (a === undefined) {
    start = end = { book, chapter: c1, verse: v1 };
  } else if (b === undefined) {
    // "John 3:16-18": verses in one chapter.
    start = { book, chapter: c1, verse: v1 };
    end = { book, chapter: c1, verse: a };
  } else {
    // "Isaiah 52:13-53:12": across a chapter break.
    start = { book, chapter: c1, verse: v1 };
    end = { book, chapter: a, verse: b };
  }
  if (start.verse < 1 || start.verse > lastVerseOf(start.chapter)) return null;
  if (end.verse < 1 || end.verse > lastVerseOf(end.chapter)) return null;
  const item = { start, end };
  const span = spanOfItem(item);
  if (!span) return null;
  // Written backwards ("John 3:18-16"): put it the right way round.
  return itemFromSpan(span);
}

/* --------------------------------------------------------------------------- *
 * Ready-made sets
 * ------------------------------------------------------------------------- */

/** A ready-made set the reader can add, as the picker lists it. */
export interface ReadyOffer {
  source: ReadySource;
  name: string;
  color: string;
  /** One line saying what it holds. */
  blurb: string;
}

/** Psalm is "Psalm" on the line and "Psalms" in some indexes. */
function lineBook(book: string): string {
  return book === 'Psalms' ? 'Psalm' : book;
}

/** A chapter-and-verse stretch as a span, or null. */
function spanOfRef(book: string, chapter: number, verse: number, endVerse = verse): Span | null {
  const a = positionOf(lineBook(book), chapter, verse);
  const b = positionOf(lineBook(book), chapter, endVerse);
  return a === null || b === null ? null : { start: a, end: Math.max(a, b) + 1 };
}

/**
 * Every verse in the New Testament that quotes the Old (grade 'quote') or
 * echoes it (grade 'allusion'), and every Old Testament verse it draws on.
 * Both ends, so the arcs between a quotation and its source light from
 * either side. A verse that does both is graded by the stronger, as the
 * reader marks it, so it sits in the quotations set only.
 */
function otQuoteSpans(grade: OtQuoteGrade): Span[] {
  const spans: Span[] = [];
  const ntStart = BIBLE_BOOKS.findIndex((b) => b.name === 'Matthew');
  for (const book of BIBLE_BOOKS.slice(ntStart)) {
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      for (const [verse, entry] of otQuotesForChapter(book.name, chapter)) {
        if (entry.grade !== grade) continue;
        const here = spanOfRef(book.name, chapter, verse);
        if (here) spans.push(here);
        for (const ref of entry.refs) {
          const there = spanOfRef(ref.book, ref.chapter, ref.verse, ref.endVerse ?? ref.verse);
          if (there) spans.push(there);
        }
      }
    }
  }
  return spans;
}

/** Every passage that has a parallel telling somewhere else. */
function parallelSpans(): Span[] {
  const spans: Span[] = [];
  for (const group of parallelGroups) {
    if (group.soloRobertson || group.passages.length < 2) continue;
    for (const p of group.passages) {
      const a = positionOf(lineBook(p.book), p.startChapter, p.startVerse);
      const b = positionOf(lineBook(p.book), p.endChapter, p.endVerse);
      if (a !== null && b !== null) spans.push({ start: Math.min(a, b), end: Math.max(a, b) + 1 });
    }
  }
  return spans;
}

/** Every highlighted verse, by the category its marks fall in. */
async function highlightedVerses(): Promise<Map<string, Span[]>> {
  const [highlights, words] = await Promise.all([
    syncedUserDataStore.getHighlights(),
    syncedUserDataStore.getWordHighlights(),
  ]);
  const out = new Map<string, Span[]>();
  for (const h of [...highlights, ...words]) {
    const key = categoryKeyFor(h.style);
    const span = spanOfRef(h.reference.book, h.reference.chapter, h.reference.verse);
    if (!span) continue;
    const list = out.get(key);
    if (list) list.push(span);
    else out.set(key, [span]);
  }
  return out;
}

/** The line groups have no color of their own; they get one from the set colors. */
const LINE_COLORS: Record<string, string> = {
  'line-solid': '#3fa7ff',
  'line-boxed': '#2ee6d6',
  'line-wavy': '#ff8fd1',
};

const OT_QUOTES_NAME = 'Old Testament quotations';
/** What the quotations set was called while it held the echoes too, and the yellow it wore. */
const OT_QUOTES_OLD_NAME = 'Old Testament in the New';
const OT_QUOTES_OLD_COLOR = '#ffd23f';
/** Quotations in gold, echoes in silver: the louder metal for the plainer borrowing. */
const OT_GOLD = '#e0b03a';
const OT_SILVER = '#b2bac4';

/**
 * The ready-made sets on offer: the two indexes always, and one per highlight
 * category the reader has actually used.
 */
export async function readyOffers(names: Record<string, string>): Promise<ReadyOffer[]> {
  const offers: ReadyOffer[] = [
    {
      source: 'ot-quotes',
      name: OT_QUOTES_NAME,
      color: OT_GOLD,
      blurb: 'Every New Testament verse that quotes the Old, and the verses it quotes',
    },
    {
      source: 'ot-echoes',
      name: 'Old Testament echoes',
      color: OT_SILVER,
      blurb: 'Every New Testament verse that alludes to or echoes the Old, and the verses it echoes',
    },
    {
      source: 'parallels',
      name: 'Parallel accounts',
      color: '#3ddc84',
      blurb: 'Every passage told more than once: the Gospels, Kings and Chronicles, and the rest',
    },
  ];
  let used: Map<string, Span[]>;
  try {
    used = await highlightedVerses();
  } catch {
    used = new Map();
  }
  for (const cat of HIGHLIGHT_CATEGORIES) {
    const count = used.get(cat.key)?.length ?? 0;
    if (!count) continue;
    offers.push({
      source: `highlight:${cat.key}`,
      name: highlightSetName(cat.key, names),
      color: cat.color ?? LINE_COLORS[cat.key] ?? '#3fa7ff',
      blurb: `Your highlights: ${count.toLocaleString()} ${count === 1 ? 'verse' : 'verses'}`,
    });
  }
  return offers;
}

/**
 * A highlight category's set name. A marker's meaning is a long list, so it
 * keeps the first word of it after the color: "Yellow: Trinity". A group the
 * reader named goes by that name, and an unnamed one by its plain label.
 */
function highlightSetName(key: string, names: Record<string, string>): string {
  const cat = HIGHLIGHT_CATEGORIES.find((c) => c.key === key);
  if (!cat) return 'Highlights';
  const first = (text: string) => text.split(',')[0].trim();
  if (cat.kind === 'marker') {
    const color = HIGHLIGHT_PALETTE[Number(key.slice('marker-'.length))]?.label ?? '';
    return `${color}: ${first(cat.label)}`;
  }
  if (cat.nameable) return names[key] || cat.label;
  return first(categoryMeaning(key, names));
}

/* --------------------------------------------------------------------------- *
 * What the draw is handed
 * ------------------------------------------------------------------------- */

/**
 * The shown sets, ready for the draw.
 *
 * `mask` holds, for every verse in the Bible, the place in the list of the
 * first shown set it belongs to, or -1 for none. Finding an arc's color is
 * then two array reads — the alternative, testing each of an arc's feet
 * against every passage of every set, is a highlight set's hundreds of verses
 * times a hundred thousand arcs, every time the batches are rebuilt.
 *
 * A new object whenever anything about the shown sets changes, which is what
 * the draw caches on.
 */
export interface SetLayer {
  mask: Int8Array;
  /** Each shown set's color, in list order. */
  colors: Array<[number, number, number]>;
}

function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The passages a set covers right now, as spans. Ready-made sets are rebuilt. */
export async function spansOfSet(set: ConnectionSet): Promise<Span[]> {
  if (!set.ready) return set.items.map(spanOfItem).filter((s): s is Span => s !== null);
  if (set.ready === 'ot-quotes') return otQuoteSpans('quote');
  if (set.ready === 'ot-echoes') return otQuoteSpans('allusion');
  if (set.ready === 'parallels') return parallelSpans();
  const key = set.ready.slice('highlight:'.length);
  try {
    return (await highlightedVerses()).get(key) ?? [];
  } catch {
    return [];
  }
}

/** The draw's layer for these sets, in this order. Null when none are shown. */
export async function layerFor(data: ConnectionsData, sets: ConnectionSet[]): Promise<SetLayer | null> {
  const shown = sets.slice(0, MAX_SHOWN_SETS);
  if (!shown.length) return null;
  const mask = new Int8Array(data.totalVerses).fill(-1);
  const all = await Promise.all(shown.map(spansOfSet));
  // Later sets first, so an earlier set paints over them and wins the verse.
  for (let n = shown.length - 1; n >= 0; n--) {
    for (const span of all[n]) {
      mask.fill(n, Math.max(span.start, 0), Math.min(span.end, data.totalVerses));
    }
  }
  return { mask, colors: shown.map((s) => rgbOf(s.color)) };
}

/** How many verses a set's spans cover, overlaps counted once. For the list. */
export function versesCovered(data: ConnectionsData, spans: Span[]): number {
  const seen = new Uint8Array(data.totalVerses);
  let count = 0;
  for (const s of spans) {
    for (let p = Math.max(s.start, 0); p < Math.min(s.end, data.totalVerses); p++) {
      if (!seen[p]) {
        seen[p] = 1;
        count++;
      }
    }
  }
  return count;
}

/* --------------------------------------------------------------------------- *
 * Saving: the sets and the saved views follow the account
 * ------------------------------------------------------------------------- */

/** The look a saved view puts back. */
export interface ConnectionsLook {
  orientation: Orientation;
  side: ArcSide;
  voteFloor: number;
  maxArcs: number;
}

/** A saved view: the look, and which sets were showing. */
export interface ConnectionsView extends ConnectionsLook {
  id: string;
  name: string;
  /** The ids of the sets shown, in the library's order. */
  shown: string[];
}

export const MAX_SETS = 40;
export const MAX_VIEWS = 20;
/** A set's own passages, so a synced settings row stays small. */
export const MAX_ITEMS = 300;

const isRef = (r: unknown): r is ConnectionRef =>
  !!r &&
  typeof (r as ConnectionRef).book === 'string' &&
  Number.isInteger((r as ConnectionRef).chapter) &&
  Number.isInteger((r as ConnectionRef).verse);

const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

function isReady(r: unknown): r is ReadySource {
  return r === 'ot-quotes' || r === 'ot-echoes' || r === 'parallels' || (typeof r === 'string' && r.startsWith('highlight:'));
}

/**
 * The saved sets, with anything malformed left out: a set synced from a newer
 * build, or written by hand into a backup, must not take the window down.
 */
export function savedSets(): ConnectionSet[] {
  const list = getSettings().connectionSets;
  if (!Array.isArray(list)) return [];
  const out: ConnectionSet[] = [];
  for (const raw of list) {
    const s = raw as Partial<ConnectionSet>;
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || !isColor(s.color)) continue;
    const items = Array.isArray(s.items)
      ? s.items.filter((i): i is SetItem => !!i && isRef(i.start) && isRef(i.end))
      : [];
    // The quotations set once held the echoes too, under a broader name; one
    // still wearing that name gets the narrower one it now deserves.
    // Its old yellow likewise turns gold, unless the reader picked a color of their own.
    const name = s.ready === 'ot-quotes' && s.name === OT_QUOTES_OLD_NAME ? OT_QUOTES_NAME : s.name;
    const color = s.ready === 'ot-quotes' && s.color.toLowerCase() === OT_QUOTES_OLD_COLOR ? OT_GOLD : s.color;
    out.push({ id: s.id, name, color, items, ...(isReady(s.ready) ? { ready: s.ready } : {}) });
  }
  return out.slice(0, MAX_SETS);
}

export function saveSets(sets: ConnectionSet[]): void {
  updateSettings({
    connectionSets: sets
      .slice(0, MAX_SETS)
      .map((s) => ({ ...s, items: s.items.slice(0, MAX_ITEMS) })) as unknown as Array<Record<string, unknown>>,
  });
}

const ORIENTATIONS: Orientation[] = ['horizontal', 'vertical'];
const SIDES: ArcSide[] = ['top', 'bottom', 'split'];

/** A look from anywhere — a saved view, a window's remembered state — or null if it isn't one. */
export function cleanLook(raw: unknown): ConnectionsLook | null {
  const l = raw as Partial<ConnectionsLook> | null;
  if (!l || typeof l !== 'object') return null;
  if (!ORIENTATIONS.includes(l.orientation as Orientation) || !SIDES.includes(l.side as ArcSide)) return null;
  if (!Number.isFinite(l.voteFloor) || !Number.isFinite(l.maxArcs)) return null;
  return { orientation: l.orientation!, side: l.side!, voteFloor: l.voteFloor!, maxArcs: Math.max(0, l.maxArcs!) };
}

export function savedViews(): ConnectionsView[] {
  const list = getSettings().connectionViews;
  if (!Array.isArray(list)) return [];
  const out: ConnectionsView[] = [];
  for (const raw of list) {
    const v = raw as Partial<ConnectionsView>;
    const look = cleanLook(v);
    if (!look || typeof v.id !== 'string' || typeof v.name !== 'string') continue;
    const shown = Array.isArray(v.shown) ? v.shown.filter((id): id is string => typeof id === 'string') : [];
    out.push({ id: v.id, name: v.name, ...look, shown });
  }
  return out.slice(0, MAX_VIEWS);
}

export function saveViews(views: ConnectionsView[]): void {
  updateSettings({ connectionViews: views.slice(0, MAX_VIEWS) as unknown as Array<Record<string, unknown>> });
}
