#!/usr/bin/env node

/**
 * Build LXX (Septuagint) Pack
 * 
 * Creates a standalone LXX pack with Greek Old Testament text.
 * This uses the lemma-based reconstruction from OpenScriptures.
 * 
 * Source: OpenScriptures LXX Lemma Project
 * License: CC BY 4.0
 * 
 * Usage:
 *   node scripts/build-lxx-pack.mjs
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const SOURCE_FILE = join(repoRoot, 'data-sources/LXX-Greek.json');
const OUTPUT_FILE = join(repoRoot, 'packs/lxx-greek.sqlite');

function buildLXXPack() {
  console.log('📖 Building LXX (Septuagint) Pack...\n');
  
  // Check source file
  if (!existsSync(SOURCE_FILE)) {
    console.error('❌ Source file not found:', SOURCE_FILE);
    console.error('   Run: node scripts/download-lxx.mjs');
    process.exit(1);
  }
  
  // Ensure output directory exists
  if (!existsSync(join(repoRoot, 'packs'))) {
    mkdirSync(join(repoRoot, 'packs'), { recursive: true });
  }
  
  // Load source data
  console.log('📥 Loading LXX data...');
  const data = JSON.parse(readFileSync(SOURCE_FILE, 'utf-8'));
  
  // Create database
  const db = new Database(OUTPUT_FILE);
  
  // Create schema
  console.log('🔧 Creating schema...');
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
    CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses(book, chapter);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('packId', 'lxx-greek-v1');
  insertMeta.run('packVersion', '1.0.0');
  insertMeta.run('packType', 'bible');
  insertMeta.run('language', 'grc'); // Ancient Greek
  insertMeta.run('languageName', 'Greek');
  insertMeta.run('translation', data.translation);
  insertMeta.run('source', data.source);
  insertMeta.run('license', data.license);
  insertMeta.run('note', data.note);
  insertMeta.run('testament', 'OT');
  insertMeta.run('description', 'Septuagint (LXX) - Greek translation of Hebrew Bible');
  insertMeta.run('createdAt', new Date().toISOString());
  
  console.log('✅ Metadata added\n');
  
  // Insert verses
  console.log('📝 Importing verses...');
  const insertVerse = db.prepare('INSERT INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
  
  const insertMany = db.transaction((books) => {
    for (const book of books) {
      for (const chapter of book.chapters) {
        for (const verse of chapter.verses) {
          insertVerse.run(book.name, chapter.chapter, verse.verse, verse.text);
        }
      }
    }
  });
  
  insertMany(data.books);
  
  // Summary
  const stats = db.prepare(`
    SELECT 
      COUNT(DISTINCT book) as books,
      COUNT(DISTINCT book || '-' || chapter) as chapters,
      COUNT(*) as verses,
      SUM(LENGTH(text)) as total_chars
    FROM verses
  `).get();
  
  const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
  
  console.log('\n📊 Pack Summary:');
  console.log(`   Books: ${stats.books}`);
  console.log(`   Chapters: ${stats.chapters}`);
  console.log(`   Verses: ${stats.verses}`);
  console.log(`   Characters: ${stats.total_chars.toLocaleString()}`);
  console.log(`   Size: ${(dbSize.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Output: ${OUTPUT_FILE}`);
  
  // Show sample verse
  const sample = db.prepare('SELECT * FROM verses WHERE book = ? AND chapter = 1 AND verse = 1').get('Genesis');
  console.log(`\n📖 Sample (Genesis 1:1):`);
  console.log(`   ${sample.text}`);
  
  db.close();
  
  console.log('\n✅ LXX pack built successfully!');
}

buildLXXPack();
