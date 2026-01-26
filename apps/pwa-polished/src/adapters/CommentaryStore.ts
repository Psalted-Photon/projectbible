import type { BCV } from '@projectbible/core';
import { readTransaction } from './db.js';
import type { DBCommentaryEntry } from './db.js';

export interface CommentaryEntry {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd?: number;
  author: string;
  title?: string;
  text: string;
  source?: string;
  year?: number;
}

/**
 * Commentary Store - Access Bible commentaries from IndexedDB
 * 
 * Provides verse-level and chapter-level commentary lookup
 * Supports filtering by author
 */
export class IndexedDBCommentaryStore {
  /**
   * Get commentary for a specific verse reference
   * @param reference BCV reference (book, chapter, verse)
   * @param author Optional author filter
   * @returns Array of commentary entries (may be empty)
   */
  async getCommentary(reference: BCV, author?: string): Promise<CommentaryEntry[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('verse');
        
        // Query by book, chapter, verse
        const range = IDBKeyRange.only([reference.book, reference.chapter, reference.verse]);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          let entries = request.result as DBCommentaryEntry[];
          
          // Also get chapter-level commentary (verse_start = 0)
          const chapterRange = IDBKeyRange.only([reference.book, reference.chapter, 0]);
          const chapterRequest = index.getAll(chapterRange);
          
          chapterRequest.onsuccess = () => {
            const chapterEntries = chapterRequest.result as DBCommentaryEntry[];
            entries = [...entries, ...chapterEntries];
            
            // Filter by author if specified
            if (author) {
              entries = entries.filter(e => e.author === author);
            }
            
            // Convert DBCommentaryEntry to CommentaryEntry
            const commentary: CommentaryEntry[] = entries.map(e => ({
              book: e.book,
              chapter: e.chapter,
              verseStart: e.verseStart,
              verseEnd: e.verseEnd,
              author: e.author,
              title: e.title,
              text: e.text,
              source: e.source,
              year: e.year
            }));
            
            resolve(commentary);
          };
          
          chapterRequest.onerror = () => reject(chapterRequest.error);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting commentary:', error);
      return [];
    }
  }
  
  /**
   * Get commentary for an entire chapter
   * @param book Book name
   * @param chapter Chapter number
   * @param author Optional author filter
   * @returns Array of commentary entries
   */
  async getChapterCommentary(book: string, chapter: number, author?: string): Promise<CommentaryEntry[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('book_chapter');
        
        const range = IDBKeyRange.only([book, chapter]);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          let entries = request.result as DBCommentaryEntry[];
          
          // Filter by author if specified
          if (author) {
            entries = entries.filter(e => e.author === author);
          }
          
          const commentary: CommentaryEntry[] = entries.map(e => ({
            book: e.book,
            chapter: e.chapter,
            verseStart: e.verseStart,
            verseEnd: e.verseEnd,
            author: e.author,
            title: e.title,
            text: e.text,
            source: e.source,
            year: e.year
          }));
          
          resolve(commentary);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting chapter commentary:', error);
      return [];
    }
  }
  
  /**
   * Get list of all authors with commentary in the database
   * @returns Array of unique author names
   */
  async getAuthors(): Promise<string[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('author');
        
        const authors = new Set<string>();
        const request = index.openCursor();
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            authors.add(cursor.key as string);
            cursor.continue();
          } else {
            resolve(Array.from(authors).sort());
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting authors:', error);
      return [];
    }
  }
  
  /**
   * Get metadata about commentary coverage
   * @returns Object with author counts, book counts, etc.
   */
  async getCoverageStats(): Promise<{
    totalEntries: number;
    authorCounts: Record<string, number>;
    bookCounts: Record<string, number>;
  }> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        
        const request = store.getAll();
        
        request.onsuccess = () => {
          const entries = request.result as DBCommentaryEntry[];
          
          const authorCounts: Record<string, number> = {};
          const bookCounts: Record<string, number> = {};
          
          for (const entry of entries) {
            authorCounts[entry.author] = (authorCounts[entry.author] || 0) + 1;
            bookCounts[entry.book] = (bookCounts[entry.book] || 0) + 1;
          }
          
          resolve({
            totalEntries: entries.length,
            authorCounts,
            bookCounts
          });
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting coverage stats:', error);
      return {
        totalEntries: 0,
        authorCounts: {},
        bookCounts: {}
      };
    }
  }

  /**
   * Get all verse-level commentary entries for a chapter
   * @param book Book name
   * @param chapter Chapter number
   * @param author Optional author filter
   * @returns Array of commentary entries sorted by verse
   */
  async getAllChapterContent(book: string, chapter: number, author?: string): Promise<CommentaryEntry[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('book_chapter');
        
        const range = IDBKeyRange.only([book, chapter]);
        const request = index.getAll(range);
        
        request.onsuccess = () => {
          let entries = request.result as DBCommentaryEntry[];
          
          // Filter by author if specified
          if (author) {
            entries = entries.filter(e => e.author === author);
          }
          
          // Sort by verse_start
          entries.sort((a, b) => a.verseStart - b.verseStart);
          
          const commentary: CommentaryEntry[] = entries.map(e => ({
            book: e.book,
            chapter: e.chapter,
            verseStart: e.verseStart,
            verseEnd: e.verseEnd,
            author: e.author,
            title: e.title,
            text: e.text,
            source: e.source,
            year: e.year
          }));
          
          resolve(commentary);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting all chapter content:', error);
      return [];
    }
  }

  /**
   * Get list of books that have commentary available
   * @returns Array of unique book names
   */
  async getAvailableBooks(): Promise<string[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('commentary_entries', 'readonly');
        const store = transaction.objectStore('commentary_entries');
        const index = store.index('book');
        
        const books = new Set<string>();
        const request = index.openCursor();
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            books.add(cursor.key as string);
            cursor.continue();
          } else {
            resolve(Array.from(books));
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting available books:', error);
      return [];
    }
  }
}
