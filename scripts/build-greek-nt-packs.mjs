#!/usr/bin/env node
/**
 * Build Greek New Testament packs (Byzantine and Textus Receptus)
 */

import { readFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function buildPack(inputPath, packId, translationId, translationName, license, attribution, outputPath) {
  console.log(`\n📖 Building ${translationName}...`);
  console.log(`   Source: ${inputPath}`);
  
  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  
  const db = new Database(outputPath);
  
  try {
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
    
    // Insert metadata
    const metadata = {
      id: packId,
      translationId: translationId,
      translationName: translationName,
      version: '1.0',
      type: 'text',
      language: 'grc',
      languageName: 'Ancient Greek',
      license: license,
      attribution: attribution
    };
    
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    const metaTransaction = db.transaction((entries) => {
      for (const [key, value] of entries) {
        insertMeta.run(key, value);
      }
    });
    
    metaTransaction(Object.entries(metadata));
    
    // Insert verses (batch insert for performance)
    const insertVerse = db.prepare('INSERT INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
    const versesTransaction = db.transaction((verses) => {
      for (const v of verses) {
        insertVerse.run(v.book, v.chapter, v.verse, v.text);
      }
    });
    
    const allVerses = [];
    let verseCount = 0;
    let bookCount = 0;
    
    // Only include NT books (skip OT books with empty verses)
    const ntBooks = [
      'Matthew', 'Mark', 'Luke', 'John', 'Acts',
      'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians', 
      'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
      '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
      'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'
    ];
    
    for (const book of data.books) {
      if (!ntBooks.includes(book.name)) {
        continue; // Skip OT books
      }
      
      bookCount++;
      for (const chapterData of book.chapters) {
        for (const verseData of chapterData.verses) {
          if (verseData.text && verseData.text.trim()) { // Only insert non-empty verses
            allVerses.push({
              book: book.name,
              chapter: chapterData.chapter,
              verse: verseData.verse,
              text: verseData.text.trim()
            });
            verseCount++;
          }
        }
      }
    }
    
    console.log(`   Processing ${bookCount} books, ${verseCount} verses...`);
    
    // Batch insert all verses
    versesTransaction(allVerses);
    
    // Update metadata with counts
    insertMeta.run('bookCount', bookCount.toString());
    insertMeta.run('verseCount', verseCount.toString());
    
  } finally {
    db.close();
  }
  
  const size = (statSync(outputPath).size / (1024 * 1024)).toFixed(2);
  console.log(`   ✅ Pack built: ${size} MB`);
}

const repoRoot = resolve(__dirname, '..');

console.log('📦 Building Greek New Testament Packs');
console.log('='.repeat(50));

// Build Byzantine Greek NT
buildPack(
  resolve(repoRoot, 'data-sources/Byz.json'),
  'byz-full',
  'BYZ',
  'Byzantine Greek New Testament (2013)',
  'Public Domain',
  'The New Testament in the Original Greek: Byzantine Textform 2013. Edited by Maurice A. Robinson and William G. Pierpont.',
  resolve(repoRoot, 'packs/byz-full.sqlite')
);

// Build Textus Receptus
buildPack(
  resolve(repoRoot, 'data-sources/TR.json'),
  'tr-full',
  'TR',
  'Textus Receptus (1550/1894)',
  'Public Domain',
  'Textus Receptus (1550/1894). Public Domain.',
  resolve(repoRoot, 'packs/tr-full.sqlite')
);

console.log('\n' + '='.repeat(50));
console.log('✅ Greek New Testament packs built successfully!');
