/**
 * Bootstrap Loader
 * 
 * Loads the bootstrap pack (bundled with app) for instant startup.
 * Bootstrap contains book metadata, verse counts, and navigation data.
 */

import { BOOTSTRAP_PACK_URL } from '../config';

export interface BootstrapData {
  books: Array<{
    id: string;
    name: string;
    testament: string;
    book_order: number;
    chapter_count: number;
  }>;
  chapterVerseCounts: Map<string, Map<number, number>>;
  verseOffsets: Map<string, Map<number, number>>;
  bookAliases: Map<string, string>;
  referencePatterns: Array<{
    pattern: string;
    description: string;
    priority: number;
  }>;
}

let bootstrapData: BootstrapData | null = null;

/**
 * Load bootstrap pack from bundled SQLite file
 */
export async function loadBootstrap(): Promise<BootstrapData> {
  if (bootstrapData) {
    return bootstrapData; // Already loaded
  }
  
  console.log('📦 Loading bootstrap pack...');
  
  try {
    // Fetch bootstrap SQLite file
    const response = await fetch(BOOTSTRAP_PACK_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch bootstrap: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Load sql.js
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: (file: string) => `/${file}`
    });
    
    // Open database
    const db = new SQL.Database(uint8Array);
    
    // Extract books
    const booksStmt = db.prepare('SELECT * FROM books ORDER BY book_order');
    const books: BootstrapData['books'] = [];
    
    while (booksStmt.step()) {
      books.push(booksStmt.getAsObject() as any);
    }
    booksStmt.free();
    
    // Extract chapter verse counts
    const chapterVerseCounts = new Map<string, Map<number, number>>();
    const verseCountsStmt = db.prepare('SELECT * FROM chapter_verses');
    
    while (verseCountsStmt.step()) {
      const row = verseCountsStmt.getAsObject() as any;
      if (!chapterVerseCounts.has(row.book_id)) {
        chapterVerseCounts.set(row.book_id, new Map());
      }
      chapterVerseCounts.get(row.book_id)!.set(row.chapter, row.verse_count);
    }
    verseCountsStmt.free();
    
    // Extract verse offsets
    const verseOffsets = new Map<string, Map<number, number>>();
    const offsetsStmt = db.prepare('SELECT * FROM verse_offsets');
    
    while (offsetsStmt.step()) {
      const row = offsetsStmt.getAsObject() as any;
      if (!verseOffsets.has(row.book_id)) {
        verseOffsets.set(row.book_id, new Map());
      }
      verseOffsets.get(row.book_id)!.set(row.chapter, row.verse_offset);
    }
    offsetsStmt.free();
    
    // Extract book aliases
    const bookAliases = new Map<string, string>();
    const aliasesStmt = db.prepare('SELECT * FROM book_aliases');
    
    while (aliasesStmt.step()) {
      const row = aliasesStmt.getAsObject() as any;
      bookAliases.set(row.alias, row.canonical_id);
    }
    aliasesStmt.free();
    
    // Extract reference patterns
    const patternsStmt = db.prepare('SELECT * FROM reference_patterns ORDER BY priority DESC');
    const referencePatterns: BootstrapData['referencePatterns'] = [];
    
    while (patternsStmt.step()) {
      referencePatterns.push(patternsStmt.getAsObject() as any);
    }
    patternsStmt.free();
    
    // Close database
    db.close();
    
    bootstrapData = {
      books,
      chapterVerseCounts,
      verseOffsets,
      bookAliases,
      referencePatterns
    };
    
    console.log(`✓ Bootstrap loaded: ${books.length} books, ${bookAliases.size} aliases`);
    
    return bootstrapData;
    
  } catch (error) {
    console.error('Failed to load bootstrap:', error);
    throw new Error(`Bootstrap load failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get book by ID
 */
export function getBook(bookId: string): BootstrapData['books'][0] | null {
  if (!bootstrapData) return null;
  return bootstrapData.books.find(b => b.id === bookId) || null;
}

/**
 * Get verse count for a chapter
 */
export function getVerseCount(bookId: string, chapter: number): number | null {
  if (!bootstrapData) return null;
  return bootstrapData.chapterVerseCounts.get(bookId)?.get(chapter) || null;
}

/**
 * Get verse offset for a chapter (for navigation)
 */
export function getVerseOffset(bookId: string, chapter: number): number | null {
  if (!bootstrapData) return null;
  return bootstrapData.verseOffsets.get(bookId)?.get(chapter) || null;
}

/**
 * Parse a book name (handles aliases)
 */
export function parseBookName(input: string): string | null {
  if (!bootstrapData) return null;
  const normalized = input.toLowerCase().trim();
  return bootstrapData.bookAliases.get(normalized) || null;
}

/**
 * Get all books
 */
export function getAllBooks(): BootstrapData['books'] {
  return bootstrapData?.books || [];
}
