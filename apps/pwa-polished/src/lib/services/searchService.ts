import { IndexedDBSearchIndex } from '../../adapters/SearchIndex';
import { normalizeBookName } from '../bibleData';
import { openDB } from '../../adapters/db';
import { IndexedDBUserDataStore } from '../../adapters/UserDataStore';
import { IndexedDBJournalStore } from '../../adapters/JournalStore';

export type SearchCategoryKey =
  | 'bible'
  | 'strongs'
  | 'notes'
  | 'journal'
  | 'saved'
  | 'characters'
  | 'commentaries';

export interface SearchResult {
  type: 'verse' | 'strongs' | 'note' | 'journal' | 'saved' | 'character' | 'commentary';
  title: string;
  subtitle?: string;
  reference?: string;
  /** Subgroup label inside the category — author, Strong's number, and so on. */
  group?: string;
  data: any;
  score: number; // relevance score
}

export interface SearchCategory {
  key: SearchCategoryKey;
  name: string;
  count: number;
  results: SearchResult[];
  /** Render the group even at zero results (Saved Verses, until that ships). */
  alwaysShow?: boolean;
  /** Results were capped — the count is what we're showing, not what exists. */
  truncated?: boolean;
}

export interface SearchOptions {
  /** Verse-result cap. -1 loads everything. */
  limit?: number;
  /**
   * Run the categories that are too expensive for type-ahead (commentaries
   * cursors ~89k rows). Set for an explicit Enter/Search press only.
   */
  deep?: boolean;
}

/** Per-category caps, so one huge category can't bury the others. */
const CATEGORY_LIMIT = 200;
const COMMENTARY_SCAN_LIMIT = 400;
const STRONGS_VERSE_LIMIT = 500;

/** Matches G26, g0026, H430 — a Strong's number typed straight into the box. */
const STRONGS_QUERY = /^([GgHh])\s*0*(\d{1,4})$/;

/**
 * The morphology pack is inconsistent about zero-padding: Greek rows store
 * `G976`, Hebrew rows store `H0121`. Try both so either spelling finds its
 * verses. Mirrors the padding fallback in adapters/lexicon-lookup.ts.
 */
