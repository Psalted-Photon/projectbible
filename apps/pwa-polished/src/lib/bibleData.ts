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
  { name: 'Psalm', chapters: 150, testament: 'OT', category: 'wisdom' },
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

/** Maps DB book name variants → canonical BIBLE_BOOKS name */
export const BOOK_NAME_ALIASES: Record<string, string> = {
  // Roman-numeral OT variants
  'I Samuel': '1 Samuel',
  'II Samuel': '2 Samuel',
  'I Kings': '1 Kings',
  'II Kings': '2 Kings',
  'I Chronicles': '1 Chronicles',
  'II Chronicles': '2 Chronicles',
  // Roman-numeral NT variants
  'I Corinthians': '1 Corinthians',
  'II Corinthians': '2 Corinthians',
  'I Thessalonians': '1 Thessalonians',
  'II Thessalonians': '2 Thessalonians',
  'I Timothy': '1 Timothy',
  'II Timothy': '2 Timothy',
  'I Peter': '1 Peter',
  'II Peter': '2 Peter',
  'I John': '1 John',
  'II John': '2 John',
  'III John': '3 John',
  // Other common variants
  'Revelation of John': 'Revelation',
  'Song of Songs': 'Song of Solomon',
  'Psalms': 'Psalm',
};

/** Normalize a DB book name to its canonical BIBLE_BOOKS name */
export function normalizeBookName(book: string): string {
  return BOOK_NAME_ALIASES[book] ?? book;
}

export interface ChapterRef {
  book: string;
  chapter: number;
  /** True when this crossed into a different book. */
  newBook: boolean;
}

/**
 * The chapter that follows this one, rolling into the next book at the end of a
 * book and wrapping Revelation → Genesis.
 *
 * Single source of truth: Read Aloud uses it to keep reading past the end of a
 * chapter, and the reader uses it to navigate. If the two disagreed, playback and
 * the page would drift apart.
 */
export function nextChapterOf(book: string, chapter: number): ChapterRef | null {
  const name = normalizeBookName(book);
  const index = BIBLE_BOOKS.findIndex((b) => b.name === name);
  if (index === -1) return null;

  if (chapter < BIBLE_BOOKS[index].chapters) {
    return { book: name, chapter: chapter + 1, newBook: false };
  }

  const next = BIBLE_BOOKS[(index + 1) % BIBLE_BOOKS.length];
  return { book: next.name, chapter: 1, newBook: true };
}

/**
 * A book's name as it should be *spoken*.
 *
 * Leading numerals are read as words, because a voice saying "one Corinthians"
 * is wrong — it is "First Corinthians". Everything else is spoken as written;
 * note this app already stores Psalms as the singular "Psalm", which is what we
 * want to hear.
 */
export function spokenBookName(book: string): string {
  const name = normalizeBookName(book);
  const ordinals: Record<string, string> = { '1': 'First', '2': 'Second', '3': 'Third' };
  const match = /^([123])\s+(.*)$/.exec(name);
  return match ? `${ordinals[match[1]]} ${match[2]}` : name;
}

/**
 * Conventional short forms, keyed by canonical name. Truncating instead would
 * produce "Gene", "Isai", "Jere" — and collide Judges with Jude and
 * Philippians with Philemon.
 */
const SHORT_BOOK_NAMES: Record<string, string> = {
  'Genesis': 'Gen', 'Exodus': 'Exod', 'Leviticus': 'Lev', 'Numbers': 'Num',
  'Deuteronomy': 'Deut', 'Joshua': 'Josh', 'Judges': 'Judg', 'Ruth': 'Ruth',
  '1 Samuel': '1 Sam', '2 Samuel': '2 Sam', '1 Kings': '1 Kgs', '2 Kings': '2 Kgs',
  '1 Chronicles': '1 Chr', '2 Chronicles': '2 Chr', 'Ezra': 'Ezra', 'Nehemiah': 'Neh',
  'Esther': 'Esth', 'Job': 'Job', 'Psalm': 'Ps', 'Proverbs': 'Prov',
  'Ecclesiastes': 'Eccl', 'Song of Solomon': 'Song', 'Isaiah': 'Isa', 'Jeremiah': 'Jer',
  'Lamentations': 'Lam', 'Ezekiel': 'Ezek', 'Daniel': 'Dan', 'Hosea': 'Hos',
  'Joel': 'Joel', 'Amos': 'Amos', 'Obadiah': 'Obad', 'Jonah': 'Jonah',
  'Micah': 'Mic', 'Nahum': 'Nah', 'Habakkuk': 'Hab', 'Zephaniah': 'Zeph',
  'Haggai': 'Hag', 'Zechariah': 'Zech', 'Malachi': 'Mal',
  'Matthew': 'Matt', 'Mark': 'Mark', 'Luke': 'Luke', 'John': 'John', 'Acts': 'Acts',
  'Romans': 'Rom', '1 Corinthians': '1 Cor', '2 Corinthians': '2 Cor',
  'Galatians': 'Gal', 'Ephesians': 'Eph', 'Philippians': 'Phil', 'Colossians': 'Col',
  '1 Thessalonians': '1 Thess', '2 Thessalonians': '2 Thess',
  '1 Timothy': '1 Tim', '2 Timothy': '2 Tim', 'Titus': 'Titus', 'Philemon': 'Phlm',
  'Hebrews': 'Heb', 'James': 'Jas', '1 Peter': '1 Pet', '2 Peter': '2 Pet',
  '1 John': '1 John', '2 John': '2 John', '3 John': '3 John', 'Jude': 'Jude',
  'Revelation': 'Rev',
};

