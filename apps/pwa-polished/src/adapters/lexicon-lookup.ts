/**
 * Lexicon Lookup System
 * Handles lookups across the consolidated lexical pack and dictionary pack
 */

import { openDB } from './db.js';
import { dictionaryCache } from '../lib/lru-cache.js';
import { normalizeBookName } from '../lib/bibleData.js';

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
  /** Words sharing this one's Louw-Nida sense, precomputed at pack-build time.
   *  Greek only — the domain tagging comes from the Greek NT. */
  related?: RelatedWords;
}

/** Two tiers: the same sense, then the surrounding area of meaning. */
export interface RelatedWord {
  id: string;
  lemma: string;
  gloss: string;
}

export interface RelatedWords {
  sense: RelatedWord[];
  area: RelatedWord[];
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
/** Stored as JSON in the pack so the tab is a read rather than a scan. */
function parseRelated(raw: unknown): RelatedWords | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const sense = Array.isArray(parsed?.sense) ? parsed.sense : [];
    const area = Array.isArray(parsed?.area) ? parsed.area : [];
    return sense.length || area.length ? { sense, area } : undefined;
  } catch {
    return undefined;
  }
}

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
        related: parseRelated(row.related),
      });

      request.onsuccess = () => {
        const row = request.result;
        if (row) {
          resolve(toEntry(row));
          return;
        }
        // Ids reach us in three shapes and the lexicon is keyed in one:
        //   'G976'    OpenGNT drops leading zeros
        //   'G0976'   the lexical pack pads to four digits
        //   'G2424G'  STEPBible disambiguates homographs with a letter suffix,
        //             separating Ἰησοῦς-as-Jesus from Ἰησοῦς-as-Joshua
        // Try padding first, then fall back to the undisambiguated entry so a
        // suffixed id that has no distinct headword still resolves to its base
        // word rather than to nothing.
        const m = strongsId.match(/^([GH])(\d+)([A-Za-z]?)$/);
        if (!m) {
          resolve(null);
          return;
        }
        const [, prefix, digits, suffix] = m;
        const candidates = [
          prefix + digits.padStart(4, '0') + suffix,
          suffix ? prefix + digits.padStart(4, '0') : '',
        ].filter((id) => id && id !== strongsId);

        const tryNext = (i: number) => {
          if (i >= candidates.length) {
            resolve(null);
            return;
          }
          const req = store.get(candidates[i]);
          req.onsuccess = () =>
            req.result ? resolve(toEntry(req.result)) : tryNext(i + 1);
          req.onerror = () => tryNext(i + 1);
        };
        tryNext(0);
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
/**
 * Ordered base-form candidates for a word, most-specific first (never includes
 * the word itself). Data-driven plural→singular folding shared by the dictionary
 * and encyclopedia lookups so a clicked word folds the same way in both — e.g.
 * "hebrews"→"hebrew", "cities"→"city", "wolves"→"wolf". Callers try the exact
 * form first, then these, and keep the first that actually matches an index, so
 * an over-eager candidate ("amorit" from "amorites") simply never resolves.
 */
export function singularCandidates(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const push = (s: string) => {
    if (s && s !== w && s.length > 2 && !out.includes(s)) out.push(s);
  };
  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y');          // cities -> city
  if (w.endsWith('ves')) { push(w.slice(0, -3) + 'f'); push(w.slice(0, -3) + 'fe'); } // wolves->wolf, knives->knife
  if (w.endsWith('es')) push(w.slice(0, -2));                 // boxes -> box
  if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1)); // hebrews -> hebrew
  return out;
}

/** Exact lemma → dictionary word_id via the word_mapping store, or null. */
async function wordMappingId(db: IDBDatabase, lemma: string): Promise<number | null> {
  if (!db.objectStoreNames.contains('word_mapping')) return null;
  return new Promise<number | null>((resolve) => {
    const req = db.transaction('word_mapping', 'readonly').objectStore('word_mapping').get(lemma);
    req.onsuccess = () => resolve(req.result?.word_id ?? null);
    req.onerror = () => resolve(null);
  });
}

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
      dictionaryWordId = await wordMappingId(db, normalizedWord);
      // Proper nouns and plurals aren't lemmas in the dictionary; fold to the
      // singular so "hebrews" shows the "hebrew" definitions instead of blank.
      if (dictionaryWordId == null) {
        for (const cand of singularCandidates(normalizedWord)) {
          dictionaryWordId = await wordMappingId(db, cand);
          if (dictionaryWordId != null) break;
        }
      }
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
      id: dictionaryWordId ?? wordData?.id ?? normalizedWord,
      word: wordData?.word ?? normalizedWord,
      ipa_us: wordData?.ipa_us ?? null,
      ipa_uk: wordData?.ipa_uk ?? null,
      pos: wordData?.pos ?? null,
      modern: [],
      historic: [],
      wordset: []
    };
    
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
    
    // Definitions are keyed ONLY by the dictionary's own word_mapping id. The
    // word-list id (wordData.id) lives in a different, unrelated id space, so
    // using it here would fetch a numerically-coincident but wrong word's
    // definitions (this is what showed "spotty" for "hebrews").
    const definitionWordId = dictionaryWordId;
    if (!definitionWordId) {
      console.log('⚠️ No word_id available for definitions');
    }

    // Wiktionary "modern" definitions are intentionally NOT loaded — that source
    // carried crude example sentences unfit for a Bible app. The Concise (Wordset)
    // dictionary now fills the "Modern" slot; see entry.wordset below. `entry.modern`
    // stays empty so any lingering Wiktionary rows in a previously-installed pack's
    // IndexedDB store are never surfaced.
    entry.modern = [];

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

    console.log('✅ Returning complete entry with', entry.modern.length, 'modern defs,', entry.historic.length, 'historic defs,', entry.wordset.length, 'wordset defs');
    
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

/**
 * A named relative. The pack writes these as `{ name, slug }`, where the slug
 * IS the other person's id — so a family tree is walkable. `id` is kept for
 * callers that were written against the older shape.
 */
export interface PersonRelation {
  slug?: string;
  id?: string;
  name: string;
}

/** The other person's id, whichever key this row happens to carry it under. */
export function relationId(rel: PersonRelation | null | undefined): string | null {
  return rel?.slug ?? rel?.id ?? null;
}

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
  father?: PersonRelation[];
  mother?: PersonRelation[];
  partners?: PersonRelation[];
  children?: PersonRelation[];
  siblings?: PersonRelation[];
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
  return (await resolveClickedPersonId(word, ref)) !== null;
}

/**
 * The same test, but handing back which character it landed on.
 *
 * The toast only ever needed a yes/no, but the ring's Map seat has to go on to
 * ask where that person's story happens, and re-running the disambiguation to
 * find out would be doing the work twice.
 */