function strongsVariants(prefix: string, digits: string): string[] {
  const bare = `${prefix}${String(Number(digits))}`;
  const padded = `${prefix}${String(Number(digits)).padStart(4, '0')}`;
  return bare === padded ? [bare] : [bare, padded];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trim to a window around the first match so long entries stay scannable. */
function snippet(text: string, term: string, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at === -1) return `${text.slice(0, maxLength)}…`;
  const start = Math.max(0, at - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function getAll<T>(store: IDBObjectStore | IDBIndex, range?: IDBKeyRange): Promise<T[]> {
  return new Promise((resolve) => {
    const request = range ? store.getAll(range) : store.getAll();
    request.onsuccess = () => resolve((request.result || []) as T[]);
    request.onerror = () => resolve([]);
  });
}

export class UnifiedSearchService {
  private static instance: UnifiedSearchService;
  private searchIndex: IndexedDBSearchIndex;
  private userData = new IndexedDBUserDataStore();
  private journal = new IndexedDBJournalStore();

  private constructor() {
    this.searchIndex = new IndexedDBSearchIndex();
  }

  static getInstance(): UnifiedSearchService {
    if (!UnifiedSearchService.instance) {
      UnifiedSearchService.instance = new UnifiedSearchService();
    }
    return UnifiedSearchService.instance;
  }

  /**
   * Search everything the app holds, one category per source.
   *
   * `limit` keeps the old signature working (callers pass a number); pass an
   * options object to opt into the deep categories.
   */
  async search(query: string, limit?: number | SearchOptions): Promise<SearchCategory[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const options: SearchOptions = typeof limit === 'object' && limit !== null ? limit : { limit };

    // Don't lowercase regex patterns - they contain special characters like \W that would break
    const normalizedQuery = query.trim();

    // Every category is independent, so fetch them together rather than
    // serially — the slowest one sets the pace instead of their sum.
    const [verses, strongs, notes, journal, characters, commentaries] = await Promise.all([
      this.searchVerses(normalizedQuery, options.limit),
      this.searchStrongs(normalizedQuery),
      this.searchNotes(normalizedQuery),
      this.searchJournal(normalizedQuery),
      this.searchCharacters(normalizedQuery),
      options.deep ? this.searchCommentaries(normalizedQuery) : Promise.resolve([]),
    ]);

    const categories: SearchCategory[] = [
      { key: 'bible', name: 'Bible', count: verses.length, results: verses },
      { key: 'strongs', name: "Strong's", count: strongs.length, results: strongs },
      { key: 'notes', name: 'Notes', count: notes.length, results: notes },
      { key: 'journal', name: 'Journal', count: journal.length, results: journal },
      // Saved verses aren't built yet — the group shows 0 and lights up on its own.
      { key: 'saved', name: 'Saved Verses', count: 0, results: [], alwaysShow: true },
      { key: 'characters', name: 'Biblical Characters', count: characters.length, results: characters },
      { key: 'commentaries', name: 'Commentaries', count: commentaries.length, results: commentaries },
    ];

    return categories.filter((c) => c.count > 0 || c.alwaysShow);
  }

  // ── Bible ────────────────────────────────────────────────────────────────

  private async searchVerses(query: string, limit: number = 250): Promise<SearchResult[]> {
    try {
      const dbResults = await this.searchIndex.search(query);

      // Limit results (default 250, or all if limit is -1)
      const resultLimit = limit === -1 ? dbResults.length : limit;

      return dbResults.slice(0, resultLimit).map((result, index) => ({
        type: 'verse' as const,
        title: `${normalizeBookName(result.book)} ${result.chapter}:${result.verse}`,
        subtitle: result.snippet || result.text,
        reference: `${normalizeBookName(result.book)} ${result.chapter}:${result.verse}`,
        data: {
          book: normalizeBookName(result.book),
          chapter: result.chapter,
          verse: result.verse,
          translation: result.translation
        },
        score: 1.0 - (index / 100), // Simple relevance scoring
      }));
    } catch (error) {
      console.error('Error searching verses:', error);
      return [];
    }
  }

  async getTotalCount(query: string): Promise<number> {
    try {
      const dbResults = await this.searchIndex.search(query);
      return dbResults.length;
    } catch (error) {
      console.error('Error getting total count:', error);
      return 0;
    }
  }

  // ── Strong's / lemma / morphology ────────────────────────────────────────

  /**
   * Three ways in:
   *   1. A Strong's number (G26) → every verse using that word.
   *   2. A Greek lemma (ἀγάπη) → same, via the lemma index.
   *   3. An English word → Strong's entries whose gloss matches, then their verses.
   *
   * Results group by Strong's number so "love" fans out into G25, G26, G5368…
   */
  private async searchStrongs(query: string): Promise<SearchResult[]> {
    try {
      const db = await openDB();
      if (!db.objectStoreNames.contains('morphology')) return [];

      const direct = query.trim().match(STRONGS_QUERY);
      if (direct) {
        const prefix = direct[1].toUpperCase();
        return this.versesForStrongs(db, strongsVariants(prefix, direct[2]));
      }

      const lemmaHits = await this.versesForLemma(db, query.trim());
      if (lemmaHits.length) return lemmaHits;

      // English word → Strong's numbers via the lexicon's own definitions.
      const ids = await this.strongsIdsByGloss(db, query.trim());
      if (!ids.length) return [];
      return this.versesForStrongs(db, ids);
    } catch (error) {
      console.error('Error searching Strong\'s:', error);
      return [];
    }
  }

  private async versesForStrongs(db: IDBDatabase, ids: string[]): Promise<SearchResult[]> {
    const rows: any[] = [];
    for (const id of ids) {
      // Fresh transaction per id — an IndexedDB transaction goes inactive once
      // its request queue drains, which is exactly what awaiting in a loop does.
      const index = db
        .transaction('morphology', 'readonly')
        .objectStore('morphology')
        .index('strongsId');
      rows.push(...(await getAll<any>(index, IDBKeyRange.only(id))));
      if (rows.length >= STRONGS_VERSE_LIMIT) break;
    }
    return this.morphologyToResults(rows);
  }

  private async versesForLemma(db: IDBDatabase, lemma: string): Promise<SearchResult[]> {
    const store = db.transaction('morphology', 'readonly').objectStore('morphology');
    let index: IDBIndex;
    try {
      index = store.index('by_lemma');
    } catch {
      return [];
    }
    // Hebrew rows store a bare Strong's number as the lemma ("121"), so a word
    // query only ever matches Greek here — which is what we want.
    return this.morphologyToResults(await getAll<any>(index, IDBKeyRange.only(lemma)));
  }

  /**
   * Flattened {id, gloss} list for both Strong's dictionaries, built once and
   * kept for the session — reloading ~14k entries on every keystroke would make
   * the whole search feel slow.
   */
  private glossIndex: Promise<{ id: string; gloss: string }[]> | null = null;

  private loadGlossIndex(db: IDBDatabase): Promise<{ id: string; gloss: string }[]> {
    if (!this.glossIndex) {
      this.glossIndex = (async () => {
        const entries: { id: string; gloss: string }[] = [];
        for (const storeName of ['greek_strongs_entries', 'hebrew_strongs_entries']) {
          if (!db.objectStoreNames.contains(storeName)) continue;
          const rows = await getAll<any>(
            db.transaction(storeName, 'readonly').objectStore(storeName),
          );
          for (const row of rows) {
            entries.push({
              id: row.id,
              gloss: `${row.shortDefinition || ''} ${row.definition || ''}`.toLowerCase(),
            });
          }
        }
        return entries;
      })();
    }
    return this.glossIndex;
  }

  private async strongsIdsByGloss(db: IDBDatabase, word: string): Promise<string[]> {
    const term = word.toLowerCase();
    if (term.length < 3 || /\s/.test(term)) return [];

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word-boundary match, so "love" doesn't drag in "glove" or "beloved".
    const pattern = new RegExp(`\\b${escaped}\\b`);

    const ids: string[] = [];
    for (const entry of await this.loadGlossIndex(db)) {
      if (pattern.test(entry.gloss)) ids.push(entry.id);
      if (ids.length >= 12) break;
    }
    return ids;
  }

  private morphologyToResults(rows: any[]): SearchResult[] {
    const seen = new Set<string>();
    const results: SearchResult[] = [];

    for (const row of rows) {
      const book = normalizeBookName(row.book);
      const ref = `${book} ${row.chapter}:${row.verse}`;
      const key = `${row.strongsId}|${ref}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const gloss = [row.transliteration, row.gloss_en].filter(Boolean).join(' — ');
      results.push({
        type: 'strongs',
        title: ref,
        subtitle: [row.text, gloss].filter(Boolean).join('  ·  '),
        reference: ref,
        group: row.strongsId,
        data: {
          book,
          chapter: row.chapter,
          verse: row.verse,
          translation: row.translationId,
          strongsId: row.strongsId,
        },
        score: 1,
      });
      if (results.length >= CATEGORY_LIMIT) break;
    }
    return results;
  }

  // ── Notes / Journal ──────────────────────────────────────────────────────

  private async searchNotes(query: string): Promise<SearchResult[]> {
    try {
      const term = query.toLowerCase();
      const notes = await this.userData.getNotes();
      return notes
        .filter((note) => stripHtml(note.text).toLowerCase().includes(term))
        .slice(0, CATEGORY_LIMIT)
        .map((note) => {
          const book = normalizeBookName(note.reference.book);
          const ref = `${book} ${note.reference.chapter}:${note.reference.verse}`;
          return {
            type: 'note' as const,
            title: ref,
            subtitle: snippet(stripHtml(note.text), query),
            reference: ref,
            data: {
              book,
              chapter: note.reference.chapter,
              verse: note.reference.verse,
              noteId: note.id,
            },
            score: 1,
          };
        });
    } catch (error) {
      console.error('Error searching notes:', error);
      return [];
    }
  }

  private async searchJournal(query: string): Promise<SearchResult[]> {
    try {
      const term = query.toLowerCase();
      const entries = await this.journal.getEntries();
      return entries
        .filter((entry) => {
          const haystack = `${entry.title || ''} ${stripHtml(entry.text)}`.toLowerCase();
          return haystack.includes(term);
        })
        .slice(0, CATEGORY_LIMIT)
        .map((entry) => ({
          type: 'journal' as const,
          title: entry.title ? `${entry.date} — ${entry.title}` : entry.date,
          subtitle: snippet(stripHtml(entry.text), query),
          data: { date: entry.date, entryId: entry.id },
          score: 1,
        }));
    } catch (error) {
      console.error('Error searching journal:', error);
      return [];
    }
  }

  // ── Biblical characters ──────────────────────────────────────────────────

  /**
   * Name-index lookup: exact match plus a prefix range, so "abra" finds Abraham.
   * No verse context here — you typed the name on purpose.
   */
  private async searchCharacters(query: string): Promise<SearchResult[]> {
    try {
      const term = query.trim().toLowerCase();
      if (term.length < 2) return [];

      const db = await openDB();
      if (!db.objectStoreNames.contains('person_names')) return [];

      const nameIndex = db
        .transaction('person_names', 'readonly')
        .objectStore('person_names')
        .index('nameLower');
      const rows = await getAll<any>(
        nameIndex,
        IDBKeyRange.bound(term, `${term}￿`, false, false),
      );
      const ids = [...new Set(rows.map((r) => r.personId))].slice(0, CATEGORY_LIMIT);
      if (!ids.length) return [];

      const peopleStore = db.transaction('people', 'readonly').objectStore('people');
      const people = await Promise.all(
        ids.map(
          (id) =>
            new Promise<any>((resolve) => {
              const request = peopleStore.get(id);
              request.onsuccess = () => resolve(request.result || null);
              request.onerror = () => resolve(null);
            }),
        ),
      );

      return people
        .filter(Boolean)
        .sort((a, b) => (b.verseCount ?? 0) - (a.verseCount ?? 0))
        .map((person) => ({
          type: 'character' as const,
          title: person.displayTitle || person.name,
          subtitle: [
            person.nameMeaning ? `“${person.nameMeaning}”` : '',
            person.verseCount ? `${person.verseCount} verses` : '',
          ]
            .filter(Boolean)
            .join('  ·  '),
          data: { personId: person.id, name: person.name },
          score: person.verseCount ?? 0,
        }));
    } catch (error) {
      console.error('Error searching characters:', error);
      return [];
    }
  }

  // ── Commentaries ─────────────────────────────────────────────────────────

  /**
   * ~89k entries with no text index, so this cursors and bails at the cap.
   * Only runs on an explicit search, never on type-ahead.
   */
  private async searchCommentaries(query: string): Promise<SearchResult[]> {
    try {
      const term = query.toLowerCase();
      if (term.length < 3) return [];

      const db = await openDB();
      if (!db.objectStoreNames.contains('commentary_entries')) return [];

      return await new Promise<SearchResult[]>((resolve) => {
        const results: SearchResult[] = [];
        const request = db
          .transaction('commentary_entries', 'readonly')
          .objectStore('commentary_entries')
          .openCursor();

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || results.length >= COMMENTARY_SCAN_LIMIT) {
            resolve(results);
            return;
          }
          const entry = cursor.value as any;
          const text = stripHtml(entry.text || '');
          if (text.toLowerCase().includes(term)) {
            const book = normalizeBookName(entry.book);
            const ref = `${book} ${entry.chapter}:${entry.verseStart}`;
            results.push({
              type: 'commentary',
              title: entry.title ? `${ref} — ${entry.title}` : ref,
              subtitle: snippet(text, query),
              reference: ref,
              group: entry.author || 'Unknown',
              data: {
                book,
                chapter: entry.chapter,
                verse: entry.verseStart,
                author: entry.author,
                commentaryId: entry.id,
              },
              score: 1,
            });
          }
          cursor.continue();
        };

        request.onerror = () => resolve(results);
      });
    } catch (error) {
      console.error('Error searching commentaries:', error);
      return [];
    }
  }
}

export const searchService = UnifiedSearchService.getInstance();
