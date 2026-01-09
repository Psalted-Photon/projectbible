import type { TextStore, Verse } from '@projectbible/core';
import { BIBLE_BOOKS } from '@projectbible/core';
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
        const packsTx = db.transaction(['packs', 'verses'], 'readonly');
        const packsStore = packsTx.objectStore('packs');
        const versesStore = packsTx.objectStore('verses');
        const versesIndex = versesStore.index('translationId');
        
        const packsRequest = packsStore.getAll();
        
        packsRequest.onsuccess = async () => {
          const packs = packsRequest.result;
          const textPacks = packs.filter((p: any) => 
            p.translationId && (p.type === 'text' || p.type === 'original-language')
          );
          
          // Filter out packs that have no verses (parent packs like "GREEK" or "HEBREW")
          const translationsWithVerses: Array<{id: string, name: string}> = [];
          
          for (const pack of textPacks) {
            // Check if this translation has any verses
            const hasVerses = await new Promise<boolean>((res) => {
              const countRequest = versesIndex.count(IDBKeyRange.only(pack.translationId));
              countRequest.onsuccess = () => res(countRequest.result > 0);
              countRequest.onerror = () => res(false);
            });
            
            if (hasVerses) {
              translationsWithVerses.push({
                id: pack.translationId,
                name: pack.translationName || pack.translationId
              });
            }
          }
          
          resolve(translationsWithVerses);
        };
        
        packsRequest.onerror = () => reject(packsRequest.error);
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
            // Sort books by biblical order using BIBLE_BOOKS canonical order
            const bookArray = Array.from(books);
            const bookOrderMap = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));
            bookArray.sort((a, b) => {
              const orderA = bookOrderMap.get(a) ?? 999;
              const orderB = bookOrderMap.get(b) ?? 999;
              return orderA - orderB;
            });
            resolve(bookArray);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting books:', error);
      return [];
    }
  }

  async getChapters(translation: string, book: string): Promise<number[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('verses', 'readonly');
        const store = transaction.objectStore('verses');
        const index = store.index('translation_book_chapter');
        
        // Use key range to filter by translation and book
        const range = IDBKeyRange.bound(
          [translation, book, 0],
          [translation, book, Number.MAX_SAFE_INTEGER]
        );
        const request = index.openCursor(range);
        
        const chapters = new Set<number>();
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            chapters.add(cursor.value.chapter);
            cursor.continue();
          } else {
            // Return sorted chapter numbers
            const chapterArray = Array.from(chapters).sort((a, b) => a - b);
            resolve(chapterArray);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting chapters:', error);
      return [];
    }
  }

  async getVerses(translation: string, book: string, chapter: number): Promise<number[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('verses', 'readonly');
        const store = transaction.objectStore('verses');
        const index = store.index('translation_book_chapter');
        
        // Use key range to filter by translation, book, and chapter
        const range = IDBKeyRange.only([translation, book, chapter]);
        const request = index.openCursor(range);
        
        const verses = new Set<number>();
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            verses.add(cursor.value.verse);
            cursor.continue();
          } else {
            // Return sorted verse numbers
            const verseArray = Array.from(verses).sort((a, b) => a - b);
            resolve(verseArray);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting verses:', error);
      return [];
    }
  }
}
