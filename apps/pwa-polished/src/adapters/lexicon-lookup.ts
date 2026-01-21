/**
 * Lexicon Lookup System
 * Handles lookups across the consolidated lexical pack and dictionary pack
 */

import { openDB } from './db.js';

export interface Definition {
  id: number;
  word_id: number;
  pos: string | null;
  sense_number: string | null;
  definition_order: number;
  definition: string;
  example: string | null;
  etymology?: string | null;
  raw_etymology?: string | null;
  tags?: string | null;
  search_tokens?: string | null;
  source: string;
  source_url?: string | null;
}

export interface EnglishWordEntry {
  id: string | number;
  word: string;
  ipa_us: string | null;
  ipa_uk: string | null;
  pos: string | null;
  synonyms: string[];
  antonyms: string[];
  grammar?: any;
  modern: Definition[];
  historic: Definition[];
}

export interface LexiconEntry {
  strongs?: string;
  lemma?: string;
  transliteration?: string;
  definition?: string;
  shortDefinition?: string;
  partOfSpeech?: string;
  language?: 'greek' | 'hebrew' | 'english';
  derivation?: string;
  kjvUsage?: string;
}

export interface MorphologyEntry {
  translation: string;
  book: string;
  chapter: number;
  verse: number;
  wordOrder: number;
  word: string;
  lemma: string | null;
  strongsId: string | null;
  morphCode: string | null;
}

/**
 * Look up a word across all lexical resources
 * Strategy:
 * 1. Check morphology table for Strong's IDs associated with this word
 * 2. Look up those Strong's numbers in greek_strongs_entries / hebrew_strongs_entries
 * 3. Return combined results
 */
export async function lookupWord(word: string): Promise<LexiconEntry[]> {
  const db = await openDB();
  const results: LexiconEntry[] = [];
  
  try {
    // Step 1: Find Strong's IDs from morphology table using the 'word' index
    const strongsIds = await new Promise<Set<string>>((resolve) => {
      const tx = db.transaction('morphology', 'readonly');
      const store = tx.objectStore('morphology');
      
      // Check if 'word' index exists, otherwise fall back to scanning
      let hasWordIndex = false;
      try {
        store.index('word');
        hasWordIndex = true;
      } catch (e) {
        console.log('Morphology word index not found, scanning all records');
      }
      
      const strongsSet = new Set<string>();
      
      if (hasWordIndex) {
        const index = store.index('word');
        const request = index.openCursor(IDBKeyRange.only(word.toLowerCase()));
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const morph = cursor.value as any;
            if (morph.strongs_id) {
              strongsSet.add(morph.strongs_id);
            }
            cursor.continue();
          } else {
            resolve(strongsSet);
          }
        };
        
        request.onerror = () => resolve(strongsSet);
      } else {
        // Fall back to scanning all morphology records
        const request = store.openCursor();
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const morph = cursor.value as any;
            if (morph.word && morph.word.toLowerCase() === word.toLowerCase() && morph.strongs_id) {
              strongsSet.add(morph.strongs_id);
            }
            cursor.continue();
          } else {
            resolve(strongsSet);
          }
        };
        
        request.onerror = () => resolve(strongsSet);
      }
    });
    
    // Step 2: Look up each Strong's ID
    for (const strongsId of strongsIds) {
      const entry = await lookupStrongs(strongsId);
      if (entry) {
        results.push(entry);
      }
    }
    
    // Step 3: If no Strong's found, try lexicon_entries by lemma
    if (results.length === 0) {
      const lemmaEntry = await lookupLemma(word);
      if (lemmaEntry) {
        results.push(lemmaEntry);
      }
    }
    
  } catch (error) {
    console.error('Error in lexicon lookup:', error);
  }
  
  return results;
}

/**
 * Look up a Strong's number (e.g., "G2424" or "H430")
 */
