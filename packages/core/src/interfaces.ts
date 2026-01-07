// Core domain types
export interface BCV {
  book: string;
  chapter: number;
  verse: number;
}

export interface Verse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface PackInfo {
  id: string;
  version: string;
  type: 'text' | 'lexicon' | 'places' | 'map';
  translationId?: string;
  translationName?: string;
  license: string;
  size?: number;
  installedAt?: Date;
}

export interface SearchResult {
  translation: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  snippet?: string;
}

export interface StrongEntry {
  id: string;
  lemma: string;
  definition: string;
  partOfSpeech: string;
}

export interface PlaceInfo {
  id: string;
  name: string;
  altNames?: string[];
  latitude?: number;
  longitude?: number;
  verses?: BCV[];
}

export interface UserNote {
  id: string;
  reference: BCV;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserHighlight {
  id: string;
  reference: BCV;
  color: string;
  createdAt: Date;
}

export interface UserBookmark {
  id: string;
  reference: BCV;
  label?: string;
  createdAt: Date;
}

// Platform interfaces (to be implemented by PWA/Electron adapters)

export interface PackManager {
  /** List all installed packs */
  listInstalled(): Promise<PackInfo[]>;
  
  /** Install a pack from a file or URL */
  install(source: string | File): Promise<void>;
  
  /** Remove an installed pack */
  remove(packId: string): Promise<void>;
  
  /** Check if a pack is installed */
  isInstalled(packId: string): Promise<boolean>;
}

export interface TextStore {
  /** Get a single verse */
  getVerse(translation: string, book: string, chapter: number, verse: number): Promise<string | null>;
  
  /** Get all verses in a chapter */
  getChapter(translation: string, book: string, chapter: number): Promise<Verse[]>;
  
  /** Get available translations */
  getTranslations(): Promise<Array<{id: string, name: string}>>;
  
  /** Get available books for a translation */
  getBooks(translation: string): Promise<string[]>;
}

export interface SearchIndex {
  /** Search across installed translations */
  search(query: string, translations?: string[]): Promise<SearchResult[]>;
  
  /** Search for a Strong's number */
  searchStrong(strongId: string): Promise<SearchResult[]>;
}

export interface LexiconStore {
  /** Get a Strong's entry by ID */
  getStrong(strongId: string): Promise<StrongEntry | null>;
  
  /** Get lemma information */
  getLemma(lemma: string): Promise<StrongEntry[]>;
}

export interface PlaceStore {
  /** Get place information by ID */
  getPlace(placeId: string): Promise<PlaceInfo | null>;
  
  /** Find places mentioned in a verse */
  getPlacesForVerse(reference: BCV): Promise<PlaceInfo[]>;
  
  /** Search places by name */
  searchPlaces(query: string): Promise<PlaceInfo[]>;
}

export interface UserDataStore {
  // Notes
  getNotes(reference?: BCV): Promise<UserNote[]>;
  saveNote(note: Omit<UserNote, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserNote>;
  deleteNote(noteId: string): Promise<void>;
  
  // Highlights
  getHighlights(reference?: BCV): Promise<UserHighlight[]>;
  saveHighlight(highlight: Omit<UserHighlight, 'id' | 'createdAt'>): Promise<UserHighlight>;
  deleteHighlight(highlightId: string): Promise<void>;
  
  // Bookmarks
  getBookmarks(): Promise<UserBookmark[]>;
  saveBookmark(bookmark: Omit<UserBookmark, 'id' | 'createdAt'>): Promise<UserBookmark>;
  deleteBookmark(bookmarkId: string): Promise<void>;
}

// Platform context (injected into core)
export interface PlatformContext {
  packManager: PackManager;
  textStore: TextStore;
  searchIndex: SearchIndex;
  lexiconStore: LexiconStore;
  placeStore: PlaceStore;
  userDataStore: UserDataStore;
}
