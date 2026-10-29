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
import { translationSortIndex } from '../bibleData';
import {
  INDEX_FORMAT,
  buildWordIndex,
  compareVerses,
  decodeWordIndex,
  encodeWordIndex,
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

async function syncNow(): Promise<void> {
  const db = await openAppDb();
  if (!db) throw new Error('The database could not be opened');
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

      default:
        throw new Error('Unknown action ' + action);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
