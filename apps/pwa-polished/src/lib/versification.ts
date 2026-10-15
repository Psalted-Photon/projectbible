/**
 * Where a verse in one text's numbering lands in another's.
 *
 * The Hebrew text, the Septuagint and a few English packs number some verses
 * differently from the English Bibles: Malachi 3:19 in Hebrew is English 4:1,
 * Hebrew psalm titles are a verse of their own, BYZ prints Romans 16:25-27
 * inside 14:23. Every conversion goes through English numbering, so each text
 * only needs its own table against English.
 *
 * The tables are built by scripts/build-versification.mjs from STEPBible's
 * TVTMS file (CC BY 4.0) and checked against the shipped packs; that script's
 * header describes the run format decoded here.
 */

import data from '../data/versification.json';
import { BIBLE_BOOKS, normalizeBookName } from './bibleData';
import { mtToLxxPsalm, lxxToMtPsalm } from './lxxPsalms';
import { isHebrewText } from './translationKind';

export type Scheme = 'english' | 'hebrew' | 'majority' | 'web' | 'lxx' | 'lxx2012';

/**
 * Which part of the English verse a mapped verse stands for. English packs
 * print a psalm's title inside verse 1; the Hebrew gives the title its own
 * verse, so that Hebrew verse is the "title" part of English verse 1 and the
 * next Hebrew verse is its "body".
 */
export type VersePart = 'whole' | 'title' | 'body';

export interface VerseRef {
  book: string;
  chapter: number;
  verse: number;
}

export interface MappedRef extends VerseRef {
  part: VersePart;
}

type Runs = Record<string, Record<string, string[]>>;

interface VersificationData {
  source: string;
  hebrew: Runs;
  byz: Runs;
  web: Runs;
  /** Greek Septuagint chapters against lxx2012: title verses to skip, or null. */
  lxxShift: Record<string, Record<string, number | null>>;
  /** Greek Septuagint chapters numbered like the Hebrew. */
  lxxHebrew: Record<string, number[]>;
  /** lxx2012 chapters outside Psalms with no English counterpart. */
  lxx2012Unmapped: Record<string, number[]>;
}

const DATA = data as VersificationData;

/** Credit line for the numbering data. */
export const VERSIFICATION_SOURCE = DATA.source;

const TABLES: Partial<Record<Scheme, Runs>> = {
  hebrew: DATA.hebrew,
  majority: DATA.byz,
  web: DATA.web,
};

const CANON = new Set(BIBLE_BOOKS.map((b) => b.name));

/** The tables use the packs' book names, which say "Psalms". */
function tableBook(book: string): string {
  const name = normalizeBookName(book);
  return name === 'Psalm' ? 'Psalms' : name;
}

const isCanon = (book: string) => CANON.has(normalizeBookName(book));

export function schemeOf(translationId: string | null | undefined): Scheme {
  const id = (translationId || '').toLowerCase();
  if (id === 'byz') return 'majority';
  if (id === 'web') return 'web';
  if (id === 'lxx') return 'lxx';
  if (id === 'lxx2012') return 'lxx2012';
  if (isHebrewText(id)) return 'hebrew';
  return 'english';
}

const PARTS: Record<string, VersePart> = { t: 'title', b: 'body' };

/** A listed chapter's runs for one verse, or null when the chapter isn't listed. */
function decode(table: Runs, book: string, chapter: number, verse: number): MappedRef[] | null {
  const runs = table[tableBook(book)]?.[chapter];
  if (!runs) return null;
  for (const run of runs) {
    const [src, dst] = run.split('>');
    const [a, b = a] = src.split('-').map(Number);
    if (verse < a || verse > b) continue;
    if (!dst) return [];
    return dst.split(',').map((t) => {
      const [, ch, v, part] = t.match(/^(\d+):(\d+)([tb]?)$/)!;
      return { book, chapter: Number(ch), verse: Number(v) + (verse - a), part: PARTS[part] ?? 'whole' };
    });
  }
  return [];
}

const whole = (book: string, chapter: number, verse: number): MappedRef => ({ book, chapter, verse, part: 'whole' });

