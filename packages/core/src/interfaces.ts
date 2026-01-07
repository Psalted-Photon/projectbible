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
  id: string; // e.g., "G25" or "H1"
  lemma: string; // Original language word
  transliteration?: string; // Romanized form
  pronunciation?: Pronunciation;
  definition: string;
  shortDefinition?: string;
  partOfSpeech: string; // noun, verb, adjective, etc.
  language: 'greek' | 'hebrew' | 'aramaic';
  derivation?: string; // Etymology
  kjvUsage?: string; // How KJV translates it
  occurrences?: number; // Times used in Bible
}

export interface Pronunciation {
  ipa?: string; // International Phonetic Alphabet
  phonetic?: string; // Simplified phonetic
  audioUrl?: string; // Reference to audio file
  syllables?: string[]; // Syllable breakdown
  stress?: number; // Which syllable is stressed (0-indexed)
}

export interface MorphologyInfo {
  word: string; // The actual word form
  lemma: string; // Dictionary form
  strongsId?: string; // Link to Strong's
  parsing: MorphologyParsing;
  gloss?: string; // English gloss
  language: 'greek' | 'hebrew' | 'aramaic';
}

export interface MorphologyParsing {
  pos: string; // Part of speech (detailed)
  person?: '1' | '2' | '3';
  number?: 'singular' | 'plural';
  gender?: 'masculine' | 'feminine' | 'neuter';
  case?: 'nominative' | 'genitive' | 'dative' | 'accusative' | 'vocative';
  tense?: 'present' | 'imperfect' | 'future' | 'aorist' | 'perfect' | 'pluperfect';
  voice?: 'active' | 'middle' | 'passive';
  mood?: 'indicative' | 'subjunctive' | 'optative' | 'imperative' | 'infinitive' | 'participle';
  state?: 'absolute' | 'construct'; // Hebrew
  stem?: string; // Hebrew verb stems (Qal, Piel, etc.)
}

export interface WordOccurrence {
  book: string;
  chapter: number;
  verse: number;
  wordPosition: number; // Position in verse
  word: string;
  translation?: string; // How it's translated
}

export interface PlaceInfo {
  id: string;
  name: string;
  altNames?: string[];
  latitude?: number;
  longitude?: number;
  verses?: BCV[];
}

export interface CrossReference {
  id: string;
  from: BCV;
  to: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd?: number;
  };
  description?: string;
  source: 'curated' | 'user' | 'ai';
  votes?: number;
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
  /** Get a Strong's entry by ID (e.g., "G25" or "H1") */
  getStrong(strongId: string): Promise<StrongEntry | null>;
  
  /** Get all Strong's entries for a lemma (may return multiple) */
  getByLemma(lemma: string, language?: 'greek' | 'hebrew'): Promise<StrongEntry[]>;
  
  /** Search Strong's entries by definition text */
  searchDefinition(query: string): Promise<StrongEntry[]>;
  
  /** Get morphology info for a specific word form */
  getMorphology(book: string, chapter: number, verse: number, wordPosition: number): Promise<MorphologyInfo | null>;
  
  /** Get all word occurrences for a Strong's number */
  getOccurrences(strongId: string, limit?: number): Promise<WordOccurrence[]>;
  
  /** Get pronunciation for a lemma or Strong's ID */
  getPronunciation(lemmaOrStrongsId: string): Promise<Pronunciation | null>;
}

export interface PlaceStore {
  /** Get place information by ID */
  getPlace(placeId: string): Promise<PlaceInfo | null>;
  
  /** Find places mentioned in a verse */
  getPlacesForVerse(reference: BCV): Promise<PlaceInfo[]>;
  
  /** Search places by name */
  searchPlaces(query: string): Promise<PlaceInfo[]>;
}

export interface CrossReferenceStore {
  /** Get all cross-references from a specific verse */
  getCrossReferences(reference: BCV): Promise<CrossReference[]>;
  
  /** Get cross-references pointing TO a specific verse */
  getReferencesToVerse(reference: BCV): Promise<CrossReference[]>;
  
  /** Save a user-created cross-reference */
  saveCrossReference(crossRef: Omit<CrossReference, 'id'>): Promise<CrossReference>;
  
  /** Delete a cross-reference */
  deleteCrossReference(id: string): Promise<void>;
  
  /** Vote on a cross-reference (upvote/downvote) */
  voteCrossReference(id: string, delta: number): Promise<void>;
}

export interface ReadingHistoryEntry {
  id: string;
  book: string;
  chapter: number;
  readAt: Date;
  planId?: string; // If part of a reading plan
}

export interface ActiveReadingPlan {
  id: string;
  name: string;
  config: any; // ReadingPlanConfig from reading-plan.ts
  startedAt: Date;
  completedAt?: Date;
  currentDayNumber: number;
}

export interface ReadingPlanDay {
  planId: string;
  dayNumber: number;
  date: Date;
  chapters: { book: string; chapter: number }[];
  completed: boolean;
  completedAt?: Date;
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

export interface ReadingHistoryStore {
  /** Record that a chapter was read */
  recordReading(book: string, chapter: number, planId?: string): Promise<ReadingHistoryEntry>;
  
  /** Get reading history for a specific book/chapter */
  getReadingHistory(book?: string, chapter?: number): Promise<ReadingHistoryEntry[]>;
  
  /** Check if a chapter has been read (optionally within a plan) */
  hasRead(book: string, chapter: number, planId?: string): Promise<boolean>;
  
  /** Get reading streak (consecutive days with at least one reading) */
  getReadingStreak(): Promise<number>;
  
  /** Get total chapters read */
  getTotalChaptersRead(): Promise<number>;
  
  // Reading Plan Management
  /** Start a new reading plan */
  startReadingPlan(name: string, config: any): Promise<ActiveReadingPlan>;
  
  /** Get the active reading plan */
  getActiveReadingPlan(): Promise<ActiveReadingPlan | null>;
  
  /** Get a specific reading plan by ID */
  getReadingPlan(planId: string): Promise<ActiveReadingPlan | null>;
  
  /** Get all reading plans (active and completed) */
  getAllReadingPlans(): Promise<ActiveReadingPlan[]>;
  
  /** Complete a reading plan */
  completeReadingPlan(planId: string): Promise<void>;
  
  /** Delete a reading plan */
  deleteReadingPlan(planId: string): Promise<void>;
  
  // Daily Reading Progress
  /** Get reading assignments for a specific day */
  getDayReading(planId: string, dayNumber: number): Promise<ReadingPlanDay | null>;
  
  /** Get all days for a reading plan */
  getAllDayReadings(planId: string): Promise<ReadingPlanDay[]>;
  
  /** Mark a day as completed */
  completeDayReading(planId: string, dayNumber: number): Promise<void>;
  
  /** Get progress for a reading plan (percentage complete) */
  getPlanProgress(planId: string): Promise<number>;
  
  /** Get today's reading assignment (if in active plan) */
  getTodaysReading(): Promise<ReadingPlanDay | null>;
}

// Platform context (injected into core)
export interface PlatformContext {
  packManager: PackManager;
  textStore: TextStore;
  searchIndex: SearchIndex;
  crossReferenceStore: CrossReferenceStore;
  lexiconStore: LexiconStore;
  placeStore: PlaceStore;
  userDataStore: UserDataStore;
  readingHistoryStore: ReadingHistoryStore;
}
