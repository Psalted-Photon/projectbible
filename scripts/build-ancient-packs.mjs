#!/usr/bin/env node
/**
 * Build ancient language packs (Hebrew WLC and Greek LXX)
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
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    insertMeta.run('pack_id', packId);
    insertMeta.run('version', '1.0.0');
    insertMeta.run('type', 'text');
    insertMeta.run('translation_id', translationId);
    insertMeta.run('translation_name', translationName);
    insertMeta.run('license', license);
    insertMeta.run('attribution', attribution);
    
    // Count and insert verses
    let verseCount = 0;
    const insertVerse = db.prepare('INSERT OR REPLACE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
    
    const insertMany = db.transaction((verses) => {
      for (const v of verses) {
        insertVerse.run(v.book, v.chapter, v.verse, v.text);
      }
    });
    
    const BATCH_SIZE = 1000;
    let batch = [];
    
    for (const book of data.books) {
      for (const chapter of book.chapters) {
        for (const verseObj of chapter.verses) {
          batch.push({
            book: book.name,
            chapter: chapter.chapter,
            verse: verseObj.verse,
            text: verseObj.text
          });
          verseCount++;
          
          if (batch.length >= BATCH_SIZE) {
            insertMany(batch);
            batch = [];
            if (verseCount % 5000 === 0) {
              console.log(`   Inserted ${verseCount} verses...`);
            }
          }
        }
      }
    }
    
    // Insert remaining
    if (batch.length > 0) {
      insertMany(batch);
    }
    
    console.log(`   ✅ Inserted ${verseCount} verses from ${data.books.length} books`);
    
    // Optimize
    db.exec('PRAGMA optimize;');
    
  } finally {
    db.close();
  }
  
  const size = (statSync(outputPath).size / (1024 * 1024)).toFixed(2);
  console.log(`   ✅ Pack built: ${size} MB`);
}

const repoRoot = resolve(__dirname, '..');

console.log('📦 Building Ancient Language Packs');
console.log('='.repeat(50));

// Build Hebrew (WLC)
buildPack(
  resolve(repoRoot, 'data-sources/WLC.json'),
  'wlc-full',
  'WLC',
  'Westminster Leningrad Codex (Hebrew)',
  'Public Domain',
  'Westminster Leningrad Codex. Public Domain.',
  resolve(repoRoot, 'packs/wlc-full.sqlite')
);

// Build LXX (Septuagint)
buildPack(
  resolve(repoRoot, 'data-sources/LXX.json'),
  'lxx-full',
  'LXX',
  'Septuagint (Greek Old Testament)',
  'Public Domain',
  'Traduction de la LXX par P. GIGUET. Public Domain.',
  resolve(repoRoot, 'packs/lxx-full.sqlite')
);

console.log('\n' + '='.repeat(50));
console.log('✅ Ancient language packs built successfully!');