// ── Septuagint ─────────────────────────────────────────────────────────────

/** LXX 10-145 run one behind the Hebrew; the split and merged psalms don't move whole. */
function lxxToMtChapter(chapter: number): number | null {
  if (chapter <= 8 || chapter >= 148) return chapter;
  if (chapter >= 10 && chapter <= 145) return chapter + 1;
  return null;
}

function mtToLxxChapter(chapter: number): number | null {
  if (chapter <= 8 || chapter >= 148) return chapter;
  if (chapter >= 11 && chapter <= 146) return chapter - 1;
  return null;
}

function lxxShiftOf(book: string, chapter: number): number | null {
  const rule = DATA.lxxShift[tableBook(book)]?.[chapter];
  return rule === undefined ? 0 : rule;
}

function lxx2012HasEnglish(book: string, chapter: number): boolean {
  if (tableBook(book) === 'Psalms') return true;
  return isCanon(book) && !DATA.lxx2012Unmapped[tableBook(book)]?.includes(chapter);
}

/** Greek Septuagint verse → lxx2012 verse(s). */
function lxxToLxx2012(ref: VerseRef): MappedRef[] {
  const shift = lxxShiftOf(ref.book, ref.chapter);
  if (shift === null) return [];
  if (shift === 0) return [whole(ref.book, ref.chapter, ref.verse)];
  if (ref.verse <= shift) return [{ ...ref, verse: 1, part: 'title' }];
  if (ref.verse === shift + 1) return [{ ...ref, verse: 1, part: 'body' }];
  return [whole(ref.book, ref.chapter, ref.verse - shift)];
}

/** lxx2012 verse → Greek Septuagint verse(s). */
function lxx2012ToLxx(ref: VerseRef): MappedRef[] {
  const shift = lxxShiftOf(ref.book, ref.chapter);
  if (shift === null) return [];
  if (shift === 0) return [whole(ref.book, ref.chapter, ref.verse)];
  if (ref.verse > 1) return [whole(ref.book, ref.chapter, ref.verse + shift)];
  const out: MappedRef[] = [];
  for (let v = 1; v <= shift; v++) out.push({ ...ref, verse: v, part: 'title' });
  out.push({ ...ref, verse: shift + 1, part: 'body' });
  return out;
}

const viaLxxHebrew = (book: string, chapter: number) =>
  !!DATA.lxxHebrew[tableBook(book)]?.includes(chapter);

// ── To and from English ────────────────────────────────────────────────────

/**
 * A verse of `translationId` in English numbering. Several results when the
 * verse holds several English verses; an empty list when it has no English
 * counterpart.
 */
export function toEnglish(translationId: string, ref: VerseRef): MappedRef[] {
  const scheme = schemeOf(translationId);
  const { book, chapter, verse } = ref;

  if (scheme === 'lxx2012') {
    if (tableBook(book) === 'Psalms') {
      const mt = lxxToMtPsalm(chapter, verse);
      return mt ? [whole(book, mt.chapter, mt.verse)] : [];
    }
    return lxx2012HasEnglish(book, chapter) ? [whole(book, chapter, verse)] : [];
  }

  if (scheme === 'lxx') {
    if (lxxShiftOf(book, chapter) !== null && lxx2012HasEnglish(book, chapter)) {
      return lxxToLxx2012(ref).flatMap((r) =>
        toEnglish('lxx2012', r).map((e) => ({ ...e, part: r.part })),
      );
    }
    if (viaLxxHebrew(book, chapter)) {
      const mt = tableBook(book) === 'Psalms' ? lxxToMtChapter(chapter) : chapter;
      return mt ? toEnglish('hebrew-oshb', { book, chapter: mt, verse }) : [];
    }
    return [];
  }

  const table = TABLES[scheme];
  return (table && decode(table, book, chapter, verse)) ?? [whole(book, chapter, verse)];
}

/** Reverse indexes, built the first time each table is read backwards. */
interface Inverse {
  byVerse: Map<string, MappedRef[]>;
  /** English chapters a table speaks for; anything else is the same number. */
  chapters: Set<string>;
}
const inverses = new Map<Scheme, Inverse>();

