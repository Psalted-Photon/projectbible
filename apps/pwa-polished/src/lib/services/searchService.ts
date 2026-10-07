import { get } from 'svelte/store';
import { IndexedDBSearchIndex } from '../../adapters/SearchIndex';
import { BIBLE_BOOKS, normalizeBookName } from '../bibleData';
import { openDB } from '../../adapters/db';
import { IndexedDBUserDataStore } from '../../adapters/UserDataStore';
import { IndexedDBTextStore } from '../../adapters/TextStore';
import { syncedJournalStore } from '../../adapters/SyncedJournalStore';
import { currentLockView } from '../journalLock/lockState';
import { navigationStore } from '../../stores/navigationStore';
import { cleanVersePreviewText } from '../verseRendering';
import { parseRefString } from '../parseRefString';
import { getAllReadings, listWorks, shortReadingLabel } from '../devotionals/devotionalsData';
import { patternMatcher, wordMatcher, type TextMatcher } from '../searchWords';

export type SearchCategoryKey =
  | 'bible'
  | 'strongs'
  | 'notes'
  | 'journal'
  | 'saved'
  | 'characters'
  | 'encyclopedia'
  | 'topical'
  | 'devotionals'
  | 'commentaries';

export interface SearchResult {
  type: 'verse' | 'strongs' | 'note' | 'journal' | 'saved' | 'character' | 'encyclopedia' | 'topical' | 'devotional' | 'commentary';
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
  /** Results were capped — the count is what we're showing, not what exists. */
  truncated?: boolean;
  /**
   * Every match that exists, capped or not. Only the Bible group is capped, so
   * only it says; it already holds every match before it trims, and counting
   * them here saves a second full scan just to learn the number.
   */
  total?: number;
}

export interface SearchOptions {
  /** Verse-result cap. -1 loads everything. */
  limit?: number;
  /**
   * Run the categories that are too expensive for type-ahead (commentaries
   * cursors ~89k rows). Set for an explicit Enter/Search press only.
   */
  deep?: boolean;
  /**
   * Advanced Search's own pattern. Without one, each word of the query finds
   * itself and its forms and nothing else (lib/searchWords), so "eye" never
   * finds obeyed. With one, text is tested against the pattern as given, and
   * the query is used only for the lookups by name or number: people, the
   * encyclopedia and topical titles, and Strong's.
   */
  pattern?: RegExp;
}

/** The two ways a category can want the words: anywhere in it, or together. */
interface Matchers {
  /** Every word somewhere in the text, in any order. */
  all: TextMatcher;
  /** The words together, in the order typed. */
  phrase: TextMatcher;
  /** Set for Advanced Search, which brings its own pattern. */
  pattern: boolean;
}

/** Per-category caps, so one huge category can't bury the others. */
const CATEGORY_LIMIT = 200;
const COMMENTARY_SCAN_LIMIT = 400;
const STRONGS_VERSE_LIMIT = 500;

