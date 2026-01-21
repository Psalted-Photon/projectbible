#!/usr/bin/env node

/**
 * Build the English Dictionary Pack (Modern + Historic)
 * 
 * This creates dictionary-en.sqlite with:
 * - english_definitions_modern (Wiktionary)
 * - english_definitions_historic (GCIDE/Webster 1913)
 * - word_mapping (lemma → word_id)
 * 
 * Expected size: 1.4-1.7 GB (under 1.9 GB cap)
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const OUTPUT_PATH = join(projectRoot, 'packs', 'consolidated', 'dictionary-en.sqlite');

console.log('📖 Building English Dictionary Pack...\n');

// Create output directory if needed
const outputDir = dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Initialize database
const db = new Database(OUTPUT_PATH);

// Enable performance optimizations
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY');

console.log('🏗️  Creating schema...');

// Create modern definitions table (Wiktionary)
db.exec(`
  CREATE TABLE IF NOT EXISTS english_definitions_modern (
    id INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL,
    pos TEXT,
    sense_number TEXT,
    definition_order INTEGER NOT NULL,
    definition TEXT NOT NULL,
    example TEXT,
    etymology TEXT,
    raw_etymology TEXT,
    tags TEXT,
    search_tokens TEXT,
    source TEXT DEFAULT 'wiktionary',
    source_url TEXT
  );
  
  CREATE INDEX IF NOT EXISTS idx_modern_word_id 
    ON english_definitions_modern(word_id);
  
  CREATE INDEX IF NOT EXISTS idx_modern_order 
    ON english_definitions_modern(word_id, definition_order);
`);

// Create historic definitions table (GCIDE/Webster 1913)
db.exec(`
  CREATE TABLE IF NOT EXISTS english_definitions_historic (
    id INTEGER PRIMARY KEY,
    word_id INTEGER NOT NULL,
    pos TEXT,
    sense_number TEXT,
    definition_order INTEGER NOT NULL,
    definition TEXT NOT NULL,
    example TEXT,
    search_tokens TEXT,
    source TEXT DEFAULT 'gcide',
    source_url TEXT
  );
  
  CREATE INDEX IF NOT EXISTS idx_historic_word_id 
    ON english_definitions_historic(word_id);
  
  CREATE INDEX IF NOT EXISTS idx_historic_order 
    ON english_definitions_historic(word_id, definition_order);
`);

// Create word mapping table (lemma → word_id)
db.exec(`
  CREATE TABLE IF NOT EXISTS word_mapping (
    lemma TEXT PRIMARY KEY,
    word_id INTEGER NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_mapping_word_id 
    ON word_mapping(word_id);
`);

// Create pack metadata table
db.exec(`
  CREATE TABLE IF NOT EXISTS pack_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Insert pack metadata
const metadata = {
  id: 'dictionary-en',
  name: 'English Dictionary (Modern + Historic)',
  type: 'dictionary',
  language: 'en',
  version: '1.0',
  description: '6M+ definitions from Wiktionary + Webster 1913',
  build_date: new Date().toISOString(),
  sources: JSON.stringify([
    { name: 'Wiktionary', url: 'https://en.wiktionary.org/', license: 'CC BY-SA 3.0' },
    { name: 'GCIDE/Webster 1913', license: 'Public Domain' }
  ])
};

const insertMeta = db.prepare('INSERT OR REPLACE INTO pack_metadata (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(metadata)) {
  insertMeta.run(key, value);
}

console.log('✅ Schema created');
console.log('\n📊 Pack Metadata:');
console.log(`   ID: ${metadata.id}`);
console.log(`   Type: ${metadata.type}`);
console.log(`   Language: ${metadata.language}`);
console.log(`   Version: ${metadata.version}`);

console.log('\n⚠️  Note: This script creates the schema only.');
console.log('   Run the following to populate data:');
console.log('   1. npm run seed-english-words');
console.log('   2. npm run parse-wiktionary');
console.log('   3. npm run parse-gcide');
console.log('\n   Or use: npm run build-full-dictionary');

// Analyze and vacuum
console.log('\n🔧 Optimizing database...');
db.exec('ANALYZE');
db.exec('VACUUM');

// Get final size
const stats = fs.statSync(OUTPUT_PATH);
const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
console.log(`\n✅ Dictionary pack created: ${sizeMB} MB`);
console.log(`   Location: ${OUTPUT_PATH}`);

db.close();
