/**
 * Bible books and chapter counts
 */

export interface BookInfo {
  name: string;
  chapters: number;
  testament: 'OT' | 'NT';
  category: 'pentateuch' | 'historical' | 'wisdom' | 'major-prophets' | 'minor-prophets' | 'gospels' | 'acts' | 'pauline' | 'general' | 'revelation';
}

export const BIBLE_BOOKS: BookInfo[] = [
  // Old Testament - Pentateuch
  { name: 'Genesis', chapters: 50, testament: 'OT', category: 'pentateuch' },
  { name: 'Exodus', chapters: 40, testament: 'OT', category: 'pentateuch' },
  { name: 'Leviticus', chapters: 27, testament: 'OT', category: 'pentateuch' },
  { name: 'Numbers', chapters: 36, testament: 'OT', category: 'pentateuch' },
  { name: 'Deuteronomy', chapters: 34, testament: 'OT', category: 'pentateuch' },
  // Historical Books
  { name: 'Joshua', chapters: 24, testament: 'OT', category: 'historical' },
  { name: 'Judges', chapters: 21, testament: 'OT', category: 'historical' },
  { name: 'Ruth', chapters: 4, testament: 'OT', category: 'historical' },
  { name: '1 Samuel', chapters: 31, testament: 'OT', category: 'historical' },
  { name: '2 Samuel', chapters: 24, testament: 'OT', category: 'historical' },
  { name: '1 Kings', chapters: 22, testament: 'OT', category: 'historical' },
  { name: '2 Kings', chapters: 25, testament: 'OT', category: 'historical' },
  { name: '1 Chronicles', chapters: 29, testament: 'OT', category: 'historical' },
  { name: '2 Chronicles', chapters: 36, testament: 'OT', category: 'historical' },
  { name: 'Ezra', chapters: 10, testament: 'OT', category: 'historical' },
  { name: 'Nehemiah', chapters: 13, testament: 'OT', category: 'historical' },
  { name: 'Esther', chapters: 10, testament: 'OT', category: 'historical' },
  // Wisdom Books
  { name: 'Job', chapters: 42, testament: 'OT', category: 'wisdom' },
  { name: 'Psalms', chapters: 150, testament: 'OT', category: 'wisdom' },
  { name: 'Proverbs', chapters: 31, testament: 'OT', category: 'wisdom' },
  { name: 'Ecclesiastes', chapters: 12, testament: 'OT', category: 'wisdom' },
  { name: 'Song of Solomon', chapters: 8, testament: 'OT', category: 'wisdom' },
  // Major Prophets
  { name: 'Isaiah', chapters: 66, testament: 'OT', category: 'major-prophets' },
  { name: 'Jeremiah', chapters: 52, testament: 'OT', category: 'major-prophets' },
  { name: 'Lamentations', chapters: 5, testament: 'OT', category: 'major-prophets' },
  { name: 'Ezekiel', chapters: 48, testament: 'OT', category: 'major-prophets' },
  { name: 'Daniel', chapters: 12, testament: 'OT', category: 'major-prophets' },
  // Minor Prophets
  { name: 'Hosea', chapters: 14, testament: 'OT', category: 'minor-prophets' },
  { name: 'Joel', chapters: 3, testament: 'OT', category: 'minor-prophets' },
  { name: 'Amos', chapters: 9, testament: 'OT', category: 'minor-prophets' },
  { name: 'Obadiah', chapters: 1, testament: 'OT', category: 'minor-prophets' },
  { name: 'Jonah', chapters: 4, testament: 'OT', category: 'minor-prophets' },
  { name: 'Micah', chapters: 7, testament: 'OT', category: 'minor-prophets' },
  { name: 'Nahum', chapters: 3, testament: 'OT', category: 'minor-prophets' },
  { name: 'Habakkuk', chapters: 3, testament: 'OT', category: 'minor-prophets' },
  { name: 'Zephaniah', chapters: 3, testament: 'OT', category: 'minor-prophets' },
  { name: 'Haggai', chapters: 2, testament: 'OT', category: 'minor-prophets' },
  { name: 'Zechariah', chapters: 14, testament: 'OT', category: 'minor-prophets' },
  { name: 'Malachi', chapters: 4, testament: 'OT', category: 'minor-prophets' },
  
  // New Testament - Gospels
  { name: 'Matthew', chapters: 28, testament: 'NT', category: 'gospels' },
  { name: 'Mark', chapters: 16, testament: 'NT', category: 'gospels' },
  { name: 'Luke', chapters: 24, testament: 'NT', category: 'gospels' },
  { name: 'John', chapters: 21, testament: 'NT', category: 'gospels' },
  // Acts
  { name: 'Acts', chapters: 28, testament: 'NT', category: 'acts' },
  // Pauline Epistles
  { name: 'Romans', chapters: 16, testament: 'NT', category: 'pauline' },
  { name: '1 Corinthians', chapters: 16, testament: 'NT', category: 'pauline' },
  { name: '2 Corinthians', chapters: 13, testament: 'NT', category: 'pauline' },
  { name: 'Galatians', chapters: 6, testament: 'NT', category: 'pauline' },
  { name: 'Ephesians', chapters: 6, testament: 'NT', category: 'pauline' },
  { name: 'Philippians', chapters: 4, testament: 'NT', category: 'pauline' },
  { name: 'Colossians', chapters: 4, testament: 'NT', category: 'pauline' },
  { name: '1 Thessalonians', chapters: 5, testament: 'NT', category: 'pauline' },
  { name: '2 Thessalonians', chapters: 3, testament: 'NT', category: 'pauline' },
  { name: '1 Timothy', chapters: 6, testament: 'NT', category: 'pauline' },
  { name: '2 Timothy', chapters: 4, testament: 'NT', category: 'pauline' },
  { name: 'Titus', chapters: 3, testament: 'NT', category: 'pauline' },
  { name: 'Philemon', chapters: 1, testament: 'NT', category: 'pauline' },
  // General Epistles
  { name: 'Hebrews', chapters: 13, testament: 'NT', category: 'general' },
  { name: 'James', chapters: 5, testament: 'NT', category: 'general' },
  { name: '1 Peter', chapters: 5, testament: 'NT', category: 'general' },
  { name: '2 Peter', chapters: 3, testament: 'NT', category: 'general' },
  { name: '1 John', chapters: 5, testament: 'NT', category: 'general' },
  { name: '2 John', chapters: 1, testament: 'NT', category: 'general' },
  { name: '3 John', chapters: 1, testament: 'NT', category: 'general' },
  { name: 'Jude', chapters: 1, testament: 'NT', category: 'general' },
  // Revelation
  { name: 'Revelation', chapters: 22, testament: 'NT', category: 'revelation' }
];