function inverseOf(scheme: Scheme, table: Runs): Inverse {
  let inv = inverses.get(scheme);
  if (inv) return inv;
  inv = { byVerse: new Map(), chapters: new Set() };
  for (const [book, chapters] of Object.entries(table)) {
    for (const [ch, runs] of Object.entries(chapters)) {
      inv.chapters.add(`${book} ${ch}`);
      for (const run of runs) {
        const [a, b = a] = run.split('>')[0].split('-').map(Number);
        for (let v = a; v <= b; v++) {
          for (const t of decode(table, book, Number(ch), v) ?? []) {
            inv.chapters.add(`${book} ${t.chapter}`);
            const k = `${book} ${t.chapter}:${t.verse}`;
            const list = inv.byVerse.get(k) ?? [];
            list.push({ book, chapter: Number(ch), verse: v, part: t.part });
            inv.byVerse.set(k, list);
          }
        }
      }
    }
  }
  inverses.set(scheme, inv);
  return inv;
}

/**
 * An English-numbered verse in `translationId`'s numbering. `part` says which
 * part of the English verse each result stands for.
 */
export function fromEnglish(translationId: string, ref: VerseRef): MappedRef[] {
  const scheme = schemeOf(translationId);
  const { book, chapter, verse } = ref;

  if (scheme === 'lxx2012') {
    if (tableBook(book) === 'Psalms') {
      const lxx = mtToLxxPsalm(chapter, verse);
      return lxx ? [whole(book, lxx.chapter, lxx.verse)] : [];
    }
    return lxx2012HasEnglish(book, chapter) ? [whole(book, chapter, verse)] : [];
  }

  if (scheme === 'lxx') {
    const out: MappedRef[] = [];
    for (const r of fromEnglish('lxx2012', ref)) {
      if (!lxx2012HasEnglish(book, r.chapter) || viaLxxHebrew(book, r.chapter)) continue;
      out.push(...lxx2012ToLxx(r));
    }
    for (const h of fromEnglish('hebrew-oshb', ref)) {
      const ch = tableBook(book) === 'Psalms' ? mtToLxxChapter(h.chapter) : h.chapter;
      if (ch !== null && viaLxxHebrew(book, ch)) out.push({ ...h, chapter: ch });
    }
    return dedupe(out);
  }

  const table = TABLES[scheme];
  if (!table) return [whole(book, chapter, verse)];
  const inv = inverseOf(scheme, table);
  const tb = tableBook(book);
  if (!inv.chapters.has(`${tb} ${chapter}`)) return [whole(book, chapter, verse)];
  return (inv.byVerse.get(`${tb} ${chapter}:${verse}`) ?? []).map((r) => ({ ...r, book }));
}

function dedupe(refs: MappedRef[]): MappedRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.chapter}:${r.verse}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * A verse of one text in another text's numbering, first match first. Empty
 * when the other text has no counterpart.
 */
export function convertRef(fromTranslation: string, toTranslation: string, ref: VerseRef): MappedRef[] {
  const from = schemeOf(fromTranslation);
  const to = schemeOf(toTranslation);
  if (from === to) return [whole(ref.book, ref.chapter, ref.verse)];
  // The Greek Septuagint and lxx2012 line up directly in more chapters than
  // either lines up with English.
  if (from === 'lxx' && to === 'lxx2012') return lxxToLxx2012(ref);
  if (from === 'lxx2012' && to === 'lxx') return lxx2012ToLxx(ref);
  return dedupe(
    toEnglish(fromTranslation, ref).flatMap((e) => {
      const found = fromEnglish(toTranslation, e);
      // Both sides split a psalm's title from its body: keep to the same part.
      const samePart = e.part === 'whole' ? [] : found.filter((f) => f.part === e.part);
      if (samePart.length) return samePart;
      // Only the source splits it: the verse found is the merged one, and the
      // source stands for that part of it (Hebrew Ps 3:1 is NET 3:1's title).
      return found.map((f) => (f.part === 'whole' ? { ...f, part: e.part } : f));
    }),
  );
}
