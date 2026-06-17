/**
 * Lexicon Lookup System
 * Handles lookups across the consolidated lexical pack and dictionary pack
 */

import { openDB } from './db.js';
import { dictionaryCache } from '../lib/lru-cache.js';

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
  wordset: Definition[];
}

export interface LexiconEntry {
  strongs?: string;
  lemma?: string;
  transliteration?: string;
  phonetic?: string;
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
      
      const toEntry = (row: any): LexiconEntry => ({
        strongs: row.id,
        lemma: row.lemma,
        transliteration: row.transliteration,
        phonetic: row.phonetic ?? undefined,
        definition: row.definition,
        shortDefinition: row.shortDefinition,
        partOfSpeech: row.partOfSpeech,
        language: row.language,
        derivation: row.derivation,
        kjvUsage: row.kjvUsage,
      });

      request.onsuccess = () => {
        const row = request.result;
        if (row) {
          resolve(toEntry(row));
        } else {
          // Try zero-padded fallback: 'G976' → 'G0976'.
          // The lexical pack stores Strong's keys zero-padded to 4 digits
          // (e.g. 'G0976') but OpenGNT omits leading zeros (e.g. 'G976').
          const m = strongsId.match(/^([GH])(\d+)$/);
          if (m && m[2].length < 4) {
            const padded = m[1] + m[2].padStart(4, '0');
            const req2 = store.get(padded);
            req2.onsuccess = () => resolve(req2.result ? toEntry(req2.result) : null);
            req2.onerror = () => resolve(null);
          } else {
            resolve(null);
          }
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
  
  const normalizedWord = word.toLowerCase();
  
  // Check cache first
  const cached = dictionaryCache.get(normalizedWord);
  if (cached) {
    console.log('✅ Cache hit for:', normalizedWord);
    return cached;
  }
  
  try {
    const db = await openDB();
    console.log('✅ DB opened successfully');
    
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
    
    let dictionaryWordId: number | null = null;
    if (db.objectStoreNames.contains('word_mapping')) {
      console.log('🔍 Looking up dictionary word mapping for:', normalizedWord);
      dictionaryWordId = await new Promise<number | null>((resolve) => {
        const tx = db.transaction('word_mapping', 'readonly');
        const store = tx.objectStore('word_mapping');
        const request = store.get(normalizedWord);
        request.onsuccess = () => resolve(request.result?.word_id ?? null);
        request.onerror = () => resolve(null);
      });
    } else {
      console.log('⚠️ word_mapping store not found');
    }

    if (!wordData && !dictionaryWordId) {
      console.log('❌ No word data or dictionary mapping found for:', normalizedWord);
      return null;
    }
    
    if (wordData) {
      console.log('✅ Found word data:', wordData);
    }
    
    const entry: EnglishWordEntry = {
      id: wordData?.id ?? dictionaryWordId ?? normalizedWord,
      word: wordData?.word ?? normalizedWord,
      ipa_us: wordData?.ipa_us ?? null,
      ipa_uk: wordData?.ipa_uk ?? null,
      pos: wordData?.pos ?? null,
      synonyms: [],
      antonyms: [],
      modern: [],
      historic: [],
      wordset: []
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
    const definitionWordId = dictionaryWordId ?? wordData?.id ?? null;
    if (!definitionWordId) {
      console.log('⚠️ No word_id available for definitions');
    }

    console.log('🔍 Looking up modern definitions for word_id:', definitionWordId);
    const modernDefs = await new Promise<Definition[]>((resolve) => {
      // Check if dictionary pack is installed
      if (!db.objectStoreNames.contains('english_definitions_modern')) {
        console.log('⚠️ Dictionary pack not installed');
        resolve([]);
        return;
      }

      if (!definitionWordId) {
        resolve([]);
        return;
      }
      
      const tx = db.transaction('english_definitions_modern', 'readonly');
      const store = tx.objectStore('english_definitions_modern');
      const index = store.index('word_id');
      const request = index.getAll(definitionWordId);
      
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
    console.log('🔍 Looking up historic definitions for word_id:', definitionWordId);
    const historicDefs = await new Promise<Definition[]>((resolve) => {
      // Check if dictionary pack is installed
      if (!db.objectStoreNames.contains('english_definitions_historic')) {
        console.log('⚠️ Dictionary pack not installed');
        resolve([]);
        return;
      }

      if (!definitionWordId) {
        resolve([]);
        return;
      }
      
      const tx = db.transaction('english_definitions_historic', 'readonly');
      const store = tx.objectStore('english_definitions_historic');
      const index = store.index('word_id');
      const request = index.getAll(definitionWordId);
      
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

    // Look up Concise definitions (Wordset) — shown alongside modern and historic
    if (definitionWordId) {
      console.log('🔍 Looking up Concise (Wordset) definitions for word_id:', definitionWordId);
      const wordsetDefs = await new Promise<Definition[]>((resolve) => {
        if (!db.objectStoreNames.contains('english_definitions_wordset')) {
          resolve([]);
          return;
        }

        const tx = db.transaction('english_definitions_wordset', 'readonly');
        const store = tx.objectStore('english_definitions_wordset');
        const index = store.index('word_id');
        const request = index.getAll(definitionWordId);

        request.onsuccess = () => {
          const results = (request.result || []) as Definition[];
          results.sort((a, b) => a.definition_order - b.definition_order);
          console.log(`✅ Found ${results.length} Concise (Wordset) definitions`);
          resolve(results);
        };
        request.onerror = () => {
          console.log('❌ Concise (Wordset) lookup failed');
          resolve([]);
        };
      });
      entry.wordset = wordsetDefs;
    }

    console.log('✅ Returning complete entry with', entry.synonyms.length, 'synonyms,', entry.modern.length, 'modern defs,', entry.historic.length, 'historic defs,', entry.wordset.length, 'wordset defs');
    
    // Cache the result
    dictionaryCache.set(normalizedWord, entry);
    
    return entry;
  } catch (error) {
    console.error('Error looking up English word:', error);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Biblical character (people) lookup
 * ------------------------------------------------------------------ */

export interface PersonRecord {
  id: string;
  name: string;
  displayTitle?: string;
  alsoCalled?: string;
  gender?: string;
  nameMeaning?: string;
  birthYear?: number | null;
  deathYear?: number | null;
  birthPlace?: { name: string; slug?: string; lat?: number | null; lon?: number | null } | null;
  deathPlace?: { name: string; slug?: string; lat?: number | null; lon?: number | null } | null;
  memberOf?: string[];
  father?: { id: string; name: string }[];
  mother?: { id: string; name: string }[];
  partners?: { id: string; name: string }[];
  children?: { id: string; name: string }[];
  siblings?: { id: string; name: string }[];
  dictText?: string;
  dictLink?: string;
  verseCount?: number;
}

export interface PersonLookupResult {
  person: PersonRecord;
  alternates: PersonRecord[]; // other people sharing the clicked name
  matchedByVerse: boolean;    // true when the current verse disambiguated the match
}

export interface VerseRef { book: string; chapter: number; verse: number }

function parseJsonArray(v: any): any[] {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}
function parseJsonObj(v: any): any | null {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

function toPersonRecord(row: any): PersonRecord {
  return {
    id: row.id,
    name: row.name,
    displayTitle: row.displayTitle,
    alsoCalled: row.alsoCalled,
    gender: row.gender,
    nameMeaning: row.nameMeaning,
    birthYear: row.birthYear ?? null,
    deathYear: row.deathYear ?? null,
    birthPlace: parseJsonObj(row.birthPlace),
    deathPlace: parseJsonObj(row.deathPlace),
    memberOf: parseJsonArray(row.memberOf),
    father: parseJsonArray(row.father),
    mother: parseJsonArray(row.mother),
    partners: parseJsonArray(row.partners),
    children: parseJsonArray(row.children),
    siblings: parseJsonArray(row.siblings),
    dictText: row.dictText,
    dictLink: row.dictLink,
    verseCount: row.verseCount,
  };
}

/**
 * Look up a clicked word as a biblical character.
 *
 * Resolution strategy:
 *   1. Find candidate people whose name / alt-name / token matches the word.
 *   2. If a verse ref is supplied, prefer the candidate(s) whose verse list
 *      contains that verse (handles homonyms like the six Marys).
 *   3. Fall back to the most-mentioned candidate when the verse doesn't decide.
 *
 * Returns null when the word matches no person (so callers fall back to the
 * normal dictionary definition).
 */
export async function lookupPerson(word: string, ref?: VerseRef | null): Promise<PersonLookupResult | null> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return null;

  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('person_names')) return null;

    // 1. Candidate person IDs sharing this name
    const candidateIds = await new Promise<string[]>((resolve) => {
      const tx = db.transaction('person_names', 'readonly');
      const index = tx.objectStore('person_names').index('nameLower');
      const request = index.getAll(IDBKeyRange.only(normalized));
      request.onsuccess = () => resolve([...new Set((request.result || []).map((r: any) => r.personId))]);
      request.onerror = () => resolve([]);
    });
    if (!candidateIds.length) return null;

    // 2. Verse-context disambiguation.
    // When we know the verse, REQUIRE the person to actually appear in it — this
    // is what distinguishes a clicked name from a coincidental common word (e.g.
    // "mother") and picks the right homonym (e.g. which of the six Marys).
    let matchedIds: string[] = [];
    if (ref && db.objectStoreNames.contains('person_verses')) {
      const atVerse = await new Promise<Set<string>>((resolve) => {
        const tx = db.transaction('person_verses', 'readonly');
        const index = tx.objectStore('person_verses').index('book_chapter_verse');
        const request = index.getAll(IDBKeyRange.only([ref.book, ref.chapter, ref.verse]));
        request.onsuccess = () => resolve(new Set((request.result || []).map((r: any) => r.personId)));
        request.onerror = () => resolve(new Set());
      });
      matchedIds = candidateIds.filter((id) => atVerse.has(id));
      // No person with this name appears in the clicked verse → not a character here.
      if (matchedIds.length === 0) return null;
    }

    // 3. Fetch all candidate records (to rank by prominence / verseCount)
    const records = (await Promise.all(
      candidateIds.map((id) => new Promise<PersonRecord | null>((resolve) => {
        const tx = db.transaction('people', 'readonly');
        const request = tx.objectStore('people').get(id);
        request.onsuccess = () => resolve(request.result ? toPersonRecord(request.result) : null);
        request.onerror = () => resolve(null);
      }))
    )).filter((r): r is PersonRecord => r !== null);
    if (!records.length) return null;

    const byProminence = (a: PersonRecord, b: PersonRecord) => (b.verseCount ?? 0) - (a.verseCount ?? 0);

    const matchedByVerse = matchedIds.length > 0;
    const primarySet = matchedByVerse ? records.filter((r) => matchedIds.includes(r.id)) : records;
    primarySet.sort(byProminence);
    const person = primarySet[0];
    const alternates = records.filter((r) => r.id !== person.id).sort(byProminence);

    return { person, alternates, matchedByVerse };
  } catch (error) {
    console.error('Error looking up person:', error);
    return null;
  }
}

/**
 * Get all verse appearances for a person, ordered canonically by storage order.
 */
export async function getPersonVerses(personId: string): Promise<VerseRef[]> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('person_verses')) return [];
    return await new Promise<VerseRef[]>((resolve) => {
      const tx = db.transaction('person_verses', 'readonly');
      const index = tx.objectStore('person_verses').index('personId');
      const request = index.getAll(IDBKeyRange.only(personId));
      request.onsuccess = () => resolve((request.result || []).map((r: any) => ({
        book: r.book, chapter: r.chapter, verse: r.verse,
      })));
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
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
