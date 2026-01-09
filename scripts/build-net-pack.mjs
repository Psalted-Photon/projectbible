#!/usr/bin/env node

/**
 * Download and Build NET Bible Pack (New English Translation)
 * 
 * Downloads the text-only version from bible.org API and builds a SQLite pack.
 * 
 * NET Bible License: Creative Commons BY 4.0
 * Source: bible.org (Biblical Studies Press)
 * 
 * Usage: node scripts/build-net-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const DATA_DIR = join(repoRoot, 'data-sources');
const CACHE_FILE = join(DATA_DIR, 'NET.json');
const OUTPUT_PATH = join(repoRoot, 'packs/net.sqlite');

// Bible.org API endpoint for NET Bible
const BIBLE_ORG_API = 'https://labs.bible.org/api/';

// All Bible books in canonical order
const BIBLE_BOOKS = [
  // Old Testament
  { name: 'Genesis', abbr: 'Gen', testament: 'OT' },
  { name: 'Exodus', abbr: 'Exod', testament: 'OT' },
  { name: 'Leviticus', abbr: 'Lev', testament: 'OT' },
  { name: 'Numbers', abbr: 'Num', testament: 'OT' },
  { name: 'Deuteronomy', abbr: 'Deut', testament: 'OT' },
  { name: 'Joshua', abbr: 'Josh', testament: 'OT' },
  { name: 'Judges', abbr: 'Judg', testament: 'OT' },
  { name: 'Ruth', abbr: 'Ruth', testament: 'OT' },
  { name: '1 Samuel', abbr: '1Sam', testament: 'OT' },
  { name: '2 Samuel', abbr: '2Sam', testament: 'OT' },
  { name: '1 Kings', abbr: '1Kgs', testament: 'OT' },
  { name: '2 Kings', abbr: '2Kgs', testament: 'OT' },
  { name: '1 Chronicles', abbr: '1Chr', testament: 'OT' },
  { name: '2 Chronicles', abbr: '2Chr', testament: 'OT' },
  { name: 'Ezra', abbr: 'Ezra', testament: 'OT' },
  { name: 'Nehemiah', abbr: 'Neh', testament: 'OT' },
  { name: 'Esther', abbr: 'Esth', testament: 'OT' },
  { name: 'Job', abbr: 'Job', testament: 'OT' },
  { name: 'Psalms', abbr: 'Ps', testament: 'OT' },
  { name: 'Proverbs', abbr: 'Prov', testament: 'OT' },
  { name: 'Ecclesiastes', abbr: 'Eccl', testament: 'OT' },
  { name: 'Song of Solomon', abbr: 'Song', testament: 'OT' },
  { name: 'Isaiah', abbr: 'Isa', testament: 'OT' },
  { name: 'Jeremiah', abbr: 'Jer', testament: 'OT' },
  { name: 'Lamentations', abbr: 'Lam', testament: 'OT' },
  { name: 'Ezekiel', abbr: 'Ezek', testament: 'OT' },
  { name: 'Daniel', abbr: 'Dan', testament: 'OT' },
  { name: 'Hosea', abbr: 'Hos', testament: 'OT' },
  { name: 'Joel', abbr: 'Joel', testament: 'OT' },
  { name: 'Amos', abbr: 'Amos', testament: 'OT' },
  { name: 'Obadiah', abbr: 'Obad', testament: 'OT' },
  { name: 'Jonah', abbr: 'Jonah', testament: 'OT' },
  { name: 'Micah', abbr: 'Mic', testament: 'OT' },
  { name: 'Nahum', abbr: 'Nah', testament: 'OT' },
  { name: 'Habakkuk', abbr: 'Hab', testament: 'OT' },
  { name: 'Zephaniah', abbr: 'Zeph', testament: 'OT' },
  { name: 'Haggai', abbr: 'Hag', testament: 'OT' },
  { name: 'Zechariah', abbr: 'Zech', testament: 'OT' },
  { name: 'Malachi', abbr: 'Mal', testament: 'OT' },
  // New Testament
  { name: 'Matthew', abbr: 'Matt', testament: 'NT' },
  { name: 'Mark', abbr: 'Mark', testament: 'NT' },
  { name: 'Luke', abbr: 'Luke', testament: 'NT' },
  { name: 'John', abbr: 'John', testament: 'NT' },
  { name: 'Acts', abbr: 'Acts', testament: 'NT' },
  { name: 'Romans', abbr: 'Rom', testament: 'NT' },
  { name: '1 Corinthians', abbr: '1Cor', testament: 'NT' },
  { name: '2 Corinthians', abbr: '2Cor', testament: 'NT' },
  { name: 'Galatians', abbr: 'Gal', testament: 'NT' },
  { name: 'Ephesians', abbr: 'Eph', testament: 'NT' },
  { name: 'Philippians', abbr: 'Phil', testament: 'NT' },
  { name: 'Colossians', abbr: 'Col', testament: 'NT' },
  { name: '1 Thessalonians', abbr: '1Thess', testament: 'NT' },
  { name: '2 Thessalonians', abbr: '2Thess', testament: 'NT' },
  { name: '1 Timothy', abbr: '1Tim', testament: 'NT' },
  { name: '2 Timothy', abbr: '2Tim', testament: 'NT' },
  { name: 'Titus', abbr: 'Titus', testament: 'NT' },
  { name: 'Philemon', abbr: 'Phlm', testament: 'NT' },
  { name: 'Hebrews', abbr: 'Heb', testament: 'NT' },
  { name: 'James', abbr: 'Jas', testament: 'NT' },
  { name: '1 Peter', abbr: '1Pet', testament: 'NT' },
  { name: '2 Peter', abbr: '2Pet', testament: 'NT' },
  { name: '1 John', abbr: '1John', testament: 'NT' },
  { name: '2 John', abbr: '2John', testament: 'NT' },
  { name: '3 John', abbr: '3John', testament: 'NT' },
  { name: 'Jude', abbr: 'Jude', testament: 'NT' },
  { name: 'Revelation', abbr: 'Rev', testament: 'NT' }
];

/**
 * Download NET Bible text from bible.org API
 */
