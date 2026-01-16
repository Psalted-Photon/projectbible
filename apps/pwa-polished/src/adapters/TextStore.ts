import type { TextStore, Verse } from '@projectbible/core';
import { BIBLE_BOOKS } from '@projectbible/core';
import { readTransaction, type DBVerse } from './db.js';

/**
 * Normalize book names between different naming conventions
 * Maps both directions: "1 Samuel" <-> "I Samuel", etc.
 */
function normalizeBookName(book: string): string[] {
  const bookUpper = book.toUpperCase().trim();
  
  // Mapping of numeric to Roman numeral book names
  const numericToRoman: Record<string, string> = {
    '1 SAMUEL': 'I Samuel',
    '2 SAMUEL': 'II Samuel',
    '1 KINGS': 'I Kings',
    '2 KINGS': 'II Kings',
    '1 CHRONICLES': 'I Chronicles',
    '2 CHRONICLES': 'II Chronicles',
    '1 CORINTHIANS': 'I Corinthians',
    '2 CORINTHIANS': 'II Corinthians',
    '1 THESSALONIANS': 'I Thessalonians',
    '2 THESSALONIANS': 'II Thessalonians',
    '1 TIMOTHY': 'I Timothy',
    '2 TIMOTHY': 'II Timothy',
    '1 PETER': 'I Peter',
    '2 PETER': 'II Peter',
    '1 JOHN': 'I John',
    '2 JOHN': 'II John',
    '3 JOHN': 'III John'
  };
  
  // Create reverse mapping
  const romanToNumeric: Record<string, string> = {};
  for (const [numeric, roman] of Object.entries(numericToRoman)) {
    romanToNumeric[roman.toUpperCase()] = numeric.replace(/^\d+/, m => m).split(' ').map((w, i) => i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }
  
  // Return all possible variants
  const variants = [book]; // Always include original
  
  if (numericToRoman[bookUpper]) {
    variants.push(numericToRoman[bookUpper]);
  }
  
  if (romanToNumeric[bookUpper]) {
    variants.push(romanToNumeric[bookUpper]);
  }
  
  return variants;
}

export class IndexedDBTextStore implements TextStore {
  async getVerse(
    translation: string,
    book: string,
    chapter: number,
    verse: number
  ): Promise<string | null> {
    const bookVariants = normalizeBookName(book);
    
    try {
      // Try each book name variant
      for (const bookVariant of bookVariants) {
        const id = `${translation}:${bookVariant}:${chapter}:${verse}`;
        const dbVerse = await readTransaction<DBVerse | undefined>(
          'verses',
          (store) => store.get(id)
        );
        
        if (dbVerse) {
          return dbVerse.text;
        }
      }
      
      return null;
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
      const bookVariants = normalizeBookName(book);
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('verses', 'readonly');
        const store = transaction.objectStore('verses');
        const index = store.index('translation_book_chapter');
        
        // Try each book name variant
        let allVerses: DBVerse[] = [];
        let processed = 0;
        
        for (const bookVariant of bookVariants) {
          const range = IDBKeyRange.only([translation, bookVariant, chapter]);
          const request = index.getAll(range);
          
          request.onsuccess = () => {
            const verses = request.result as DBVerse[];
            if (verses.length > 0 && allVerses.length === 0) {
              allVerses = verses;
            }
            
            processed++;
            if (processed === bookVariants.length) {
              // All variants checked, return results
              const sortedVerses: Verse[] = allVerses
                .map(v => ({
                  book: v.book,
                  chapter: v.chapter,
                  verse: v.verse,
                  text: v.text,
                  heading: v.heading ?? null
                }))
                .sort((a, b) => a.verse - b.verse);
              
              resolve(sortedVerses);
            }
          };
          
          request.onerror = () => {
            processed++;
            if (processed === bookVariants.length) {
              reject(request.error);
            }
          };
        }
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