export async function resolveClickedPersonId(
  word: string,
  ref?: VerseRef | null,
): Promise<string | null> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return null;

  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('person_names')) return null;

    const candidateIds = await new Promise<string[]>((resolve) => {
      const tx = db.transaction('person_names', 'readonly');
      const index = tx.objectStore('person_names').index('nameLower');
      const request = index.getAll(IDBKeyRange.only(normalized));
      request.onsuccess = () => resolve([...new Set((request.result || []).map((r: any) => r.personId))]);
      request.onerror = () => resolve([]);
    });
    if (!candidateIds.length) return null;
    if (!ref || !db.objectStoreNames.contains('person_verses')) return candidateIds[0];

    const atVerse = await new Promise<Set<string>>((resolve) => {
      const tx = db.transaction('person_verses', 'readonly');
      const index = tx.objectStore('person_verses').index('book_chapter_verse');
      const request = index.getAll(IDBKeyRange.only([ref.book, ref.chapter, ref.verse]));
      request.onsuccess = () => resolve(new Set((request.result || []).map((r: any) => r.personId)));
      request.onerror = () => resolve(new Set());
    });
    const hit = candidateIds.find((id) => atVerse.has(id));
    if (hit) return hit;

    for (const id of candidateIds) {
      const verses = await getPersonVerses(id);
      if (verses.some((v) => v.book === ref.book && v.chapter === ref.chapter)) return id;
    }
    return null;
  } catch {
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

/** Every place carrying this exact name, phrases included. Phrase-only lookups
 *  go through the in-memory index above instead. */
async function isbePlaceIdsByName(nameLower: string): Promise<string[]> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_place_names')) return [];
  return new Promise((resolve) => {
    const tx = db.transaction('isbe_place_names', 'readonly');
    const idx = tx.objectStore('isbe_place_names').index('nameLower');
    const req = idx.getAll(IDBKeyRange.only(nameLower));
    req.onsuccess = () => {
      const rows = (req.result || []) as any[];
      resolve([...new Set(rows.map((r) => r.placeId))]);
    };
    req.onerror = () => resolve([]);
  });
}

/**
 * The multi-word place names, held in memory after the first read.
 *
 * The phrase pass in resolveIsbeClick tries up to nine spans around the clicked
 * word, and each one used to be its own IndexedDB round-trip. On the first tap
 * of a session those run against a cold database, and the answer can land after
 * the radial menu has already sized itself — at which point the menu will not
 * take a new seat, so Map silently goes missing until something else warms the
 * indexes. The whole phrase index is about a thousand rows, so it is cheaper to
 * hold all of it than to keep asking.
 */
let isbePhraseIndex: Map<string, string[]> | null = null;
let isbePhraseLoad: Promise<void> | null = null;