export function getBookChapters(bookName: string): number {
  const book = BIBLE_BOOKS.find(b => b.name === bookName);
  return book?.chapters || 1;
}

export function getBookNames(): string[] {
  return BIBLE_BOOKS.map(b => b.name);
}

// Translation scope: which testaments are available
export type TranslationScope = 'full' | 'nt-only' | 'ot-only';

// Mapping of translation IDs to their scope
export const TRANSLATION_SCOPES: Record<string, TranslationScope> = {
  // Full Bible translations
  'BSB': 'full',
  'KJV': 'full',
  'WEB': 'full',
  'NET': 'full',
  'LXX2012': 'full',
  
  // NT-only translations
  'BYZ': 'nt-only',
  'TR': 'nt-only',
  'SBLGNT': 'nt-only',
  'OGNT': 'nt-only',
  
  // OT-only translations
  'LXX': 'ot-only',
  'HEBREW': 'ot-only',
  'OSHB': 'ot-only'
};

/**
 * Get the scope of a translation (full, NT-only, or OT-only)
 */
export function getTranslationScope(translationId: string): TranslationScope {
  const upperTranslation = translationId.toUpperCase();
  
  // Check exact match first
  if (TRANSLATION_SCOPES[upperTranslation]) {
    return TRANSLATION_SCOPES[upperTranslation];
  }
  
  // Check for partial matches
  if (upperTranslation.includes('BYZ') || upperTranslation.includes('TR') || upperTranslation.includes('GNT')) {
    return 'nt-only';
  }
  
  if (upperTranslation.includes('LXX') && !upperTranslation.includes('2012')) {
    return 'ot-only';
  }
  
  if (upperTranslation.includes('HEBREW') || upperTranslation.includes('OSHB')) {
    return 'ot-only';
  }
  
  // Default to full Bible
  return 'full';
}

/**
 * Get available books for a translation
 */
export function getAvailableBooks(translationId: string): BookInfo[] {
  const scope = getTranslationScope(translationId);
  
  if (scope === 'nt-only') {
    return BIBLE_BOOKS.filter(b => b.testament === 'NT');
  }
  
  if (scope === 'ot-only') {
    return BIBLE_BOOKS.filter(b => b.testament === 'OT');
  }
  
  return BIBLE_BOOKS;
}

/**
 * Get the first available book for a translation
 */
export function getFirstAvailableBook(translationId: string): string {
  const scope = getTranslationScope(translationId);
  
  if (scope === 'nt-only') {
    return 'Matthew';
  }
  
  // For both full and OT-only, start with Genesis
  return 'Genesis';
}
