/**
 * The search's worker: builds the word list for each installed translation
 * (wordIndex.ts) off the page's thread, and answers the bar's verse searches
 * from it, so a search reads only the verses it finds.
 *
 * Requests:  { id, action, payload }
 * Responses: { id, ok: true, result } | { id, ok: false, error }
 *
 * The app's database is only read here, the way the voice worker reads it.
 * The connection closes the moment the app wants a newer version of the
 * database, and is opened again on the next request.
 */

import { wordLookups, wordMatcher, type WordLookup } from '../searchWords';
import { cleanVersePreviewText } from '../verseRendering';
import { BIBLE_BOOKS, bookTitle, translationSortIndex } from '../bibleData';
import { soundKey, typoDistance } from '../fuzzy';
import {
  INDEX_FORMAT,
  buildWordIndex,
  compareVerses,
  decodeWordIndex,
  encodeWordIndex,
  findWord,
  firstWordFrom,
  foldWord,
  matchVerses,
  verseAt,
  type VerseRow,
  type WordIndex,
} from './wordIndex';

/** One verse found, as stored. */
export interface VerseHit {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

/** What one translation found: how many in all, and the first of them. */
export interface TranslationHits {
  translation: string;
  total: number;
  verses: VerseHit[];
}

export interface VerseQuery {
  query: string;
  /** Verses kept per translation; -1 keeps them all. */
  limit: number;
  /** The reader's translation, listed first. */
  first?: string;
  /** Stand-ins that count as finding a word, keyed by the word (lib/searchWords). */
  also?: Record<string, string[]>;
}

// ── The app's database ──────────────────────────────────────────────────────

let appDb: Promise<IDBDatabase | null> | null = null;

function openAppDb(): Promise<IDBDatabase | null> {
  if (!appDb) {
    appDb = new Promise((resolve) => {
      const req = indexedDB.open('projectbible');
      // Only fires when the database doesn't exist yet; stop it being made.
      req.onupgradeneeded = () => req.transaction?.abort();
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          appDb = null;
        };
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    appDb.then((db) => {
      if (!db) appDb = null;
    });
  }
  return appDb;
}

function request<T>(req: IDBRequest<T>, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? fallback);
    req.onerror = () => resolve(fallback);
  });
}

function getAll(db: IDBDatabase, store: string, index?: string, key?: IDBValidKey): Promise<any[]> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  const s = db.transaction(store, 'readonly').objectStore(store);
  return request(index ? s.index(index).getAll(key) : s.getAll(), []);
}

/** Every translation with verses in the database, as its verses spell it. */
function translationIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('verses')) return resolve([]);
    const ids: string[] = [];
    const req = db.transaction('verses', 'readonly').objectStore('verses').index('translationId').openKeyCursor(null, 'nextunique');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(ids);
      ids.push(String(cursor.key));
      cursor.continue();
    };
    req.onerror = () => resolve(ids);
  });
}

/** The stored verses for these keys, in the same order; undefined where one has gone. */
function versesByKey(db: IDBDatabase, ids: string[]): Promise<(VerseRow | undefined)[]> {
  if (!ids.length) return Promise.resolve([]);
  const store = db.transaction('verses', 'readonly').objectStore('verses');
  return Promise.all(ids.map((id) => request<VerseRow | undefined>(store.get(id), undefined)));
}

// ── The word lists ──────────────────────────────────────────────────────────

const indexes = new Map<string, WordIndex>();
let syncing: Promise<void> | null = null;
/** The last build didn't finish, so the lists may be missing verses; searches say so instead of answering short. */
let syncFailed = false;

/** Let other requests in between pieces of a long build. */
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * What a translation's verses are, short of reading them: how many there are,
 * and the pack they came from. A pack that holds several translations stamps
 * its own row, and each translation's row is named after it ("ancient-tr").
 * A finished install records its file's hash, so a corrected pack (or one
 * still installing) reads differently from the copy the list was built from.
 */
