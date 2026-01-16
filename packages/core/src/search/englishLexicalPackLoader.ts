/**
 * English Lexical Pack Loader
 * 
 * Loads SQLite pack data into IndexedDB for offline access.
 * Handles chunked loading to avoid blocking the main thread.
 */

import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { englishLexicalService } from './englishLexicalService';
import type { WordInfo, Synonym, VerbForm, NounPlural, POSTag } from './englishLexicalService';

export interface LoadProgress {
  pack: 'wordlist' | 'thesaurus' | 'grammar';
  stage: 'downloading' | 'parsing' | 'importing' | 'complete';
  progress: number; // 0-100
  message: string;
}

const CHUNK_SIZE = 5000; // Process 5k records at a time to avoid blocking

export class EnglishLexicalPackLoader {
  private sql: any = null;

  /**
   * Initialize SQL.js
   */
  private async initSQL(): Promise<void> {
    if (this.sql) return;
    this.sql = await initSqlJs({
      locateFile: (file: string) => `/${file}`
    });
  }

  /**
   * Load a SQLite pack file from URL or ArrayBuffer
   */
  private async loadSQLiteDB(source: string | ArrayBuffer): Promise<Database> {
    await this.initSQL();

    let buffer: ArrayBuffer;
    if (typeof source === 'string') {
      const response = await fetch(source);
      buffer = await response.arrayBuffer();
    } else {
      buffer = source;
    }

    return new this.sql.Database(new Uint8Array(buffer));
  }

  /**
   * Load wordlist pack into IndexedDB
   */
  async loadWordlistPack(
    packUrl: string,
    onProgress?: (progress: LoadProgress) => void
  ): Promise<void> {
    try {
      onProgress?.({
        pack: 'wordlist',
        stage: 'downloading',
        progress: 0,
        message: 'Downloading wordlist pack...'
      });

      const db = await this.loadSQLiteDB(packUrl);

      onProgress?.({
        pack: 'wordlist',
        stage: 'parsing',
        progress: 30,
        message: 'Reading wordlist data...'
      });

      // Get total count
      const countResult = db.exec('SELECT COUNT(*) as count FROM words');
      const totalWords = countResult[0]?.values[0]?.[0] as number || 0;

      // Read all words
      const results = db.exec('SELECT word, ipa_us, ipa_uk FROM words');
      const words: WordInfo[] = [];

      if (results.length > 0) {
        const rows = results[0].values;
        for (const row of rows) {
          words.push({
            word: row[0] as string,
            ipa_us: row[1] as string | undefined,
            ipa_uk: row[2] as string | undefined
          });
        }
      }

      db.close();

      onProgress?.({
        pack: 'wordlist',
        stage: 'importing',
        progress: 60,
        message: `Importing ${totalWords.toLocaleString()} words...`
      });

      // Import in chunks
      for (let i = 0; i < words.length; i += CHUNK_SIZE) {
        const chunk = words.slice(i, i + CHUNK_SIZE);
        await englishLexicalService.bulkInsertWordlist(chunk);

        const progress = 60 + Math.floor((i / words.length) * 40);
        onProgress?.({
          pack: 'wordlist',
          stage: 'importing',
          progress,
          message: `Imported ${Math.min(i + CHUNK_SIZE, words.length).toLocaleString()} / ${totalWords.toLocaleString()} words`
        });
      }

      onProgress?.({
        pack: 'wordlist',
        stage: 'complete',
        progress: 100,
        message: `Wordlist loaded: ${totalWords.toLocaleString()} words`
      });
    } catch (error) {
      console.error('Failed to load wordlist pack:', error);
      throw error;
    }
  }

  /**
   * Load thesaurus pack into IndexedDB
   */
  async loadThesaurusPack(
    packUrl: string,
    onProgress?: (progress: LoadProgress) => void
  ): Promise<void> {
    try {
      onProgress?.({
        pack: 'thesaurus',
        stage: 'downloading',
        progress: 0,
        message: 'Downloading thesaurus pack...'
      });

      const db = await this.loadSQLiteDB(packUrl);

      onProgress?.({
        pack: 'thesaurus',
        stage: 'parsing',
        progress: 30,
        message: 'Reading synonym data...'
      });

      // Get total count
      const countResult = db.exec('SELECT COUNT(*) as count FROM synonyms');
      const totalSynonyms = countResult[0]?.values[0]?.[0] as number || 0;

      // Read all synonyms
      const results = db.exec('SELECT word, synonym FROM synonyms');
      const synonyms: Synonym[] = [];

      if (results.length > 0) {
        const rows = results[0].values;
        for (const row of rows) {
          synonyms.push({
            word: row[0] as string,
            synonym: row[1] as string
          });
        }
      }

      db.close();

      onProgress?.({
        pack: 'thesaurus',
        stage: 'importing',
        progress: 60,
        message: `Importing ${totalSynonyms.toLocaleString()} synonyms...`
      });

      // Import in chunks
      for (let i = 0; i < synonyms.length; i += CHUNK_SIZE) {
        const chunk = synonyms.slice(i, i + CHUNK_SIZE);
        await englishLexicalService.bulkInsertSynonyms(chunk);

        const progress = 60 + Math.floor((i / synonyms.length) * 40);
        onProgress?.({
          pack: 'thesaurus',
          stage: 'importing',
          progress,
          message: `Imported ${Math.min(i + CHUNK_SIZE, synonyms.length).toLocaleString()} / ${totalSynonyms.toLocaleString()} synonyms`
        });
      }

      onProgress?.({
        pack: 'thesaurus',
        stage: 'complete',
        progress: 100,
        message: `Thesaurus loaded: ${totalSynonyms.toLocaleString()} synonyms`
      });
    } catch (error) {
      console.error('Failed to load thesaurus pack:', error);
      throw error;
    }
  }

