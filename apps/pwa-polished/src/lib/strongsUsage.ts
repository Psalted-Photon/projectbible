/**
 * One Strong's number's usage across the installed original-language texts.
 *
 * The word study needs three things out of the morphology store — the verses a
 * number appears in, the inflected forms it appears as, and the original text of
 * each of those verses — and each used to be answered by its own full scan of
 * the `strongsId` index. This module scans once and derives the rest, so opening
 * a study costs one pass rather than one per tab.
 *
 * Two kinds of multiplicity live in that store and they want opposite treatment:
 *
 *   - BYZ, TR and SBLGNT are competing editions of the *same* New Testament. A
 *     verse all three carry is one verse, not three. Counting it three times is
 *     exactly what made the old inflection counts wrong — they scaled with how
 *     many Greek texts you happened to have installed.
 *   - The LXX is a *different corpus* that happens to share Greek Strong's
 *     numbers with the NT. Its hits are separate evidence and never merge with
 *     them, which is why callers group by testament before showing anything.
 */

import { BIBLE_BOOKS, normalizeBookName } from './bibleData.js';
import { openDB } from '../adapters/db';

/** One morphology row: a single tagged word in a single text. */
export interface UsageRow {
  translationId: string;
  /** Book name exactly as the pack stored it — needed to query the verse back
   *  out of `verse_ref`, whose key path is the raw field. */
  rawBook: string;
  /** Normalized name, for grouping, ordering and colour. */
  book: string;
  chapter: number;
  verse: number;
  /** 0-based position of the word in its verse. */
  wordIndex: number;
  /** The inflected surface form as it appears in the text. */
  form: string;
  morphCode: string;
}

/** One verse, after the editions carrying it have been folded together. */
export interface VerseUse {
  book: string;
  rawBook: string;
  chapter: number;
  verse: number;
  testament: 'OT' | 'NT';
  /** Editions that contain this verse with the word in it, in canonical order. */
  sources: string[];
  /** translationId → the word positions to mark in that edition's text. */
  marks: Record<string, number[]>;
}

/** One inflected form, with every verse it occurs in. */
export interface FormGroup {
  /** Stable identity for keyed each-blocks and expand state. */
  key: string;
  form: string;
  morphCode: string;
  /** Distinct verses, not raw hits — see the note at the top of this file. */
  count: number;
  uses: VerseUse[];
}

/** A word of original-language text, for rendering a preview line. */
export interface Token {
  text: string;
  wordIndex: number;
}

export interface StrongsUsage {
  rows: UsageRow[];
  /**
   * Editions that contain this word at all, canonically ordered.
   *
   * Derived from the scan rather than from the installed-pack list on purpose.
   * Consolidated packs carry several editions inside one pack row, so the packs
   * store cannot enumerate them; and what the picker actually wants to offer is
   * the texts that have something to show for *this* word.
   */
  sources: string[];
}

// Canonical order and testament, resolved once rather than per row.
const BOOK_ORDER = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
const BOOK_TESTAMENT = new Map(BIBLE_BOOKS.map((b) => [b.name, b.testament]));

/** Display order for the source picker: NT editions, then the Septuagint, then
 *  Hebrew. Anything unrecognised sorts after, alphabetically. */
const SOURCE_ORDER = ['BYZ', 'TR', 'SBLGNT', 'OGNT', 'LXX', 'WLC', 'HEBREW-OSHB'];

function sourceRank(id: string): number {
  const i = SOURCE_ORDER.indexOf(id.toUpperCase());
  return i === -1 ? SOURCE_ORDER.length : i;
}

export function compareSources(a: string, b: string): number {
  const d = sourceRank(a) - sourceRank(b);
  return d !== 0 ? d : a.localeCompare(b);
}

/** How a verse is named in visited-state and preview caches. One definition, so
 *  the list and its host cannot disagree about what they are keying on. */
export function refKey(u: Pick<VerseUse, 'book' | 'chapter' | 'verse'>): string {
  return `${u.book} ${u.chapter}:${u.verse}`;
}

/** Which testament a book belongs to. Unknown books fall to NT so a verse from
 *  an unrecognised pack still lands somewhere rather than vanishing. */
export function testamentOf(book: string): 'OT' | 'NT' {
  return BOOK_TESTAMENT.get(normalizeBookName(book)) ?? 'NT';
}

function compareRefs(a: VerseUse, b: VerseUse): number {
  const oa = BOOK_ORDER.get(a.book) ?? 999;
  const ob = BOOK_ORDER.get(b.book) ?? 999;
  if (oa !== ob) return oa - ob;
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.verse - b.verse;
}

/**
 * Every tagged word carrying this Strong's number, in one pass.
 *
 * Deliberately unfiltered: the source picker switches between editions without
 * re-querying, so the rows have to hold all of them.
 */
