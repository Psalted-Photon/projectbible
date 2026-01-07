import type { UserDataStore, UserNote, UserHighlight, UserBookmark, BCV } from '@projectbible/core';
import { generateId, readTransaction, writeTransaction } from './db.js';
import type { DBUserNote, DBUserHighlight, DBUserBookmark } from './db.js';

export class IndexedDBUserDataStore implements UserDataStore {
  // ========== NOTES ==========
  
  async getNotes(reference?: BCV): Promise<UserNote[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('user_notes', 'readonly');
        const store = transaction.objectStore('user_notes');
        
        let request: IDBRequest<DBUserNote[]>;
        
        if (reference) {
          // Get notes for specific verse
          const index = store.index('book_chapter_verse');
          const range = IDBKeyRange.only([reference.book, reference.chapter, reference.verse]);
          request = index.getAll(range);
        } else {
          // Get all notes
          request = store.getAll();
        }
        
        request.onsuccess = () => {
          const dbNotes = request.result;
          const notes: UserNote[] = dbNotes.map(n => ({
            id: n.id,
            reference: {
              book: n.book,
              chapter: n.chapter,
              verse: n.verse
            },
            text: n.text,
            createdAt: new Date(n.createdAt),
            updatedAt: new Date(n.updatedAt)
          }));
          
          resolve(notes);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting notes:', error);
      return [];
    }
  }
  
  async saveNote(note: Omit<UserNote, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserNote> {
    const now = Date.now();
    const id = generateId();
    
    const dbNote: DBUserNote = {
      id,
      book: note.reference.book,
      chapter: note.reference.chapter,
      verse: note.reference.verse,
      text: note.text,
      createdAt: now,
      updatedAt: now
    };
    
    await writeTransaction('user_notes', (store) => store.put(dbNote));
    
    return {
      id,
      reference: note.reference,
      text: note.text,
      createdAt: new Date(now),
      updatedAt: new Date(now)
    };
  }
  
  async updateNote(noteId: string, text: string): Promise<void> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('user_notes', 'readwrite');
        const store = transaction.objectStore('user_notes');
        
        const getRequest = store.get(noteId);
        
        getRequest.onsuccess = () => {
          const note = getRequest.result as DBUserNote | undefined;
          
          if (!note) {
            reject(new Error(`Note ${noteId} not found`));
            return;
          }
          
          note.text = text;
          note.updatedAt = Date.now();
          
          const putRequest = store.put(note);
          
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        };
        
        getRequest.onerror = () => reject(getRequest.error);
      });
    } catch (error) {
      console.error('Error updating note:', error);
      throw error;
    }
  }
  
  async deleteNote(noteId: string): Promise<void> {
    await writeTransaction('user_notes', (store) => store.delete(noteId));
  }
  
  // ========== HIGHLIGHTS ==========
  
  async getHighlights(reference?: BCV): Promise<UserHighlight[]> {
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('user_highlights', 'readonly');
        const store = transaction.objectStore('user_highlights');
        
        let request: IDBRequest<DBUserHighlight[]>;
        
        if (reference) {
          // Get highlights for specific verse
          const index = store.index('book_chapter_verse');
          const range = IDBKeyRange.only([reference.book, reference.chapter, reference.verse]);
          request = index.getAll(range);
        } else {
          // Get all highlights
          request = store.getAll();
        }
        
        request.onsuccess = () => {
          const dbHighlights = request.result;
          const highlights: UserHighlight[] = dbHighlights.map(h => ({
            id: h.id,
            reference: {
              book: h.book,
              chapter: h.chapter,
              verse: h.verse
            },
            color: h.color,
            createdAt: new Date(h.createdAt)
          }));
          
          resolve(highlights);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error getting highlights:', error);
      return [];
    }
  }
  
  async saveHighlight(highlight: Omit<UserHighlight, 'id' | 'createdAt'>): Promise<UserHighlight> {
    const now = Date.now();
    const id = generateId();
    
    const dbHighlight: DBUserHighlight = {
      id,
      book: highlight.reference.book,
      chapter: highlight.reference.chapter,
      verse: highlight.reference.verse,
      color: highlight.color,
      createdAt: now
    };
    
    await writeTransaction('user_highlights', (store) => store.put(dbHighlight));
    
    return {
      id,
      reference: highlight.reference,
      color: highlight.color,
      createdAt: new Date(now)
    };
  }
  
  async deleteHighlight(highlightId: string): Promise<void> {
    await writeTransaction('user_highlights', (store) => store.delete(highlightId));
  }
  
  // ========== BOOKMARKS ==========
  
  async getBookmarks(): Promise<UserBookmark[]> {
    try {
      const dbBookmarks = await readTransaction<DBUserBookmark[]>(
        'user_bookmarks',
        (store) => store.getAll()
      );
      
      return dbBookmarks
        .map(b => ({
          id: b.id,
          reference: {
            book: b.book,
            chapter: b.chapter,
            verse: b.verse
          },
          label: b.label,
          createdAt: new Date(b.createdAt)
        }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Most recent first
    } catch (error) {
      console.error('Error getting bookmarks:', error);
      return [];
    }
  }
  
  async saveBookmark(bookmark: Omit<UserBookmark, 'id' | 'createdAt'>): Promise<UserBookmark> {
    const now = Date.now();
    const id = generateId();
    
    const dbBookmark: DBUserBookmark = {
      id,
      book: bookmark.reference.book,
      chapter: bookmark.reference.chapter,
      verse: bookmark.reference.verse,
      label: bookmark.label,
      createdAt: now
    };
    
    await writeTransaction('user_bookmarks', (store) => store.put(dbBookmark));
    
    return {
      id,
      reference: bookmark.reference,
      label: bookmark.label,
      createdAt: new Date(now)
    };
  }
  
  async deleteBookmark(bookmarkId: string): Promise<void> {
    await writeTransaction('user_bookmarks', (store) => store.delete(bookmarkId));
  }
  
  // ========== READING POSITION ==========
  
  /**
   * Save the user's current reading position
   * Stored as a special bookmark with label "READING_POSITION"
   */
  async saveReadingPosition(reference: BCV): Promise<void> {
    const POSITION_KEY = 'reading-position';
    
    try {
      const db = await import('./db.js').then(m => m.openDB());
      
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('user_bookmarks', 'readwrite');
        const store = transaction.objectStore('user_bookmarks');
        
        const dbBookmark: DBUserBookmark = {
          id: POSITION_KEY,
          book: reference.book,
          chapter: reference.chapter,
          verse: reference.verse,
          label: 'READING_POSITION',
          createdAt: Date.now()
        };
        
        const request = store.put(dbBookmark);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error saving reading position:', error);
      throw error;
    }
  }
  
  /**
   * Get the user's last reading position
   */
  async getReadingPosition(): Promise<BCV | null> {
    const POSITION_KEY = 'reading-position';
    
    try {
      const bookmark = await readTransaction<DBUserBookmark | undefined>(
        'user_bookmarks',
        (store) => store.get(POSITION_KEY)
      );
      
      if (!bookmark) {
        return null;
      }
      
      return {
        book: bookmark.book,
        chapter: bookmark.chapter,
        verse: bookmark.verse
      };
    } catch (error) {
      console.error('Error getting reading position:', error);
      return null;
    }
  }
}
