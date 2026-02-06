/**
 * PWA IndexedDB Adapters
 * 
 * These adapters implement the core platform interfaces using IndexedDB
 * for browser-based storage.
 */

export { openDB, generateId } from './db.js';
export type { DBPack, DBVerse, DBUserNote, DBUserHighlight, DBUserBookmark, DBJournalEntry, DBCrossReference, DBStrongEntry, DBPronunciation, DBMorphology, DBWordOccurrence, DBPlace, DBPlaceNameLink, DBMapTile, DBHistoricalLayer, DBReadingHistoryEntry, DBActiveReadingPlan, DBReadingPlanDay } from './db.js';

export { IndexedDBTextStore } from './TextStore.js';
export { IndexedDBPackManager } from './PackManager.js';
export { IndexedDBSearchIndex } from './SearchIndex.js';
export { IndexedDBUserDataStore } from './UserDataStore.js';
export { IndexedDBJournalStore } from './JournalStore.js';
export { IndexedDBCrossReferenceStore } from './CrossReferenceStore.js';
export { IndexedDBLexiconStore } from './LexiconStore.js';
export { IndexedDBPlaceStore } from './PlaceStore.js';
export { IndexedDBMapStore } from './MapStore.js';
export { IndexedDBReadingHistoryStore } from './ReadingHistoryStore.js';
export { importPackFromSQLite, exportPackToSQLite } from './pack-import.js';

export {
  getSettings,
  updateSettings,
  getDailyDriverFor,
  getPrimaryDailyDriver,
  clearSettings,
  type UserSettings
} from './settings.js';
export { clearAllData, clearPacksOnly, getDatabaseStats, removePack, listInstalledPacks } from './db-manager.js';

// Re-export platform interfaces from core
export type { 
  TextStore, 
  PackManager,
  SearchIndex,
  UserDataStore,
  CrossReferenceStore,
  CrossReference,
  LexiconStore,
  StrongEntry,
  Pronunciation,
  MorphologyInfo,
  MorphologyParsing,
  WordOccurrence,
  PlaceStore,
  PlaceInfo,
  PlaceHistoricalName,
  PlaceAppearance,
  MapStore,
  MapTile,
  HistoricalMapLayer,
  BoundingBox,
  GeoPoint,
  ReadingHistoryStore,
  ReadingHistoryEntry,
  ActiveReadingPlan,
  ReadingPlanDay,
  SearchResult,
  PackInfo, 
  Verse, 
  BCV 
} from '@projectbible/core';
