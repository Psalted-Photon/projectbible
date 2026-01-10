import type { 
  LexiconStore, 
  StrongEntry, 
  MorphologyInfo, 
  WordOccurrence,
  Pronunciation
} from '@projectbible/core';
import { openDB, readTransaction, writeTransaction, batchWriteTransaction } from './db';
import type { DBStrongEntry, DBPronunciation, DBMorphology, DBWordOccurrence } from './db';

/**
 * IndexedDB implementation of LexiconStore
 * Provides Strong's dictionary lookups, morphology parsing, word occurrences, and pronunciation data
 */
export class IndexedDBLexiconStore implements LexiconStore {
  
  /**
   * Get a Strong's entry by ID
   * @param strongsId - Strong's number (e.g., "G25" or "H1")
   */
  async getStrong(strongsId: string): Promise<StrongEntry | null> {
    const entry = await readTransaction<DBStrongEntry>(
      'strongs_entries',
      (store) => store.get(strongsId)
    );
    
    if (!entry) return null;
    
    return this.dbToStrongEntry(entry);
  }

  /**
   * Get Strong's entries by lemma (lexical form)
   * @param lemma - The root word form
   * @param language - Optional language filter
   */
  async getByLemma(lemma: string, language?: 'greek' | 'hebrew' | 'aramaic'): Promise<StrongEntry[]> {
    const entries = await readTransaction<DBStrongEntry[]>(
      'strongs_entries',
      (store) => {
        const index = store.index('lemma');
        return index.getAll(lemma);
      }
    );
    
    let filtered = entries;
    if (language) {
      filtered = entries.filter(e => e.language === language);
    }
    
    return filtered.map(e => this.dbToStrongEntry(e));
  }

  /**
   * Search Strong's entries by definition text
   * @param searchTerm - Text to search for in definitions
   * @param language - Optional language filter
   */
  async searchDefinition(searchTerm: string, language?: 'greek' | 'hebrew' | 'aramaic'): Promise<StrongEntry[]> {
    const db = await openDB();
    const lowerSearch = searchTerm.toLowerCase();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction('strongs_entries', 'readonly');
      const store = tx.objectStore('strongs_entries');
      const results: DBStrongEntry[] = [];
      
      let request: IDBRequest;
      if (language) {
        const index = store.index('language');
        request = index.openCursor(IDBKeyRange.only(language));
      } else {
        request = store.openCursor();
      }
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const entry = cursor.value as DBStrongEntry;
          const definitionMatch = entry.definition.toLowerCase().includes(lowerSearch);
          const shortDefMatch = entry.shortDefinition?.toLowerCase().includes(lowerSearch);
          const lemmaMatch = entry.lemma.toLowerCase().includes(lowerSearch);
          
          if (definitionMatch || shortDefMatch || lemmaMatch) {
            results.push(entry);
          }
          cursor.continue();
        } else {
          resolve(results.map(e => this.dbToStrongEntry(e)));
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get morphology information for a specific word occurrence
   * @param book - Book name
   * @param chapter - Chapter number
   * @param verse - Verse number
   * @param wordPosition - Position of word in verse (1-indexed)
   */
  async getMorphology(book: string, chapter: number, verse: number, wordPosition: number): Promise<MorphologyInfo | null> {
    const morphData = await readTransaction<DBMorphology | undefined>(
      'morphology',
      (store) => {
        const index = store.index('book_chapter_verse_word');
        return index.get([book, chapter, verse, wordPosition]);
      }
    );
    
    if (!morphData) return null;
    
    return this.dbToMorphology(morphData);
  }

  /**
   * Get all occurrences of a Strong's number in the Bible
   * @param strongsId - Strong's number (e.g., "G25")
   * @param limit - Optional limit on number of results
   */
  async getOccurrences(strongsId: string, limit?: number): Promise<WordOccurrence[]> {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction('word_occurrences', 'readonly');
      const store = tx.objectStore('word_occurrences');
      const index = store.index('strongsId');
      const results: DBWordOccurrence[] = [];
      
      const request = index.openCursor(IDBKeyRange.only(strongsId));
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && (!limit || results.length < limit)) {
          results.push(cursor.value as DBWordOccurrence);
          cursor.continue();
        } else {
          resolve(results.map(o => this.dbToOccurrence(o)));
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get pronunciation data for a Strong's entry
   * @param strongsId - Strong's number
   */
  async getPronunciation(strongsId: string): Promise<Pronunciation | null> {
    const pronData = await readTransaction<DBPronunciation>(
      'pronunciations',
      (store) => store.get(strongsId)
    );
    
    if (!pronData) return null;
    
    return {
      ipa: pronData.ipa,
      phonetic: pronData.phonetic,
      audioUrl: pronData.audioUrl,
      syllables: pronData.syllables ? JSON.parse(pronData.syllables) : undefined,
      stress: pronData.stress
    };
  }

  // ===== Conversion helpers =====

  private dbToStrongEntry(db: DBStrongEntry): StrongEntry {
    return {
      id: db.id,
      lemma: db.lemma,
      transliteration: db.transliteration,
      definition: db.definition,
      shortDefinition: db.shortDefinition,
      partOfSpeech: db.partOfSpeech,
      language: db.language,
      derivation: db.derivation,
      kjvUsage: db.kjvUsage,
      occurrences: db.occurrences
    };
  }

  private dbToMorphology(db: DBMorphology): MorphologyInfo {
    // Handle parsing - can be a JSON string, plain morph code string, or object
    let parsing: any;
    if (typeof db.parsing === 'string') {
      try {
        parsing = JSON.parse(db.parsing);
      } catch {
        // Not JSON - it's a morph code string like "N-NSM-P"
        parsing = { code: db.parsing };
      }
    } else {
      parsing = db.parsing;
    }
    
    return {
      word: db.text || db.word,
      lemma: db.lemma,
      strongsId: db.strongsId,
      parsing,
      gloss: db.gloss,
      transliteration: db.transliteration,
      language: db.language
    };
  }

  private dbToOccurrence(db: DBWordOccurrence): WordOccurrence {
    return {
      book: db.book,
      chapter: db.chapter,
      verse: db.verse,
      wordPosition: db.wordPosition,
      word: db.word,
      translation: db.translation
    };
  }
}
