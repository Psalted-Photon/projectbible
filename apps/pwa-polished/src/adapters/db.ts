import { logInstallIfActive } from '../lib/install-log';
import { getDeviceOwner } from '../lib/sync/deviceOwner';
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
 * - journal_entries: daily journal entries
 * - journal_lock / journal_key_slots: the journal lock and its locked key copies
 */

const DB_NAME = 'projectbible';
const DB_VERSION = 40; // Migration 40: chronological_events / chronological_eras (see Timeline)

let dbPromise: Promise<IDBDatabase> | null = null;
let dbInstance: IDBDatabase | null = null;

export interface DBSectionHeading {
  id: string;      // `${translation}:${book}:${chapter}:${verse}`
  /** Absent on packs built before headings were per-translation; those are BSB's. */
  translation?: string;
  book: string;
  chapter: number;
  verse: number;
  heading: string;
  level: number;   // 1 for \s1, 2 for \s2
}

export interface DBArtScene {
  id: string;             // stable slug, e.g. "last-supper"
  title: string;          // "The Last Supper"
  book: string;
  chapter: number;
  verse: number;          // anchor verse (matches the section-heading verse)
  passageLabel?: string;  // "John 13:21–30"
  works: string;          // JSON-serialized ArtWork[] (each references imageId/thumbId)
}

export interface DBArtImage {
  id: string;         // content id referenced by ArtWork.imageId / thumbId
  mime: string;       // e.g. "image/jpeg"
  /**
   * The image, for offline display.
   *
   * Stored as a Blob: IndexedDB structured-clones a raw Uint8Array through
   * memory, which for the art pack meant pushing 87 MB of bytes through the
   * serialiser, while a Blob is handed to Chrome's file-backed blob store
   * instead. Packs installed by older builds still hold a Uint8Array here, so
   * readers must accept both.
   */
  data: Blob | Uint8Array;
}

/** One of the Historical Map pack's self-description rows. */
export interface DBAtlasMeta {
  key: string;
  value: string;
}

export interface DBAtlasEra {
  id: string;
  title: string;
  subtitle?: string | null;
  yearStart: number;
  yearEnd: number;
  sortOrder: number;
  /** 'attested' where borders are surveyed, 'approximate' where they are not. */
  confidence: string;
  blurb?: string | null;
  /** Set only where the dating itself is disputed, and shown on the era card. */
  datingNote?: string | null;
  /** JSON array: the biblical books that witness this era. */
  books?: string | null;
}

/** A drawn layer's entry in the catalogue. The geometry lives in atlas_geometry. */
export interface DBAtlasLayer {
  id: string;
  group: 'basemap' | 'overlay';
  kind: string;
  /** 110 | 50 | 10 | 1 for basemap layers, null for overlays. */
  detail: number | null;
  eraId: string | null;
  title: string;
  source?: string | null;
  confidence?: string | null;
  sortOrder: number;
  shard: number;
  rawBytes: number;
}

/**
 * One layer's GeoJSON, gzipped.
 *
 * Kept compressed in storage and inflated with DecompressionStream on read:
 * 67 MB of linework is 21 MB this way, and inflating one layer costs a few
 * milliseconds against holding all of it expanded forever.
 */
export interface DBAtlasGeometry {
  id: string;
  encoding: 'gzip';
  rawBytes: number;
  data: Blob;
}

export interface DBAtlasEraPlace {
  id: string;        // `${placeId}|${eraId}` — a place can appear in many eras
  placeId: string;
  eraId: string;
  name: string;
  lat: number;
  lon: number;
  kind?: string | null;
  verses: number;
}

export interface DBAtlasPoint {
  id: number;
  kind: 'peak' | 'city';
  name: string;
  lat: number;
  lon: number;
  elevation?: number | null;
  country?: string | null;
  population?: number | null;
  rank?: number | null;
}

export interface DBAtlasBiblicalPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind?: string | null;
  /** What the place is called today, where it is known. */
  modern?: string | null;
  /** JSON [[label, ref], …] — every verse that names this place. */
  verses: string;
}

export interface DBAtlasAncientName {
  id: number;
  name: string;
  kind?: string | null;
  lat: number;
  lon: number;
  yearStart?: number | null;
  yearEnd?: number | null;
}

export interface DBAtlasPlacePhoto {
  place: string;
  thumbUrl: string;
  fullUrl: string;
  author?: string | null;
  license?: string | null;
  /** The Wikimedia Commons page, offered as a link and never navigated to. */
  pageUrl?: string | null;
  caption?: string | null;
  palette?: string | null;
}

/**
 * One column of the place search index.
 *
 * 562,524 places stored as columns rather than rows: two text blobs (the
 * searchable names and the display names, newline-delimited) and a set of typed
 * arrays. Gzipped here, inflated once when search first opens.
 */
export interface DBAtlasPlaceColumn {
  name: string;
  kind: 'utf8' | 'int32' | 'uint32' | 'uint16' | 'uint8' | 'json';
  encoding: 'gzip';
  rawBytes: number;
  data: Blob;
}

export interface DBPack {
  id: string;
  version: string;
  type: 'text' | 'lexicon' | 'dictionary' | 'places' | 'geonames' | 'map' | 'cross-references' | 'morphology' | 'audio' | 'original-language' | 'commentary' | 'references' | 'headings' | 'people' | 'isbe' | 'encyclotopical' | 'art' | 'atlas-map' | 'study';
  translationId?: string;
  translationName?: string;
  language?: string;
  license: string;
  attribution?: string;
  size: number;
  installedAt: number; // Unix timestamp
  description?: string;
  /**
   * SHA-256 of the installed pack file. Versions are deliberately held steady
   * across rebuilds, so this is what distinguishes a corrected pack from the
   * copy already on the device. Absent on packs installed before it was added.
   */
  contentHash?: string;
}

export interface DBPackAudioChapter {
  id: string; // `${translationId}:${book}:${chapter}`
  translationId: string;
  book: string;
  chapter: number;
  filePath: string; // Relative path to audio file
  format: string; // 'mp3', 'webm', 'ogg'
}

export interface DBVerse {
  id: string; // `${translationId}:${book}:${chapter}:${verse}`
  translationId: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  heading?: string | null; // Section heading that appears before this verse
}

export interface DBUserNote {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  createdAt: number;
  updatedAt: number;
  /**
   * The account this row belongs to. Absent on rows written before ownership
   * was recorded, and on rows written while signed out; both are adopted by
   * the next account to sign in. See PERSONAL_STORES.
   */
  ownerId?: string;
}

