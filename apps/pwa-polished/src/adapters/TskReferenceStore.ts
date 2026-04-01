import { openDB } from './db.js';
import type { DBTskReference } from './db.js';

/** Strip HTML/parser artifacts (e.g. 'br />', '*margins') from a reference string. */
function isCleanRef(ref: string): boolean {
  return ref.length > 0 && !ref.startsWith('*') && !/^(br|p|div|span|img|h[1-6]|ul|ol|li|script|style)[>\s/]/i.test(ref);
}

/** Nullify keywords that are parser artifacts (e.g. '*margins', 'br />'). */
function cleanKeyword(kw: string | null): string | null {
  if (!kw) return null;
  if (kw.startsWith('*')) return null;
  if (/^(br|p|div|span|img|h[1-6]|ul|ol|li|script|style)[>\s/]/i.test(kw)) return null;
  return kw;
}

export interface TskEntry {
  id?: number;
  book: string;
  chapter: number;
  verse: number;
  keyword: string | null;
  references: string[];
}

/**
 * TSK Reference Store — accesses Treasury of Scripture Knowledge cross-references
 * stored in the tsk_references IndexedDB object store.
 */
export class IndexedDBTskReferenceStore {
  /**
   * Get all TSK keyword→reference groups for a specific verse.
   */
  async getVerseReferences(book: string, chapter: number, verse: number): Promise<TskEntry[]> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tsk_references', 'readonly');
        const store = tx.objectStore('tsk_references');
        const index = store.index('verse');
        const range = IDBKeyRange.only([book, chapter, verse]);
        const request = index.getAll(range);
        request.onsuccess = () => {
          const rows = request.result as DBTskReference[];
          resolve(rows.map(r => ({
            id: r.id,
            book: r.book,
            chapter: r.chapter,
            verse: r.verse,
            keyword: cleanKeyword(r.keyword),
            references: (JSON.parse(r.references_json) as string[]).filter(isCleanRef)
          })));
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return [];
    }
  }

  /**
   * Get all TSK entries for an entire chapter (bulk fetch for chapter rendering).
   * Returns a Map keyed by verse number.
   */
  async getChapterReferences(book: string, chapter: number): Promise<Map<number, TskEntry[]>> {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tsk_references', 'readonly');
        const store = tx.objectStore('tsk_references');
        const index = store.index('book_chapter');
        const range = IDBKeyRange.only([book, chapter]);
        const request = index.getAll(range);
        request.onsuccess = () => {
          const rows = request.result as DBTskReference[];
          const map = new Map<number, TskEntry[]>();
          for (const r of rows) {
            const entry: TskEntry = {
              id: r.id,
              book: r.book,
              chapter: r.chapter,
              verse: r.verse,
              keyword: cleanKeyword(r.keyword),
              references: (JSON.parse(r.references_json) as string[]).filter(isCleanRef)
            };
            if (!map.has(r.verse)) map.set(r.verse, []);
            map.get(r.verse)!.push(entry);
          }
          resolve(map);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return new Map();
    }
  }

  /** Returns true if the tsk_references store has any data */
  async isInstalled(): Promise<boolean> {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction('tsk_references', 'readonly');
        const store = tx.objectStore('tsk_references');
        const req = store.count();
        req.onsuccess = () => resolve((req.result as number) > 0);
        req.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }
}
