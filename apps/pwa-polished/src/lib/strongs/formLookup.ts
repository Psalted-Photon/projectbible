/**
 * A Greek or Hebrew word met inside English prose — a commentary quoting
 * ἀγάπη, a definition naming its root — matched to its Strong's entry.
 *
 * Tried in order, each a little looser than the last:
 *   1. the word as a headword, letter for letter;
 *   2. the word with accents and points folded off, against every headword;
 *   3. the same folded spelling against every inflected form the Bible text
 *      uses (the Word Links pack's original_forms), so ἠγάπησεν finds G25.
 */

import { openDB } from '../../adapters/db';
import { lookupStrongs } from '../../adapters/lexicon-lookup.js';
import { greekKey, hebrewKey, isGreekText, isHebrewText } from './collate';
import { glossFor } from './entry';

export interface OriginalWord {
  /** The Strong's number. */
  id: string;
  lemma: string;
  transliteration: string;
  gloss: string;
  language: 'greek' | 'hebrew';
}

type Lang = OriginalWord['language'];

const storeFor = (lang: Lang) => (lang === 'hebrew' ? 'hebrew_strongs_entries' : 'greek_strongs_entries');
const keyOf = (lang: Lang, text: string) => (lang === 'hebrew' ? hebrewKey(text) : greekKey(text));

/** The language a word is written in, or null for anything else. */
export function scriptOf(text: string): Lang | null {
  if (isHebrewText(text)) return 'hebrew';
  if (isGreekText(text)) return 'greek';
  return null;
}

function request<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function storeOf(name: string): Promise<IDBObjectStore | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains(name)) return null;
  return db.transaction(name, 'readonly').objectStore(name);
}

async function byLemma(lang: Lang, text: string): Promise<string | null> {
  const store = await storeOf(storeFor(lang));
  if (!store) return null;
  const row = await request<any>(store.index('lemma').get(text.normalize('NFC')));
  return row?.id ?? null;
}

/** Folded headword → number, built once per language from the lexicon. */
const headwordKeys = new Map<Lang, Promise<Map<string, string>>>();

function headwordKeyMap(lang: Lang): Promise<Map<string, string>> {
  let found = headwordKeys.get(lang);
  if (!found) {
    found = (async () => {
      const map = new Map<string, string>();
      const store = await storeOf(storeFor(lang)).catch(() => null);
      const rows = (store ? await request<any[]>(store.getAll()) : null) ?? [];
      // Plain numbers before split ones (G2424 before G2424G), lowest first,
      // so a shared spelling files under the number Strong's gave it first.
      rows.sort((a, b) => String(a.id).length - String(b.id).length || (a.id < b.id ? -1 : 1));
      for (const row of rows) {
        for (const form of String(row.lemma ?? '').split(',')) {
          const key = keyOf(lang, form);
          if (key && !map.has(key)) map.set(key, row.id);
        }
      }
      return map;
    })();
    // A failed read (no lexicon yet) is tried again next time.
    found.then((m) => m.size || headwordKeys.delete(lang));
    headwordKeys.set(lang, found);
  }
  return found;
}

async function byForm(key: string): Promise<string | null> {
  const store = await storeOf('original_forms');
  if (!store) return null;
  const row = await request<any>(store.get(key));
  return row?.strongs ?? null;
}

/** A Greek or Hebrew word's entry, or null when nothing matches or the lexicon isn't installed. */
export async function resolveOriginalWord(text: string): Promise<OriginalWord | null> {
  const lang = scriptOf(text);
  if (!lang) return null;
  try {
    const key = keyOf(lang, text);
    if (!key) return null;
    const id =
      (await byLemma(lang, text)) ?? (await headwordKeyMap(lang)).get(key) ?? (await byForm(key));
    if (!id) return null;
    const entry = await lookupStrongs(id);
    if (!entry) return null;
    return {
      id: entry.strongs ?? id,
      lemma: String(entry.lemma ?? '').split(',')[0].trim(),
      transliteration: String(entry.transliteration ?? ''),
      gloss: await glossFor(id, '', lang),
      language: lang,
    };
  } catch {
    return null;
  }
}

/** The Greek or Hebrew word under a point on screen, and where it sits. */
export interface WordAtPoint {
  text: string;
  rect: DOMRect;
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as any;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range: Range | null = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  return null;
}

/**
 * The Greek or Hebrew word tapped at (x, y), or null when the tap is on
 * anything else. Words are split the way the browser splits them, which keeps
 * Hebrew prefixes and vowel points with their word.
 */
export function originalWordAt(x: number, y: number): WordAtPoint | null {
  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const text = caret.node.textContent ?? '';
  if (!scriptOf(text)) return null;
  const Segmenter = (Intl as any).Segmenter;
  if (!Segmenter) return null;
  for (const seg of new Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    const start: number = seg.index;
    const end = start + seg.segment.length;
    // A tap past a word's last letter puts the caret at its end.
    if (caret.offset < start || caret.offset > end || !seg.isWordLike) continue;
    if (!scriptOf(seg.segment)) continue;
    const range = document.createRange();
    range.setStart(caret.node, start);
    range.setEnd(caret.node, end);
    const rect = range.getBoundingClientRect();
    // The caret lands on the nearest text even when the tap was beside it.
    if (x < rect.left - 4 || x > rect.right + 4 || y < rect.top - 4 || y > rect.bottom + 4) return null;
    return { text: seg.segment, rect };
  }
  return null;
}
