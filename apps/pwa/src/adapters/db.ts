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
const DB_VERSION = 6; // Updated for maps and enhanced places

export interface DBPack {
  id: string;
  version: string;
  type: 'text' | 'lexicon' | 'places' | 'map' | 'cross-references' | 'morphology';
  translationId?: string;
  translationName?: string;
  license: string;
  attribution?: string;
  size: number;
  installedAt: number; // Unix timestamp
  description?: string;
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

export interface DBCrossReference {
  id: string;
  fromBook: string;
  fromChapter: number;
  fromVerse: number;
  toBook: string;
  toChapter: number;
  toVerseStart: number;
  toVerseEnd?: number;
  description?: string;
  source: 'curated' | 'user' | 'ai';
  votes: number;
}

export interface DBStrongEntry {
  id: string; // "G25" or "H1"
  lemma: string;
  transliteration?: string;
  definition: string;
  shortDefinition?: string;
  partOfSpeech: string;
  language: 'greek' | 'hebrew' | 'aramaic';
  derivation?: string;
  kjvUsage?: string;
  occurrences?: number;
}

export interface DBPronunciation {
  id: string; // Same as Strong's ID
  ipa?: string;
  phonetic?: string;
  audioUrl?: string;
  syllables?: string; // JSON string array
  stress?: number;
}

export interface DBMorphology {
  id?: number; // Auto-increment
  book: string;
  chapter: number;
  verse: number;
  wordPosition: number;
  word: string;
  lemma: string;
  strongsId?: string;
  parsing: string; // JSON string of MorphologyParsing
  gloss?: string;
  language: 'greek' | 'hebrew' | 'aramaic';
}

export interface DBWordOccurrence {
  id?: number; // Auto-increment
  strongsId: string;
  book: string;
  chapter: number;
  verse: number;
  wordPosition: number;
  word: string;
  translation?: string; // Pack ID if available
}

export interface DBPlace {
  id: string;
  name: string;
  altNames?: string; // JSON string array
  
  // Location
  latitude?: number;
  longitude?: number;
  modernCity?: string;
  modernCountry?: string;
  region?: string; // Biblical region
  
  // Historical names (JSON string array of PlaceHistoricalName objects)
  historicalNames?: string;
  
  // Appearances (JSON string array of PlaceAppearance objects)
  appearances?: string;
  
  // Biblical references
  verses?: string; // JSON string array of BCV objects
  firstMention?: string; // JSON string of BCV object
  significance?: string;
  
  // Related entities
  events?: string; // JSON string array
  people?: string; // JSON string array
  
  // Additional data
  type?: 'city' | 'region' | 'mountain' | 'river' | 'sea' | 'wilderness' | 'country';
  elevation?: number;
  description?: string;
}

export interface DBPlaceNameLink {
  id?: number; // Auto-increment
  word: string; // The word in the text (e.g., "Bethel", "Jerusalem")
  normalizedWord: string; // Lowercase for searching
  placeId: string; // Link to DBPlace
  language: 'hebrew' | 'greek' | 'english';
  strongsId?: string; // If the place name has a Strong's entry
}

export interface DBMapTile {
  id: string; // "${zoom}-${x}-${y}"
  zoom: number;
  x: number;
  y: number;
  tileData: Blob; // PNG/WebP image data
  packId: string; // Which map pack this belongs to
}

export interface DBHistoricalLayer {
  id: string;
  name: string;
  displayName: string;
  period: string; // 'patriarchs', 'exodus', 'judges', etc.
  yearStart: number;
  yearEnd: number;
  type: string; // 'political', 'tribal', 'empire', 'journey', etc.
  boundaries?: string; // GeoJSON string
  overlayUrl?: string;
  opacity?: number;
  description?: string;
  attribution?: string;
  packId: string; // Which map pack this belongs to
}

export interface DBReadingHistoryEntry {
  id: string;
  book: string;
  chapter: number;
  readAt: number; // timestamp
  planId?: string;
}

export interface DBActiveReadingPlan {
  id: string;
  name: string;
  config: string; // JSON string of ReadingPlanConfig
  startedAt: number; // timestamp
  completedAt?: number; // timestamp
  currentDayNumber: number;
}

export interface DBReadingPlanDay {
  id: string; // "planId-dayNumber"
  planId: string;
  dayNumber: number;
  date: number; // timestamp
  chapters: string; // JSON string array of {book, chapter}
  completed: number; // 0 or 1 (boolean)
  completedAt?: number; // timestamp
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
      
