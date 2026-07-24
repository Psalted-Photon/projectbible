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

// Memo cache for Strong's-id → transliteration lookups. null = looked up, not found.
const translitCache = new Map<string, string | null>();

/**
 * Batch-resolve transliterations for a set of Strong's ids (e.g. "G976", "H0430").
 * Returns a map containing only the ids that resolved to a non-empty transliteration.
 * Results are memoized for the session, so repeat chapters cost nothing.
 */
export async function getStrongsTransliterations(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter((id) => id && !translitCache.has(id));

  await Promise.all(
    unique.map(async (id) => {
      const entry = await lookupStrongs(id);
      translitCache.set(id, entry?.transliteration || null);
    }),
  );

  const result = new Map<string, string>();
  for (const id of new Set(ids)) {
    const translit = translitCache.get(id);
    if (translit) result.set(id, translit);
  }
  return result;
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
  /** How the match was established — 'verse' is exact, 'chapter' is the widened tier. */
  matchTier?: 'verse' | 'chapter' | 'name';
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

    // 2. Context disambiguation, in two tiers.
    // Tier 1 — the person appears in the exact clicked verse. Best signal: it
    // picks the right homonym (e.g. which of the six Marys).
    // Tier 2 — the person appears anywhere in the clicked chapter. Theographic's
    // per-verse links are sparse (Abraham is linked in Genesis 18 at v6 and v7 but
    // not v1-3, where the text plainly names him), so tier 1 alone silently drops
    // real matches.
    // Requiring at least chapter-level evidence is what still distinguishes a
    // clicked name from a coincidental common word — "mother", "son", "father",
    // "king", "word", "judge" and "prophet" are all real person names in the index.
    let matchedIds: string[] = [];
    let tier: 'verse' | 'chapter' | 'name' = 'name';
    if (ref && db.objectStoreNames.contains('person_verses')) {
      const atVerse = await new Promise<Set<string>>((resolve) => {
        const tx = db.transaction('person_verses', 'readonly');
        const index = tx.objectStore('person_verses').index('book_chapter_verse');
        const request = index.getAll(IDBKeyRange.only([ref.book, ref.chapter, ref.verse]));
        request.onsuccess = () => resolve(new Set((request.result || []).map((r: any) => r.personId)));
        request.onerror = () => resolve(new Set());
      });
      matchedIds = candidateIds.filter((id) => atVerse.has(id));
      tier = 'verse';

      if (matchedIds.length === 0) {
        // Widen to the chapter. Candidates are few (1-5), and the personId index
        // makes each list cheap, so this stays a handful of indexed reads.
        const inChapter = await Promise.all(
          candidateIds.map(async (id) => {
            const verses = await getPersonVerses(id);
            return verses.some((v) => v.book === ref.book && v.chapter === ref.chapter) ? id : null;
          }),
        );
        matchedIds = inChapter.filter((id): id is string => id !== null);
        tier = 'chapter';
      }

      // Nobody with this name appears anywhere in the clicked chapter → not a
      // character here, so callers fall back to the dictionary definition.
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

    const matchedByContext = matchedIds.length > 0;
    const primarySet = matchedByContext ? records.filter((r) => matchedIds.includes(r.id)) : records;
    primarySet.sort(byProminence);
    const person = primarySet[0];
    const alternates = records.filter((r) => r.id !== person.id).sort(byProminence);

    return {
      person,
      alternates,
      // Only an exact verse hit counts as verse-confirmed; a chapter-tier match
      // narrowed the field but can't promise this is the person in this verse.
      matchedByVerse: matchedByContext && tier === 'verse',
      matchTier: matchedByContext ? tier : 'name',
    };
  } catch (error) {
    console.error('Error looking up person:', error);
    return null;
  }
}

/**
 * Cheap "is this clicked word a biblical character?" test for the selection toast,
 * so the button can read "Bio" instead of "Define".
 *
 * Applies the same two-tier gate as lookupPerson (exact verse, then chapter) but
 * skips loading the full person records, so the label never promises a bio that
 * the modal won't show.
 */