export interface DBUserHighlight {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  color: string;
  /** JSON-serialized HighlightStyle. Falls back to deriving from `color` when absent. */
  style?: string;
  createdAt: number;
  /**
   * The account this row belongs to. Absent on rows written before ownership
   * was recorded, and on rows written while signed out; both are adopted by
   * the next account to sign in. See PERSONAL_STORES.
   */
  ownerId?: string;
}

export interface DBUserWordHighlight {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  translation: string;
  wordStart: number;
  wordLength: number;
  style: string; // JSON-serialized HighlightStyle
  createdAt: number;
  /**
   * The account this row belongs to. Absent on rows written before ownership
   * was recorded, and on rows written while signed out; both are adopted by
   * the next account to sign in. See PERSONAL_STORES.
   */
  ownerId?: string;
}

export interface DBUserBookmark {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  label?: string;
  createdAt: number;
  /**
   * The account this row belongs to. Absent on rows written before ownership
   * was recorded, and on rows written while signed out; both are adopted by
   * the next account to sign in. See PERSONAL_STORES.
   */
  ownerId?: string;
}

export interface DBJournalEntry {
  id: string;
  date: string; // YYYY-MM-DD format
  title?: string;
  text: string; // Raw HTML from Lexical
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
  /**
   * The account this row belongs to. Absent on rows written before ownership
   * was recorded, and on rows written while signed out; both are adopted by
   * the next account to sign in. See PERSONAL_STORES.
   */
  ownerId?: string;
}

/**
 * The journal lock as this device last heard it from the cloud. One row, for
 * whichever account last signed in here. Holds no secret.
 */
export interface DBJournalLock {
  userId: string;
  state: 'off' | 'on' | 'turning_off';
  keyId: string | null;
  updatedAt: number;
}

/**
 * A locked copy of the journal key. Kept on the device so unlocking works
 * offline; useless without the passkey or recovery code that opens it.
 */
export interface DBJournalKeySlot {
  id: string;
  userId: string;
  kind: 'passkey' | 'recovery';
  keyId: string;
  label: string;
  credentialId: string | null;
  rpId: string | null;
  salt: string;
  wrappedKey: string;
  createdAt: number;
}

/** A named folder of free-form notes. Created and renamed by the user. */
export interface DBNotebook {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /**
   * The account this row belongs to. Absent on rows written before ownership
   * was recorded, and on rows written while signed out; both are adopted by
   * the next account to sign in. See PERSONAL_STORES.
   */
  ownerId?: string;
}

/** One free-form note. Always belongs to a notebook. */
export interface DBNotebookPage {
  id: string;
  notebookId: string;
  title?: string;
  text: string; // Raw HTML from Lexical
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  /**
   * The account this row belongs to. Absent on rows written before ownership
   * was recorded, and on rows written while signed out; both are adopted by
   * the next account to sign in. See PERSONAL_STORES.
   */
  ownerId?: string;
}

/**
 * A notebook more than one person reads and writes. Mirrors the
 * shared_notebooks row in migration 012, with the timestamps kept as epoch
 * milliseconds the way every other store here does.
 */
export interface DBSharedNotebook {
  id: string;
  ownerId: string;
  name: string;
  /** 'group' — everyone writes. 'broadcast' — only the owner does. */
  kind: 'group' | 'broadcast';
  /** 'private' — members only. 'public' — anyone holding the link may read. */
  visibility: 'private' | 'public';
  joinCode: string;
  joinOpen: boolean;
  /** Moves on every page change anywhere in the notebook. */
  rev: number;
  createdAt: number;
  updatedAt: number;
  /**
   * When this device noticed the notebook had stopped coming back from the
   * pull — you were removed, or the owner deleted it. Local only; the server
   * has no such column and never sends one, so re-joining clears it by simply
   * writing the row again. A notebook carrying this is kept as a read-only
   * copy rather than deleted, which is the one exception to the rule at the
   * top of SharedNotebookStore.
   */
  removedAt?: number | null;
}

/** One person's place in a shared notebook, and the pill that stands for them. */
export interface DBSharedNotebookMember {
  id: string;
  notebookId: string;
  userId: string;
  role: 'admin' | 'writer' | 'reader';
  displayName: string;
  initials: string;
  color: string;
  joinedAt: number;
  updatedAt: number;
}

/** One page of a shared notebook. */
export interface DBSharedNotebookPage {
  id: string;
  notebookId: string;
  authorId: string;
  title?: string;
  text: string; // Sanitised HTML — never rendered without passing sanitizeNoteHtml
  /** 'author' means closed: nobody but the author may rewrite it. */
  editMode: 'anyone' | 'author';
  pinned: boolean;
  sortOrder: number;
  rev: number;
  /**
   * The revision this device last saw from the server. An edit uploads with
   * this attached, so a save made with no signal can be told apart from one
   * made on top of what everybody else can see.
   */
  baseRev: number;
  /** Set when the page has been taken out of the notebook. */
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
}

/**
 * One write to a shared notebook that has not reached the server yet.
 *
 * Keyed on the page rather than on an id of its own, so a second edit of the
 * same page replaces the first instead of queueing behind it — which is what
 * anybody writing offline actually means: send what I end up with, not each
 * keystroke on the way there. `baseRev` therefore stays at whatever the first
 * queued edit was measured against, because that is still the last version
 * this device has seen of everybody else's work.
 *
 * Kept apart from 'sync_queue' for the same reason the three tables above are
 * kept apart from their single-user cousins: that queue speaks in table/row
 * upserts against rows belonging to one account, and these rows belong to
 * everybody in the notebook and go through save_shared_page, which can refuse.
 */
export interface DBSharedOutboxItem {
  /** The page this is waiting to do something to. Also the key. */
  pageId: string;
  notebookId: string;
  /** 'save' covers both a new page and the hundredth edit of an old one. */
  kind: 'save' | 'remove';
  title: string;
  /** Sanitised and already stamped, so the pills are right while offline too. */
  text: string;
  /** The revision this edit was measured against. Null for a new page. */
  baseRev: number | null;
  editMode: 'anyone' | 'author' | null;
  pinned: boolean | null;
  /** Set only for a page started offline, which the server has never seen. */
  createdAt: number | null;
  queuedAt: number;
  attempts: number;
  lastAttemptAt: number | null;
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
  // Positioning / alignment
  word_index: number;          // 0-based index within verse (v2+ schema)
  book: string;                // canonical book name, e.g. "Genesis", "Romans"
  chapter: number;             // 1-based
  verse: number;               // 1-based
  
