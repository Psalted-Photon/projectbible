#!/usr/bin/env node
/**
 * Build Consolidated Translation Pack
 * 
 * Merges all English translations into a single pack.
 * This is Step 1 of the consolidation process - start simple.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs');
const OUTPUT_DIR = join(repoRoot, 'packs/consolidated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'translations.sqlite');

console.log('📦 Building Translations Pack...\n');

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Source translations
const translations = [
  { file: 'kjv.sqlite', id: 'kjv', name: 'King James Version' },
  { file: 'web.sqlite', id: 'web', name: 'World English Bible' },
  { file: 'bsb.sqlite', id: 'bsb', name: 'Berean Study Bible' },
  { file: 'net.sqlite', id: 'net', name: 'New English Translation' },
  { file: 'lxx2012-english.sqlite', id: 'lxx2012', name: 'LXX 2012 English' }
];

// Create output database
console.log('Creating output database...');
const output = new Database(OUTPUT_FILE);

// Create schema
output.exec(`
  -- Pack metadata
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  -- Translation registry
  CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    description TEXT
  );
  
  -- Unified verses table
  CREATE TABLE verses (
    translation_id TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (translation_id, book, chapter, verse)
  );
  
  CREATE INDEX idx_verses_translation ON verses(translation_id);
  CREATE INDEX idx_verses_book ON verses(book);
  CREATE INDEX idx_verses_chapter ON verses(book, chapter);
`);

// Insert pack metadata
console.log('Inserting pack metadata...');
const insertMeta = output.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta.run('id', 'translations');
insertMeta.run('version', '1.0.0');
insertMeta.run('type', 'translation');
insertMeta.run('schemaVersion', '1');
insertMeta.run('minAppVersion', '1.0.0');
insertMeta.run('name', 'English Translations Pack');
insertMeta.run('description', 'KJV, WEB, BSB, NET, LXX2012 English translations');
insertMeta.run('createdAt', new Date().toISOString());

// Merge each translation
let totalVerses = 0;

for (const trans of translations) {
  const packPath = join(PACKS_DIR, trans.file);
  
  if (!existsSync(packPath)) {
    console.log(`   ⚠️  Skipping ${trans.id} - pack not found`);
    continue;
  }
  
  console.log(`\n   Merging ${trans.id}...`);
  
  try {
    const source = new Database(packPath, { readonly: true });
    
    // Register translation
    output.prepare(`
      INSERT INTO translations (id, name, language, description)
      VALUES (?, ?, 'en', ?)
    `).run(trans.id, trans.name, `${trans.name} translation`);
    
    // Copy verses
    const verses = source.prepare('SELECT book, chapter, verse, text FROM verses').all();
    console.log(`      ${verses.length.toLocaleString()} verses`);
    
    const insertVerse = output.prepare(`
      INSERT INTO verses (translation_id, book, chapter, verse, text)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const copyVerse = output.transaction((verses) => {
      for (const v of verses) {
        insertVerse.run(trans.id, v.book, v.chapter, v.verse, v.text);
      }
    });
    
    copyVerse(verses);
    totalVerses += verses.length;
    
    source.close();
    console.log(`      ✅ Complete`);
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
  }
}

// Optimize database
console.log('\nOptimizing database...');
output.exec('VACUUM');
output.exec('ANALYZE');

output.close();

// Get final stats
const stats = statSync(OUTPUT_FILE);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('\n✅ Translations pack complete!');
console.log(`📍 Output: ${OUTPUT_FILE}`);
console.log(`📊 Size: ${sizeMB} MB`);
console.log(`📖 Verses: ${totalVerses.toLocaleString()}`);
console.log(`📚 Translations: ${translations.length}`);