export async function isPersonName(word: string, ref?: VerseRef | null): Promise<boolean> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return false;

  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('person_names')) return false;

    const candidateIds = await new Promise<string[]>((resolve) => {
      const tx = db.transaction('person_names', 'readonly');
      const index = tx.objectStore('person_names').index('nameLower');
      const request = index.getAll(IDBKeyRange.only(normalized));
      request.onsuccess = () => resolve([...new Set((request.result || []).map((r: any) => r.personId))]);
      request.onerror = () => resolve([]);
    });
    if (!candidateIds.length) return false;
    if (!ref || !db.objectStoreNames.contains('person_verses')) return true;

    const atVerse = await new Promise<Set<string>>((resolve) => {
      const tx = db.transaction('person_verses', 'readonly');
      const index = tx.objectStore('person_verses').index('book_chapter_verse');
      const request = index.getAll(IDBKeyRange.only([ref.book, ref.chapter, ref.verse]));
      request.onsuccess = () => resolve(new Set((request.result || []).map((r: any) => r.personId)));
      request.onerror = () => resolve(new Set());
    });
    if (candidateIds.some((id) => atVerse.has(id))) return true;

    for (const id of candidateIds) {
      const verses = await getPersonVerses(id);
      if (verses.some((v) => v.book === ref.book && v.chapter === ref.chapter)) return true;
    }
    return false;
  } catch {
    return false;
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

/* ------------------------------------------------------------------ *
 * ISBE encyclopedia + geolocated places lookup
 *
 * Resolves a clicked word to either a biblical place (possibly via a multi-word
 * phrase like "Red Sea") or a general ISBE encyclopedia entry. Powers the
 * toast's "More Info" label and the place/entry modal. Verse context
 * disambiguates places that share a surface name, using the same two-tier gate
 * (exact verse, then chapter) as the people lookup above.
 * ------------------------------------------------------------------ */

export interface IsbeEntryRecord {
  entryId: number;
  title: string;
  primaryName: string;
  bodyHtml: string;
  lead: string | null;
  outline: { i: number; t: string }[] | null;
  charCount: number;
  isPlace: boolean;
}

export interface IsbePlaceRecord {
  placeId: string;
  primaryName: string;
  entryId: number | null;
  type: string | null;
  latitude: number | null;
  longitude: number | null;
  modernName: string | null;
  precedingArticle: string | null;
  verseCount: number;
}

/** Lightweight result for the toast + modal open (no article body). */
export interface IsbeResolution {
  kind: 'place' | 'entry';
  entryId: number | null;   // ISBE article id, if any
  placeId?: string;         // resolved place, when kind === 'place'
  primaryName: string;      // display name
  phrase?: string;          // the multi-word phrase that matched, if any
  matchedByVerse?: boolean; // place confirmed by the exact clicked verse
}

/** Context captured at click time so phrase expansion can see neighbouring words. */
export interface IsbeClickContext {
  word: string;
  before?: string[];  // preceding words in reading order (nearest last)
  after?: string[];   // following words in reading order (nearest first)
  ref?: VerseRef | null;
}

// Normalize a token/name the same way build-isbe-pack.mjs does: lowercase,
// non-alphanumerics to spaces, collapsed. Keeps clicked spans aligned with the
// stored place-name and entry-name indexes.
function isbeNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([0-9]+\)\s*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function isbePlaceIdsByName(nameLower: string, phraseOnly: boolean): Promise<string[]> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_place_names')) return [];
  return new Promise((resolve) => {
    const tx = db.transaction('isbe_place_names', 'readonly');
    const idx = tx.objectStore('isbe_place_names').index('nameLower');
    const req = idx.getAll(IDBKeyRange.only(nameLower));
    req.onsuccess = () => {
      const rows = (req.result || []) as any[];
      const filtered = phraseOnly ? rows.filter((r) => r.isPhrase) : rows;
      resolve([...new Set(filtered.map((r) => r.placeId))]);
    };
    req.onerror = () => resolve([]);
  });
}

async function isbeGetPlace(placeId: string): Promise<IsbePlaceRecord | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_places')) return null;
  return new Promise((resolve) => {
    const req = db.transaction('isbe_places', 'readonly').objectStore('isbe_places').get(placeId);
    req.onsuccess = () => resolve((req.result as IsbePlaceRecord) || null);
    req.onerror = () => resolve(null);
  });
}

async function isbePlaceIdsAtVerse(ref: VerseRef): Promise<Set<string>> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_place_verses')) return new Set();
  return new Promise((resolve) => {
    const idx = db
      .transaction('isbe_place_verses', 'readonly')
      .objectStore('isbe_place_verses')
      .index('book_chapter_verse');
    const req = idx.getAll(IDBKeyRange.only([ref.book, ref.chapter, ref.verse]));
    req.onsuccess = () => resolve(new Set((req.result || []).map((r: any) => r.placeId)));
    req.onerror = () => resolve(new Set());
  });
}