  // Text + normalization
  text: string;                // surface form as in the verse (NFC normalized)
  lemma: string;               // lemma in original script
  transliteration: string;     // e.g. "bereshit", "logos"
  
  // Lexical identifiers
  strongsId?: string;          // e.g. "H7225", "G3056"
  morph_code: string;          // raw morphology code, e.g. "V-PAI-3S"
  language: 'hebrew' | 'greek' | 'aramaic';
  translationId: string;       // "WLC", "LXX", "BYZ", "TR", etc.
  
  // Gloss / display
  gloss_en?: string;           // short English gloss
  
  // Legacy fields (for backward compatibility)
  id?: string | number;        // Can be auto-increment or custom ID
  wordPosition?: number;       // Old field name (use word_index instead)
  word?: string;               // Old field name (use text instead)
  parsing?: string;            // Old field name (use morph_code instead)
  gloss?: string;              // Old field name (use gloss_en instead)
}

export interface DBCommentaryEntry {
  id: string; // `${book}:${chapter}:${verse_start}:${author}`
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

export interface DBTskReference {
  id?: number; // Auto-increment
  book: string;
  chapter: number;
  verse: number;
  keyword: string | null;
  references_json: string; // JSON array of ref strings
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

export interface DBPerson {
  id: string;             // personLookup slug, e.g. "moses_2108"
  name: string;
  displayTitle?: string;
  alsoCalled?: string;
  surname?: string;
  gender?: string;
  status?: string;
  nameMeaning?: string;   // Hitchcock's name meaning
  birthYear?: number | null;
  deathYear?: number | null;
  minYear?: number | null;
  maxYear?: number | null;
  birthPlace?: string;    // JSON {name,slug,lat,lon}
  deathPlace?: string;    // JSON {name,slug,lat,lon}
  memberOf?: string;      // JSON [groupName]
  father?: string;        // JSON [{id,name}]
  mother?: string;
  partners?: string;
  children?: string;
  siblings?: string;
  dictText?: string;
  dictLink?: string;
  verseCount?: number;
}

export interface DBPersonName {
  id?: number;            // auto-increment
  nameLower: string;      // lowercased name / alt-name / token
  personId: string;
}

export interface DBPersonVerse {
  id?: number;            // auto-increment
  personId: string;
  book: string;           // canonical book name
  chapter: number;
  verse: number;
  osis?: string;
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

export interface DBPleiadesPlace {
  id: string; // Pleiades ID
  title: string;
  uri?: string;
  placeType?: string; // "city", "region", "mountain", etc.
  description?: string;
  yearStart?: number;
  yearEnd?: number;
  created?: string;
  modified?: string;
  bbox?: string; // JSON bounding box
  
  // Primary coordinates (from first location)
  latitude?: number;
  longitude?: number;
}

export interface DBPleiadesName {
  id?: number; // Auto-increment
  placeId: string;
  name: string;
  language?: string; // "grc" (Greek), "la" (Latin), "hbo" (Hebrew), etc.
  romanized?: string;
  nameType?: string;
  timePeriod?: string;
  certainty?: string;
}

export interface DBPleiadesLocation {
  id?: number; // Auto-increment
  placeId: string;
  title?: string;
  geometryType?: string; // "Point", "Polygon"
  coordinates?: string; // JSON geometry coordinates
  latitude?: number;
  longitude?: number;
  certainty?: string;
  timePeriod?: string;
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

export interface DBReadingProgressEntry {
  id: string; // "planId-dayNumber"
  planId: string;
  dayNumber: number;
  completed: number; // 0 or 1
  createdAt: number; // timestamp
  completedAt?: number; // timestamp
  startedReadingAt?: number; // timestamp
  chaptersRead: string; // JSON string of chapters/actions
  catchUpAdjustment?: string; // JSON string
}

export interface DBPlanMetadata {
  planId: string;
  status: 'active' | 'completed' | 'archived';
  planDefinitionHash: string;
  planVersion: number;
  activatedAt: number; // timestamp
  archivedAt?: number; // timestamp
  lastSyncedAt?: number; // timestamp
  syncConflicts?: string; // JSON string
  catchUpAdjustment?: string; // JSON string
}

export type DBSyncQueueStatus = 'pending' | 'processing' | 'failed' | 'done';

export interface DBSyncQueueItem {
  id: string;
  type: string;
  payload: any;
  operationId: string;
  priority: number;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number | null;
  status: DBSyncQueueStatus;
  lastError?: string;
  planId?: string;
}

export interface DBSyncOperation {
  operationId: string;
  appliedAt: number;
}

/**
 * Close the shared connection and drop the cached handles.
 *
 * Needed before deleting the database: an open connection blocks
 * indexedDB.deleteDatabase, and the blocked path is easy to mistake for
 * success. The next openDB() call reopens from scratch.
 */
export function closeDB(): void {
  dbInstance?.close();
  dbInstance = null;
  dbPromise = null;
}

/**
 * Open the IndexedDB database, creating it if needed
 */
export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB upgrade blocked by another open tab. Close other tabs and reload.'));
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbPromise = null;
      };
      resolve(dbInstance);
    };
    
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
      
