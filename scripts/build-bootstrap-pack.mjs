#!/usr/bin/env node
/**
 * Build Bootstrap Pack
 * 
 * Creates a minimal SQLite database shipped with the app bundle to enable
 * instant startup before any packs are downloaded.
 * 
 * Contains:
 * - Book names and metadata
 * - Verse counts per chapter
 * - Precomputed verse offsets
 * - Canonical ordering tables
 * - Chapter/verse lookup tables
 * - Reference parsing rules
 * - UI metadata
 * 
 * Target size: ~200KB
 * Location: Bundled with app (not downloaded)
 * 
 * Usage: node scripts/build-bootstrap-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const OUTPUT_PATH = join(repoRoot, 'packs/bootstrap.sqlite');

// Canonical book order and metadata
const BOOKS = [
  // Old Testament
  { id: 'Gen', name: 'Genesis', testament: 'OT', order: 1, chapters: 50 },
  { id: 'Exod', name: 'Exodus', testament: 'OT', order: 2, chapters: 40 },
  { id: 'Lev', name: 'Leviticus', testament: 'OT', order: 3, chapters: 27 },
  { id: 'Num', name: 'Numbers', testament: 'OT', order: 4, chapters: 36 },
  { id: 'Deut', name: 'Deuteronomy', testament: 'OT', order: 5, chapters: 34 },
  { id: 'Josh', name: 'Joshua', testament: 'OT', order: 6, chapters: 24 },
  { id: 'Judg', name: 'Judges', testament: 'OT', order: 7, chapters: 21 },
  { id: 'Ruth', name: 'Ruth', testament: 'OT', order: 8, chapters: 4 },
  { id: '1Sam', name: '1 Samuel', testament: 'OT', order: 9, chapters: 31 },
  { id: '2Sam', name: '2 Samuel', testament: 'OT', order: 10, chapters: 24 },
  { id: '1Kgs', name: '1 Kings', testament: 'OT', order: 11, chapters: 22 },
  { id: '2Kgs', name: '2 Kings', testament: 'OT', order: 12, chapters: 25 },
  { id: '1Chr', name: '1 Chronicles', testament: 'OT', order: 13, chapters: 29 },
  { id: '2Chr', name: '2 Chronicles', testament: 'OT', order: 14, chapters: 36 },
  { id: 'Ezra', name: 'Ezra', testament: 'OT', order: 15, chapters: 10 },
  { id: 'Neh', name: 'Nehemiah', testament: 'OT', order: 16, chapters: 13 },
  { id: 'Esth', name: 'Esther', testament: 'OT', order: 17, chapters: 10 },
  { id: 'Job', name: 'Job', testament: 'OT', order: 18, chapters: 42 },
  { id: 'Ps', name: 'Psalms', testament: 'OT', order: 19, chapters: 150 },
  { id: 'Prov', name: 'Proverbs', testament: 'OT', order: 20, chapters: 31 },
  { id: 'Eccl', name: 'Ecclesiastes', testament: 'OT', order: 21, chapters: 12 },
  { id: 'Song', name: 'Song of Solomon', testament: 'OT', order: 22, chapters: 8 },
  { id: 'Isa', name: 'Isaiah', testament: 'OT', order: 23, chapters: 66 },
  { id: 'Jer', name: 'Jeremiah', testament: 'OT', order: 24, chapters: 52 },
  { id: 'Lam', name: 'Lamentations', testament: 'OT', order: 25, chapters: 5 },
  { id: 'Ezek', name: 'Ezekiel', testament: 'OT', order: 26, chapters: 48 },
  { id: 'Dan', name: 'Daniel', testament: 'OT', order: 27, chapters: 12 },
  { id: 'Hos', name: 'Hosea', testament: 'OT', order: 28, chapters: 14 },
  { id: 'Joel', name: 'Joel', testament: 'OT', order: 29, chapters: 3 },
  { id: 'Amos', name: 'Amos', testament: 'OT', order: 30, chapters: 9 },
  { id: 'Obad', name: 'Obadiah', testament: 'OT', order: 31, chapters: 1 },
  { id: 'Jonah', name: 'Jonah', testament: 'OT', order: 32, chapters: 4 },
  { id: 'Mic', name: 'Micah', testament: 'OT', order: 33, chapters: 7 },
  { id: 'Nah', name: 'Nahum', testament: 'OT', order: 34, chapters: 3 },
  { id: 'Hab', name: 'Habakkuk', testament: 'OT', order: 35, chapters: 3 },
  { id: 'Zeph', name: 'Zephaniah', testament: 'OT', order: 36, chapters: 3 },
  { id: 'Hag', name: 'Haggai', testament: 'OT', order: 37, chapters: 2 },
  { id: 'Zech', name: 'Zechariah', testament: 'OT', order: 38, chapters: 14 },
  { id: 'Mal', name: 'Malachi', testament: 'OT', order: 39, chapters: 4 },
  
  // New Testament
  { id: 'Matt', name: 'Matthew', testament: 'NT', order: 40, chapters: 28 },
  { id: 'Mark', name: 'Mark', testament: 'NT', order: 41, chapters: 16 },
  { id: 'Luke', name: 'Luke', testament: 'NT', order: 42, chapters: 24 },
  { id: 'John', name: 'John', testament: 'NT', order: 43, chapters: 21 },
  { id: 'Acts', name: 'Acts', testament: 'NT', order: 44, chapters: 28 },
  { id: 'Rom', name: 'Romans', testament: 'NT', order: 45, chapters: 16 },
  { id: '1Cor', name: '1 Corinthians', testament: 'NT', order: 46, chapters: 16 },
  { id: '2Cor', name: '2 Corinthians', testament: 'NT', order: 47, chapters: 13 },
  { id: 'Gal', name: 'Galatians', testament: 'NT', order: 48, chapters: 6 },
  { id: 'Eph', name: 'Ephesians', testament: 'NT', order: 49, chapters: 6 },
  { id: 'Phil', name: 'Philippians', testament: 'NT', order: 50, chapters: 4 },
  { id: 'Col', name: 'Colossians', testament: 'NT', order: 51, chapters: 4 },
  { id: '1Thess', name: '1 Thessalonians', testament: 'NT', order: 52, chapters: 5 },
  { id: '2Thess', name: '2 Thessalonians', testament: 'NT', order: 53, chapters: 3 },
  { id: '1Tim', name: '1 Timothy', testament: 'NT', order: 54, chapters: 6 },
  { id: '2Tim', name: '2 Timothy', testament: 'NT', order: 55, chapters: 4 },
  { id: 'Titus', name: 'Titus', testament: 'NT', order: 56, chapters: 3 },
  { id: 'Phlm', name: 'Philemon', testament: 'NT', order: 57, chapters: 1 },
  { id: 'Heb', name: 'Hebrews', testament: 'NT', order: 58, chapters: 13 },
  { id: 'Jas', name: 'James', testament: 'NT', order: 59, chapters: 5 },
  { id: '1Pet', name: '1 Peter', testament: 'NT', order: 60, chapters: 5 },
  { id: '2Pet', name: '2 Peter', testament: 'NT', order: 61, chapters: 3 },
  { id: '1John', name: '1 John', testament: 'NT', order: 62, chapters: 5 },
  { id: '2John', name: '2 John', testament: 'NT', order: 63, chapters: 1 },
  { id: '3John', name: '3 John', testament: 'NT', order: 64, chapters: 1 },
  { id: 'Jude', name: 'Jude', testament: 'NT', order: 65, chapters: 1 },
  { id: 'Rev', name: 'Revelation', testament: 'NT', order: 66, chapters: 22 }
];

// Verse counts per chapter (canonical Protestant Bible)
const VERSE_COUNTS = {
  'Genesis': [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  'Exodus': [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  'Leviticus': [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],
  'Numbers': [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
  'Deuteronomy': [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
  'Joshua': [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
  'Judges': [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
  'Ruth': [22,23,18,22],
  '1 Samuel': [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13],
  '2 Samuel': [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
  '1 Kings': [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
  '2 Kings': [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
  '1 Chronicles': [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
  '2 Chronicles': [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
  'Ezra': [11,70,13,24,17,22,28,36,15,44],
  'Nehemiah': [11,20,32,23,19,19,73,18,38,39,36,47,31],
  'Esther': [22,23,15,17,14,14,10,17,32,3],
  'Job': [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],
  'Psalms': [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  'Proverbs': [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31],
  'Ecclesiastes': [18,26,22,16,20,12,29,17,18,20,10,14],
  'Song of Solomon': [17,17,11,16,16,13,13,14],
  'Isaiah': [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],
  'Jeremiah': [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],
  'Lamentations': [22,22,66,22,22],
  'Ezekiel': [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
  'Daniel': [21,49,30,37,31,28,28,27,27,21,45,13],
  'Hosea': [11,23,5,19,15,11,16,14,17,15,12,14,16,9],
  'Joel': [20,32,21],
  'Amos': [15,16,15,13,27,14,17,14,15],
  'Obadiah': [21],
  'Jonah': [17,10,10,11],
  'Micah': [16,13,12,13,15,16,20],
  'Nahum': [15,13,19],
  'Habakkuk': [17,20,19],
  'Zephaniah': [18,15,20],
  'Haggai': [15,23],
  'Zechariah': [21,13,10,14,11,15,14,23,17,12,17,14,9,21],
  'Malachi': [14,17,18,6],
  'Matthew': [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  'Mark': [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  'Luke': [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  'John': [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  'Acts': [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  'Romans': [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  '1 Corinthians': [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  '2 Corinthians': [24,17,18,18,21,18,16,24,15,18,33,21,14],
  'Galatians': [24,21,29,31,26,18],
  'Ephesians': [23,22,21,32,33,24],
  'Philippians': [30,30,21,23],
  'Colossians': [29,23,25,18],
  '1 Thessalonians': [10,20,13,18,28],
  '2 Thessalonians': [12,17,18],
  '1 Timothy': [20,15,16,16,25,21],
  '2 Timothy': [18,26,17,22],
  'Titus': [16,15,15],
  'Philemon': [25],
  'Hebrews': [14,18,19,16,14,20,28,13,28,39,40,29,25],
  'James': [27,26,18,17,20],
  '1 Peter': [25,25,22,19,14],
  '2 Peter': [21,22,18],
  '1 John': [10,29,24,21,21],
  '2 John': [13],
  '3 John': [14],
  'Jude': [25],
  'Revelation': [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21]
};

// Common book name variations for reference parsing
const BOOK_ALIASES = [
  { canonical: 'Gen', aliases: ['Genesis', 'Ge', 'Gn'] },
  { canonical: 'Exod', aliases: ['Exodus', 'Ex', 'Exo'] },
  { canonical: 'Lev', aliases: ['Leviticus', 'Le', 'Lv'] },
  { canonical: 'Num', aliases: ['Numbers', 'Nu', 'Nm', 'Nb'] },
  { canonical: 'Deut', aliases: ['Deuteronomy', 'Dt', 'De'] },
  { canonical: 'Josh', aliases: ['Joshua', 'Jos', 'Jsh'] },
  { canonical: 'Judg', aliases: ['Judges', 'Jdg', 'Jg', 'Jdgs'] },
  { canonical: 'Ruth', aliases: ['Ru', 'Rth'] },
  { canonical: '1Sam', aliases: ['1 Samuel', '1Sam', '1 Sam', '1S', '1 S', 'I Samuel', 'I Sam'] },
  { canonical: '2Sam', aliases: ['2 Samuel', '2Sam', '2 Sam', '2S', '2 S', 'II Samuel', 'II Sam'] },
  { canonical: '1Kgs', aliases: ['1 Kings', '1Kgs', '1 Kgs', '1K', '1 K', 'I Kings', 'I Kgs'] },
  { canonical: '2Kgs', aliases: ['2 Kings', '2Kgs', '2 Kgs', '2K', '2 K', 'II Kings', 'II Kgs'] },
  { canonical: '1Chr', aliases: ['1 Chronicles', '1Chr', '1 Chr', '1Ch', 'I Chronicles', 'I Chr'] },
  { canonical: '2Chr', aliases: ['2 Chronicles', '2Chr', '2 Chr', '2Ch', 'II Chronicles', 'II Chr'] },
  { canonical: 'Ezra', aliases: ['Ezr'] },
  { canonical: 'Neh', aliases: ['Nehemiah', 'Ne'] },
  { canonical: 'Esth', aliases: ['Esther', 'Es'] },
  { canonical: 'Job', aliases: ['Jb'] },
  { canonical: 'Ps', aliases: ['Psalms', 'Psalm', 'Pslm', 'Psa', 'Psm', 'Pss'] },
  { canonical: 'Prov', aliases: ['Proverbs', 'Pr', 'Prv'] },
  { canonical: 'Eccl', aliases: ['Ecclesiastes', 'Ec', 'Ecc', 'Qoh'] },
  { canonical: 'Song', aliases: ['Song of Solomon', 'Song of Songs', 'SOS', 'So', 'Canticles', 'Canticle of Canticles'] },
  { canonical: 'Isa', aliases: ['Isaiah', 'Is'] },
  { canonical: 'Jer', aliases: ['Jeremiah', 'Je', 'Jr'] },
  { canonical: 'Lam', aliases: ['Lamentations', 'La'] },
  { canonical: 'Ezek', aliases: ['Ezekiel', 'Eze', 'Ezk'] },
  { canonical: 'Dan', aliases: ['Daniel', 'Da', 'Dn'] },
  { canonical: 'Hos', aliases: ['Hosea', 'Ho'] },
  { canonical: 'Joel', aliases: ['Joe', 'Jl'] },
  { canonical: 'Amos', aliases: ['Am'] },
  { canonical: 'Obad', aliases: ['Obadiah', 'Ob'] },
  { canonical: 'Jonah', aliases: ['Jon', 'Jnh'] },
  { canonical: 'Mic', aliases: ['Micah', 'Mc'] },
  { canonical: 'Nah', aliases: ['Nahum', 'Na'] },
  { canonical: 'Hab', aliases: ['Habakkuk', 'Hb'] },
  { canonical: 'Zeph', aliases: ['Zephaniah', 'Zep', 'Zp'] },
  { canonical: 'Hag', aliases: ['Haggai', 'Hg'] },
  { canonical: 'Zech', aliases: ['Zechariah', 'Zec', 'Zc'] },
  { canonical: 'Mal', aliases: ['Malachi', 'Ml'] },
  { canonical: 'Matt', aliases: ['Matthew', 'Mt', 'Mat'] },
  { canonical: 'Mark', aliases: ['Mrk', 'Mk', 'Mr'] },
  { canonical: 'Luke', aliases: ['Luk', 'Lk'] },
  { canonical: 'John', aliases: ['Joh', 'Jhn', 'Jn'] },
  { canonical: 'Acts', aliases: ['Act', 'Ac'] },
  { canonical: 'Rom', aliases: ['Romans', 'Ro', 'Rm'] },
  { canonical: '1Cor', aliases: ['1 Corinthians', '1Cor', '1 Cor', '1Co', 'I Corinthians', 'I Cor'] },
  { canonical: '2Cor', aliases: ['2 Corinthians', '2Cor', '2 Cor', '2Co', 'II Corinthians', 'II Cor'] },
  { canonical: 'Gal', aliases: ['Galatians', 'Ga'] },
  { canonical: 'Eph', aliases: ['Ephesians', 'Ephes'] },
  { canonical: 'Phil', aliases: ['Philippians', 'Php', 'Pp'] },
  { canonical: 'Col', aliases: ['Colossians', 'Co'] },
  { canonical: '1Thess', aliases: ['1 Thessalonians', '1Thess', '1 Thess', '1Th', 'I Thessalonians', 'I Thess'] },
  { canonical: '2Thess', aliases: ['2 Thessalonians', '2Thess', '2 Thess', '2Th', 'II Thessalonians', 'II Thess'] },
  { canonical: '1Tim', aliases: ['1 Timothy', '1Tim', '1 Tim', '1Ti', 'I Timothy', 'I Tim'] },
  { canonical: '2Tim', aliases: ['2 Timothy', '2Tim', '2 Tim', '2Ti', 'II Timothy', 'II Tim'] },
  { canonical: 'Titus', aliases: ['Tit', 'Ti'] },
  { canonical: 'Phlm', aliases: ['Philemon', 'Phm', 'Pm'] },
  { canonical: 'Heb', aliases: ['Hebrews', 'He'] },
  { canonical: 'Jas', aliases: ['James', 'Jm', 'Ja'] },
  { canonical: '1Pet', aliases: ['1 Peter', '1Pet', '1 Pet', '1Pe', '1P', 'I Peter', 'I Pet'] },
  { canonical: '2Pet', aliases: ['2 Peter', '2Pet', '2 Pet', '2Pe', '2P', 'II Peter', 'II Pet'] },
  { canonical: '1John', aliases: ['1 John', '1John', '1 Jn', '1Jn', '1J', 'I John', 'I Jn'] },
  { canonical: '2John', aliases: ['2 John', '2John', '2 Jn', '2Jn', '2J', 'II John', 'II Jn'] },
  { canonical: '3John', aliases: ['3 John', '3John', '3 Jn', '3Jn', '3J', 'III John', 'III Jn'] },
  { canonical: 'Jude', aliases: ['Jud', 'Jd'] },
  { canonical: 'Rev', aliases: ['Revelation', 'Re', 'The Revelation'] }
];

console.log('📦 Building Bootstrap Pack...\n');

// Ensure output directory exists
const outputDir = dirname(OUTPUT_PATH);
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Create database
const db = new Database(OUTPUT_PATH);

console.log('Creating schema...');
db.exec(`
  -- Pack metadata
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  -- Canonical book list with ordering
  CREATE TABLE books (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    testament TEXT NOT NULL,
    book_order INTEGER NOT NULL,
    chapter_count INTEGER NOT NULL
  );
  
  CREATE INDEX idx_books_order ON books(book_order);
  CREATE INDEX idx_books_testament ON books(testament);
  
  -- Verse counts per chapter
  CREATE TABLE chapter_verses (
    book_id TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse_count INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter),
    FOREIGN KEY (book_id) REFERENCES books(id)
  );
  
  CREATE INDEX idx_chapter_verses_book ON chapter_verses(book_id);
  
  -- Precomputed verse offsets for instant navigation
  -- verse_offset = total verses before this chapter in this book
  CREATE TABLE verse_offsets (
    book_id TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse_offset INTEGER NOT NULL,
    PRIMARY KEY (book_id, chapter),
    FOREIGN KEY (book_id) REFERENCES books(id)
  );
  
  CREATE INDEX idx_verse_offsets_book ON verse_offsets(book_id);
  
  -- Book name aliases for reference parsing
  CREATE TABLE book_aliases (
    alias TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL,
    FOREIGN KEY (canonical_id) REFERENCES books(id)
  );
  
  CREATE INDEX idx_book_aliases_canonical ON book_aliases(canonical_id);
  
  -- Reference parsing patterns (regex patterns for common formats)
  CREATE TABLE reference_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 0
  );
`);

console.log('Inserting metadata...');
const insertMetadata = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMetadata.run('id', 'bootstrap');
insertMetadata.run('version', '1.0.0');
insertMetadata.run('type', 'bootstrap');
insertMetadata.run('schemaVersion', '1');
insertMetadata.run('minAppVersion', '1.0.0');
insertMetadata.run('description', 'Bootstrap pack for instant app startup');
insertMetadata.run('createdAt', new Date().toISOString());

console.log('Inserting books...');
const insertBook = db.prepare(`
  INSERT INTO books (id, name, testament, book_order, chapter_count)
  VALUES (?, ?, ?, ?, ?)
`);

for (const book of BOOKS) {
  insertBook.run(book.id, book.name, book.testament, book.order, book.chapters);
}

console.log('Inserting verse counts and offsets...');
const insertChapterVerse = db.prepare(`
  INSERT INTO chapter_verses (book_id, chapter, verse_count)
  VALUES (?, ?, ?)
`);

const insertVerseOffset = db.prepare(`
  INSERT INTO verse_offsets (book_id, chapter, verse_offset)
  VALUES (?, ?, ?)
`);

for (const book of BOOKS) {
  const verseCounts = VERSE_COUNTS[book.name];
  if (!verseCounts) {
    console.warn(`⚠️  No verse counts for ${book.name}`);
    continue;
  }
  
  let cumulativeOffset = 0;
  
  for (let chapter = 1; chapter <= verseCounts.length; chapter++) {
    const verseCount = verseCounts[chapter - 1];
    
    // Insert verse count
    insertChapterVerse.run(book.id, chapter, verseCount);
    
    // Insert offset (offset for chapter N = sum of all verses in chapters 1 to N-1)
    insertVerseOffset.run(book.id, chapter, cumulativeOffset);
    
    cumulativeOffset += verseCount;
  }
}

console.log('Inserting book aliases...');
const insertAlias = db.prepare(`
  INSERT INTO book_aliases (alias, canonical_id)
  VALUES (?, ?)
`);

for (const { canonical, aliases } of BOOK_ALIASES) {
  // Insert canonical name itself
  insertAlias.run(canonical, canonical);
  
  // Insert all aliases
  for (const alias of aliases) {
    insertAlias.run(alias.toLowerCase(), canonical);
  }
}

console.log('Inserting reference patterns...');
const insertPattern = db.prepare(`
  INSERT INTO reference_patterns (pattern, description, priority)
  VALUES (?, ?, ?)
`);

// Common biblical reference patterns (in order of priority)
const patterns = [
  { pattern: '^([1-3]?[A-Za-z]+)\\s+(\\d+):(\\d+)-(\\d+)$', desc: 'Book Chapter:Verse-Verse', priority: 10 },
  { pattern: '^([1-3]?[A-Za-z]+)\\s+(\\d+):(\\d+)$', desc: 'Book Chapter:Verse', priority: 9 },
  { pattern: '^([1-3]?[A-Za-z]+)\\s+(\\d+)$', desc: 'Book Chapter', priority: 8 },
  { pattern: '^([1-3]?[A-Za-z]+)\\s+(\\d+):(\\d+)-(\\d+):(\\d+)$', desc: 'Book Chapter:Verse-Chapter:Verse', priority: 7 },
  { pattern: '^([1-3]?[A-Za-z]+(\\s+[A-Za-z]+)*)\\s+(\\d+):(\\d+)$', desc: 'Multi-word Book Chapter:Verse', priority: 6 }
];

for (const { pattern, desc, priority } of patterns) {
  insertPattern.run(pattern, desc, priority);
}

console.log('Optimizing database...');
db.exec('VACUUM');
db.exec('ANALYZE');

db.close();

// Get file size
const fs = await import('fs/promises');
const stats = await fs.stat(OUTPUT_PATH);
const sizeKB = (stats.size / 1024).toFixed(2);

console.log('\n✅ Bootstrap pack built successfully!');
console.log(`📍 Output: ${OUTPUT_PATH}`);
console.log(`📊 Size: ${sizeKB} KB`);
console.log(`📚 Books: ${BOOKS.length}`);
console.log(`🔤 Aliases: ${BOOK_ALIASES.reduce((sum, b) => sum + b.aliases.length + 1, 0)}`);
console.log(`📖 Total verses: ${Object.values(VERSE_COUNTS).flat().reduce((sum, n) => sum + n, 0).toLocaleString()}`);
console.log('\n💡 This pack enables:');
console.log('   • Instant app startup');
console.log('   • Immediate navigation');
console.log('   • Reference parsing without downloads');
console.log('   • Progressive enhancement UX');