async function loadIsbePhraseIndex(): Promise<void> {
  if (isbePhraseIndex) return;
  if (isbePhraseLoad) return isbePhraseLoad;
  isbePhraseLoad = (async () => {
    const index = new Map<string, string[]>();
    try {
      const db = await openDB();
      if (db.objectStoreNames.contains('isbe_place_names')) {
        const rows = await new Promise<any[]>((resolve) => {
          const req = db
            .transaction('isbe_place_names', 'readonly')
            .objectStore('isbe_place_names')
            .getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
        for (const r of rows) {
          if (!r.isPhrase || typeof r.nameLower !== 'string') continue;
          const ids = index.get(r.nameLower);
          if (ids) {
            if (!ids.includes(r.placeId)) ids.push(r.placeId);
          } else {
            index.set(r.nameLower, [r.placeId]);
          }
        }
      }
    } catch {
      // Pack not installed. An empty index simply skips the phrase pass.
    }
    isbePhraseIndex = index;
  })();
  return isbePhraseLoad;
}

/**
 * Every located place, keyed by the verse it appears in.
 *
 * Built once and kept, for the same reason as the phrase index: working out
 * which places a person's story touches means asking about every verse they
 * appear in, and someone like David appears in hundreds. As one query each that
 * is unusable; the whole table is about nine thousand rows, so it is cheaper to
 * hold it and intersect in memory.
 */
let isbeVersePlaces: Map<string, string[]> | null = null;
let isbePlacesById: Map<string, IsbePlaceRecord> | null = null;
let isbeVersePlacesLoad: Promise<void> | null = null;

const verseKey = (book: string, chapter: number, verse: number) => `${book}|${chapter}|${verse}`;

/** Pull a whole store into memory. Both of these are small enough to hold. */
async function getAllRows(db: IDBDatabase, storeName: string): Promise<any[]> {
  if (!db.objectStoreNames.contains(storeName)) return [];
  return new Promise((resolve) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function loadIsbeVersePlaces(): Promise<void> {
  if (isbeVersePlaces && isbePlacesById) return;
  if (isbeVersePlacesLoad) return isbeVersePlacesLoad;
  isbeVersePlacesLoad = (async () => {
    const index = new Map<string, string[]>();
    const byId = new Map<string, IsbePlaceRecord>();
    try {
      const db = await openDB();
      for (const r of await getAllRows(db, 'isbe_place_verses')) {
        const key = verseKey(r.book, r.chapter, r.verse);
        const ids = index.get(key);
        if (ids) {
          if (!ids.includes(r.placeId)) ids.push(r.placeId);
        } else {
          index.set(key, [r.placeId]);
        }
      }
      // The gazetteer itself, so resolving a person's places costs no further
      // round-trips once we know which ids they touch.
      for (const p of await getAllRows(db, 'isbe_places')) byId.set(p.placeId, p as IsbePlaceRecord);
    } catch {
      // Pack not installed.
    }
    isbeVersePlaces = index;
    isbePlacesById = byId;
  })();
  return isbeVersePlacesLoad;
}

/** Pins past this stop telling you anything about the person. */
const MAX_PERSON_PLACES = 24;

/** A located place tied to a person, ready to pin on the map. */
export interface PersonPlace {
  name: string;
  latitude: number;
  longitude: number;
  modernName?: string | null;
  placeType?: string | null;
}

/**
 * The places a person's story touches, for the map.
 *
 * Their birth and death places are the most precise answer but the people pack
 * only carries them for a few dozen of three thousand, so the body of the
 * result is the places named in the verses they appear in. That is a looser
 * claim — a place sharing a verse is not necessarily somewhere they went — but
 * it is the connection the text itself makes, and it is what makes the map
 * worth opening for more than the famous few.
 */
export async function getPersonPlaces(personId: string): Promise<PersonPlace[]> {
  const out: PersonPlace[] = [];
  const seen = new Set<string>();
  const add = (p: PersonPlace) => {
    const key = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };

  try {
    const person = await getPersonById(personId);
    for (const anchor of [person?.birthPlace, person?.deathPlace]) {
      if (anchor && anchor.lat != null && anchor.lon != null) {
        add({ name: anchor.name, latitude: anchor.lat, longitude: anchor.lon });
      }
    }

    await loadIsbeVersePlaces();
    if (isbeVersePlaces?.size) {
      const verses = await getPersonVerses(personId);
      const placeIds = new Set<string>();
      for (const v of verses) {
        for (const id of isbeVersePlaces.get(verseKey(v.book, v.chapter, v.verse)) ?? []) {
          placeIds.add(id);
        }
      }
      const places = [...placeIds]
        .map((id) => isbePlacesById?.get(id))
        .filter((p): p is IsbePlaceRecord => !!p);
      // Most-referenced first, so the cap keeps the places that matter. Someone
      // like David touches far more than a map can say anything with; past a
      // couple of dozen pins the picture stops being about them at all.
      places.sort((a, b) => (b.verseCount ?? 0) - (a.verseCount ?? 0));
      for (const p of places) {
        if (out.length >= MAX_PERSON_PLACES) break;
        if (p.latitude == null || p.longitude == null) continue;
        add({
          name: p.primaryName,
          latitude: p.latitude,
          longitude: p.longitude,
          modernName: p.modernName,
          placeType: p.type,
        });
      }
    }
  } catch (error) {
    console.error('Error collecting places for person:', error);
  }

  return out;
}

/**
 * Open the ISBE indexes before the first word is tapped.
 *
 * Called from the reader on mount. The radial menu only grows a Map seat if the
 * lookup answers while it is still drawing, so the first tap of a session must
 * not be the one that pays for opening the database.
 */
export async function warmIsbeLookup(): Promise<void> {
  try {
    await openDB();
    // Both indexes, because both feed the Map seat: the phrase index for a
    // clicked place, the verse/place tables for a clicked character. Leaving
    // either cold just moves the same missing-seat problem to the first tap of
    // that kind.
    await Promise.all([loadIsbePhraseIndex(), loadIsbeVersePlaces()]);
  } catch {
    // Nothing to warm — the click path degrades on its own.
  }
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
  // Exact forms first, then plural→singular folds so "Hebrews" reaches the
  // "HEBREW; HEBREWESS" article. The first form that actually matches wins.
  const folded = singularCandidates(word).flatMap((c) => [c, isbeNorm(c)]);
  const variants = [...new Set([word.trim().toLowerCase(), isbeNorm(word), ...folded])].filter(Boolean);
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
    await loadIsbePhraseIndex();

    // 1. Phrase expansion. Build a small window around the click and try the
    //    longest multi-word place name that includes the clicked word. The
    //    candidate spans are tested against the in-memory index, so this whole
    //    pass costs no database round-trips unless one of them actually hits.
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
        const ids = isbePhraseIndex?.get(span) ?? [];
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

    // 2. Single-word place. Try the exact form, then plural→singular folds.
    //    Require at least chapter evidence so ordinary words ("sea", "city")
    //    don't masquerade as a place they don't belong to.
    if (selfNorm) {
      const placeForms = [...new Set([selfNorm, ...singularCandidates(word).map(isbeNorm)])].filter(Boolean);
      for (const form of placeForms) {
        const ids = await isbePlaceIdsByName(form);
        if (!ids.length) continue;
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
      if (entry) {
        // A place article that step 2 turned down for want of verse coverage is
        // still a place — OpenBible's verse index is thinner than the gazetteer,
        // and the article itself already knows. Take it back as a place when it
        // has somewhere to put on the map, so the ring offers Map rather than
        // the weaker Info for the same word.
        if (entry.isPlace) {
          const place = await getIsbePlaceByEntryId(entryId);
          if (place && place.latitude != null && place.longitude != null) {
            return {
              kind: 'place',
              entryId,
              placeId: place.placeId,
              primaryName: place.primaryName,
              matchedByVerse: false,
            };
          }
        }
        return { kind: 'entry', entryId, primaryName: entry.primaryName };
      }
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
async function isbeGetEntryMeta(
  entryId: number,
): Promise<{ primaryName: string; isPlace: boolean } | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entries')) return null;
  return new Promise((resolve) => {
    const req = db.transaction('isbe_entries', 'readonly').objectStore('isbe_entries').get(entryId);
    req.onsuccess = () =>
      resolve(
        req.result
          ? { primaryName: (req.result as any).primaryName, isPlace: !!(req.result as any).isPlace }
          : null,
      );
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

/**
 * Which of these names are real ISBE articles? Used to linkify the ALL-CAPS
 * cross-references an article writes as plain prose ("see KIDRON") — a whole
 * article's worth of candidates in one readonly pass, rather than a query each.
 * Maps each name that resolved to the indexed name it resolved to, so the link
 * can carry a target the click handler is guaranteed to find again.
 */
export async function resolveIsbeEntryNames(names: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entry_names')) return found;

  const idx = db.transaction('isbe_entry_names', 'readonly').objectStore('isbe_entry_names').index('nameLower');
  const exact = (v: string) =>
    new Promise<string | null>((resolve) => {
      const req = idx.getKey(IDBKeyRange.only(v));
      req.onsuccess = () => resolve(req.result != null ? v : null);
      req.onerror = () => resolve(null);
    });
  // Articles are titled "MAIN, QUALIFIER", so prose that points at the bare
  // "PSALMS" is after "PSALMS, BOOK OF". The comma keeps this from wandering
  // into merely similar names.
  const byPrefix = (v: string) =>
    new Promise<string | null>((resolve) => {
      const req = idx.openKeyCursor(IDBKeyRange.bound(`${v},`, `${v},￿`));
      req.onsuccess = () => resolve((req.result?.key as string) ?? null);
      req.onerror = () => resolve(null);
    });

  // Every request is issued up front so they all share the one transaction.
  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const raw = name.trim().toLowerCase();
      // Names are indexed twice, verbatim and punctuation-folded, so a raw miss
      // can still land ("BETH-SHEMESH" -> "beth shemesh").
      const norm = isbeNorm(name);
      const tries = [exact(raw), norm && norm !== raw ? exact(norm) : null, byPrefix(raw)];
      const results = await Promise.all(tries);
      const hit = results.find((r) => r);
      if (hit) found.set(name, hit);
    }),
  );
  return found;
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
 * Every spelling a place is known by ("jerusalem", "zion", "daughter of judah").
 * The Verses tab highlights these in the verse text, so a verse linked to
 * Jerusalem that actually reads "out of Zion" still shows why it's on the list.
 */
export async function getIsbePlaceNames(placeId: string): Promise<string[]> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_place_names')) return [];
  return new Promise((resolve) => {
    const idx = db.transaction('isbe_place_names', 'readonly').objectStore('isbe_place_names').index('placeId');
    const req = idx.getAll(IDBKeyRange.only(placeId));
    req.onsuccess = () =>
      resolve([...new Set((req.result || []).map((r: any) => r.nameLower as string).filter(Boolean))]);
    req.onerror = () => resolve([]);
  });
}

/* ------------------------------------------------------------------ *
 * Library browsing
 *
 * The lookups above all start from a word you tapped. These start from
 * nothing: they walk the encyclopedia alphabetically so it can be read as a
 * book — a contents list per letter, the entry either side of the one you're
 * on, and a check of which other packs cover the same name.
 *
 * All of it rides on the `primaryNameLower` index, which the pack has always
 * carried and nothing has used until now, so there is no pack change here.
 * ------------------------------------------------------------------ */

/** One row in a contents list. Slim on purpose — a letter can be 1,000 rows. */
export interface LibraryRow {
  /** Number for encyclopedia entries, string for people ("moses_2108"). */
  id: number | string;
  name: string;
  /** The indexed lowercase name. Sorts the list and anchors prev/next. */
  sortKey: string;
  isPlace: boolean;
  /** A line of context under the name, where the source has one to give. */
  detail?: string;
  /** Filled in by annotateLibraryBadges, once the row is on screen. */
  hasBio?: boolean;
  hasDict?: boolean;
  hasEntry?: boolean;
  hasTopic?: boolean;
  /**
   * What each badge points at, alongside the flag that draws it — so tapping a
   * badge navigates straight there instead of resolving the name again and
   * possibly landing somewhere else. Named `badgeEntryId` rather than `entryId`
   * because for an encyclopedia row that would collide with the row's own `id`.
   */
  bioId?: string;
  badgeEntryId?: number;
  topicId?: number;
  /** The word the dictionary filed this under — the full name or its head. */
  dictTerm?: string;
}

export const LIBRARY_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
/** Anything not filing under A–Z — numerals, and the handful of odd titles. */
export const LIBRARY_OTHER = '#';

/** The key range covering one letter, or everything before 'a' for the # bucket. */
function letterRange(letter: string): IDBKeyRange {
  if (letter === LIBRARY_OTHER) return IDBKeyRange.upperBound('a', true);
  const lo = letter.toLowerCase();
  return IDBKeyRange.bound(lo, `${lo}￿`);
}

// A letter's rows, kept once fetched. The whole encyclopedia held this way is
// ~9,400 slim objects, so there is nothing to evict.
const letterCache = new Map<string, LibraryRow[]>();

/**
 * How many entries file under each letter, for the rail. Counts run against the
 * index directly, so no article body is read to draw it.
 */
export async function getIsbeLetterCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entries')) return out;

  const order = [...LIBRARY_LETTERS, LIBRARY_OTHER];
  const tx = db.transaction('isbe_entries', 'readonly');
  const idx = tx.objectStore('isbe_entries').index('primaryNameLower');
  const counts = await Promise.all(
    order.map(
      (letter) =>
        new Promise<number>((resolve) => {
          const req = idx.count(letterRange(letter));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(0);
        }),
    ),
  );

  // Written in alphabetical order once every count is in. The requests finish
  // out of order, so assigning as they land would leave the rail's "next
  // letter" walking the alphabet at random.
  order.forEach((letter, i) => {
    if (counts[i] > 0) out[letter] = counts[i];
  });
  return out;
}

/**
 * Every entry filing under one letter, in alphabetical order.
 *
 * This pulls whole records, article bodies included — the biggest letter is
 * about 2.7 MB, which is one quick read — and immediately keeps only the few
 * fields a list row needs, so the bodies are collectable straight after.
 */
export async function getIsbeEntriesForLetter(letter: string): Promise<LibraryRow[]> {
  const cached = letterCache.get(letter);
  if (cached) return cached;

  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entries')) return [];

  const rows = await new Promise<LibraryRow[]>((resolve) => {
    const idx = db
      .transaction('isbe_entries', 'readonly')
      .objectStore('isbe_entries')
      .index('primaryNameLower');
    const req = idx.getAll(letterRange(letter));
    req.onsuccess = () =>
      resolve(
        (req.result || []).map((r: any) => ({
          id: r.entryId as number,
          name: (r.primaryName || r.title || '') as string,
          sortKey: (r.primaryNameLower || '') as string,
          isPlace: !!r.isPlace,
        })),
      );
    req.onerror = () => resolve([]);
  });

  // getAll follows index order already; sort defensively so a row that somehow
  // lacks the indexed key can't land in the middle of the list.
  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  letterCache.set(letter, rows);
  return rows;
}

/** Which letter a name files under, for opening the contents at the right place. */
export function libraryLetterOf(sortKey: string): string {
  const first = (sortKey || '').charAt(0).toUpperCase();
  return LIBRARY_LETTERS.includes(first) ? first : LIBRARY_OTHER;
}

/**
 * The entries either side of this one alphabetically — the footer arrows.
 * Walks the index by key alone, so stepping to a neighbour costs one cursor
 * hop plus one record read, not a scan.
 */
export async function getIsbeNeighbors(
  sortKey: string,
): Promise<{ prev: LibraryRow | null; next: LibraryRow | null }> {
  const empty = { prev: null, next: null };
  if (!sortKey) return empty;
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entries')) return empty;

  const step = (direction: 'next' | 'prev') =>
    new Promise<LibraryRow | null>((resolve) => {
      const store = db.transaction('isbe_entries', 'readonly').objectStore('isbe_entries');
      const idx = store.index('primaryNameLower');
      // Open past the current key so entries sharing a name are stepped over as
      // one, rather than the arrow appearing to do nothing.
      const range =
        direction === 'next'
          ? IDBKeyRange.lowerBound(sortKey, true)
          : IDBKeyRange.upperBound(sortKey, true);
      const req = idx.openCursor(range, direction);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(null);
        const r = cursor.value as any;
        resolve({
          id: r.entryId,
          name: r.primaryName || r.title || '',
          sortKey: r.primaryNameLower || '',
          isPlace: !!r.isPlace,
        });
      };
      req.onerror = () => resolve(null);
    });

  const [prev, next] = await Promise.all([step('prev'), step('next')]);
  return { prev, next };
}

/**
 * The single word a compound name files under.
 *
 * The dictionary files single words, so an article titled "Abomination, Birds
 * Of" is looked up on "abomination". Encyclopedia titles get the same
 * treatment, since a person named "Mary, mother of Jesus" has an article filed
 * under "Mary".
 *
 * Exported because availability and the thing that opens have to agree on it —
 * a badge or tab derived from one rule and a click handler derived from another
 * is how you get an entry that lights up and then opens nothing.
 */
export function headWord(s: string): string {
  return (s || '').split(/[;,(]/)[0].trim().split(/\s+/)[0].toLowerCase();
}

/**
 * Mark which rows also have a person bio or a dictionary definition.
 *
 * Done a letter at a time rather than a row at a time: one bounded read per
 * pack gives every name in that letter, and the rows are then matched against
 * those sets in memory. A pack that isn't installed simply contributes nothing,
 * which is what makes its dots disappear rather than error.
 */
export async function annotateLibraryBadges(rows: LibraryRow[], letter: string): Promise<LibraryRow[]> {
  if (!rows.length) return rows;
  const db = await openDB();
  const range = letterRange(letter);

  /**
   * Every name in this letter from one name index, mapped to the id it belongs
   * to.
   *
   * The ids sit in the very same records the names come from, so keeping them
   * costs nothing extra — and it is what lets a badge click navigate straight
   * there rather than resolving the name a second time.
   *
   * First one wins where a name repeats, which is the same entry the list shows
   * first for that name.
   */
  const namesFrom = (store: string, idField: string) =>
    new Promise<Map<string, string | number>>((resolve) => {
      if (!db.objectStoreNames.contains(store)) return resolve(new Map());
      const idx = db.transaction(store, 'readonly').objectStore(store).index('nameLower');
      const req = idx.getAll(range);
      req.onsuccess = () => {
        const found = new Map<string, string | number>();
        for (const r of (req.result || []) as any[]) {
          if (r?.nameLower != null && r[idField] != null && !found.has(r.nameLower)) {
            found.set(r.nameLower, r[idField]);
          }
        }
        resolve(found);
      };
      req.onerror = () => resolve(new Map());
    });

  const dictWordsFrom = () =>
    new Promise<Set<string>>((resolve) => {
      if (!db.objectStoreNames.contains('word_mapping')) return resolve(new Set());
      // Keyed on the lemma itself, so the keys alone answer this — no records read.
      const req = db.transaction('word_mapping', 'readonly').objectStore('word_mapping').getAllKeys(range);
      req.onsuccess = () => resolve(new Set((req.result || []).map((k) => String(k))));
      req.onerror = () => resolve(new Set());
    });

  const [bioNames, entryNames, topicNames, dictWords] = await Promise.all([
    namesFrom('person_names', 'personId'),
    namesFrom('isbe_entry_names', 'entryId'),
    namesFrom('naves_names', 'topicId'),
    dictWordsFrom(),
  ]);

  for (const row of rows) {
    // The full name first, then the word it files under — an article titled
    // "Abomination, Birds Of" is matched on "abomination". A click has to
    // resolve on the same two, in the same order, or it dead-ends.
    const head = headWord(row.name);
    const bio = bioNames.get(row.sortKey) ?? bioNames.get(head);
    const entry = entryNames.get(row.sortKey) ?? entryNames.get(head);
    const topic = topicNames.get(row.sortKey) ?? topicNames.get(head);
    const dictTerm = dictWords.has(row.sortKey)
      ? row.sortKey
      : dictWords.has(head)
        ? head
        : undefined;

    row.hasBio = bio !== undefined;
    row.hasEntry = entry !== undefined;
    row.hasTopic = topic !== undefined;
    row.hasDict = dictTerm !== undefined;

    row.bioId = bio === undefined ? undefined : String(bio);
    row.badgeEntryId = entry === undefined ? undefined : Number(entry);
    row.topicId = topic === undefined ? undefined : Number(topic);
    row.dictTerm = dictTerm;
  }
  return rows;
}

/**
 * Contents filtered to what turns up in one chapter — the "in this chapter"
 * button. Reads the place-verse index for the chapter, then maps those places
 * back to their articles.
 */
export async function getIsbeEntriesInChapter(book: string, chapter: number): Promise<LibraryRow[]> {
  const name = normalizeBookName(book);
  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_place_verses') || !db.objectStoreNames.contains('isbe_places')) {
    return [];
  }

  const placeIds = await new Promise<string[]>((resolve) => {
    const idx = db
      .transaction('isbe_place_verses', 'readonly')
      .objectStore('isbe_place_verses')
      .index('book_chapter_verse');
    // An array sorts after any number, so this upper bound catches every verse
    // in the chapter without needing to know how many there are.
    const req = idx.getAll(IDBKeyRange.bound([name, chapter], [name, chapter, []]));
    req.onsuccess = () => resolve([...new Set((req.result || []).map((r: any) => r.placeId))]);
    req.onerror = () => resolve([]);
  });
  if (!placeIds.length) return [];

  const placeStore = db.transaction('isbe_places', 'readonly').objectStore('isbe_places');
  const entryIds = await Promise.all(
    placeIds.map(
      (id) =>
        new Promise<number | null>((resolve) => {
          const req = placeStore.get(id);
          req.onsuccess = () => resolve((req.result as any)?.entryId ?? null);
          req.onerror = () => resolve(null);
        }),
    ),
  );

  const wanted = [...new Set(entryIds.filter((id): id is number => id != null))];
  if (!wanted.length) return [];

  const entryStore = db.transaction('isbe_entries', 'readonly').objectStore('isbe_entries');
  const rows = await Promise.all(
    wanted.map(
      (id) =>
        new Promise<LibraryRow | null>((resolve) => {
          const req = entryStore.get(id);
          req.onsuccess = () => {
            const r = req.result as any;
            resolve(
              r
                ? {
                    id: r.entryId,
                    name: r.primaryName || r.title || '',
                    sortKey: r.primaryNameLower || '',
                    isPlace: !!r.isPlace,
                  }
                : null,
            );
          };
          req.onerror = () => resolve(null);
        }),
    ),
  );

  return rows
    .filter((r): r is LibraryRow => !!r)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * Title search over the encyclopedia alone, for the library's own search bar.
 * Prefix-matched against the name index so alternate spellings find the article
 * too, then deduped to one row per entry.
 */
export async function searchIsbeEntries(query: string, limit = 60): Promise<LibraryRow[]> {
  const term = query.toLowerCase().trim();
  if (term.length < 2) return [];

  const db = await openDB();
  if (!db.objectStoreNames.contains('isbe_entry_names')) return [];

  const ids = await new Promise<number[]>((resolve) => {
    const idx = db
      .transaction('isbe_entry_names', 'readonly')
      .objectStore('isbe_entry_names')
      .index('nameLower');
    const req = idx.getAll(IDBKeyRange.bound(term, `${term}￿`));
    req.onsuccess = () => resolve([...new Set((req.result || []).map((r: any) => r.entryId as number))]);
    req.onerror = () => resolve([]);
  });
  if (!ids.length) return [];

  const entryStore = db.transaction('isbe_entries', 'readonly').objectStore('isbe_entries');
  const rows = await Promise.all(
    ids.slice(0, limit * 3).map(
      (id) =>
        new Promise<(LibraryRow & { weight: number }) | null>((resolve) => {
          const req = entryStore.get(id);
          req.onsuccess = () => {
            const r = req.result as any;
            resolve(
              r
                ? {
                    id: r.entryId,
                    name: r.primaryName || r.title || '',
                    sortKey: r.primaryNameLower || '',
                    isPlace: !!r.isPlace,
                    weight: r.charCount ?? 0,
                  }
                : null,
            );
          };
          req.onerror = () => resolve(null);
        }),
    ),
  );

  return rows
    .filter((r): r is LibraryRow & { weight: number } => !!r)
    // An exact hit first, then the fuller articles — the same ranking the main
    // search uses, minus its places-always-win rule, which reads oddly in a list
    // you asked to be alphabetical elsewhere.
    .sort(
      (a, b) =>
        Number(b.sortKey === term) - Number(a.sortKey === term) ||
        b.weight - a.weight ||
        a.sortKey.localeCompare(b.sortKey),
    )
    .slice(0, limit)
    .map(({ weight: _weight, ...row }) => row);
}

/* ------------------------------------------------------------------ *
 * Nave's Topical Bible
 *
 * The topical counterpart to ISBE's prose. Where the encyclopedia explains
 * what a thing is, Nave's answers where Scripture speaks about it: an outline
 * of points, each carrying its own references. Ships in the Encyclotopical
 * pack alongside the encyclopedia.
 * ------------------------------------------------------------------ */

export interface NavesRef {
  osis: string;
  label: string;
}

/**
 * A "See OTHER TOPIC" pointer, already resolved. About one in twelve of Nave's
 * internal cross-references names a topic the module doesn't actually carry, so
 * the target is looked up once when the topic loads and the UI can show the
 * dead ones as plain text rather than a button that does nothing.
 */
export interface NavesLink {
  name: string;
  topicId: number | null;
}

/** One line of a topic's outline. Depth 0 is a top-level point, 1 a sub-point. */
export interface NavesPoint {
  seq: number;
  depth: number;
  text: string;
  refs: NavesRef[];
  links: NavesLink[];
}

export interface NavesTopicRecord {
  topicId: number;
  title: string;
  primaryName: string;
  lead: string | null;
  pointCount: number;
  refCount: number;
  points: NavesPoint[];
}

function parseNavesJson<T>(value: unknown): T[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A whole topic: its heading plus every outline point, in document order. */
export async function getNavesTopic(topicId: number): Promise<NavesTopicRecord | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_topics')) return null;

  const topic = await new Promise<any>((resolve) => {
    const req = db.transaction('naves_topics', 'readonly').objectStore('naves_topics').get(topicId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
  if (!topic) return null;

  const rawPoints = await new Promise<{ point: Omit<NavesPoint, 'links'>; linkNames: string[] }[]>(
    (resolve) => {
      if (!db.objectStoreNames.contains('naves_points')) return resolve([]);
      const idx = db.transaction('naves_points', 'readonly').objectStore('naves_points').index('topic_seq');
      // The compound (topicId, seq) index returns the outline already in order.
      // A shorter array sorts before a longer one sharing its prefix, and an
      // array sorts after any number — so this covers every seq for the topic
      // without needing to know how many points it has.
      const req = idx.getAll(IDBKeyRange.bound([topicId], [topicId, []]));
      req.onsuccess = () =>
        resolve(
          (req.result || []).map((r: any) => ({
            point: {
              seq: r.seq,
              depth: r.depth,
              text: r.text || '',
              refs: parseNavesJson<NavesRef>(r.refs),
            },
            linkNames: parseNavesJson<string>(r.links),
          })),
        );
      req.onerror = () => resolve([]);
    },
  );

  // Resolve every cross-reference once per distinct name, rather than once per
  // line — "See PRAYER" can appear a dozen times in one topic.
  const distinct = [...new Set(rawPoints.flatMap((p) => p.linkNames))];
  const resolved = new Map<string, number | null>(
    await Promise.all(
      distinct.map(async (name) => [name, await resolveNavesTopicId(name)] as [string, number | null]),
    ),
  );

  const points: NavesPoint[] = rawPoints.map(({ point, linkNames }) => ({
    ...point,
    links: linkNames.map((name) => ({ name, topicId: resolved.get(name) ?? null })),
  }));

  return {
    topicId: topic.topicId,
    title: topic.title,
    primaryName: topic.primaryName || topic.title,
    lead: topic.lead ?? null,
    pointCount: topic.pointCount ?? points.length,
    refCount: topic.refCount ?? 0,
    points,
  };
}

/** Every verse a topic cites, for its Verses tab. */
export async function getNavesVerses(topicId: number): Promise<VerseRef[]> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_verses')) return [];
  return new Promise((resolve) => {
    const idx = db.transaction('naves_verses', 'readonly').objectStore('naves_verses').index('topicId');
    const req = idx.getAll(IDBKeyRange.only(topicId));
    req.onsuccess = () =>
      resolve((req.result || []).map((r: any) => ({ book: r.book, chapter: r.chapter, verse: r.verse })));
    req.onerror = () => resolve([]);
  });
}

/**
 * Resolve a word to a topic. Used both by the cross-reference links inside a
 * topic and by the bridge buttons on the other three works, so a name folds
 * the same way here as it does everywhere else.
 */
export async function resolveNavesTopicId(word: string): Promise<number | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_names')) return null;

  const folded = singularCandidates(word).flatMap((c) => [c, isbeNorm(c)]);
  const variants = [...new Set([word.trim().toLowerCase(), isbeNorm(word), ...folded])].filter(Boolean);

  const nameIndex = () =>
    db.transaction('naves_names', 'readonly').objectStore('naves_names').index('nameLower');

  for (const v of variants) {
    const id = await new Promise<number | null>((resolve) => {
      const req = nameIndex().get(IDBKeyRange.only(v));
      req.onsuccess = () => resolve(req.result ? (req.result as any).topicId : null);
      req.onerror = () => resolve(null);
    });
    if (id != null) return id;
  }

  // Topics are titled "MAIN, QUALIFIER", so a link pointing at the bare
  // "COURTS" is after "COURTS, OF LAW". The comma keeps this from wandering
  // into merely similar names — the same fallback resolveIsbeEntryNames uses,
  // and it recovers about a hundred of Nave's internal cross-references.
  for (const v of variants) {
    const id = await new Promise<number | null>((resolve) => {
      const req = nameIndex().openCursor(IDBKeyRange.bound(`${v},`, `${v},￿`));
      req.onsuccess = () => resolve(req.result ? (req.result.value as any).topicId : null);
      req.onerror = () => resolve(null);
    });
    if (id != null) return id;
  }
  return null;
}

/** The display name for a topic id, without loading its outline. */
export async function getNavesTopicName(topicId: number): Promise<string | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_topics')) return null;
  return new Promise((resolve) => {
    const req = db.transaction('naves_topics', 'readonly').objectStore('naves_topics').get(topicId);
    req.onsuccess = () => resolve(req.result ? (req.result as any).primaryName || (req.result as any).title : null);
    req.onerror = () => resolve(null);
  });
}

export async function getNavesLetterCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_topics')) return out;

  const order = [...LIBRARY_LETTERS, LIBRARY_OTHER];
  const idx = db.transaction('naves_topics', 'readonly').objectStore('naves_topics').index('primaryNameLower');
  const counts = await Promise.all(
    order.map(
      (letter) =>
        new Promise<number>((resolve) => {
          const req = idx.count(letterRange(letter));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(0);
        }),
    ),
  );
  // Written in order once every count lands — see getIsbeLetterCounts.
  order.forEach((letter, i) => {
    if (counts[i] > 0) out[letter] = counts[i];
  });
  return out;
}

const navesLetterCache = new Map<string, LibraryRow[]>();

export async function getNavesForLetter(letter: string): Promise<LibraryRow[]> {
  // Handed back as-is, like the encyclopedia's: the only thing that writes to
  // these rows is badge annotation, which is idempotent, so letting it land in
  // the cache means revisiting a letter keeps its dots.
  const cached = navesLetterCache.get(letter);
  if (cached) return cached;

  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_topics')) return [];

  const rows = await new Promise<LibraryRow[]>((resolve) => {
    const idx = db.transaction('naves_topics', 'readonly').objectStore('naves_topics').index('primaryNameLower');
    const req = idx.getAll(letterRange(letter));
    req.onsuccess = () =>
      resolve(
        (req.result || []).map((r: any) => ({
          id: r.topicId as number,
          name: (r.primaryName || r.title || '') as string,
          sortKey: (r.primaryNameLower || '') as string,
          isPlace: false,
          detail: r.refCount ? `${r.refCount} ref${r.refCount === 1 ? '' : 's'}` : undefined,
        })),
      );
    req.onerror = () => resolve([]);
  });

  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  navesLetterCache.set(letter, rows);
  return rows;
}

export async function getNavesNeighbors(
  sortKey: string,
): Promise<{ prev: LibraryRow | null; next: LibraryRow | null }> {
  const empty = { prev: null, next: null };
  if (!sortKey) return empty;
  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_topics')) return empty;

  const step = (direction: 'next' | 'prev') =>
    new Promise<LibraryRow | null>((resolve) => {
      const idx = db.transaction('naves_topics', 'readonly').objectStore('naves_topics').index('primaryNameLower');
      const range =
        direction === 'next'
          ? IDBKeyRange.lowerBound(sortKey, true)
          : IDBKeyRange.upperBound(sortKey, true);
      const req = idx.openCursor(range, direction);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(null);
        const r = cursor.value as any;
        resolve({
          id: r.topicId,
          name: r.primaryName || r.title || '',
          sortKey: r.primaryNameLower || '',
          isPlace: false,
        });
      };
      req.onerror = () => resolve(null);
    });

  const [prev, next] = await Promise.all([step('prev'), step('next')]);
  return { prev, next };
}

export async function searchNaves(query: string, limit = 60): Promise<LibraryRow[]> {
  const term = query.toLowerCase().trim();
  if (term.length < 2) return [];

  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_names')) return [];

  const ids = await new Promise<number[]>((resolve) => {
    const idx = db.transaction('naves_names', 'readonly').objectStore('naves_names').index('nameLower');
    const req = idx.getAll(IDBKeyRange.bound(term, `${term}￿`));
    req.onsuccess = () => resolve([...new Set((req.result || []).map((r: any) => r.topicId as number))]);
    req.onerror = () => resolve([]);
  });
  if (!ids.length) return [];

  const store = db.transaction('naves_topics', 'readonly').objectStore('naves_topics');
  const rows = await Promise.all(
    ids.slice(0, limit * 3).map(
      (id) =>
        new Promise<(LibraryRow & { weight: number }) | null>((resolve) => {
          const req = store.get(id);
          req.onsuccess = () => {
            const r = req.result as any;
            resolve(
              r
                ? {
                    id: r.topicId,
                    name: r.primaryName || r.title || '',
                    sortKey: r.primaryNameLower || '',
                    isPlace: false,
                    detail: r.refCount ? `${r.refCount} refs` : undefined,
                    weight: r.refCount ?? 0,
                  }
                : null,
            );
          };
          req.onerror = () => resolve(null);
        }),
    ),
  );

  return rows
    .filter((r): r is LibraryRow & { weight: number } => !!r)
    // Exact hit first, then the topics with most to say on it.
    .sort(
      (a, b) =>
        Number(b.sortKey === term) - Number(a.sortKey === term) ||
        b.weight - a.weight ||
        a.sortKey.localeCompare(b.sortKey),
    )
    .slice(0, limit)
    .map(({ weight: _weight, ...row }) => row);
}

/** Topics citing a verse in this chapter — the "in this chapter" button. */
export async function getNavesInChapter(book: string, chapter: number): Promise<LibraryRow[]> {
  const name = normalizeBookName(book);
  const db = await openDB();
  if (!db.objectStoreNames.contains('naves_verses')) return [];

  const ids = await new Promise<number[]>((resolve) => {
    const idx = db.transaction('naves_verses', 'readonly').objectStore('naves_verses').index('book_chapter_verse');
    const req = idx.getAll(IDBKeyRange.bound([name, chapter], [name, chapter, []]));
    req.onsuccess = () => resolve([...new Set((req.result || []).map((r: any) => r.topicId as number))]);
    req.onerror = () => resolve([]);
  });
  if (!ids.length) return [];

  const store = db.transaction('naves_topics', 'readonly').objectStore('naves_topics');
  const rows = await Promise.all(
    ids.map(
      (id) =>
        new Promise<LibraryRow | null>((resolve) => {
          const req = store.get(id);
          req.onsuccess = () => {
            const r = req.result as any;
            resolve(
              r
                ? {
                    id: r.topicId,
                    name: r.primaryName || r.title || '',
                    sortKey: r.primaryNameLower || '',
                    isPlace: false,
                    detail: r.refCount ? `${r.refCount} refs` : undefined,
                  }
                : null,
            );
          };
          req.onerror = () => resolve(null);
        }),
    ),
  );

  return rows
    .filter((r): r is LibraryRow => !!r)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/* ------------------------------------------------------------------ *
 * People browsing
 *
 * The bio pack is the master list of people: 3,067 names, which is small
 * enough to hold whole. So rather than the per-letter index reads the
 * encyclopedia needs, the roster is read once and then sliced in memory —
 * letters, neighbours and search all come off the same sorted array.
 * ------------------------------------------------------------------ */

let peopleRoster: LibraryRow[] | null = null;
let peopleRosterLoading: Promise<LibraryRow[]> | null = null;

/** Every person, sorted by name. Read once per session. */
async function getPeopleRoster(): Promise<LibraryRow[]> {
  if (peopleRoster) return peopleRoster;
  // Several callers can ask at once on first open; they share the one read.
  if (peopleRosterLoading) return peopleRosterLoading;

  peopleRosterLoading = (async () => {
    const db = await openDB();
    if (!db.objectStoreNames.contains('people')) return [];
    const rows = await new Promise<LibraryRow[]>((resolve) => {
      const req = db.transaction('people', 'readonly').objectStore('people').getAll();
      req.onsuccess = () =>
        resolve(
          (req.result || []).map((r: any) => ({
            id: r.id as string,
            // The title disambiguates the twelve Marys; the bare name is what
            // files it alphabetically, so the two are kept apart.
            name: (r.displayTitle || r.name || '') as string,
            sortKey: ((r.name || r.displayTitle || '') as string).toLowerCase(),
            isPlace: false,
            detail: r.nameMeaning ? `“${r.nameMeaning}”` : undefined,
          })),
        );
      req.onerror = () => resolve([]);
    });
    rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.name.localeCompare(b.name));
    peopleRoster = rows;
    return rows;
  })();

  const result = await peopleRosterLoading;
  peopleRosterLoading = null;
  return result;
}

export async function getPeopleLetterCounts(): Promise<Record<string, number>> {
  const roster = await getPeopleRoster();
  const out: Record<string, number> = {};
  for (const letter of [...LIBRARY_LETTERS, LIBRARY_OTHER]) {
    const n = roster.filter((r) => libraryLetterOf(r.sortKey) === letter).length;
    if (n > 0) out[letter] = n;
  }
  return out;
}

export async function getPeopleForLetter(letter: string): Promise<LibraryRow[]> {
  const roster = await getPeopleRoster();
  // Copies, so badge annotation can't write flags back onto the shared roster.
  return roster.filter((r) => libraryLetterOf(r.sortKey) === letter).map((r) => ({ ...r }));
}

export async function getPeopleNeighbors(
  sortKey: string,
  id: string,
): Promise<{ prev: LibraryRow | null; next: LibraryRow | null }> {
  const roster = await getPeopleRoster();
  // Names repeat constantly here, so the id is what pins the position — going
  // by name alone would make "next" skip every other Zechariah at once.
  let i = roster.findIndex((r) => String(r.id) === id);
  if (i < 0) i = roster.findIndex((r) => r.sortKey === sortKey);
  if (i < 0) return { prev: null, next: null };
  return { prev: roster[i - 1] ?? null, next: roster[i + 1] ?? null };
}

export async function searchPeople(query: string, limit = 60): Promise<LibraryRow[]> {
  const term = query.toLowerCase().trim();
  if (term.length < 2) return [];
  const roster = await getPeopleRoster();
  return roster
    .filter((r) => r.sortKey.startsWith(term) || r.name.toLowerCase().includes(term))
    // Names that start with what you typed come before ones that merely contain it.
    .sort(
      (a, b) =>
        Number(b.sortKey.startsWith(term)) - Number(a.sortKey.startsWith(term)) ||
        a.sortKey.localeCompare(b.sortKey),
    )
    .slice(0, limit)
    .map((r) => ({ ...r }));
}

/** People who turn up in one chapter — the "in this chapter" button. */
export async function getPeopleInChapter(book: string, chapter: number): Promise<LibraryRow[]> {
  const name = normalizeBookName(book);
  const db = await openDB();
  if (!db.objectStoreNames.contains('person_verses')) return [];

  const ids = await new Promise<Set<string>>((resolve) => {
    const idx = db
      .transaction('person_verses', 'readonly')
      .objectStore('person_verses')
      .index('book_chapter_verse');
    const req = idx.getAll(IDBKeyRange.bound([name, chapter], [name, chapter, []]));
    req.onsuccess = () => resolve(new Set((req.result || []).map((r: any) => r.personId)));
    req.onerror = () => resolve(new Set());
  });
  if (!ids.size) return [];

  const roster = await getPeopleRoster();
  return roster.filter((r) => ids.has(String(r.id))).map((r) => ({ ...r }));
}

/** One person by id — for family links and opening a row from the contents. */
export async function getPersonById(personId: string): Promise<PersonRecord | null> {
  try {
    const db = await openDB();
    if (!db.objectStoreNames.contains('people')) return null;
    return await new Promise<PersonRecord | null>((resolve) => {
      const req = db.transaction('people', 'readonly').objectStore('people').get(personId);
      req.onsuccess = () => resolve(req.result ? toPersonRecord(req.result) : null);
      req.onerror = () => resolve(null);
    });
  } catch {
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

// --- The four works, resolved together -----------------------------------

/**
 * What each of the four works has for one subject, with the ids needed to open
 * them — not just booleans.
 *
 * This exists because availability used to be worked out three times per
 * component, with four different rules for deriving the term, and the answer
 * was thrown away: the header knew a topic existed but not its id, so opening
 * re-resolved from scratch and could land somewhere else. Returning the
 * resolutions means whatever lights a tab is exactly what that tab opens.
 */
export interface WorksResolution {
  /** The term the dictionary was looked up on — reuse it when opening. */
  term: string;
  /** Dictionary has an entry for `term`. */
  dict: boolean;
  /** Nave's topic, ready to open. */
  topic: { id: number; name: string } | null;
  /** Encyclopedia article or place, ready to open. */
  entry: IsbeResolution | null;
  /** Person bio, ready to open. */
  person: PersonLookupResult | null;
}

const EMPTY_WORKS: WorksResolution = {
  term: '',
  dict: false,
  topic: null,
  entry: null,
  person: null,
};

/**
 * Resolve a subject across all four works at once.
 *
 * Encyclopedia, Topical and People are asked with the full name, because their
 * own resolvers already fold plurals and multi-word phrases. Only the
 * dictionary is narrowed to `headWord`, since it files single words. A pack
 * that isn't installed contributes null rather than throwing, so the tabs
 * simply grey out.
 *
 * `ref` is the verse the subject was clicked in, where there is one — it lets
 * the person and place lookups disambiguate homonyms.
 */
export async function resolveWorks(
  name: string,
  ref?: VerseRef | null,
): Promise<WorksResolution> {
  const subject = (name || '').trim();
  if (!subject) return { ...EMPTY_WORKS };

  const term = headWord(subject);

  const [entryRes, topicRes, dictRes, personRes] = await Promise.allSettled([
    resolveIsbeClick({ word: subject, ref: ref ?? null }),
    resolveNavesTopicId(subject),
    lookupEnglishWord(term),
    lookupPerson(subject, ref ?? null),
  ]);

  const entry = entryRes.status === 'fulfilled' ? entryRes.value : null;
  const topicId = topicRes.status === 'fulfilled' ? topicRes.value : null;
  const english = dictRes.status === 'fulfilled' ? dictRes.value : null;
  const person = personRes.status === 'fulfilled' ? personRes.value : null;

  let topic: { id: number; name: string } | null = null;
  if (topicId != null) {
    topic = { id: topicId, name: (await getNavesTopicName(topicId)) ?? subject };
  }

  return {
    term,
    // An entry row can exist with no definitions attached to it, which would
    // open an empty card — so this asks whether there is anything to read.
    dict: !!(english && (english.modern?.length || english.historic?.length || english.wordset?.length)),
    topic,
    entry,
    person,
  };
}