async function signatures(db: IDBDatabase): Promise<Map<string, string>> {
  const packs = await getAll(db, 'packs');
  const byId = new Map(packs.map((p) => [p.id, p]));
  const stampOf = (p: any): string => {
    if (p.contentHash) return p.contentHash;
    const tid = String(p.translationId);
    const parent = p.id.endsWith(`-${tid}`) ? byId.get(p.id.slice(0, -(tid.length + 1))) : null;
    return parent?.contentHash ?? `${p.id}@${p.installedAt ?? ''}`;
  };
  const out = new Map<string, string>();
  const store = (name: string) => db.transaction(name, 'readonly').objectStore(name);
  for (const tid of await translationIds(db)) {
    const count = await request(store('verses').index('translationId').count(tid), 0);
    const stamps = packs
      .filter((p) => p.translationId && String(p.translationId).toLowerCase() === tid.toLowerCase())
      .map(stampOf)
      .sort();
    out.set(tid, `${INDEX_FORMAT}|${count}|${stamps.join(',')}`);
  }
  return out;
}

// ── Kept between launches ───────────────────────────────────────────────────
// Each finished list is saved to the browser's file storage, the way the
// voice files are kept, so a later launch reads it in a moment instead of
// building it again. A saved list is used only while its signature still
// matches the translation's; one that doesn't is built again and replaces it.

const FOLDER = 'search-index';

async function folder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(FOLDER, { create: true });
  } catch {
    return null;
  }
}

const fileName = (tid: string) => `${encodeURIComponent(tid)}.idx`;

async function loadSaved(tid: string, signature: string): Promise<WordIndex | null> {
  const dir = await folder();
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(fileName(tid))).getFile();
    const index = decodeWordIndex(await file.arrayBuffer());
    return index && index.translation === tid && index.signature === signature ? index : null;
  } catch {
    return null;
  }
}

async function save(index: WordIndex): Promise<void> {
  const dir = await folder();
  if (!dir) return;
  const name = fileName(index.translation);
  try {
    const handle = await dir.getFileHandle(name, { create: true });
    const blob = encodeWordIndex(index);
    if (typeof (handle as any).createWritable === 'function') {
      const writable = await (handle as any).createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      // Workers that only have the synchronous handle.
      const access = await (handle as any).createSyncAccessHandle();
      try {
        access.truncate(0);
        access.write(new Uint8Array(await blob.arrayBuffer()), { at: 0 });
        access.flush();
      } finally {
        access.close();
      }
    }
  } catch (error) {
    // A half-written file must not be read back next launch.
    console.warn('[Search] could not keep the word list for', index.translation, error);
    await dir.removeEntry(name).catch(() => {});
  }
}

/** Saved lists for translations no longer installed go too. */
async function forgetSavedExcept(keep: Set<string>): Promise<void> {
  const dir = await folder();
  if (!dir) return;
  try {
    const names: string[] = [];
    for await (const name of (dir as any).keys() as AsyncIterable<string>) names.push(name);
    for (const name of names) if (!keep.has(name)) await dir.removeEntry(name).catch(() => {});
  } catch {
    // Nothing to tidy, or no way to.
  }
}

// ── People, places and topics ───────────────────────────────────────────────
// Their names, read with the word lists, for close spellings and suggestions.

/** A person, place or topic, enough to name it and open it. */
export interface NamedThing {
  kind: 'person' | 'place' | 'topic';
  /** As shown: "Abraham", "Jerusalem", "Care". */
  label: string;
  /** What opens it: the person's id, the place's encyclopedia entry, the topic's id. */
  id: string | number;
  /** How much the Bible has on it, in verses or references. */
  weight: number;
}

/** Every name, lower case, in sorted order. */
let names: { key: string; thing: NamedThing }[] = [];