  /**
   * Load grammar pack into IndexedDB
   */
  async loadGrammarPack(
    packUrl: string,
    onProgress?: (progress: LoadProgress) => void
  ): Promise<void> {
    try {
      onProgress?.({
        pack: 'grammar',
        stage: 'downloading',
        progress: 0,
        message: 'Downloading grammar pack...'
      });

      const db = await this.loadSQLiteDB(packUrl);

      onProgress?.({
        pack: 'grammar',
        stage: 'parsing',
        progress: 30,
        message: 'Reading grammar data...'
      });

      // Load verb forms
      const verbResults = db.exec('SELECT base_form, present, past, past_participle, present_participle FROM verb_forms');
      const verbs: VerbForm[] = [];
      if (verbResults.length > 0) {
        for (const row of verbResults[0].values) {
          verbs.push({
            base_form: row[0] as string,
            present: row[1] as string,
            past: row[2] as string,
            past_participle: row[3] as string,
            present_participle: row[4] as string
          });
        }
      }

      // Load noun plurals
      const pluralResults = db.exec('SELECT singular, plural FROM noun_plurals');
      const plurals: NounPlural[] = [];
      if (pluralResults.length > 0) {
        for (const row of pluralResults[0].values) {
          plurals.push({
            singular: row[0] as string,
            plural: row[1] as string
          });
        }
      }

      // Load POS tags
      const posResults = db.exec('SELECT word, pos FROM pos_tags');
      const posTags: POSTag[] = [];
      if (posResults.length > 0) {
        for (const row of posResults[0].values) {
          posTags.push({
            word: row[0] as string,
            pos: row[1] as 'noun' | 'verb' | 'adjective' | 'adverb'
          });
        }
      }

      db.close();

      onProgress?.({
        pack: 'grammar',
        stage: 'importing',
        progress: 60,
        message: 'Importing grammar data...'
      });

      // Import all grammar data
      await englishLexicalService.bulkInsertVerbForms(verbs);
      onProgress?.({
        pack: 'grammar',
        stage: 'importing',
        progress: 75,
        message: `Imported ${verbs.length} verb forms`
      });

      await englishLexicalService.bulkInsertNounPlurals(plurals);
      onProgress?.({
        pack: 'grammar',
        stage: 'importing',
        progress: 85,
        message: `Imported ${plurals.length} noun plurals`
      });

      // Import POS tags in chunks
      for (let i = 0; i < posTags.length; i += CHUNK_SIZE) {
        const chunk = posTags.slice(i, i + CHUNK_SIZE);
        await englishLexicalService.bulkInsertPOSTags(chunk);
      }

      onProgress?.({
        pack: 'grammar',
        stage: 'complete',
        progress: 100,
        message: `Grammar loaded: ${verbs.length} verbs, ${plurals.length} plurals, ${posTags.length.toLocaleString()} POS tags`
      });
    } catch (error) {
      console.error('Failed to load grammar pack:', error);
      throw error;
    }
  }

  /**
   * Load all packs
   */
  async loadAllPacks(
    baseUrl: string,
    onProgress?: (progress: LoadProgress) => void
  ): Promise<void> {
    await this.loadWordlistPack(`${baseUrl}/english-wordlist-v1.sqlite`, onProgress);
    await this.loadThesaurusPack(`${baseUrl}/english-thesaurus-v1.sqlite`, onProgress);
    await this.loadGrammarPack(`${baseUrl}/english-grammar-v1.sqlite`, onProgress);
  }

  /**
   * Check if all packs are loaded
   */
  async arePacksLoaded(): Promise<boolean> {
    return await englishLexicalService.isDataLoaded();
  }
}

// Singleton instance
export const englishLexicalPackLoader = new EnglishLexicalPackLoader();