export async function lookupStrongs(strongsId: string): Promise<LexiconEntry | null> {
  const db = await openDB();
  
  try {
    // Determine if Greek or Hebrew
    const isGreek = strongsId.startsWith('G');
    const tableName = isGreek ? 'greek_strongs_entries' : 'hebrew_strongs_entries';
    
    return new Promise<LexiconEntry | null>((resolve) => {
      const tx = db.transaction(tableName, 'readonly');
      const store = tx.objectStore(tableName);
      const request = store.get(strongsId);
      
      request.onsuccess = () => {
        const row = request.result;
        if (row) {
          resolve({
            strongs: row.id,
            lemma: row.lemma,
            transliteration: row.transliteration,
            definition: row.definition,
            shortDefinition: row.shortDefinition,
            partOfSpeech: row.partOfSpeech,
            language: row.language,
            derivation: row.derivation,
            kjvUsage: row.kjvUsage
          });
        } else {
          resolve(null);
        }
      };
      
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    console.error('Error looking up Strong\'s:', error);
    return null;
  }
}

/**
 * Look up a lemma in lexicon_entries
 */
export async function lookupLemma(lemma: string): Promise<LexiconEntry | null> {
  const db = await openDB();
  
  try {
    return new Promise<LexiconEntry | null>((resolve) => {
      const tx = db.transaction('lexicon_entries', 'readonly');
      const store = tx.objectStore('lexicon_entries');
      
      // Check if 'lemma' index exists
      let hasLemmaIndex = false;
      try {
        store.index('lemma');
        hasLemmaIndex = true;
      } catch (e) {
        console.log('Lexicon lemma index not found');
      }
      
      if (hasLemmaIndex) {
        const index = store.index('lemma');
        const request = index.get(lemma);
        
        request.onsuccess = () => {
          const row = request.result;
          if (row) {
            resolve({
              lemma: row.lemma,
              transliteration: row.transliteration,
              definition: row.definition,
              language: row.language
            });
          } else {
            resolve(null);
          }
        };
        
        request.onerror = () => resolve(null);
      } else {
        resolve(null);
      }
    });
  } catch (error) {
    console.error('Error looking up lemma:', error);
    return null;
  }
}

/**
 * Look up an English word and return detailed lexical data
 */
export async function lookupEnglishWord(word: string): Promise<EnglishWordEntry | null> {
  console.log('🔍 lookupEnglishWord called with:', word);
  
  try {
    const db = await openDB();
    console.log('✅ DB opened successfully');
    
    const normalizedWord = word.toLowerCase();
    console.log('📝 Normalized word:', normalizedWord);
    
    // Look up the word in english_words
    const wordData = await new Promise<any>((resolve) => {
      console.log('🔄 Starting english_words transaction...');
      const tx = db.transaction('english_words', 'readonly');
      const store = tx.objectStore('english_words');
      
      let hasWordIndex = false;
      try {
        store.index('word');
        hasWordIndex = true;
        console.log('✅ Found "word" index');
      } catch (e) {
        console.log('⚠️ English words index not found, scanning records');
      }
      
      if (hasWordIndex) {
        const index = store.index('word');
        const request = index.get(normalizedWord);
        console.log('🔍 Querying index for:', normalizedWord);
        
        request.onsuccess = () => {
          console.log('✅ Index query complete, result:', request.result);
          resolve(request.result);
        };
        request.onerror = () => {
          console.error('❌ Index query error:', request.error);
          resolve(null);
        };
      } else {
        // Scan all records
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (cursor.value.word === normalizedWord) {
              resolve(cursor.value);
            } else {
              cursor.continue();
            }
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      }
    });
    
    console.log('📦 Word data retrieved:', wordData);
    
    if (!wordData) {
      console.log('❌ No word data found for:', normalizedWord);
      return null;
    }
    
    console.log('✅ Found word data:', wordData);
    
    const entry: EnglishWordEntry = {
      id: wordData.id,
      word: wordData.word,
      ipa_us: wordData.ipa_us,
      ipa_uk: wordData.ipa_uk,
      pos: wordData.pos,
      synonyms: [],
      antonyms: [],
      modern: [],
      historic: []
    };
    
    // Look up synonyms from thesaurus using index
    console.log('🔍 Looking up synonyms for:', normalizedWord);
    const synonyms = await new Promise<string[]>((resolve) => {
      const tx = db.transaction('thesaurus_synonyms', 'readonly');
      const store = tx.objectStore('thesaurus_synonyms');
      const index = store.index('word');
      const request = index.getAll(normalizedWord);
      
      request.onsuccess = () => {
        const results = request.result || [];
        const syns = results.map((r: any) => r.synonym);
        console.log(`✅ Found ${syns.length} synonyms`);
        resolve(syns);
      };
      request.onerror = () => {
        console.log('❌ Synonym lookup failed');
        resolve([]);
      };
    });
    
    entry.synonyms = synonyms;
    
    // Look up antonyms from thesaurus using index
    console.log('🔍 Looking up antonyms for:', normalizedWord);
    const antonyms = await new Promise<string[]>((resolve) => {
      const tx = db.transaction('thesaurus_antonyms', 'readonly');
      const store = tx.objectStore('thesaurus_antonyms');
      const index = store.index('word');
      const request = index.getAll(normalizedWord);
      
      request.onsuccess = () => {
        const results = request.result || [];
        const ants = results.map((r: any) => r.antonym);
        console.log(`✅ Found ${ants.length} antonyms`);
        resolve(ants);
      };
      request.onerror = () => {
        console.log('❌ Antonym lookup failed');
        resolve([]);
      };
    });
    
    entry.antonyms = antonyms;
    
    // Look up grammar info using index
    console.log('🔍 Looking up grammar for:', normalizedWord);
    const grammar = await new Promise<any>((resolve) => {
      const tx = db.transaction('english_grammar', 'readonly');
      const store = tx.objectStore('english_grammar');
      const index = store.index('word');
      const request = index.get(normalizedWord);
      
      request.onsuccess = () => {
        const result = request.result;
        console.log('✅ Grammar lookup complete:', result ? 'found' : 'not found');
        resolve(result || null);
      };
      request.onerror = () => {
        console.log('❌ Grammar lookup failed');
        resolve(null);
      };
    });
    
    entry.grammar = grammar;
    
    // Look up modern definitions (Wiktionary)
    console.log('🔍 Looking up modern definitions for word_id:', wordData.id);
    const modernDefs = await new Promise<Definition[]>((resolve) => {
      // Check if dictionary pack is installed
      if (!db.objectStoreNames.contains('english_definitions_modern')) {
        console.log('⚠️ Dictionary pack not installed');
        resolve([]);
        return;
      }
      
      const tx = db.transaction('english_definitions_modern', 'readonly');
      const store = tx.objectStore('english_definitions_modern');
      const index = store.index('word_id');
      const request = index.getAll(wordData.id);
      
      request.onsuccess = () => {
        const results = (request.result || []) as Definition[];
        // Sort by definition_order to preserve source ordering
        results.sort((a, b) => a.definition_order - b.definition_order);
        console.log(`✅ Found ${results.length} modern definitions`);
        resolve(results);
      };
      request.onerror = () => {
        console.log('❌ Modern definitions lookup failed');
        resolve([]);
      };
    });
    
    entry.modern = modernDefs;
    
    // Look up historic definitions (GCIDE/Webster 1913)
    console.log('🔍 Looking up historic definitions for word_id:', wordData.id);
    const historicDefs = await new Promise<Definition[]>((resolve) => {
      // Check if dictionary pack is installed
      if (!db.objectStoreNames.contains('english_definitions_historic')) {
        console.log('⚠️ Dictionary pack not installed');
        resolve([]);
        return;
      }
      
      const tx = db.transaction('english_definitions_historic', 'readonly');
      const store = tx.objectStore('english_definitions_historic');
      const index = store.index('word_id');
      const request = index.getAll(wordData.id);
      
      request.onsuccess = () => {
        const results = (request.result || []) as Definition[];
        // Sort by definition_order to preserve source ordering
        results.sort((a, b) => a.definition_order - b.definition_order);
        console.log(`✅ Found ${results.length} historic definitions`);
        resolve(results);
      };
      request.onerror = () => {
        console.log('❌ Historic definitions lookup failed');
        resolve([]);
      };
    });
    
    entry.historic = historicDefs;
    
    console.log('✅ Returning complete entry with', entry.synonyms.length, 'synonyms,', entry.modern.length, 'modern defs,', entry.historic.length, 'historic defs');
    return entry;
  } catch (error) {
    console.error('Error looking up English word:', error);
    return null;
  }
}

/**
 * Get morphology data for a specific verse
 */
export async function getMorphology(
  translation: string,
  book: string,
  chapter: number,
  verse: number
): Promise<MorphologyEntry[]> {
  const db = await openDB();
  
  try {
    return new Promise<MorphologyEntry[]>((resolve) => {
      const tx = db.transaction('morphology', 'readonly');
      const store = tx.objectStore('morphology');
      const index = store.index('translation_book_chapter_verse'); // Assumes composite index
      
      const key = [translation.toLowerCase(), book, chapter, verse];
      const request = index.getAll(IDBKeyRange.only(key));
      
      request.onsuccess = () => {
        const rows = request.result || [];
        const entries: MorphologyEntry[] = rows.map((row: any) => ({
          translation: row.translation_id,
          book: row.book,
          chapter: row.chapter,
          verse: row.verse,
          wordOrder: row.word_order,
          word: row.word,
          lemma: row.lemma,
          strongsId: row.strongs_id,
          morphCode: row.morph_code
        }));
        
        resolve(entries.sort((a, b) => a.wordOrder - b.wordOrder));
      };
      
      request.onerror = () => resolve([]);
    });
  } catch (error) {
    console.error('Error getting morphology:', error);
    return [];
  }
}
