/**
 * USFM (Unified Standard Format Markers) Bible Parser
 * 
 * Parses USFM files from eBible.org and other sources
 * into SQLite packs for ProjectBible.
 * 
 * USFM is a text-based format with backslash markers:
 * \id - Book ID
 * \c - Chapter
 * \v - Verse
 * \f - Footnote
 * \x - Cross-reference
 */

import fs from 'fs';
import path from 'path';

/**
 * USFM book ID to standard name mapping
 */
const USFM_BOOK_MAP = {
  'GEN': 'Genesis',
  'EXO': 'Exodus',
  'LEV': 'Leviticus',
  'NUM': 'Numbers',
  'DEU': 'Deuteronomy',
  'JOS': 'Joshua',
  'JDG': 'Judges',
  'RUT': 'Ruth',
  '1SA': '1 Samuel',
  '2SA': '2 Samuel',
  '1KI': '1 Kings',
  '2KI': '2 Kings',
  '1CH': '1 Chronicles',
  '2CH': '2 Chronicles',
  'EZR': 'Ezra',
  'NEH': 'Nehemiah',
  'EST': 'Esther',
  'JOB': 'Job',
  'PSA': 'Psalms',
  'PRO': 'Proverbs',
  'ECC': 'Ecclesiastes',
  'SNG': 'Song of Solomon',
  'ISA': 'Isaiah',
  'JER': 'Jeremiah',
  'LAM': 'Lamentations',
  'EZK': 'Ezekiel',
  'DAN': 'Daniel',
  'HOS': 'Hosea',
  'JOL': 'Joel',
  'AMO': 'Amos',
  'OBA': 'Obadiah',
  'JON': 'Jonah',
  'MIC': 'Micah',
  'NAM': 'Nahum',
  'HAB': 'Habakkuk',
  'ZEP': 'Zephaniah',
  'HAG': 'Haggai',
  'ZEC': 'Zechariah',
  'MAL': 'Malachi',
  // NT
  'MAT': 'Matthew',
  'MRK': 'Mark',
  'LUK': 'Luke',
  'JHN': 'John',
  'ACT': 'Acts',
  'ROM': 'Romans',
  '1CO': '1 Corinthians',
  '2CO': '2 Corinthians',
  'GAL': 'Galatians',
  'EPH': 'Ephesians',
  'PHP': 'Philippians',
  'COL': 'Colossians',
  '1TH': '1 Thessalonians',
  '2TH': '2 Thessalonians',
  '1TI': '1 Timothy',
  '2TI': '2 Timothy',
  'TIT': 'Titus',
  'PHM': 'Philemon',
  'HEB': 'Hebrews',
  'JAS': 'James',
  '1PE': '1 Peter',
  '2PE': '2 Peter',
  '1JN': '1 John',
  '2JN': '2 John',
  '3JN': '3 John',
  'JUD': 'Jude',
  'REV': 'Revelation',
  // Apocrypha/Deuterocanon
  'TOB': 'Tobit',
  'JDT': 'Judith',
  'WIS': 'Wisdom',
  'SIR': 'Sirach',
  'BAR': 'Baruch',
  'LJE': 'Epistle of Jeremiah',
  'S3Y': 'Prayer of Azariah',
  'SUS': 'Susanna',
  'BEL': 'Bel and the Dragon',
  '1MA': '1 Maccabees',
  '2MA': '2 Maccabees',
  '3MA': '3 Maccabees',
  '4MA': '4 Maccabees',
  '1ES': '1 Esdras',
  '2ES': '2 Esdras',
  'MAN': 'Prayer of Manasseh'
};

/**
 * Parse a single USFM file
 */