async function isbePlaceInChapter(placeId: string, ref: VerseRef): Promise<boolean> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_place_verses')) return false;
  return new Promise((resolve) => {
    const idx = db
      .transaction('isbe_place_verses', 'readonly')
      .objectStore('isbe_place_verses')
      .index('placeId');
    const req = idx.getAll(IDBKeyRange.only(placeId));
    req.onsuccess = () =>
      resolve((req.result || []).some((v: any) => v.book === ref.book && v.chapter === ref.chapter));
    req.onerror = () => resolve(false);
  });
}

async function isbeEntryIdByName(word: string): Promise<number | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entry_names')) return null;
  const variants = [...new Set([word.trim().toLowerCase(), isbeNorm(word)])].filter(Boolean);
  for (const v of variants) {
    const id = await new Promise<number | null>((resolve) => {
      const idx = db.transaction('isbe_entry_names', 'readonly').objectStore('isbe_entry_names').index('nameLower');
      const req = idx.get(IDBKeyRange.only(v));
      req.onsuccess = () => resolve(req.result ? (req.result as any).entryId : null);
      req.onerror = () => resolve(null);
    });
    if (id != null) return id;
  }
  return null;
}

// Pick the best place among candidates sharing a name, gated by verse then chapter,
// falling back to the most-referenced place. Returns the chosen place + whether the
// exact verse confirmed it.
async function isbeChoosePlace(
  placeIds: string[],
  ref: VerseRef | null,
  requireChapter: boolean,
): Promise<{ place: IsbePlaceRecord; matchedByVerse: boolean } | null> {
  if (!placeIds.length) return null;
  const places = (await Promise.all(placeIds.map(isbeGetPlace))).filter(
    (p): p is IsbePlaceRecord => p !== null,
  );
  if (!places.length) return null;
  const byRefs = (a: IsbePlaceRecord, b: IsbePlaceRecord) => (b.verseCount ?? 0) - (a.verseCount ?? 0);

  if (ref) {
    const atVerse = await isbePlaceIdsAtVerse(ref);
    const verseHits = places.filter((p) => atVerse.has(p.placeId)).sort(byRefs);
    if (verseHits.length) return { place: verseHits[0], matchedByVerse: true };

    const chapterHits: IsbePlaceRecord[] = [];
    for (const p of places) if (await isbePlaceInChapter(p.placeId, ref)) chapterHits.push(p);
    if (chapterHits.length) return { place: chapterHits.sort(byRefs)[0], matchedByVerse: false };

    // No verse or chapter evidence. For single common words this is too weak to
    // claim it's the place; for an explicit multi-word phrase it's still a match.
    if (requireChapter) return null;
  }
  return { place: places.sort(byRefs)[0], matchedByVerse: false };
}

/**
 * Resolve a clicked word to an ISBE place or entry.
 *
 * Order: multi-word place phrase (suppresses everything else) → single-word place
 * (verse/chapter-gated) → general encyclopedia entry (exact title). Returns null
 * when nothing matches, so callers fall back to the dictionary definition.
 */
export async function resolveIsbeClick(ctx: IsbeClickContext): Promise<IsbeResolution | null> {
  const word = (ctx.word || '').trim();
  if (!word) return null;
  const ref = ctx.ref || null;

  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('isbe_entry_names')) return null; // pack not installed

    // 1. Phrase expansion. Build a small window around the click and try the
    //    longest multi-word place name that includes the clicked word.
    const before = (ctx.before || []).map(isbeNorm);
    const after = (ctx.after || []).map(isbeNorm);
    const selfNorm = isbeNorm(word);
    const window = [...before, selfNorm, ...after];
    const clickIdx = before.length;
    const MAX_PHRASE = 4;
    for (let len = Math.min(MAX_PHRASE, window.length); len >= 2; len--) {
      for (let start = Math.max(0, clickIdx - len + 1); start + len <= window.length && start <= clickIdx; start++) {
        const span = window.slice(start, start + len).filter(Boolean).join(' ').trim();
        if (!span.includes(' ')) continue;
        const ids = await isbePlaceIdsByName(span, true);
        if (ids.length) {
          const chosen = await isbeChoosePlace(ids, ref, false);
          if (chosen) {
            return {
              kind: 'place',
              entryId: chosen.place.entryId,
              placeId: chosen.place.placeId,
              primaryName: chosen.place.primaryName,
              phrase: span,
              matchedByVerse: chosen.matchedByVerse,
            };
          }
        }
      }
    }

    // 2. Single-word place. Require at least chapter evidence so ordinary words
    //    ("sea", "city") don't masquerade as a place they don't belong to.
    if (selfNorm) {
      const ids = await isbePlaceIdsByName(selfNorm, false);
      if (ids.length) {
        const chosen = await isbeChoosePlace(ids, ref, true);
        if (chosen) {
          return {
            kind: 'place',
            entryId: chosen.place.entryId,
            placeId: chosen.place.placeId,
            primaryName: chosen.place.primaryName,
            matchedByVerse: chosen.matchedByVerse,
          };
        }
      }
    }

    // 3. General encyclopedia entry (exact title / alternate spelling).
    const entryId = await isbeEntryIdByName(word);
    if (entryId != null) {
      const entry = await isbeGetEntryMeta(entryId);
      if (entry) return { kind: 'entry', entryId, primaryName: entry.primaryName };
    }

    return null;
  } catch (error) {
    console.error('Error resolving ISBE click:', error);
    return null;
  }
}