      // Journal entries store
      if (!db.objectStoreNames.contains('journal_entries')) {
        const journalStore = db.createObjectStore('journal_entries', { keyPath: 'id' });
        journalStore.createIndex('date', 'date', { unique: true });
        journalStore.createIndex('createdAt', 'createdAt', { unique: false });
        journalStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      
      // The journal lock, and the locked copies of the journal key
      if (!db.objectStoreNames.contains('journal_lock')) {
        db.createObjectStore('journal_lock', { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains('journal_key_slots')) {
        const slotStore = db.createObjectStore('journal_key_slots', { keyPath: 'id' });
        slotStore.createIndex('userId', 'userId', { unique: false });
      }

      // Notebooks store (named folders for free-form notes)
      if (!db.objectStoreNames.contains('notebooks')) {
        const notebookStore = db.createObjectStore('notebooks', { keyPath: 'id' });
        notebookStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Notebook pages store (one free-form note each)
      if (!db.objectStoreNames.contains('notebook_pages')) {
        const pageStore = db.createObjectStore('notebook_pages', { keyPath: 'id' });
        pageStore.createIndex('notebookId', 'notebookId', { unique: false });
        pageStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // ── Shared notebooks ──────────────────────────────────────────────────
      // Kept apart from 'notebooks'/'notebook_pages' rather than sharing them.
      // Those hold one account's rows and are reconciled against a pull scoped
      // to that account; these hold other people's rows too, and putting the
      // two in one store would let the single-user reconciler delete somebody
      // else's work off this device.
      if (!db.objectStoreNames.contains('shared_notebooks')) {
        const sharedStore = db.createObjectStore('shared_notebooks', { keyPath: 'id' });
        sharedStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('shared_notebook_members')) {
        const memberStore = db.createObjectStore('shared_notebook_members', { keyPath: 'id' });
        memberStore.createIndex('notebookId', 'notebookId', { unique: false });
        // Finding "my own member row in this notebook" is the commonest lookup
        // of the lot — it decides what the whole pane is allowed to offer.
        memberStore.createIndex('notebookUser', ['notebookId', 'userId'], { unique: false });
      }

      if (!db.objectStoreNames.contains('shared_notebook_pages')) {
        const sharedPageStore = db.createObjectStore('shared_notebook_pages', { keyPath: 'id' });
        sharedPageStore.createIndex('notebookId', 'notebookId', { unique: false });
        sharedPageStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Writes made with no signal. One row per page — see DBSharedOutboxItem.
      if (!db.objectStoreNames.contains('shared_outbox')) {
        const outboxStore = db.createObjectStore('shared_outbox', { keyPath: 'pageId' });
        outboxStore.createIndex('notebookId', 'notebookId', { unique: false });
        outboxStore.createIndex('queuedAt', 'queuedAt', { unique: false });
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
        const morphStore = db.createObjectStore('morphology', { keyPath: 'id' });
        morphStore.createIndex('book_chapter_verse_word', ['book', 'chapter', 'verse', 'wordPosition'], { unique: false });
        morphStore.createIndex('verse_ref', ['translationId', 'book', 'chapter', 'verse'], { unique: false });
        morphStore.createIndex('strongsId', 'strongsId', { unique: false });
        morphStore.createIndex('word', 'word', { unique: false }); // For lexicon lookup
        morphStore.createIndex('by_word', 'word', { unique: false });
        morphStore.createIndex('by_strongs', 'strongs_id', { unique: false });
        morphStore.createIndex('by_lemma', 'lemma', { unique: false });
        morphStore.createIndex('by_ref_word', ['translation_id', 'book', 'chapter', 'verse', 'word'], { unique: false });
      }
      
      // Greek Strong's lexicon entries
      if (!db.objectStoreNames.contains('greek_strongs_entries')) {
        const greekStore = db.createObjectStore('greek_strongs_entries', { keyPath: 'id' });
        greekStore.createIndex('lemma', 'lemma', { unique: false });
        greekStore.createIndex('by_id', 'id', { unique: true });
        greekStore.createIndex('by_lemma', 'lemma', { unique: false });
      }
      
      // Hebrew Strong's lexicon entries
      if (!db.objectStoreNames.contains('hebrew_strongs_entries')) {
        const hebrewStore = db.createObjectStore('hebrew_strongs_entries', { keyPath: 'id' });
        hebrewStore.createIndex('lemma', 'lemma', { unique: false });
        hebrewStore.createIndex('by_id', 'id', { unique: true });
        hebrewStore.createIndex('by_lemma', 'lemma', { unique: false });
      }
      
      // General lexicon entries (for words without Strong's)
      if (!db.objectStoreNames.contains('lexicon_entries')) {
        const lexiconStore = db.createObjectStore('lexicon_entries', { keyPath: 'id' });
        lexiconStore.createIndex('lemma', 'lemma', { unique: false });
        lexiconStore.createIndex('by_lemma', 'lemma', { unique: false });
        lexiconStore.createIndex('language', 'language', { unique: false });
      }
      
      // English words (dictionary)
      if (!db.objectStoreNames.contains('english_words')) {
        const englishStore = db.createObjectStore('english_words', { keyPath: 'id' });
        englishStore.createIndex('word', 'word', { unique: false });
        englishStore.createIndex('by_word', 'word', { unique: false });
        englishStore.createIndex('pos', 'pos', { unique: false });
      }
      
      // English grammar data
      if (!db.objectStoreNames.contains('english_grammar')) {
        const grammarStore = db.createObjectStore('english_grammar', { keyPath: 'id', autoIncrement: true });
        grammarStore.createIndex('word', 'word', { unique: false });
      }
      
      // English definitions (modern) - Wiktionary
      if (!db.objectStoreNames.contains('english_definitions_modern')) {
        const modernStore = db.createObjectStore('english_definitions_modern', { keyPath: 'id', autoIncrement: true });
        modernStore.createIndex('word_id', 'word_id', { unique: false });
        modernStore.createIndex('word_order', ['word_id', 'definition_order'], { unique: false });
      }

      // Word mapping (lemma -> word_id) for dictionary packs
      if (!db.objectStoreNames.contains('word_mapping')) {
        const mappingStore = db.createObjectStore('word_mapping', { keyPath: 'lemma' });
        mappingStore.createIndex('word_id', 'word_id', { unique: false });
      }
      
      // English definitions (historic) - GCIDE/Webster 1913
      if (!db.objectStoreNames.contains('english_definitions_historic')) {
        const historicStore = db.createObjectStore('english_definitions_historic', { keyPath: 'id', autoIncrement: true });
        historicStore.createIndex('word_id', 'word_id', { unique: false });
        historicStore.createIndex('word_order', ['word_id', 'definition_order'], { unique: false });
      }

      // English definitions (Concise / Wordset)
      if (!db.objectStoreNames.contains('english_definitions_wordset')) {
        const wordsetStore = db.createObjectStore('english_definitions_wordset', { keyPath: 'id', autoIncrement: true });
        wordsetStore.createIndex('word_id', 'word_id', { unique: false });
        wordsetStore.createIndex('word_order', ['word_id', 'definition_order'], { unique: false });
      }
      
      // Chronological order (moved from study pack to core schema)
      if (!db.objectStoreNames.contains('chronological_order')) {
        const chronoStore = db.createObjectStore('chronological_order', { keyPath: 'sequence' });
        chronoStore.createIndex('book', 'book', { unique: false });
      }

      // The forty events and twelve eras the Timeline window labels the
      // chronological order with. Both are tiny; both arrive with the study pack.
      if (!db.objectStoreNames.contains('chronological_events')) {
        const eventStore = db.createObjectStore('chronological_events', { keyPath: 'event_id' });
        eventStore.createIndex('era', 'era', { unique: false });
      }
      if (!db.objectStoreNames.contains('chronological_eras')) {
        db.createObjectStore('chronological_eras', { keyPath: 'era_id' });
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
      
      // Audio chapters store (for audio Bible packs)
      if (!db.objectStoreNames.contains('audio_chapters')) {
        const audioStore = db.createObjectStore('audio_chapters', { keyPath: 'id' });
        audioStore.createIndex('translationId', 'translationId', { unique: false });
        audioStore.createIndex('book', 'book', { unique: false });
        audioStore.createIndex('translation_book_chapter', ['translationId', 'book', 'chapter'], { unique: false });
      }

      // Audio cache store — stores extracted chapter audio blobs for instant replay
      if (!db.objectStoreNames.contains('audio_cache')) {
        db.createObjectStore('audio_cache', { keyPath: 'id' });
      }
      
      // Reading plan days store
      if (!db.objectStoreNames.contains('reading_plan_days')) {
        const daysStore = db.createObjectStore('reading_plan_days', { keyPath: 'id' });
        daysStore.createIndex('planId', 'planId', { unique: false });
        daysStore.createIndex('planId_dayNumber', ['planId', 'dayNumber'], { unique: true });
        daysStore.createIndex('date', 'date', { unique: false });
      }

      // Reading progress store
      if (!db.objectStoreNames.contains('reading_progress')) {
        const progressStore = db.createObjectStore('reading_progress', { keyPath: 'id' });
        progressStore.createIndex('planId', 'planId', { unique: false });
        progressStore.createIndex('planId_dayNumber', ['planId', 'dayNumber'], { unique: true });
        progressStore.createIndex('completed', 'completed', { unique: false });
      }

      // Plan metadata store
      if (!db.objectStoreNames.contains('plan_metadata')) {
        const metaStore = db.createObjectStore('plan_metadata', { keyPath: 'planId' });
        metaStore.createIndex('status', 'status', { unique: false });
        metaStore.createIndex('activatedAt', 'activatedAt', { unique: false });
      }

      // Sync queue store
      if (!db.objectStoreNames.contains('sync_queue')) {
        const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
        queueStore.createIndex('status', 'status', { unique: false });
        queueStore.createIndex('priority', 'priority', { unique: false });
        queueStore.createIndex('status_priority', ['status', 'priority'], { unique: false });
        queueStore.createIndex('createdAt', 'createdAt', { unique: false });
        queueStore.createIndex('type', 'type', { unique: false });
        queueStore.createIndex('planId', 'planId', { unique: false });
        queueStore.createIndex('type_planId', ['type', 'planId'], { unique: false });
      }

      // Sync operations store (idempotency log)
      if (!db.objectStoreNames.contains('sync_operations')) {
        const opsStore = db.createObjectStore('sync_operations', { keyPath: 'operationId' });
        opsStore.createIndex('appliedAt', 'appliedAt', { unique: false });
      }
      
      // Pleiades ancient places store (41,833 scholarly places)
      if (!db.objectStoreNames.contains('pleiades_places')) {
        const pleiadesStore = db.createObjectStore('pleiades_places', { keyPath: 'id' });
        pleiadesStore.createIndex('title', 'title', { unique: false });
        pleiadesStore.createIndex('placeType', 'placeType', { unique: false });
        pleiadesStore.createIndex('yearRange', ['yearStart', 'yearEnd'], { unique: false });
        pleiadesStore.createIndex('coordinates', ['latitude', 'longitude'], { unique: false });
      }
      
      // Pleiades place names store (historical name variations)
      if (!db.objectStoreNames.contains('pleiades_names')) {
        const namesStore = db.createObjectStore('pleiades_names', { keyPath: 'id', autoIncrement: true });
        namesStore.createIndex('placeId', 'placeId', { unique: false });
        namesStore.createIndex('name', 'name', { unique: false });
        namesStore.createIndex('language', 'language', { unique: false });
      }
      
      // Commentary entries store (Bible commentaries)
      if (!db.objectStoreNames.contains('commentary_entries')) {
        const commentaryStore = db.createObjectStore('commentary_entries', { keyPath: 'id' });
        commentaryStore.createIndex('verse', ['book', 'chapter', 'verseStart'], { unique: false });
        commentaryStore.createIndex('author', 'author', { unique: false });
        commentaryStore.createIndex('book', 'book', { unique: false });
        commentaryStore.createIndex('book_chapter', ['book', 'chapter'], { unique: false });
      }
      
      // Pleiades place locations store (coordinates)
      if (!db.objectStoreNames.contains('pleiades_locations')) {
        const locationsStore = db.createObjectStore('pleiades_locations', { keyPath: 'id', autoIncrement: true });
        locationsStore.createIndex('placeId', 'placeId', { unique: false });
        locationsStore.createIndex('coordinates', ['latitude', 'longitude'], { unique: false });
      }
      
      // OpenBible modern locations store (biblical geography with coordinates)
      if (!db.objectStoreNames.contains('openbible_locations')) {
        const openBibleLocStore = db.createObjectStore('openbible_locations', { keyPath: 'id' });
        openBibleLocStore.createIndex('friendlyId', 'friendlyId', { unique: false });
        openBibleLocStore.createIndex('type', 'type', { unique: false });
        openBibleLocStore.createIndex('class', 'class', { unique: false });
        openBibleLocStore.createIndex('coordinates', ['latitude', 'longitude'], { unique: false });
      }
      
      // OpenBible ancient places store (biblical names as they appear in Scripture)
      if (!db.objectStoreNames.contains('openbible_places')) {
        const openBiblePlacesStore = db.createObjectStore('openbible_places', { keyPath: 'id' });
        openBiblePlacesStore.createIndex('friendlyId', 'friendlyId', { unique: false });
        openBiblePlacesStore.createIndex('type', 'type', { unique: false });
        openBiblePlacesStore.createIndex('class', 'class', { unique: false });
        openBiblePlacesStore.createIndex('verseCount', 'verseCount', { unique: false });
      }
      
      // OpenBible place identifications store (links ancient -> modern with confidence)
      if (!db.objectStoreNames.contains('openbible_identifications')) {
        const openBibleIdentsStore = db.createObjectStore('openbible_identifications', { keyPath: 'id', autoIncrement: true });
        openBibleIdentsStore.createIndex('ancientPlaceId', 'ancientPlaceId', { unique: false });
        openBibleIdentsStore.createIndex('modernLocationId', 'modernLocationId', { unique: false });
        openBibleIdentsStore.createIndex('confidence', 'confidence', { unique: false });
      }

      // TSK cross-references store (Treasury of Scripture Knowledge keyword→verse chains)
      if (!db.objectStoreNames.contains('tsk_references')) {
        const tskStore = db.createObjectStore('tsk_references', { keyPath: 'id', autoIncrement: true });
        tskStore.createIndex('verse', ['book', 'chapter', 'verse'], { unique: false });
        tskStore.createIndex('book_chapter', ['book', 'chapter'], { unique: false });
      }

      // User word highlights store (translation-specific; degrades to verse-level on other translations)
      if (!db.objectStoreNames.contains('user_word_highlights')) {
        const wordHlStore = db.createObjectStore('user_word_highlights', { keyPath: 'id' });
        wordHlStore.createIndex('book_chapter_verse', ['book', 'chapter', 'verse'], { unique: false });
        wordHlStore.createIndex('translation', 'translation', { unique: false });
        wordHlStore.createIndex('book_chapter_verse_translation', ['book', 'chapter', 'verse', 'translation'], { unique: false });
      }

      // Section headings store (pericope titles from headings.sqlite pack)
      if (!db.objectStoreNames.contains('section_headings')) {
        const headingsStore = db.createObjectStore('section_headings', { keyPath: 'id' });
        headingsStore.createIndex('book_chapter', ['book', 'chapter'], { unique: false });
      }

      // Biblical art scenes store (famous paintings anchored to passages, from art.sqlite pack)
      if (!db.objectStoreNames.contains('art_scenes')) {
        const artScenesStore = db.createObjectStore('art_scenes', { keyPath: 'id' });
        artScenesStore.createIndex('book_chapter', ['book', 'chapter'], { unique: false });
        artScenesStore.createIndex('anchor', ['book', 'chapter', 'verse'], { unique: false });
      }

      // Bundled art image blobs (full + thumbnail), keyed by content id
      if (!db.objectStoreNames.contains('art_images')) {
        db.createObjectStore('art_images', { keyPath: 'id' });
      }

      // People store (biblical characters — bio, dates, places, relationships)
      if (!db.objectStoreNames.contains('people')) {
        const peopleStore = db.createObjectStore('people', { keyPath: 'id' });
        peopleStore.createIndex('name', 'name', { unique: false });
      }

      // Person name index (name / alt-name / token -> personId) for clicked-word lookup
      if (!db.objectStoreNames.contains('person_names')) {
        const personNamesStore = db.createObjectStore('person_names', { keyPath: 'id', autoIncrement: true });
        personNamesStore.createIndex('nameLower', 'nameLower', { unique: false });
        personNamesStore.createIndex('personId', 'personId', { unique: false });
      }

      // Person verse appearances (personId <-> book/chapter/verse) for verse-context disambiguation
      if (!db.objectStoreNames.contains('person_verses')) {
        const personVersesStore = db.createObjectStore('person_verses', { keyPath: 'id', autoIncrement: true });
        personVersesStore.createIndex('personId', 'personId', { unique: false });
        personVersesStore.createIndex('book_chapter_verse', ['book', 'chapter', 'verse'], { unique: false });
      }

      // ISBE encyclopedia entries (title, body_html, lead, outline, char_count, is_place)
      if (!db.objectStoreNames.contains('isbe_entries')) {
        const isbeEntries = db.createObjectStore('isbe_entries', { keyPath: 'entryId' });
        isbeEntries.createIndex('primaryNameLower', 'primaryNameLower', { unique: false });
      }

      // ISBE entry name index (title / alternate spelling -> entryId) for clicked-word lookup
      if (!db.objectStoreNames.contains('isbe_entry_names')) {
        const isbeNames = db.createObjectStore('isbe_entry_names', { keyPath: 'id', autoIncrement: true });
        isbeNames.createIndex('nameLower', 'nameLower', { unique: false });
        isbeNames.createIndex('entryId', 'entryId', { unique: false });
      }

      // ISBE full-text token index (token -> entryId) for deep search of article bodies
      if (!db.objectStoreNames.contains('isbe_tokens')) {
        const isbeTokens = db.createObjectStore('isbe_tokens', { keyPath: 'id', autoIncrement: true });
        isbeTokens.createIndex('token', 'token', { unique: false });
      }

      // ISBE geolocated places (OpenBible-derived: coords, type, modern name, entryId)
      if (!db.objectStoreNames.contains('isbe_places')) {
        const isbePlaces = db.createObjectStore('isbe_places', { keyPath: 'placeId' });
        isbePlaces.createIndex('entryId', 'entryId', { unique: false });
      }

      // ISBE place name index (spelling -> placeId, with is_phrase flag) for phrase + word lookup
      if (!db.objectStoreNames.contains('isbe_place_names')) {
        const isbePlaceNames = db.createObjectStore('isbe_place_names', { keyPath: 'id', autoIncrement: true });
        isbePlaceNames.createIndex('nameLower', 'nameLower', { unique: false });
        isbePlaceNames.createIndex('placeId', 'placeId', { unique: false });
      }

      // ISBE place verse appearances (placeId <-> book/chapter/verse) for verse-context disambiguation
      if (!db.objectStoreNames.contains('isbe_place_verses')) {
        const isbePlaceVerses = db.createObjectStore('isbe_place_verses', { keyPath: 'id', autoIncrement: true });
        isbePlaceVerses.createIndex('placeId', 'placeId', { unique: false });
        isbePlaceVerses.createIndex('book_chapter_verse', ['book', 'chapter', 'verse'], { unique: false });
      }

      // Nave's Topical Bible topics (title, lead, point/reference counts)
      if (!db.objectStoreNames.contains('naves_topics')) {
        const navesTopics = db.createObjectStore('naves_topics', { keyPath: 'topicId' });
        navesTopics.createIndex('primaryNameLower', 'primaryNameLower', { unique: false });
      }

      // Nave's topic name index (title / "also called" spelling -> topicId)
      if (!db.objectStoreNames.contains('naves_names')) {
        const navesNames = db.createObjectStore('naves_names', { keyPath: 'id', autoIncrement: true });
        navesNames.createIndex('nameLower', 'nameLower', { unique: false });
        navesNames.createIndex('topicId', 'topicId', { unique: false });
      }

      // Nave's outline points — the numbered structure of a topic. Read in
      // document order, so the index is on (topicId, seq) rather than topicId.
      if (!db.objectStoreNames.contains('naves_points')) {
        const navesPoints = db.createObjectStore('naves_points', { keyPath: 'id', autoIncrement: true });
        navesPoints.createIndex('topic_seq', ['topicId', 'seq'], { unique: false });
      }

      // Nave's verse citations, for the Verses tab and "in this chapter"
      if (!db.objectStoreNames.contains('naves_verses')) {
        const navesVerses = db.createObjectStore('naves_verses', { keyPath: 'id', autoIncrement: true });
        navesVerses.createIndex('topicId', 'topicId', { unique: false });
        navesVerses.createIndex('book_chapter_verse', ['book', 'chapter', 'verse'], { unique: false });
      }

      // Nave's full-text token index (token -> topicId) for deep search
      if (!db.objectStoreNames.contains('naves_tokens')) {
        const navesTokens = db.createObjectStore('naves_tokens', { keyPath: 'id', autoIncrement: true });
        navesTokens.createIndex('token', 'token', { unique: false });
      }

      // ── The Historical Map pack ───────────────────────────────────────────
      //
      // Split by how the data is read rather than by where it came from. The
      // two blob stores (atlas_geometry, atlas_place_index) hold a handful of
      // large gzipped rows that are inflated on demand and never queried; the
      // rest are small tables read whole when the map opens.

      // What the pack knows about itself: layer and row counts to check a
      // finished install against, the fine-water coverage boxes, attribution.
      if (!db.objectStoreNames.contains('atlas_meta')) {
        db.createObjectStore('atlas_meta', { keyPath: 'key' });
      }

      // The sixteen eras of the timeline.
      if (!db.objectStoreNames.contains('atlas_eras')) {
        const atlasEras = db.createObjectStore('atlas_eras', { keyPath: 'id' });
        atlasEras.createIndex('sortOrder', 'sortOrder', { unique: false });
      }

      // The catalogue of drawn layers — what exists, and which shard the bytes
      // came from. Carries no geometry itself.
      if (!db.objectStoreNames.contains('atlas_layers')) {
        const atlasLayers = db.createObjectStore('atlas_layers', { keyPath: 'id' });
        atlasLayers.createIndex('eraId', 'eraId', { unique: false });
        atlasLayers.createIndex('group_kind_detail', ['group', 'kind', 'detail'], { unique: false });
      }

      // One gzipped GeoJSON blob per layer. Blob-wrapped so Chrome stores it in
      // its file-backed blob store rather than cloning 20 MB through memory.
      if (!db.objectStoreNames.contains('atlas_geometry')) {
        db.createObjectStore('atlas_geometry', { keyPath: 'id' });
      }

      // Places lettered on a particular era's map.
      if (!db.objectStoreNames.contains('atlas_era_places')) {
        const atlasEraPlaces = db.createObjectStore('atlas_era_places', { keyPath: 'id' });
        atlasEraPlaces.createIndex('eraId', 'eraId', { unique: false });
      }

      // Modern cities and named peaks drawn on the parchment basemap.
      if (!db.objectStoreNames.contains('atlas_points')) {
        const atlasPoints = db.createObjectStore('atlas_points', { keyPath: 'id' });
        atlasPoints.createIndex('kind', 'kind', { unique: false });
      }

      // The places Scripture names, each with every verse that names it.
      if (!db.objectStoreNames.contains('atlas_biblical_places')) {
        const atlasBiblical = db.createObjectStore('atlas_biblical_places', { keyPath: 'id' });
        atlasBiblical.createIndex('name', 'name', { unique: false });
      }

      // Dated names off the Barrington regional linework.
      if (!db.objectStoreNames.contains('atlas_ancient_names')) {
        const atlasAncient = db.createObjectStore('atlas_ancient_names', { keyPath: 'id' });
        atlasAncient.createIndex('name', 'name', { unique: false });
      }

      // One Wikimedia photograph per place, with its credit.
      if (!db.objectStoreNames.contains('atlas_place_photos')) {
        db.createObjectStore('atlas_place_photos', { keyPath: 'place' });
      }

      // The place search index: thirteen gzipped columns, not half a million
      // rows. Read once when search first opens, released when the map closes.
      if (!db.objectStoreNames.contains('atlas_place_index')) {
        db.createObjectStore('atlas_place_index', { keyPath: 'name' });
      }

      // The journeys a reader can follow: who travelled, when, and in what
      // colour. Ours, not the route source's.
      if (!db.objectStoreNames.contains('atlas_journeys')) {
        const atlasJourneys = db.createObjectStore('atlas_journeys', { keyPath: 'id' });
        atlasJourneys.createIndex('sortOrder', 'sortOrder', { unique: false });
      }

      // Every stop on every journey. `journeyId|seq` because a place is a stop
      // on as many journeys as pass through it, and twice on some of them.
      // placeId points into atlas_biblical_places, which is where the verses
      // live — a stop never carries its own copy of them.
      if (!db.objectStoreNames.contains('atlas_journey_stops')) {
        const atlasStops = db.createObjectStore('atlas_journey_stops', { keyPath: 'id' });
        atlasStops.createIndex('journeyId', 'journeyId', { unique: false });
      }

      // The drawn lines, gzipped, one row per journey: coordinates and nothing
      // else. This store is the CC BY-SA boundary — every name a reader sees
      // comes from the two stores above, so keep it that way.
      if (!db.objectStoreNames.contains('atlas_journey_geometry')) {
        db.createObjectStore('atlas_journey_geometry', { keyPath: 'id' });
      }

      // Modern world places store (GeoNames — cities, states, countries worldwide)
      if (!db.objectStoreNames.contains('modern_places')) {
        const modernStore = db.createObjectStore('modern_places', { keyPath: 'id' });
        modernStore.createIndex('name',        'name',        { unique: false });
        modernStore.createIndex('asciiName',   'asciiName',   { unique: false });
        modernStore.createIndex('countryCode', 'countryCode', { unique: false });
        modernStore.createIndex('admin1Name',  'admin1Name',  { unique: false });
        modernStore.createIndex('featureClass','featureClass',{ unique: false });
        modernStore.createIndex('population',  'population',  { unique: false });
      }
    };
  });

  return dbPromise;
}

// ─── Ownership stamping ────────────────────────────────────────────────────
//
// The stores below hold one person's own work, and each of their rows carries
// an `ownerId` naming the account it belongs to. Stamping happens here rather
// than at the thirty-odd call sites that write them, because a call site
// missed is a row that silently cannot answer whose it is — and phases 3 to 5
// decide what to keep and what to clear from exactly that answer.
//
// Not listed here: the shared notebook stores, which hold other people's rows
// and already carry an authorId of their own; the pack and reference stores,
// which are the same for everybody; and the sync queue, which phase 1 guards
// separately.

const PERSONAL_STORES = new Set([
  'user_notes',
  'user_highlights',
  'user_word_highlights',
  'user_bookmarks',
  'journal_entries',
  'notebooks',
  'notebook_pages',
  'reading_progress',
  'plan_metadata',
]);

/** Whether rows written to this store should carry an `ownerId`. */
export function isPersonalStore(storeName: string): boolean {
  return PERSONAL_STORES.has(storeName);
}

/**
 * Stamp a personal-store record by hand.
 *
 * For the handful of places that open their own readwrite transaction rather
 * than going through writeTransaction — a read-modify-write needs the live
 * store object to call `get` on it, which the helpers do not hand back. Most
 * of those put back a row that was already stamped when it was created; this
 * is for the ones that build a record from scratch.
 */
export function withOwner<T extends Record<string, any>>(record: T): T {
  if (record && typeof record === 'object' && !record.ownerId) {
    const owner = getDeviceOwner();
    if (owner) return { ...record, ownerId: owner };
  }
  return record;
}

/**
 * Wrap a personal store so every record put through it is stamped.
 *
 * A row that already names an owner keeps it: the apply functions stamp from
 * the account the pull was made against, and a read-modify-write puts back a
 * row that was stamped when it was created. Signed out, nothing is stamped —
 * the row stays unowned and is adopted by the next account to sign in, which
 * is the same treatment rows written before this change receive.
 *
 * Only `put` and `add` are wrapped. Everything else — `get`, `delete`,
 * `index`, the cursor methods — is handed through untouched, so the object
 * behaves exactly like the store it stands for.
 */
function stampingStore(store: IDBObjectStore): IDBObjectStore {
  const owner = getDeviceOwner();
  if (!owner) return store;

  const stamp = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (value.ownerId) return value;
    return { ...value, ownerId: owner };
  };

  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'put' || prop === 'add') {
        return (value: any, key?: IDBValidKey) =>
          key === undefined
            ? (target as any)[prop](stamp(value))
            : (target as any)[prop](stamp(value), key);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
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
 * Every morphology word in a chapter, for original-language reading.
 *
 * The words table always keys on a lowercase translation id, while the reader
 * may be showing an uppercase one, so the id is normalised here rather than at
 * each call site.
 */
export async function getMorphologyForChapter(
  translationId: string,
  book: string,
  chapter: number
): Promise<DBMorphology[]> {
  try {
    const id = translationId.toLowerCase();
    const rows = await readTransaction<DBMorphology[]>('morphology', (store) =>
      store.index('verse_ref').getAll(
        IDBKeyRange.bound([id, book, chapter, 1], [id, book, chapter, 999])
      )
    );
    return rows ?? [];
  } catch (error) {
    console.error('Error fetching chapter morphology:', error);
    return [];
  }
}

/**
 * Helper to execute a write transaction
 */
export async function writeTransaction<T>(
  storeName: string,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  // Stage logging: a single small write here once took 13.6 s and coincided
  // with ~2 GB of heap growth, and with one await there was no way to tell
  // which part was responsible.
  logInstallIfActive('tx-open-db', { store: storeName });
  const db = await openDB();
  logInstallIfActive('tx-db-ready', { store: storeName });
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const raw = transaction.objectStore(storeName);
    const store = PERSONAL_STORES.has(storeName) ? stampingStore(raw) : raw;
    logInstallIfActive('tx-created', { store: storeName });
    const request = callback(store);
    logInstallIfActive('tx-request-issued', { store: storeName });

    request.onsuccess = () => {
      logInstallIfActive('tx-request-success', { store: storeName });
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`${storeName} transaction aborted`));
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
    const raw = transaction.objectStore(storeName);
    const store = PERSONAL_STORES.has(storeName) ? stampingStore(raw) : raw;

    operations(store);
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`${storeName} transaction aborted`));
  });
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Clear only translation packs (text/audio), keeping lexical/morphology/maps intact
 * Useful for debugging translation issues without re-importing large lexical datasets
 */
export async function clearTranslationPacks(): Promise<void> {
  const db = await openDB();
  
  return new Promise(async (resolve, reject) => {
    try {
      // Get all packs
      const packsTransaction = db.transaction('packs', 'readonly');
      const packsStore = packsTransaction.objectStore('packs');
      const packsRequest = packsStore.getAll();
      
      packsRequest.onsuccess = async () => {
        const allPacks = packsRequest.result as DBPack[];
        const translationPacks = allPacks.filter(p => p.type === 'text' || p.type === 'audio');
        const translationIds = new Set(translationPacks.map(p => p.translationId).filter(Boolean));
        
        console.log(`Clearing ${translationPacks.length} translation packs...`);
        console.log('Translation IDs to remove:', Array.from(translationIds));
        
        // Delete translation packs metadata
        const deletePacksTransaction = db.transaction('packs', 'readwrite');
        const deletePacksStore = deletePacksTransaction.objectStore('packs');
        for (const pack of translationPacks) {
          deletePacksStore.delete(pack.id);
        }
        
        await new Promise<void>((res, rej) => {
          deletePacksTransaction.oncomplete = () => res();
          deletePacksTransaction.onerror = () => rej(deletePacksTransaction.error);
        });
        
        // Delete all verses from translation packs
        const versesTransaction = db.transaction('verses', 'readwrite');
        const versesStore = versesTransaction.objectStore('verses');
        const versesIndex = versesStore.index('translationId');
        
        for (const translationId of translationIds) {
          const versesRequest = versesIndex.openCursor(IDBKeyRange.only(translationId));
          versesRequest.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
        }
        
        await new Promise<void>((res, rej) => {
          versesTransaction.oncomplete = () => res();
          versesTransaction.onerror = () => rej(versesTransaction.error);
        });
        
        console.log('✅ Translation packs cleared (lexical data preserved)');
        resolve();
      };
      
      packsRequest.onerror = () => reject(packsRequest.error);
    } catch (err) {
      reject(err);
    }
  });
}

// Expose to window for console debugging
if (typeof window !== 'undefined') {
  (window as any).clearTranslationPacks = clearTranslationPacks;
}
