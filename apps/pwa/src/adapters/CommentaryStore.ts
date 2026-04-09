import { openDB } from './db.js';

export interface CommentaryEntry {
  id?: number;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number | null;
  author: string;
  title: string | null;
  text: string;
  source: string | null;
  year: number | null;
}

export interface BCV {
  book: string;
  chapter: number;
  verse: number;
}

export class IndexedDBCommentaryStore {
  /**
   * Returns true if any commentary entry exists for the given verse.
   * Returns false gracefully if the pack is not installed.
   */
  async hasCommentary(ref: BCV): Promise<boolean> {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains('commentary_entries')) return false;

      return new Promise((resolve) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('verse');
        const range = IDBKeyRange.only([ref.book, ref.chapter, ref.verse]);
        const request = index.count(range);

        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }

  /**
   * Returns all commentary entries for the given verse.
   */
  async getCommentary(ref: BCV): Promise<CommentaryEntry[]> {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains('commentary_entries')) return [];

      return new Promise((resolve) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('verse');
        const range = IDBKeyRange.only([ref.book, ref.chapter, ref.verse]);
        const request = index.getAll(range);

        request.onsuccess = () => resolve(request.result as CommentaryEntry[]);
        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  /**
   * Returns all commentary entries for the given chapter (all verses).
   */
  async getChapterCommentary(ref: { book: string; chapter: number }): Promise<CommentaryEntry[]> {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains('commentary_entries')) return [];

      return new Promise((resolve) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('book_chapter');
        const range = IDBKeyRange.only([ref.book, ref.chapter]);
        const request = index.getAll(range);

        request.onsuccess = () => resolve(request.result as CommentaryEntry[]);
        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }
}
