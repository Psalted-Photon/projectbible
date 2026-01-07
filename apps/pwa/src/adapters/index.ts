/**
 * PWA IndexedDB Adapters
 * 
 * These adapters implement the core platform interfaces using IndexedDB
 * for browser-based storage.
 */

export { openDB, generateId } from './db.js';
export type { DBPack, DBVerse, DBUserNote, DBUserHighlight, DBUserBookmark, DBCrossReference } from './db.js';

export { IndexedDBTextStore } from './TextStore.js';
export { IndexedDBPackManager } from './PackManager.js';
export { IndexedDBSearchIndex } from './SearchIndex.js';
export { IndexedDBUserDataStore } from './UserDataStore.js';
export { IndexedDBCrossReferenceStore } from './CrossReferenceStore.js';
export { importPackFromSQLite, exportPackToSQLite } from './pack-import.js';

// Re-export platform interfaces from core
export type { 
  TextStore, 
  PackManager,
  SearchIndex,
  UserDataStore,
  CrossReferenceStore,
  CrossReference,
  SearchResult,
  PackInfo, 
  Verse, 
  BCV 
} from '@projectbible/core';