      // Cross-references store
      if (!db.objectStoreNames.contains('cross_references')) {
        const crossRefStore = db.createObjectStore('cross_references', { keyPath: 'id' });
        crossRefStore.createIndex('from_verse', ['fromBook', 'fromChapter', 'fromVerse'], { unique: false });
        crossRefStore.createIndex('to_verse', ['toBook', 'toChapter', 'toVerseStart'], { unique: false });
        crossRefStore.createIndex('source', 'source', { unique: false });
      }
      
      // Strong's lexicon entries store
      if (!db.objectStoreNames.contains('strongs_entries')) {
        const strongsStore = db.createObjectStore('strongs_entries', { keyPath: 'id' });
        strongsStore.createIndex('language', 'language', { unique: false });
        strongsStore.createIndex('lemma', 'lemma', { unique: false });
      }
      
      // Pronunciation data store
      if (!db.objectStoreNames.contains('pronunciations')) {
        db.createObjectStore('pronunciations', { keyPath: 'id' });
      }
      
      // Morphology data store
      if (!db.objectStoreNames.contains('morphology')) {
        const morphStore = db.createObjectStore('morphology', { keyPath: 'id', autoIncrement: true });
        morphStore.createIndex('book_chapter_verse_word', ['book', 'chapter', 'verse', 'wordPosition'], { unique: false });
        morphStore.createIndex('strongsId', 'strongsId', { unique: false });
      }
      
      // Word occurrences store
      if (!db.objectStoreNames.contains('word_occurrences')) {
        const occStore = db.createObjectStore('word_occurrences', { keyPath: 'id', autoIncrement: true });
        occStore.createIndex('strongsId', 'strongsId', { unique: false });
        occStore.createIndex('book_chapter_verse', ['book', 'chapter', 'verse'], { unique: false });
      }
      
      // Places store
      if (!db.objectStoreNames.contains('places')) {
        const placeStore = db.createObjectStore('places', { keyPath: 'id' });
        placeStore.createIndex('name', 'name', { unique: false });
        placeStore.createIndex('type', 'type', { unique: false });
        placeStore.createIndex('region', 'region', { unique: false });
        placeStore.createIndex('modernCountry', 'modernCountry', { unique: false });
      }
      
      // Place name links (for word -> place entity mapping)
      if (!db.objectStoreNames.contains('place_name_links')) {
        const linkStore = db.createObjectStore('place_name_links', { keyPath: 'id', autoIncrement: true });
        linkStore.createIndex('normalizedWord', 'normalizedWord', { unique: false });
        linkStore.createIndex('placeId', 'placeId', { unique: false });
        linkStore.createIndex('strongsId', 'strongsId', { unique: false });
      }
      
      // Map tiles store (for offline base maps)
      if (!db.objectStoreNames.contains('map_tiles')) {
        const tileStore = db.createObjectStore('map_tiles', { keyPath: 'id' });
        tileStore.createIndex('zoom', 'zoom', { unique: false });
        tileStore.createIndex('packId', 'packId', { unique: false });
        tileStore.createIndex('zoom_x_y', ['zoom', 'x', 'y'], { unique: false });
      }
      
      // Historical map layers store
      if (!db.objectStoreNames.contains('historical_layers')) {
        const layerStore = db.createObjectStore('historical_layers', { keyPath: 'id' });
        layerStore.createIndex('period', 'period', { unique: false });
        layerStore.createIndex('type', 'type', { unique: false });
        layerStore.createIndex('packId', 'packId', { unique: false });
        layerStore.createIndex('yearRange', ['yearStart', 'yearEnd'], { unique: false });
      }
      
      // Reading history store
      if (!db.objectStoreNames.contains('reading_history')) {
        const historyStore = db.createObjectStore('reading_history', { keyPath: 'id' });
        historyStore.createIndex('book_chapter', ['book', 'chapter'], { unique: false });
        historyStore.createIndex('planId', 'planId', { unique: false });
        historyStore.createIndex('readAt', 'readAt', { unique: false });
      }
      
      // Active reading plans store
      if (!db.objectStoreNames.contains('reading_plans')) {
        const plansStore = db.createObjectStore('reading_plans', { keyPath: 'id' });
        plansStore.createIndex('completedAt', 'completedAt', { unique: false });
      }
      
      // Reading plan days store
      if (!db.objectStoreNames.contains('reading_plan_days')) {
        const daysStore = db.createObjectStore('reading_plan_days', { keyPath: 'id' });
        daysStore.createIndex('planId', 'planId', { unique: false });
        daysStore.createIndex('planId_dayNumber', ['planId', 'dayNumber'], { unique: true });
        daysStore.createIndex('date', 'date', { unique: false });
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