export async function loadStrongsUsage(strongsId: string): Promise<StrongsUsage> {
  const db = await openDB();
  const rows = await new Promise<UsageRow[]>((resolve, reject) => {
    const tx = db.transaction('morphology', 'readonly');
    const store = tx.objectStore('morphology');
    // `by_strongs` indexes `strongs_id`, which the importer never writes — it
    // writes `strongsId`. Prefer the index that actually has keys in it.
    const indexName = store.indexNames.contains('strongsId') ? 'strongsId' : 'by_strongs';
    const found: UsageRow[] = [];
    const req = store.index(indexName).openCursor(IDBKeyRange.only(strongsId));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor) {
        resolve(found);
        return;
      }
      const m = cursor.value;
      const form = String(m.text ?? m.word ?? '').trim();
      if (form) {
        const rawBook = String(m.book ?? '');
        found.push({
          translationId: String(m.translationId ?? m.translation_id ?? ''),
          rawBook,
          book: normalizeBookName(rawBook),
          chapter: Number(m.chapter),
          verse: Number(m.verse),
          // Packs written before the canonical field names only have the
          // 1-based `wordPosition`.
          wordIndex: Number(m.word_index ?? (Number(m.wordPosition ?? 1) - 1)),
          form,
          morphCode: String(m.morph_code ?? m.parsing ?? '').trim(),
        });
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  const sources = [...new Set(rows.map((r) => r.translationId).filter(Boolean))].sort(compareSources);
  return { rows, sources };
}

/** Fold rows into one entry per verse. `source` null means every edition. */
function foldVerses(rows: UsageRow[], source: string | null): VerseUse[] {
  const byRef = new Map<string, VerseUse>();
  for (const r of rows) {
    if (source && r.translationId !== source) continue;
    const key = `${r.book}|${r.chapter}|${r.verse}`;
    let use = byRef.get(key);
    if (!use) {
      use = {
        book: r.book,
        rawBook: r.rawBook,
        chapter: r.chapter,
        verse: r.verse,
        testament: testamentOf(r.book),
        sources: [],
        marks: {},
      };
      byRef.set(key, use);
    }
    if (!use.sources.includes(r.translationId)) use.sources.push(r.translationId);
    // A word can occur more than once in a verse, so marks is a list.
    (use.marks[r.translationId] ??= []).push(r.wordIndex);
  }
  const uses = [...byRef.values()];
  for (const u of uses) u.sources.sort(compareSources);
  return uses.sort(compareRefs);
}

/** Every verse this word appears in, for the Occurrences tab. */
export function buildVerseUses(usage: StrongsUsage, source: string | null): VerseUse[] {
  return foldVerses(usage.rows, source);
}

/**
 * The inflected forms, each with the verses using it, commonest first.
 *
 * Counts are distinct verses rather than raw hits, so they agree with the list
 * that expands underneath them and do not move when another edition is
 * installed.
 */
export function buildFormGroups(usage: StrongsUsage, source: string | null): FormGroup[] {
  const byForm = new Map<string, UsageRow[]>();
  for (const r of usage.rows) {
    if (source && r.translationId !== source) continue;
    const key = `${r.form}|${r.morphCode}`;
    const bucket = byForm.get(key);
    if (bucket) bucket.push(r);
    else byForm.set(key, [r]);
  }
  const groups: FormGroup[] = [];
  for (const [key, rows] of byForm) {
    const uses = foldVerses(rows, null);
    groups.push({ key, form: rows[0].form, morphCode: rows[0].morphCode, count: uses.length, uses });
  }
  // Commonest first; ties alphabetical so the order is stable between opens.
  return groups.sort((a, b) => b.count - a.count || a.form.localeCompare(b.form));
}

/**
 * Which editions to measure a verse against when deciding it is a variant.
 *
 * Scoped per testament: the LXX having a word says nothing about whether the
 * Greek NT editions agree with each other, so comparing across the two would
 * badge every verse in the Bible.
 */
export function sourcesByTestament(usage: StrongsUsage): Record<'OT' | 'NT', string[]> {
  const ot = new Set<string>();
  const nt = new Set<string>();
  for (const r of usage.rows) {
    if (!r.translationId) continue;
    (testamentOf(r.book) === 'OT' ? ot : nt).add(r.translationId);
  }
  return {
    OT: [...ot].sort(compareSources),
    NT: [...nt].sort(compareSources),
  };
}

/**
 * The original-language text of one verse, word by word.
 *
 * Rebuilt from the morphology store rather than read from `verses`, because the
 * tagged words are what the highlight needs: marking by word position gets
 * repeated words and accent variants right, where matching on the string could
 * not tell two Ἀβραάμ in one verse apart.
 */
export async function loadOriginalTokens(
  translationId: string,
  rawBook: string,
  chapter: number,
  verse: number,
): Promise<Token[]> {
  const db = await openDB();
  return new Promise<Token[]>((resolve) => {
    const tx = db.transaction('morphology', 'readonly');
    const store = tx.objectStore('morphology');
    if (!store.indexNames.contains('verse_ref')) {
      resolve([]);
      return;
    }
    const req = store
      .index('verse_ref')
      .getAll(IDBKeyRange.only([translationId, rawBook, chapter, verse]));
    req.onsuccess = () => {
      const tokens: Token[] = (req.result ?? []).map((m: any) => ({
        text: String(m.text ?? m.word ?? ''),
        wordIndex: Number(m.word_index ?? (Number(m.wordPosition ?? 1) - 1)),
      }));
      resolve(tokens.filter((t) => t.text).sort((a, b) => a.wordIndex - b.wordIndex));
    };
    req.onerror = () => resolve([]);
  });
}