/**
 * A book's name compressed for dense lists — the reading plan's one-line day
 * rows, where "1 Chronicles 12" would push the rest of the day off the line.
 * Falls back to the full name for anything unrecognised.
 */
export function shortBookName(book: string): string {
  const name = normalizeBookName(book);
  return SHORT_BOOK_NAMES[name] ?? name;
}

/**
 * Category → accent color, mirroring the reference dropdown tints in NavigationBar.
 * Single source of truth for book-category color cues (book lists, verse highlights).
 */
export const CATEGORY_COLORS: Record<BookInfo['category'], string> = {
  'pentateuch': '#a67c52',
  'historical': '#6ca0dc',
  'wisdom': '#f0c040',
  'major-prophets': '#5c1e99',
  'minor-prophets': '#a45be9',
  'gospels': '#fc345c',
  'acts': '#ff6520',
  'pauline': '#6048cc',
  'general': '#f2893e',
  'revelation': '#61f1ff',
};

/** Human-readable display names for each book category (shown in nav grouping). */
export const CATEGORY_LABELS: Record<BookInfo['category'], string> = {
  'pentateuch': 'Pentateuch',
  'historical': 'Historical',
  'wisdom': 'Wisdom',
  'major-prophets': 'Major Prophets',
  'minor-prophets': 'Minor Prophets',
  'gospels': 'Gospels',
  'acts': 'Acts',
  'pauline': 'Pauline Epistles',
  'general': 'General Epistles',
  'revelation': 'Eschaton',
};

/** Accent color for a book (by name, normalized). Falls back to a neutral gray. */
export function getBookColor(book: string): string {
  const info = BIBLE_BOOKS.find(b => b.name === normalizeBookName(book));
  return info ? CATEGORY_COLORS[info.category] : '#8a8f98';
}

export function getBookChapters(bookName: string): number {
  // Normalize first, like getBookColor above — otherwise an alias spelling
  // (e.g. the plural "Psalms") silently answers "1 chapter".
  const book = BIBLE_BOOKS.find(b => b.name === normalizeBookName(bookName));
  return book?.chapters || 1;
}

export function getBookNames(): string[] {
  return BIBLE_BOOKS.map(b => b.name);
}

// Display order for the translation dropdown: English first, then ancient languages.
// Anything not listed here sorts to the end alphabetically.
export const TRANSLATION_ORDER = [
  'NET',
  'BSB',
  'WEB',
  'KJV',
  'LXX2012',
  'TR',
  'BYZ',
  'LXX',
  'HEBREW-OSHB'
];

// Display labels. The keys are translation IDs and must not change — the ID is a
// storage key (verses, morphology, highlights, saved nav state). Only the label changes.
const TRANSLATION_LABELS: Record<string, string> = {
  'HEBREW-OSHB': 'OSHB-HEBREW',
  'TR': 'TR-GREEK',
  'BYZ': 'BYZ-GREEK',
  // Not the Septuagint. What ships under this id is the Open Scriptures lemma
  // analysis — every word in its dictionary form, so Gen 1:1 reads
  // "ἐν ἀρχή ποιέω ὁ θεός" rather than "ἐν ἀρχῇ ἐποίησεν ὁ θεὸς". Useful for
  // vocabulary, misleading if it claims to be the text. Renamed until a real
  // inflected LXX lands.
  'LXX': 'LXX-LEMMAS'
};

/**
 * Get the label to display for a translation ID (falls back to the ID itself)
 */
export function translationLabel(translationId: string): string {
  if (!translationId) return translationId;
  const upper = translationId.toUpperCase();
  return TRANSLATION_LABELS[upper] || translationId;
}

/**
 * Sort key for a translation ID — its position in TRANSLATION_ORDER, or the end
 */
export function translationSortIndex(translationId: string): number {
  const index = TRANSLATION_ORDER.indexOf(translationId.toUpperCase());
  return index === -1 ? TRANSLATION_ORDER.length : index;
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