/** Canonical Genesis → Revelation position, for ordering saved verses. */
const bookOrder = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]));

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
function snippet(text: string, match: TextMatcher, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  const at = match.indexIn(text);
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
  private textStore = new IndexedDBTextStore();

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
    const options: SearchOptions = typeof limit === 'object' && limit !== null ? limit : { limit };

    // Advanced Search can run on its pattern alone (words near each other).
    const normalizedQuery = (query || '').trim();
    if (!normalizedQuery && !options.pattern) {
      return [];
    }

    const match: Matchers = options.pattern
      ? { all: patternMatcher(options.pattern), phrase: patternMatcher(options.pattern), pattern: true }
      : { all: wordMatcher(normalizedQuery, 'all'), phrase: wordMatcher(normalizedQuery, 'phrase'), pattern: false };

    // Every category is independent, so fetch them together rather than
    // serially — the slowest one sets the pace instead of their sum.
    const [verses, strongs, notes, journal, saved, characters, encyclopedia, topical, devotionals, commentaries] = await Promise.all([
      this.searchVerses(match.all, options.limit),
      this.searchStrongs(normalizedQuery),
      this.searchNotes(match.phrase),
      this.searchJournal(match.phrase),
      this.searchSaved(match.phrase),
      this.searchCharacters(normalizedQuery),
      this.searchEncyclopedia(normalizedQuery, !!options.deep),
      this.searchTopical(normalizedQuery, !!options.deep),
      this.searchDevotionals(normalizedQuery, match),
      options.deep ? this.searchCommentaries(normalizedQuery, match) : Promise.resolve([]),
    ]);

    const categories: SearchCategory[] = [
      { key: 'bible', name: 'Bible', count: verses.results.length, results: verses.results, total: verses.total },
      { key: 'strongs', name: "Strong's", count: strongs.length, results: strongs },
      { key: 'notes', name: 'Notes', count: notes.length, results: notes },
      { key: 'journal', name: 'Journal', count: journal.length, results: journal },
      { key: 'saved', name: 'Highlights', count: saved.length, results: saved },
      { key: 'characters', name: 'Biblical Characters', count: characters.length, results: characters },
      { key: 'encyclopedia', name: 'Encyclopedia (ISBE)', count: encyclopedia.length, results: encyclopedia },
      { key: 'topical', name: "Topical (Nave's)", count: topical.length, results: topical },
      { key: 'devotionals', name: 'Devotionals', count: devotionals.length, results: devotionals },
      { key: 'commentaries', name: 'Commentaries', count: commentaries.length, results: commentaries },
    ];

    return categories.filter((c) => c.count > 0);
  }

  // ── Bible ────────────────────────────────────────────────────────────────

  private async searchVerses(
    match: TextMatcher,
    limit: number = 250,
  ): Promise<{ results: SearchResult[]; total: number }> {
    try {
      const dbResults = await this.searchIndex.scan(match);

      // Limit results (default 250, or all if limit is -1)
      const resultLimit = limit === -1 ? dbResults.length : limit;

      const results = dbResults.slice(0, resultLimit).map((result, index) => ({
        type: 'verse' as const,
        title: `${normalizeBookName(result.book)} ${result.chapter}:${result.verse}`,
        // Full stored text, not result.snippet — the snippet is cut from raw
        // text at scan time and can slice through a footnote. The tree cleans
        // and trims it for display instead.
        subtitle: result.text || result.snippet,
        reference: `${normalizeBookName(result.book)} ${result.chapter}:${result.verse}`,
        data: {
          book: normalizeBookName(result.book),
          chapter: result.chapter,
          verse: result.verse,
          translation: result.translation
        },
        score: 1.0 - (index / 100), // Simple relevance scoring
      }));
      return { results, total: dbResults.length };
    } catch (error) {
      console.error('Error searching verses:', error);
      return { results: [], total: 0 };
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

  private async searchNotes(match: TextMatcher): Promise<SearchResult[]> {
    try {
      const notes = await this.userData.getNotes();
      return notes
        .filter((note) => match.test(stripHtml(note.text)))
        .slice(0, CATEGORY_LIMIT)
        .map((note) => {
          const book = normalizeBookName(note.reference.book);
          const ref = `${book} ${note.reference.chapter}:${note.reference.verse}`;
          return {
            type: 'note' as const,
            title: ref,
            subtitle: snippet(stripHtml(note.text), match),
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

  private async searchJournal(match: TextMatcher): Promise<SearchResult[]> {
    try {
      // A locked journal isn't searched at all — not even which days match.
      if (currentLockView().needsUnlock) return [];
      // The synced store hands back unscrambled text while unlocked.
      const entries = await syncedJournalStore.getEntries();
      return entries
        .filter((entry) => {
          if (entry.locked || entry.unreadable) return false;
          return match.test(`${entry.title || ''} ${stripHtml(entry.text)}`);
        })
        .slice(0, CATEGORY_LIMIT)
        .map((entry) => ({
          type: 'journal' as const,
          title: entry.title ? `${entry.date} — ${entry.title}` : entry.date,
          subtitle: snippet(stripHtml(entry.text), match),
          data: { date: entry.date, entryId: entry.id },
          score: 1,
        }));
    } catch (error) {
      console.error('Error searching journal:', error);
      return [];
    }
  }

  // ── Saved verses ─────────────────────────────────────────────────────────

  /**
   * The same verses Profile lists as Highlights: every verse carrying a
   * highlight or underline, whole-verse or single-word. Matched against their
   * text in the translation the reader is showing, since that's the text the
   * list in Profile shows too.
   */
  private async searchSaved(match: TextMatcher): Promise<SearchResult[]> {
    try {
      const [highlights, wordHighlights] = await Promise.all([
        this.userData.getHighlights(),
        this.userData.getWordHighlights(),
      ]);

      // One entry per verse, however many highlights sit on it.
      const refs = new Map<string, { book: string; chapter: number; verse: number }>();
      for (const { reference } of [...highlights, ...wordHighlights]) {
        const book = normalizeBookName(reference.book);
        refs.set(`${book}|${reference.chapter}|${reference.verse}`, {
          book,
          chapter: reference.chapter,
          verse: reference.verse,
        });
      }
      if (!refs.size) return [];

      const translation = get(navigationStore).translation;
      const verses = await Promise.all(
        [...refs.values()].map(async (ref) => ({
          ...ref,
          text: await this.textStore.getVerse(translation, ref.book, ref.chapter, ref.verse),
        })),
      );

      return verses
        .filter((v) => v.text && match.test(cleanVersePreviewText(v.text)))
        .sort(
          (a, b) =>
            (bookOrder.get(a.book) ?? 999) - (bookOrder.get(b.book) ?? 999) ||
            a.chapter - b.chapter ||
            a.verse - b.verse,
        )
        .slice(0, CATEGORY_LIMIT)
        .map((v) => {
          const ref = `${v.book} ${v.chapter}:${v.verse}`;
          return {
            type: 'saved' as const,
            title: ref,
            // Raw stored text, like Bible results — the tree cleans it for display.
            subtitle: v.text!,
            reference: ref,
            data: { book: v.book, chapter: v.chapter, verse: v.verse },
            score: 1,
          };
        });
    } catch (error) {
      console.error('Error searching saved verses:', error);
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

  // ── Encyclopedia (ISBE) ──────────────────────────────────────────────────

  /**
   * Type-ahead matches entry titles (prefix). A `deep` search additionally scans
   * the full-text token index so a word discussed *inside* an article — but not in
   * its title — still surfaces. Places rank above general entries, then by length.
   */
  private async searchEncyclopedia(query: string, deep: boolean): Promise<SearchResult[]> {
    try {
      const term = query.toLowerCase().trim();
      if (term.length < 2) return [];

      const db = await openDB();
      if (!db.objectStoreNames.contains('isbe_entry_names')) return [];

      const entryIds = new Set<number>();

      // Title prefix matches
      const nameIdx = db
        .transaction('isbe_entry_names', 'readonly')
        .objectStore('isbe_entry_names')
        .index('nameLower');
      const nameRows = await getAll<any>(
        nameIdx,
        IDBKeyRange.bound(term, `${term}￿`, false, false),
      );
      for (const r of nameRows) entryIds.add(r.entryId);

      // Deep: exact-token body matches (one token only — the box is a single word here)
      if (deep && /^[a-z0-9]{3,}$/.test(term) && db.objectStoreNames.contains('isbe_tokens')) {
        const tokIdx = db.transaction('isbe_tokens', 'readonly').objectStore('isbe_tokens').index('token');
        const tokRows = await getAll<any>(tokIdx, IDBKeyRange.only(term));
        for (const r of tokRows) entryIds.add(r.entryId);
      }

      if (!entryIds.size) return [];
      const ids = [...entryIds].slice(0, CATEGORY_LIMIT);

      const entryStore = db.transaction('isbe_entries', 'readonly').objectStore('isbe_entries');
      const entries = await Promise.all(
        ids.map(
          (id) =>
            new Promise<any>((resolve) => {
              const req = entryStore.get(id);
              req.onsuccess = () => resolve(req.result || null);
              req.onerror = () => resolve(null);
            }),
        ),
      );

      return entries
        .filter(Boolean)
        // Places first, then longer (richer) articles.
        .sort((a, b) => (b.isPlace ?? 0) - (a.isPlace ?? 0) || (b.charCount ?? 0) - (a.charCount ?? 0))
        .map((e) => ({
          type: 'encyclopedia' as const,
          title: e.primaryName || e.title,
          subtitle: [
            e.isPlace ? 'Place' : 'Encyclopedia',
            e.lead ? String(e.lead).slice(0, 90) : '',
          ]
            .filter(Boolean)
            .join('  ·  '),
          data: { entryId: e.entryId, isPlace: !!e.isPlace, primaryName: e.primaryName || e.title },
          score: (e.isPlace ? 1e6 : 0) + (e.charCount ?? 0),
        }));
    } catch (error) {
      console.error('Error searching encyclopedia:', error);
      return [];
    }
  }

  // ── Topical (Nave's) ─────────────────────────────────────────────────────

  /**
   * Type-ahead matches topic titles (prefix). A `deep` search additionally
   * scans the token index, so a word discussed inside a topic's outline — but
   * not in its heading — still surfaces. Ranked by how much the topic has to
   * say, which for Nave's means how many references it gathers.
   */
  private async searchTopical(query: string, deep: boolean): Promise<SearchResult[]> {
    try {
      const term = query.toLowerCase().trim();
      if (term.length < 2) return [];

      const db = await openDB();
      if (!db.objectStoreNames.contains('naves_names')) return [];

      const topicIds = new Set<number>();

      const nameIdx = db
        .transaction('naves_names', 'readonly')
        .objectStore('naves_names')
        .index('nameLower');
      const nameRows = await getAll<any>(nameIdx, IDBKeyRange.bound(term, `${term}￿`, false, false));
      for (const r of nameRows) topicIds.add(r.topicId);

      if (deep && /^[a-z0-9]{3,}$/.test(term) && db.objectStoreNames.contains('naves_tokens')) {
        const tokIdx = db.transaction('naves_tokens', 'readonly').objectStore('naves_tokens').index('token');
        const tokRows = await getAll<any>(tokIdx, IDBKeyRange.only(term));
        for (const r of tokRows) topicIds.add(r.topicId);
      }

      if (!topicIds.size) return [];
      const ids = [...topicIds].slice(0, CATEGORY_LIMIT);

      const store = db.transaction('naves_topics', 'readonly').objectStore('naves_topics');
      const topics = await Promise.all(
        ids.map(
          (id) =>
            new Promise<any>((resolve) => {
              const req = store.get(id);
              req.onsuccess = () => resolve(req.result || null);
              req.onerror = () => resolve(null);
            }),
        ),
      );

      return topics
        .filter(Boolean)
        .sort((a, b) => (b.refCount ?? 0) - (a.refCount ?? 0))
        .map((t) => ({
          type: 'topical' as const,
          title: t.primaryName || t.title,
          subtitle: [
            t.refCount ? `${t.refCount} reference${t.refCount === 1 ? '' : 's'}` : 'Topic',
            t.lead ? String(t.lead).slice(0, 90) : '',
          ]
            .filter(Boolean)
            .join('  ·  '),
          data: { topicId: t.topicId, primaryName: t.primaryName || t.title },
          score: t.refCount ?? 0,
        }));
    } catch (error) {
      console.error('Error searching topical:', error);
      return [];
    }
  }

  // ── Devotionals ──────────────────────────────────────────────────────────

  /**
   * A reference ("John 3:16", "Psalm 23") finds the readings built on it — the
   * Spurgeon headline, or any Daily Light fragment. Anything else is words:
   * every word of the query has to appear in the reading. Grouped by work.
   */
  private async searchDevotionals(query: string, match: Matchers): Promise<SearchResult[]> {
    try {
      const q = query.trim();
      if (q.length < 3 && !match.pattern) return [];
      const readings = await getAllReadings();
      if (!readings.length) return [];
      const works = new Map((await listWorks()).map((w) => [w.workId, w]));
      const order = (id: string) => works.get(id)?.sortOrder ?? 99;

      // A reference names a book, so only try one when the query has a digit after a word.
      const ref = !match.pattern && /[a-z]/i.test(q) && /\d/.test(q) ? parseRefString(q, '', 0) : null;
      const refBook = ref?.book ? normalizeBookName(ref.book) : null;
      const wantVerse = ref && /:\s*\d/.test(q) ? ref.verse : null;

      const hits: { r: (typeof readings)[number]; sub: string }[] = [];
      if (ref && refBook) {
        for (const r of readings) {
          const k = r.keyRefs.find((k) => {
            if (normalizeBookName(k.book) !== refBook || k.chapter !== ref.chapter) return false;
            if (wantVerse == null || k.verseStart == null) return true;
            const vs = k.verses ?? [];
            return vs.length ? vs.includes(wantVerse) : wantVerse >= k.verseStart && wantVerse <= (k.verseEnd ?? k.verseStart);
          });
          if (k) hits.push({ r, sub: `${k.label} · ${k.fragment ?? k.kjvText}` });
        }
      } else {
        for (const r of readings) {
          if (!match.all.test(r.plainText)) continue;
          // plainText is lowercased for matching; the snippet comes from the text as written.
          // The modern text and notes are searched too, so a match may only be there.
          const shown = [
            ...r.keyRefs.map((k) => k.fragment ?? k.kjvText),
            stripHtml(r.bodyHtml || ''),
            stripHtml(r.modernHtml || ''),
            ...(r.notes ?? []).map((n) => `${n.term}: ${stripHtml(n.html)}`),
          ].join(' ');
          hits.push({ r, sub: snippet(shown, match.all, 140) });
        }
      }

      return hits
        .sort((a, b) => order(a.r.workId) - order(b.r.workId) || a.r.month - b.r.month || a.r.day - b.r.day || (a.r.slot === 'morning' ? -1 : 1))
        .slice(0, CATEGORY_LIMIT)
        .map(({ r, sub }) => {
          const work = works.get(r.workId);
          return {
            type: 'devotional' as const,
            title: `${work?.shortTitle ?? r.workId} — ${shortReadingLabel(r.month, r.day, r.slot)}`,
            subtitle: sub,
            group: work?.title ?? r.workId,
            data: { workId: r.workId, month: r.month, day: r.day, slot: r.slot },
            score: 0,
          };
        });
    } catch (error) {
      console.error('Error searching devotionals:', error);
      return [];
    }
  }

  // ── Commentaries ─────────────────────────────────────────────────────────

  /**
   * ~89k entries with no text index, so this cursors and bails at the cap.
   * Only runs on an explicit search, never on type-ahead.
   */
  private async searchCommentaries(query: string, match: Matchers): Promise<SearchResult[]> {
    try {
      if (query.length < 3 && !match.pattern) return [];

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
          if (match.phrase.test(text)) {
            const book = normalizeBookName(entry.book);
            const ref = `${book} ${entry.chapter}:${entry.verseStart}`;
            results.push({
              type: 'commentary',
              title: entry.title ? `${ref} — ${entry.title}` : ref,
              subtitle: snippet(text, match.phrase),
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