async function downloadNETBible() {
  console.log('📥 Downloading NET Bible from bible.org...\n');
  
  const bibleData = {
    translation: 'NET',
    fullName: 'New English Translation',
    license: 'CC BY 4.0',
    attribution: 'NET Bible® copyright ©1996-2017 by Biblical Studies Press, L.L.C. http://netbible.com All rights reserved.',
    books: []
  };
  
  let totalVerses = 0;
  
  for (const book of BIBLE_BOOKS) {
    console.log(`Downloading ${book.name}...`);
    
    try {
      // Download entire book using bible.org API
      // Format: https://labs.bible.org/api/?passage=John&type=text&formatting=plain
      const url = `${BIBLE_ORG_API}?passage=${encodeURIComponent(book.name)}&type=text&formatting=plain`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`  ❌ Failed to download ${book.name}: ${response.status}`);
        continue;
      }
      
      const text = await response.text();
      
      // Parse the plain text response
      // Format is typically: "Book Chapter:Verse verse text\n"
      const verses = parseNETText(text, book.name);
      
      if (verses.length > 0) {
        bibleData.books.push({
          name: book.name,
          testament: book.testament,
          verses: verses
        });
        
        totalVerses += verses.length;
        console.log(`  ✓ ${verses.length} verses`);
      }
      
      // Rate limiting - be nice to bible.org
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`  ❌ Error downloading ${book.name}:`, error.message);
    }
  }
  
  console.log(`\n✅ Downloaded ${totalVerses} verses from ${bibleData.books.length} books`);
  
  return bibleData;
}

/**
 * Parse plain text NET Bible format
 */
function parseNETText(text, bookName) {
  const verses = [];
  const lines = text.trim().split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Try to match verse pattern
    // Could be: "Genesis 1:1 In the beginning..."
    // Or just: "1 In the beginning..." (if book name is omitted)
    const match = line.match(/^(?:.*?)?(\d+):(\d+)\s+(.+)$/);
    
    if (match) {
      const [, chapter, verse, verseText] = match;
      verses.push({
        chapter: parseInt(chapter),
        verse: parseInt(verse),
        text: verseText.trim()
      });
    }
  }
  
  return verses;
}

/**
 * Build SQLite pack from NET data
 */
function buildNETPack(data) {
  console.log('\n💾 Building NET Bible pack...\n');
  
  // Remove old pack if exists
  if (existsSync(OUTPUT_PATH)) {
    console.log('Removing old pack...');
    unlinkSync(OUTPUT_PATH);
  }
  
  const db = new Database(OUTPUT_PATH);
  
  // Create schema
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    
    CREATE TABLE verses (
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (book, chapter, verse)
    );
    
    CREATE INDEX idx_verses_book_chapter ON verses(book, chapter);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('pack_id', 'net');
  insertMeta.run('packId', 'net');
  insertMeta.run('type', 'text');
  insertMeta.run('version', '1.0.0');
  insertMeta.run('translation_id', 'NET');
  insertMeta.run('translationId', 'NET');
  insertMeta.run('translation_name', 'New English Translation');
  insertMeta.run('translationName', 'New English Translation');
  insertMeta.run('license', 'CC BY 4.0');
  insertMeta.run('attribution', data.attribution);
  insertMeta.run('description', 'New English Translation (NET Bible) - Modern scholarly translation with extensive translator notes');
  
  console.log('✓ Metadata inserted');
  
  // Insert verses
  const insertVerse = db.prepare('INSERT INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
  
  let totalVerses = 0;
  const insertTransaction = db.transaction((books) => {
    for (const book of books) {
      for (const verse of book.verses) {
        insertVerse.run(book.name, verse.chapter, verse.verse, verse.text);
        totalVerses++;
      }
    }
  });
  
  insertTransaction(data.books);
  
  console.log(`✓ Inserted ${totalVerses.toLocaleString()} verses`);
  
  db.close();
  
  console.log(`\n✅ NET Bible pack created: ${OUTPUT_PATH}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('📖 NET Bible Pack Builder\n');
  console.log('='.repeat(50) + '\n');
  
  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  
  let netData;
  
  // Check if we have cached data
  if (existsSync(CACHE_FILE)) {
    console.log('📂 Using cached NET Bible data...\n');
    netData = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } else {
    // Download fresh data
    netData = await downloadNETBible();
    
    // Cache the data
    console.log('\n💾 Caching NET Bible data...');
    writeFileSync(CACHE_FILE, JSON.stringify(netData, null, 2));
    console.log(`✓ Cached to ${CACHE_FILE}`);
  }
  
  // Build the pack
  buildNETPack(netData);
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ NET Bible pack built successfully!');
  console.log(`\nImport URL: https://github.com/Psalted-Photon/projectbible/raw/main/packs/net.sqlite`);
}

main().catch(error => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
