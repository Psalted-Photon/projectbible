/**
 * IndexedDB schema and utilities for PWA storage
 * 
 * Database: projectbible
 * Stores:
 * - packs: metadata about installed packs
 * - verses: verse text from all installed translations
 * - user_notes: user notes
 * - user_highlights: user highlights
 * - user_bookmarks: user bookmarks
 */

const DB_NAME = 'projectbible';
const DB_VERSION = 1;

export interface DBPack {
  id: string;
  version: string;
  type: 'text' | 'lexicon' | 'places' | 'map';
  translationId?: string;
  translationName?: string;
  license: string;
  attribution?: string;
  size: number;
  installedAt: number; // Unix timestamp
}

export interface DBVerse {
  id: string; // `${translationId}:${book}:${chapter}:${verse}`
  translationId: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface DBUserNote {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface DBUserHighlight {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  color: string;
  createdAt: number;
}

export interface DBUserBookmark {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  label?: string;
  createdAt: number;
}

/**
 * Open the IndexedDB database, creating it if needed
 */
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Packs store
      if (!db.objectStoreNames.contains('packs')) {
        const packStore = db.createObjectStore('packs', { keyPath: 'id' });
        packStore.createIndex('type', 'type', { unique: false });
        packStore.createIndex('translationId', 'translationId', { unique: false });
      }
      
      // Verses store
      if (!db.objectStoreNames.contains('verses')) {
        const verseStore = db.createObjectStore('verses', { keyPath: 'id' });
        verseStore.createIndex('translationId', 'translationId', { unique: false });
        verseStore.createIndex('book', 'book', { unique: false });
        verseStore.createIndex('translation_book', ['translationId', 'book'], { unique: false });
        verseStore.createIndex('translation_book_chapter', ['translationId', 'book', 'chapter'], { unique: false });
      }
      
      // User notes store
      if (!db.objectStoreNames.contains('user_notes')) {
        const noteStore = db.createObjectStore('user_notes', { keyPath: 'id' });
        noteStore.createIndex('book_chapter_verse', ['book', 'chapter', 'verse'], { unique: false });
      }
      
      // User highlights store
      if (!db.objectStoreNames.contains('user_highlights')) {
        const highlightStore = db.createObjectStore('user_highlights', { keyPath: 'id' });
        highlightStore.createIndex('book_chapter_verse', ['book', 'chapter', 'verse'], { unique: false });
      }
      
      // User bookmarks store
      if (!db.objectStoreNames.contains('user_bookmarks')) {
        db.createObjectStore('user_bookmarks', { keyPath: 'id' });
      }
    };
  });
}

/**
 * Helper to execute a read transaction
 */
export async function readTransaction<T>(
  storeName: string,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = callback(store);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Helper to execute a write transaction
 */
export async function writeTransaction<T>(
  storeName: string,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = callback(store);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Helper to execute multiple operations in a single transaction
 */
export async function batchWriteTransaction(
  storeName: string,
  operations: (store: IDBObjectStore) => void
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    
    operations(store);
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
