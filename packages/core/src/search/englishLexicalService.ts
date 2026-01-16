/**
 * English Lexical Service
 * 
 * Provides access to English lexical data from IndexedDB:
 * - Wordlist with IPA pronunciations
 * - Thesaurus with synonyms
 * - Grammar with POS tags, irregular verbs, plurals
 * 
 * Data is loaded from SQLite packs into IndexedDB for offline access.
 */

export interface WordInfo {
  word: string;
  ipa_us?: string;
  ipa_uk?: string;
}

export interface Synonym {
  word: string;
  synonym: string;
}

export interface VerbForm {
  base_form: string;
  present: string;
  past: string;
  past_participle: string;
  present_participle: string;
}

export interface NounPlural {
  singular: string;
  plural: string;
}

export interface POSTag {
  word: string;
  pos: 'noun' | 'verb' | 'adjective' | 'adverb';
}

class EnglishLexicalService {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'EnglishLexicalDB';
  private readonly DB_VERSION = 1;

  /**
   * Initialize IndexedDB with stores for wordlist, thesaurus, and grammar
   */
  async initialize(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Wordlist store (word -> pronunciation)
        if (!db.objectStoreNames.contains('wordlist')) {
          const wordlistStore = db.createObjectStore('wordlist', { keyPath: 'word' });
          wordlistStore.createIndex('word', 'word', { unique: true });
        }

        // Synonyms store (word -> list of synonyms)
        if (!db.objectStoreNames.contains('synonyms')) {
          const synonymsStore = db.createObjectStore('synonyms', { autoIncrement: true });
          synonymsStore.createIndex('word', 'word', { unique: false });
          synonymsStore.createIndex('synonym', 'synonym', { unique: false });
        }

        // Verb forms store
        if (!db.objectStoreNames.contains('verb_forms')) {
          const verbStore = db.createObjectStore('verb_forms', { keyPath: 'base_form' });
          verbStore.createIndex('base_form', 'base_form', { unique: true });
        }

        // Noun plurals store
        if (!db.objectStoreNames.contains('noun_plurals')) {
          const nounStore = db.createObjectStore('noun_plurals', { keyPath: 'singular' });
          nounStore.createIndex('singular', 'singular', { unique: true });
        }

        // POS tags store
        if (!db.objectStoreNames.contains('pos_tags')) {
          const posStore = db.createObjectStore('pos_tags', { autoIncrement: true });
          posStore.createIndex('word', 'word', { unique: false });
          posStore.createIndex('pos', 'pos', { unique: false });
        }
      };
    });
  }

  /**
   * Get pronunciation for a word
   */
  async getPronunciation(word: string): Promise<WordInfo | null> {
    await this.initialize();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['wordlist'], 'readonly');
      const store = transaction.objectStore('wordlist');
      const request = store.get(word.toLowerCase());

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get synonyms for a word
   */
  async getSynonyms(word: string, limit: number = 50): Promise<string[]> {
    await this.initialize();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['synonyms'], 'readonly');
      const store = transaction.objectStore('synonyms');
      const index = store.index('word');
      const request = index.getAll(IDBKeyRange.only(word.toLowerCase()));

      request.onsuccess = () => {
        const results = request.result || [];
        const synonyms = results.map((r: Synonym) => r.synonym).slice(0, limit);
        resolve(synonyms);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Expand search terms with synonyms
   */
  async expandWithSynonyms(words: string[], maxSynonymsPerWord: number = 10): Promise<string[]> {
    const expanded = new Set(words.map(w => w.toLowerCase()));

    for (const word of words) {
      const synonyms = await this.getSynonyms(word, maxSynonymsPerWord);
      synonyms.forEach(syn => expanded.add(syn.toLowerCase()));
    }

    return Array.from(expanded);
  }

  /**
   * Get part of speech tags for a word
   */
  async getPOSTags(word: string): Promise<string[]> {
    await this.initialize();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pos_tags'], 'readonly');
      const store = transaction.objectStore('pos_tags');
      const index = store.index('word');
      const request = index.getAll(IDBKeyRange.only(word.toLowerCase()));

      request.onsuccess = () => {
        const results = request.result || [];
        const tags = results.map((r: POSTag) => r.pos);
        resolve([...new Set(tags)]); // Deduplicate
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get irregular verb forms
   */
  async getVerbForms(baseForm: string): Promise<VerbForm | null> {
    await this.initialize();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['verb_forms'], 'readonly');
      const store = transaction.objectStore('verb_forms');
      const request = store.get(baseForm.toLowerCase());

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get irregular plural
   */
  async getNounPlural(singular: string): Promise<string | null> {
    await this.initialize();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['noun_plurals'], 'readonly');
      const store = transaction.objectStore('noun_plurals');
      const request = store.get(singular.toLowerCase());

      request.onsuccess = () => {
        const result = request.result as NounPlural | undefined;
        resolve(result?.plural || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if lexical data is loaded
   */
  async isDataLoaded(): Promise<boolean> {
    await this.initialize();
    if (!this.db) return false;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['wordlist'], 'readonly');
      const store = transaction.objectStore('wordlist');
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        resolve(countRequest.result > 0);
      };
      countRequest.onerror = () => resolve(false);
    });
  }

  /**
   * Bulk insert wordlist data
   */
  async bulkInsertWordlist(words: WordInfo[]): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['wordlist'], 'readwrite');
      const store = transaction.objectStore('wordlist');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const word of words) {
        store.put(word);
      }
    });
  }

  /**
   * Bulk insert synonyms
   */
  async bulkInsertSynonyms(synonyms: Synonym[]): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['synonyms'], 'readwrite');
      const store = transaction.objectStore('synonyms');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const synonym of synonyms) {
        store.add(synonym);
      }
    });
  }

  /**
   * Bulk insert verb forms
   */
  async bulkInsertVerbForms(verbs: VerbForm[]): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['verb_forms'], 'readwrite');
      const store = transaction.objectStore('verb_forms');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const verb of verbs) {
        store.put(verb);
      }
    });
  }

  /**
   * Bulk insert noun plurals
   */
  async bulkInsertNounPlurals(plurals: NounPlural[]): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['noun_plurals'], 'readwrite');
      const store = transaction.objectStore('noun_plurals');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const plural of plurals) {
        store.put(plural);
      }
    });
  }

  /**
   * Bulk insert POS tags
   */
  async bulkInsertPOSTags(tags: POSTag[]): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pos_tags'], 'readwrite');
      const store = transaction.objectStore('pos_tags');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const tag of tags) {
        store.add(tag);
      }
    });
  }

  /**
   * Clear all data (for re-importing)
   */
  async clearAllData(): Promise<void> {
    await this.initialize();
    if (!this.db) return;

    const stores = ['wordlist', 'synonyms', 'verb_forms', 'noun_plurals', 'pos_tags'];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(stores, 'readwrite');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const storeName of stores) {
        transaction.objectStore(storeName).clear();
      }
    });
  }
}

// Singleton instance
export const englishLexicalService = new EnglishLexicalService();