export function parseUSFMFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  let bookId = null;
  let bookName = null;
  let currentChapter = null;
  const verses = [];
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    // Book ID
    if (line.startsWith('\\id ')) {
      bookId = line.substring(4).trim().split(/\s+/)[0];
      bookName = USFM_BOOK_MAP[bookId] || bookId;
      continue;
    }
    
    // Chapter
    if (line.startsWith('\\c ')) {
      currentChapter = parseInt(line.substring(3).trim());
      continue;
    }
    
    // Verse
    if (line.startsWith('\\v ')) {
      if (!bookName || currentChapter === null) {
        continue;
      }
      
      const verseContent = line.substring(3).trim();
      const spaceIndex = verseContent.indexOf(' ');
      const verseNum = parseInt(verseContent.substring(0, spaceIndex));
      let text = verseContent.substring(spaceIndex + 1).trim();
      
      // Remove footnotes (\f ... \f*)
      text = text.replace(/\\f\s+\+[^\\]*\\f\*/g, '');
      
      // Remove cross-references (\x ... \x*)
      text = text.replace(/\\x\s+\+[^\\]*\\x\*/g, '');
      
      // Remove other markers
      text = text.replace(/\\[a-z]+\*?/g, '');
      
      // Clean up extra whitespace
      text = text.trim().replace(/\s+/g, ' ');
      
      if (text) {
        verses.push({
          book: bookName,
          chapter: currentChapter,
          verse: verseNum,
          text
        });
      }
    }
  }
  
  return { bookName, verses };
}

/**
 * Parse all USFM files in a directory
 */
export function parseUSFMDirectory(dirPath) {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.usfm'))
    .sort();
  
  let allVerses = [];
  const metadata = {
    source: 'usfm',
    books: []
  };
  
  for (const file of files) {
    // Skip front matter and intro files
    if (file.startsWith('00-') || file.startsWith('01-INT')) {
      continue;
    }
    
    const filePath = path.join(dirPath, file);
    console.log(`  📄 Parsing ${file}...`);
    
    const { bookName, verses } = parseUSFMFile(filePath);
    if (bookName && verses.length > 0) {
      metadata.books.push(bookName);
      allVerses = allVerses.concat(verses);
      console.log(`     ✅ ${verses.length} verses`);
    }
  }
  
  return {
    metadata,
    verses: allVerses
  };
}

/**
 * Build SQLite pack from USFM directory
 */
export async function buildPackFromUSFM(dirPath, outputPath, packMetadata = {}) {
  const Database = (await import('better-sqlite3')).default;
  
  console.log(`\n📖 Parsing USFM files from ${path.basename(dirPath)}...\n`);
  const parsedData = parseUSFMDirectory(dirPath);
  
  console.log(`\n💾 Building SQLite pack: ${path.basename(outputPath)}`);
  
  const db = new Database(outputPath);
  
  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS verses (
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (book, chapter, verse)
    );
    
    CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
    CREATE INDEX IF NOT EXISTS idx_verses_book_chapter ON verses(book, chapter);
  `);
  
  // Insert metadata - use snake_case for compatibility with pack-import.ts
  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('source', parsedData.metadata.source);
  insertMeta.run('books', JSON.stringify(parsedData.metadata.books));
  
  // Map camelCase to snake_case for consistency
  const metadataKeyMap = {
    packId: 'pack_id',
    packVersion: 'version',
    packType: 'type',
    translationId: 'translation_id',
    translationName: 'translation_name',
    languageName: 'language_name'
  };
  
  for (const [key, value] of Object.entries(packMetadata)) {
    const dbKey = metadataKeyMap[key] || key;
    insertMeta.run(dbKey, String(value));
  }
  
  insertMeta.run('createdAt', new Date().toISOString());
  
  // Insert verses
  const insertVerse = db.prepare('INSERT OR REPLACE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((verses) => {
    for (const verse of verses) {
      insertVerse.run(verse.book, verse.chapter, verse.verse, verse.text);
    }
  });
  
  insertMany(parsedData.verses);
  
  console.log(`✅ Inserted ${parsedData.verses.length} verses`);
  console.log(`   Books: ${parsedData.metadata.books.length}`);
  
  db.close();
  
  return outputPath;
}
