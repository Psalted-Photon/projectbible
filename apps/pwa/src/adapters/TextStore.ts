import type { TextStore, Verse } from '@projectbible/core';
import { readTransaction, type DBVerse } from './db.js';

export class IndexedDBTextStore implements TextStore {
  async getVerse(
    translation: string,
    book: string,
    chapter: number,
    verse: number
  ): Promise<string | null> {
    const id = `${translation}:${book}:${chapter}:${verse}`;
    
    try {
      const dbVerse = await readTransaction<DBVerse | undefined>(
        'verses',
        (store) => store.get(id)
      );
      
      return dbVerse?.text ?? null;
    } catch (error) {
      console.error('Error getting verse:', error);
      return null;
    }
  }

  async getChapter(
    translation: string,
    book: string,
    chapter: number
  ): Promise<Verse[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('verses', 'readonly');
        const store = transaction.objectStore('verses');
        const index = store.index('translation_book_chapter');
        
        const range = IDBKeyRange.only([translation, book, chapter]);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          const dbVerses = request.result as DBVerse[];
          const verses: Verse[] = dbVerses
            .map(v => ({
              book: v.book,
              chapter: v.chapter,
              verse: v.verse,
              text: v.text
            }))
            .sort((a, b) => a.verse - b.verse);
          
          resolve(verses);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting chapter:', error);
      return [];
    }
  }

  async getTranslations(): Promise<Array<{id: string, name: string}>> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('packs', 'readonly');
        const store = transaction.objectStore('packs');
        const index = store.index('type');
        
        const range = IDBKeyRange.only('text');
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          const packs = request.result;
          const translations = packs
            .filter((p: any) => p.translationId)
            .map((p: any) => ({
              id: p.translationId,
              name: p.translationName || p.translationId
            }));
          
          resolve(translations);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting translations:', error);
      return [];
    }
  }

  async getBooks(translation: string): Promise<string[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('verses', 'readonly');
        const store = transaction.objectStore('verses');
        const index = store.index('translationId');
        
        const range = IDBKeyRange.only(translation);
        const request = index.openCursor(range);
        
        const books = new Set<string>();
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            books.add(cursor.value.book);
            cursor.continue();
          } else {
            resolve(Array.from(books).sort());
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting books:', error);
      return [];
    }
  }
}