/** Cheap-ish kind check for the toast label. Returns 'place' | 'entry' | null. */
export async function classifyIsbeClick(ctx: IsbeClickContext): Promise<'place' | 'entry' | null> {
  const res = await resolveIsbeClick(ctx);
  return res ? res.kind : null;
}

/** Entry metadata without the (potentially huge) body — for the toast + list rows. */
async function isbeGetEntryMeta(entryId: number): Promise<{ primaryName: string } | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entries')) return null;
  return new Promise((resolve) => {
    const req = db.transaction('isbe_entries', 'readonly').objectStore('isbe_entries').get(entryId);
    req.onsuccess = () => resolve(req.result ? { primaryName: (req.result as any).primaryName } : null);
    req.onerror = () => resolve(null);
  });
}

/** Full ISBE entry incl. body_html — for the modal Article tab. */
export async function getIsbeEntry(entryId: number): Promise<IsbeEntryRecord | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entries')) return null;
  return new Promise((resolve) => {
    const req = db.transaction('isbe_entries', 'readonly').objectStore('isbe_entries').get(entryId);
    req.onsuccess = () => {
      const r = req.result as any;
      if (!r) return resolve(null);
      resolve({
        entryId: r.entryId,
        title: r.title,
        primaryName: r.primaryName,
        bodyHtml: r.bodyHtml,
        lead: r.lead ?? null,
        outline: r.outline ? JSON.parse(r.outline) : null,
        charCount: r.charCount,
        isPlace: !!r.isPlace,
      });
    };
    req.onerror = () => resolve(null);
  });
}

/** Resolve an ISBE entry by exact title/alternate spelling (for internal cross-ref links). */
export async function getIsbeEntryByName(name: string): Promise<IsbeEntryRecord | null> {
  const id = await isbeEntryIdByName(name);
  return id != null ? getIsbeEntry(id) : null;
}

/** Full place record (coords, type, modern name) + its verse list — for the modal. */
export async function getIsbePlace(placeId: string): Promise<IsbePlaceRecord | null> {
  return isbeGetPlace(placeId);
}

/** Representative place for an ISBE entry id (for opening a place from a search hit). */
export async function getIsbePlaceByEntryId(entryId: number): Promise<IsbePlaceRecord | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_places')) return null;
  return new Promise((resolve) => {
    const idx = db.transaction('isbe_places', 'readonly').objectStore('isbe_places').index('entryId');
    const req = idx.getAll(IDBKeyRange.only(entryId));
    req.onsuccess = () => {
      const rows = (req.result || []) as IsbePlaceRecord[];
      if (!rows.length) return resolve(null);
      // Prefer the most-referenced place sharing this entry.
      rows.sort((a, b) => (b.verseCount ?? 0) - (a.verseCount ?? 0));
      resolve(rows[0]);
    };
    req.onerror = () => resolve(null);
  });
}

export async function getIsbePlaceVerses(placeId: string): Promise<VerseRef[]> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_place_verses')) return [];
  return new Promise((resolve) => {
    const idx = db.transaction('isbe_place_verses', 'readonly').objectStore('isbe_place_verses').index('placeId');
    const req = idx.getAll(IDBKeyRange.only(placeId));
    req.onsuccess = () =>
      resolve((req.result || []).map((r: any) => ({ book: r.book, chapter: r.chapter, verse: r.verse })));
    req.onerror = () => resolve([]);
  });
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