async function loadNames(db: IDBDatabase): Promise<void> {
  const best = new Map<string, NamedThing>();
  const add = (thing: NamedThing) => {
    const key = `${thing.kind}|${foldWord(thing.label)}`;
    const had = best.get(key);
    if (!had || thing.weight > had.weight) best.set(key, thing);
  };
  for (const p of await getAll(db, 'people')) {
    const name = String(p.name ?? '').trim();
    if (name) add({ kind: 'person', label: name, id: p.id, weight: p.verseCount ?? 0 });
  }
  for (const p of await getAll(db, 'isbe_places')) {
    const name = String(p.primaryName ?? '').trim();
    if (name && p.entryId != null) add({ kind: 'place', label: name, id: p.entryId, weight: p.verseCount ?? 0 });
  }
  for (const t of await getAll(db, 'naves_topics')) {
    const name = String(t.primaryName || t.title || '').trim();
    if (name) add({ kind: 'topic', label: name, id: t.topicId, weight: t.refCount ?? 0 });
  }
  names = [...best.values()]
    .map((thing) => ({ key: foldWord(thing.label), thing }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Where the first name at or after `prefix` sits in `names`. */
function firstNameFrom(prefix: string): number {
  let lo = 0;
  let hi = names.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (names[mid].key < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Close spellings ─────────────────────────────────────────────────────────

interface Spelling {
  word: string;
  /** How sure we can be people mean it: verses using it, or a name's weight. */
  count: number;
  /** How it sounds (lib/fuzzy). */
  key: string;
}

/** Every plain English word in the Bible text and every one-word name, built when first asked for. */
let spellings: Spelling[] | null = null;

function spellingPool(): Spelling[] {
  if (spellings) return spellings;
  const count = new Map<string, number>();
  for (const index of indexes.values()) {
    for (let w = 0; w < index.words.length; w++) {
      const word = index.words[w];
      if (word.length >= 3 && /^[a-z]+$/.test(word)) count.set(word, (count.get(word) ?? 0) + index.counts[w]);
    }
  }
  for (const { key, thing } of names) {
    if (/^[a-z]{3,}$/.test(key) && !count.has(key)) count.set(key, thing.weight);
  }
  spellings = [...count].map(([word, n]) => ({ word, count: n, key: soundKey(word) }));
  return spellings;
}

/** The typed word finds something: one of its forms is in a translation, or a name starts with it. */
function isKnown(lookup: WordLookup & { kind: 'forms' }): boolean {
  for (const index of indexes.values()) {
    for (const form of lookup.forms) if (findWord(index, form) !== -1) return true;
  }
  const at = firstNameFrom(lookup.word);
  return at < names.length && names[at].key.startsWith(lookup.word);
}

/**
 * The real word closest to one that finds nothing. A word a slip or two away
 * comes first ("shepard" → shepherd); only when there is none does one that
 * merely sounds the same, so "nebakanezer" still reaches nebuchadnezzar. A
 * word that starts differently must be a single slip away. Common words win
 * ties. Null when nothing is close enough to be a fair guess.
 */
function closestSpelling(word: string): string | null {
  return closeSpellings(word, 1)[0] ?? null;
}

/**
 * The `n` closest real words to one, closest first, by closestSpelling's
 * measure. A `partial` word is still being typed, so it is measured against
 * the start of each word ("nebakan" against "nebucha…").
 */
function closeSpellings(word: string, n: number, partial = false): string[] {
  const key = soundKey(word);
  const most = word.length <= 4 ? 1 : word.length <= 7 ? 2 : 3;
  const found: { word: string; rank: number; count: number }[] = [];
  for (const c of spellingPool()) {
    // Sounding alike allows more letters to differ (the voice worker's rule).
    // A word half typed has fewer letters to judge by, so it allows a little more.
    const soundMost = partial ? Math.max(2, Math.round(word.length * 0.6)) : Math.max(2, Math.round(c.word.length * 0.45));
    if (partial ? c.word.length < word.length - most : Math.abs(c.word.length - word.length) > Math.max(most, soundMost)) continue;
    const kd = partial ? typoDistance(key, c.key.slice(0, key.length)) : typoDistance(key, c.key);
    const d = partial
      ? Math.min(...[-1, 0, 1].map((k) => typoDistance(word, c.word.slice(0, word.length + k))))
      : typoDistance(word, c.word);
    const close = d <= most;
    const sounds = key.length >= 3 && kd <= (key.length >= 5 ? 2 : 1) && d <= soundMost;
    const sameStart = c.word[0] === word[0];
    if (d === 0 || (!close && !sounds) || (!sameStart && d > 1)) continue;
    found.push({ word: c.word, rank: (close ? 0 : 10) + d + kd + (sameStart ? 0 : 1), count: c.count });
  }
  return found
    .sort((a, b) => a.rank - b.rank || b.count - a.count)
    .slice(0, n)
    .map((f) => f.word);
}

/**
 * The query with each word that finds nothing swapped for its closest real
 * word ("shepard" → shepherd), or null when every word finds something or
 * nothing is close.
 */
async function didYouMean(query: string): Promise<string | null> {
  await (syncing ?? sync());
  let changed = false;
  const fixed = query.trim().split(/\s+/).map((raw) => {
    const core = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const lookup = core ? wordLookups(core)?.[0] : undefined;
    if (!lookup || lookup.kind !== 'forms' || lookup.word.length < 3 || isKnown(lookup)) return raw;
    const better = closestSpelling(lookup.word);
    if (!better) return raw;
    changed = true;
    return raw.replace(core, better);
  });
  return changed ? fixed.join(' ') : null;
}

// ── Suggestions while typing ────────────────────────────────────────────────

export type Suggestion =
  | { kind: 'word'; label: string }
  | { kind: 'person' | 'place' | 'topic'; label: string; id: string | number }
  | { kind: 'book'; label: string; book: string };

export interface Suggestions {
  items: Suggestion[];
  /** Nothing starts with what was typed, so these are close spellings of it. */
  close: boolean;
}

const SUGGESTION_MAX = 8;

/** Each book under the names it can be typed as: "1 corinthians", "corinthians", "psalms". */
const BOOK_NAMES = BIBLE_BOOKS.map((b) => ({
  book: b.name,
  label: bookTitle(b.name),
  names: [...new Set([b.name, bookTitle(b.name), b.name.replace(/^[123] /, '')].map((n) => n.toLowerCase()))],
}));

/** A word as shown: the list keeps a Greek final sigma as σ. */
const shownWord = (word: string) => word.replace(/σ$/u, 'ς');

/** Bible words starting with `prefix`, most-used first, across every translation. */
function wordsStarting(prefix: string): string[] {
  const count = new Map<string, number>();
  for (const index of indexes.values()) {
    for (let w = firstWordFrom(index, prefix); w < index.words.length && index.words[w].startsWith(prefix); w++) {
      const word = index.words[w];
      if (/^\d+$/.test(word)) continue;
      count.set(word, (count.get(word) ?? 0) + index.counts[w]);
    }
  }
  return [...count].sort((a, b) => b[1] - a[1]).map(([word]) => word);
}

/** People, places or topics whose names start with `prefix`, the most written about first. */
function namesStarting(prefix: string, kind: NamedThing['kind']): NamedThing[] {
  const out: NamedThing[] = [];
  for (let i = firstNameFrom(prefix); i < names.length && names[i].key.startsWith(prefix); i++) {
    if (names[i].thing.kind === kind) out.push(names[i].thing);
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * Up to eight suggestions for what is typed so far: Bible words that finish
 * its last word, then people, places, topics and books whose names start with
 * it. Each kind gets a few places, and places a kind can't fill go to the
 * others in that order. When nothing starts with it, close spellings of its
 * last word. Never waits for a build: it answers from what is ready.
 */
function suggest(text: string): Suggestions {
  if (!syncing) void sync();
  const typed = text.trim().replace(/\s+/g, ' ');
  const whole = foldWord(typed);
  const words = typed.split(' ');
  const last = foldWord((words.pop() ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  const before = words.length ? `${words.join(' ')} ` : '';
  if (whole.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return { items: [], close: false };

  const lists: Suggestion[][] = [
    last.length >= 2 ? wordsStarting(last).map((w) => ({ kind: 'word' as const, label: before + shownWord(w) })) : [],
    ...(['person', 'place', 'topic'] as const).map((kind) =>
      namesStarting(whole, kind).map((t) => ({ kind, label: t.label, id: t.id })),
    ),
    BOOK_NAMES.filter((b) => b.names.some((n) => n.startsWith(whole))).map((b) => ({ kind: 'book' as const, label: b.label, book: b.book })),
  ];
  const take = lists.map((list, i) => Math.min(list.length, [3, 2, 1, 1, 1][i]));
  let room = SUGGESTION_MAX - take.reduce((a, b) => a + b, 0);
  while (room > 0) {
    let gave = false;
    for (let i = 0; i < lists.length && room > 0; i++) {
      if (take[i] < lists[i].length) {
        take[i]++;
        room--;
        gave = true;
      }
    }
    if (!gave) break;
  }
  const items = lists.flatMap((list, i) => list.slice(0, take[i]));
  if (items.length || last.length < 3 || !/^[a-z]+$/.test(last)) return { items, close: false };

  return {
    items: closeSpellings(last, 5, true).map((w) => ({ kind: 'word' as const, label: before + w })),
    close: true,
  };
}

async function syncNow(): Promise<void> {
  const db = await openAppDb();
  if (!db) throw new Error('The database could not be opened');
  spellings = null;
  const wanted = await signatures(db);
  for (const tid of [...indexes.keys()]) if (!wanted.has(tid)) indexes.delete(tid);
  for (const [tid, signature] of wanted) {
    if (indexes.get(tid)?.signature === signature) continue;
    const saved = await loadSaved(tid, signature);
    if (saved) {
      indexes.set(tid, saved);
      continue;
    }
    const rows = (await getAll(db, 'verses', 'translationId', tid)) as VerseRow[];
    const index = await buildWordIndex(tid, signature, rows, pause);
    indexes.set(tid, index);
    await save(index);
  }
  await forgetSavedExcept(new Set([...wanted.keys()].map(fileName)));
  await loadNames(db);
  spellings = null;
}

/** Bring every list up to date with the database. Runs one at a time. */
function sync(): Promise<void> {
  const run = () =>
    syncNow().then(
      () => {
        syncFailed = false;
      },
      (error) => {
        syncFailed = true;
        console.error('[Search] word list build failed:', error);
      },
    );
  syncing = syncing ? syncing.then(run) : run();
  return syncing;
}

// ── Verse searches ──────────────────────────────────────────────────────────

/** Every verse of one translation, read and tested, for what the word list can't answer. */
async function scanTranslation(db: IDBDatabase, tid: string, test: (text: string) => boolean): Promise<VerseRow[]> {
  const rows = (await getAll(db, 'verses', 'translationId', tid)) as VerseRow[];
  return rows.filter((row) => test(cleanVersePreviewText(row.text))).sort(compareVerses);
}

async function searchVerses({ query, limit, first, also }: VerseQuery): Promise<TranslationHits[]> {
  await (syncing ?? sync());
  // A build cut off (the app moving the database on, say) gets one more go.
  if (syncFailed) await sync();
  const db = await openAppDb();
  if (!db || syncFailed) throw new Error('The word lists are not ready');

  const lookups = wordLookups(query);
  const extra: Record<string, WordLookup[]> = {};
  for (const [word, words] of Object.entries(also ?? {})) {
    extra[word] = words.flatMap((w) => wordLookups(w) ?? []);
  }
  const matcher = wordMatcher(query, 'all', also);
  const test = (row: VerseRow | undefined) => !!row && matcher.test(cleanVersePreviewText(row.text));
  const keep = (list: VerseRow[]) => (limit === -1 ? list : list.slice(0, limit));
  const isFirst = (tid: string) => !!first && tid.toLowerCase() === first.toLowerCase();

  const order = [...indexes.keys()].sort(
    (a, b) => Number(isFirst(b)) - Number(isFirst(a)) || translationSortIndex(a) - translationSortIndex(b) || a.localeCompare(b),
  );

  const out: TranslationHits[] = [];
  for (const tid of order) {
    const index = indexes.get(tid)!;
    const found = lookups ? matchVerses(index, lookups, extra) : null;
    let total: number;
    let rows: VerseRow[];
    if (!found) {
      const all = await scanTranslation(db, tid, (text) => matcher.test(text));
      total = all.length;
      rows = keep(all);
    } else if (!found.exact) {
      // Words that must sit together: read each verse that has them all, and check.
      const all = (await versesByKey(db, found.verses.map((v) => verseAt(index, v).id))).filter(test) as VerseRow[];
      total = all.length;
      rows = keep(all);
    } else {
      total = found.verses.length;
      const shown = limit === -1 ? found.verses : found.verses.slice(0, limit);
      rows = (await versesByKey(db, shown.map((v) => verseAt(index, v).id))).filter(Boolean) as VerseRow[];
    }
    if (!total) continue;
    out.push({
      translation: tid,
      total,
      verses: rows.map((r) => ({ book: r.book, chapter: r.chapter, verse: r.verse, text: r.text })),
    });
  }
  return out;
}

self.onmessage = async (e: MessageEvent<{ id: number; action: string; payload?: any }>) => {
  const { id, action, payload } = e.data;
  try {
    let result: unknown;
    switch (action) {
      case 'sync':
        // At launch, and when a pack comes in or goes.
        await sync();
        result = [...indexes.keys()];
        break;

      case 'verses':
        result = await searchVerses(payload as VerseQuery);
        break;

      case 'didYouMean':
        result = await didYouMean(String(payload?.query ?? ''));
        break;

      case 'suggest':
        result = suggest(String(payload?.text ?? ''));
        break;

      default:
        throw new Error('Unknown action ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
