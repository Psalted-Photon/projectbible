#!/usr/bin/env node

/**
 * Build the complete English Dictionary Pack
 * 
 * Reads NDJSON from parsers and inserts into SQLite with proper word_id mapping.
 * This is the final step that creates the production-ready pack.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultWiktionary = fs.existsSync('wiktionary-modern-clean.ndjson')
  ? 'wiktionary-modern-clean.ndjson'
  : 'wiktionary-modern.ndjson';

const WIKTIONARY_NDJSON = process.argv[2] || defaultWiktionary;
const GCIDE_NDJSON = process.argv[3] || 'gcide-historic.ndjson';
const OUTPUT_DB = process.argv[4] || path.join(__dirname, '../../packs/consolidated/dictionary-en.sqlite');
const WORDSET_NDJSON = 'wordset.ndjson';

console.log('📖 Building English Dictionary Pack\n');
console.log(`   Wiktionary: ${WIKTIONARY_NDJSON}`);
console.log(`   GCIDE: ${GCIDE_NDJSON}`);
console.log(`   Wordset: ${WORDSET_NDJSON} (fallback)`);
console.log(`   Output: ${OUTPUT_DB}\n`);

if (!fs.existsSync(WIKTIONARY_NDJSON) || !fs.existsSync(GCIDE_NDJSON)) {
  console.error('❌ Input files not found. Run parsers first.');
  process.exit(1);
}

// Create output directory
const outputDir = path.dirname(OUTPUT_DB);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Open database
const db = new Database(OUTPUT_DB);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -128000'); // 128MB cache for bulk insert
db.pragma('temp_store = MEMORY');

console.log('🏗️  Ensuring schema exists...');

// Create schema (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS pack_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  
  CREATE TABLE IF NOT EXISTS word_mapping (
    lemma TEXT PRIMARY KEY,
    word_id INTEGER NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_mapping_word_id ON word_mapping(word_id);
  
  CREATE TABLE IF NOT EXISTS english_definitions_modern (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  
  CREATE INDEX IF NOT EXISTS idx_modern_word_id ON english_definitions_modern(word_id);
  CREATE INDEX IF NOT EXISTS idx_modern_order ON english_definitions_modern(word_id, definition_order);
  
  CREATE TABLE IF NOT EXISTS english_definitions_historic (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  
  CREATE INDEX IF NOT EXISTS idx_historic_word_id ON english_definitions_historic(word_id);
  CREATE INDEX IF NOT EXISTS idx_historic_order ON english_definitions_historic(word_id, definition_order);

  CREATE TABLE IF NOT EXISTS english_definitions_wordset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    pos TEXT,
    sense_number TEXT,
    definition_order INTEGER NOT NULL,
    definition TEXT NOT NULL,
    example TEXT,
    source TEXT DEFAULT 'wordset',
    source_url TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_wordset_word_id ON english_definitions_wordset(word_id);
  CREATE INDEX IF NOT EXISTS idx_wordset_order ON english_definitions_wordset(word_id, definition_order);
`);

console.log('✅ Schema ready\n');

// Check if word_mapping is populated
const mappingCount = db.prepare('SELECT COUNT(*) as count FROM word_mapping').get();
if (mappingCount.count === 0) {
  console.error('❌ word_mapping is empty. Run seed-english-words.mjs first.');
  process.exit(1);
}

console.log(`✅ Found ${mappingCount.count.toLocaleString()} word mappings\n`);

/**
 * Load word_mapping into memory for fast lookups
 */
function loadWordMapping() {
  console.log('📚 Loading word mappings into memory...');
  const map = new Map();
  const rows = db.prepare('SELECT lemma, word_id FROM word_mapping').all();
  
  for (const row of rows) {
    map.set(row.lemma, row.word_id);
  }
  
  console.log(`   ✅ Loaded ${map.size.toLocaleString()} mappings\n`);
  return map;
}

const wordMapping = loadWordMapping();

/**
 * Import modern definitions from Wiktionary NDJSON
 */
async function importModern() {
  console.log('📖 Importing modern definitions (Wiktionary)...');
  
  // Clear existing
  db.exec('DELETE FROM english_definitions_modern');
  
  const insert = db.prepare(`
    INSERT INTO english_definitions_modern 
    (word_id, pos, sense_number, definition_order, definition, example, etymology, raw_etymology, tags, search_tokens, source, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const fileStream = fs.createReadStream(WIKTIONARY_NDJSON);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(
        row.word_id,
        row.pos,
        row.sense_number,
        row.definition_order,
        row.definition_text,
        row.example,
        row.etymology,
        row.raw_etymology,
        row.tags ? JSON.stringify(row.tags) : null,
        row.search_tokens,
        row.source,
        row.source_url
      );
    }
  });
  
  let batch = [];
  let count = 0;
  let skipped = 0;
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const row = JSON.parse(line);
      const wordId = wordMapping.get(row.word.toLowerCase());
      
      if (!wordId) {
        skipped++;
        continue;
      }
      
      batch.push({
        word_id: wordId,
        pos: row.pos || null,
        sense_number: row.sense_number || null,
        definition_order: row.definition_order,
        definition_text: row.definition_text,
        example: row.example || null,
        etymology: row.etymology || null,
        raw_etymology: row.raw_etymology || null,
        tags: row.tags || null,
        search_tokens: row.search_tokens || null,
        source: row.source || 'wiktionary',
        source_url: row.source_url || null
      });
      
      if (batch.length >= 5000) {
        insertBatch(batch);
        count += batch.length;
        batch = [];
        
        if (count % 100000 === 0) {
          console.log(`   Inserted ${count.toLocaleString()} modern definitions...`);
        }
      }
    } catch (err) {
      console.warn(`   Warning: Could not parse line: ${line.substring(0, 50)}...`);
    }
  }
  
  // Insert remaining
  if (batch.length > 0) {
    insertBatch(batch);
    count += batch.length;
  }
  
  console.log(`   ✅ Inserted ${count.toLocaleString()} modern definitions`);
  if (skipped > 0) {
    console.log(`   ⚠️  Skipped ${skipped.toLocaleString()} rows (no word_id mapping)`);
  }
  console.log();
}

/**
 * Import historic definitions from GCIDE NDJSON
 */
async function importHistoric() {
  console.log('📚 Importing historic definitions (GCIDE)...');
  
  // Clear existing
  db.exec('DELETE FROM english_definitions_historic');
  
  const insert = db.prepare(`
    INSERT INTO english_definitions_historic 
    (word_id, pos, sense_number, definition_order, definition, example, search_tokens, source, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const fileStream = fs.createReadStream(GCIDE_NDJSON);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(
        row.word_id,
        row.pos,
        row.sense_number,
        row.definition_order,
        row.definition_text,
        row.example,
        row.search_tokens,
        row.source,
        row.source_url
      );
    }
  });
  
  let batch = [];
  let count = 0;
  let skipped = 0;
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const row = JSON.parse(line);
      const wordId = wordMapping.get(row.word.toLowerCase());
      
      if (!wordId) {
        skipped++;
        continue;
      }
      
      batch.push({
        word_id: wordId,
        pos: row.pos || null,
        sense_number: row.sense_number || null,
        definition_order: row.definition_order,
        definition_text: row.definition_text,
        example: row.example || null,
        search_tokens: row.search_tokens || null,
        source: row.source || 'gcide',
        source_url: row.source_url || null
      });
      
      if (batch.length >= 5000) {
        insertBatch(batch);
        count += batch.length;
        batch = [];
        
        if (count % 50000 === 0) {
          console.log(`   Inserted ${count.toLocaleString()} historic definitions...`);
        }
      }
    } catch (err) {
      console.warn(`   Warning: Could not parse line: ${line.substring(0, 50)}...`);
    }
  }
  
  // Insert remaining
  if (batch.length > 0) {
    insertBatch(batch);
    count += batch.length;
  }
  
  console.log(`   ✅ Inserted ${count.toLocaleString()} historic definitions`);
  if (skipped > 0) {
    console.log(`   ⚠️  Skipped ${skipped.toLocaleString()} rows (no word_id mapping)`);
  }
  console.log();
}

/**
 * Import Wordset fallback definitions
 */
async function importWordset() {
  if (!fs.existsSync(WORDSET_NDJSON)) {
    console.log('⚠️  wordset.ndjson not found, skipping Wordset import.\n');
    return;
  }

  console.log('📗 Importing Wordset fallback definitions...');

  db.exec('DELETE FROM english_definitions_wordset');

  const insert = db.prepare(`
    INSERT INTO english_definitions_wordset
    (word_id, pos, sense_number, definition_order, definition, example, source, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const fileStream = fs.createReadStream(WORDSET_NDJSON);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(
        row.word_id,
        row.pos,
        row.sense_number,
        row.definition_order,
        row.definition_text,
        row.example,
        row.source,
        row.source_url
      );
    }
  });

  let batch = [];
  let count = 0;
  let skipped = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const row = JSON.parse(line);
      const wordId = wordMapping.get(row.word.toLowerCase());

      if (!wordId) {
        skipped++;
        continue;
      }

      batch.push({
        word_id: wordId,
        pos: row.pos || null,
        sense_number: row.sense_number || null,
        definition_order: row.definition_order,
        definition_text: row.definition_text,
        example: row.example || null,
        source: row.source || 'wordset',
        source_url: row.source_url || null
      });

      if (batch.length >= 5000) {
        insertBatch(batch);
        count += batch.length;
        batch = [];
      }
    } catch (err) {
      console.warn(`   Warning: Could not parse line: ${line.substring(0, 50)}...`);
    }
  }

  if (batch.length > 0) {
    insertBatch(batch);
    count += batch.length;
  }

  console.log(`   ✅ Inserted ${count.toLocaleString()} Wordset definitions`);
  if (skipped > 0) {
    console.log(`   ⚠️  Skipped ${skipped.toLocaleString()} rows (no word_id mapping)`);
  }
  console.log();
}

/**
 * Insert pack metadata
 */
function insertMetadata() {
  console.log('📝 Inserting pack metadata...');
  
  const metadata = {
    id: 'dictionary-en',
    name: 'English Dictionary (Modern + Historic)',
    type: 'dictionary',
    language: 'en',
    version: '1.0.0',
    schemaVersion: '13',
    description: 'Modern Wiktionary + Webster 1913 definitions + Wordset fallback',
    build_date: new Date().toISOString(),
    sources: JSON.stringify([
      { name: 'Wiktionary', url: 'https://en.wiktionary.org/', license: 'CC BY-SA 3.0' },
      { name: 'GCIDE/Webster 1913', license: 'Public Domain' },
      { name: 'Wordset', url: 'https://github.com/wordset/wordset-dictionary', license: 'MIT' }
    ])
  };
  
  const insertPackMeta = db.prepare('INSERT OR REPLACE INTO pack_metadata (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(metadata)) {
    insertPackMeta.run(key, value.toString());
  }

  const standardMeta = {
    pack_id: metadata.id,
    pack_type: metadata.type,
    pack_version: metadata.version,
    name: metadata.name,
    language: metadata.language,
    description: metadata.description,
    build_date: metadata.build_date,
    sources: metadata.sources
  };

  const insertStandardMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(standardMeta)) {
    insertStandardMeta.run(key, value.toString());
  }
  
  console.log('   ✅ Metadata inserted\n');
}

/**
 * Run integrity checks
 */
function runIntegrityChecks() {
  console.log('🔍 Running integrity checks...');
  
  // Check for null definitions
  const nullModern = db.prepare("SELECT COUNT(*) as count FROM english_definitions_modern WHERE definition IS NULL OR definition = ''").get();
  const nullHistoric = db.prepare("SELECT COUNT(*) as count FROM english_definitions_historic WHERE definition IS NULL OR definition = ''").get();
  
  if (nullModern.count > 0) {
    console.warn(`   ⚠️  Found ${nullModern.count} null modern definitions`);
  } else {
    console.log('   ✅ No null modern definitions');
  }
  
  if (nullHistoric.count > 0) {
    console.warn(`   ⚠️  Found ${nullHistoric.count} null historic definitions`);
  } else {
    console.log('   ✅ No null historic definitions');
  }
  
  // Check for orphaned definitions
  const orphanedModern = db.prepare(`
    SELECT COUNT(*) as count 
    FROM english_definitions_modern 
    WHERE word_id NOT IN (SELECT word_id FROM word_mapping)
  `).get();
  
  const orphanedHistoric = db.prepare(`
    SELECT COUNT(*) as count 
    FROM english_definitions_historic 
    WHERE word_id NOT IN (SELECT word_id FROM word_mapping)
  `).get();
  
  if (orphanedModern.count > 0) {
    console.warn(`   ⚠️  Found ${orphanedModern.count} orphaned modern definitions`);
  } else {
    console.log('   ✅ No orphaned modern definitions');
  }
  
  if (orphanedHistoric.count > 0) {
    console.warn(`   ⚠️  Found ${orphanedHistoric.count} orphaned historic definitions`);
  } else {
    console.log('   ✅ No orphaned historic definitions');
  }

  const nullWordset = db.prepare("SELECT COUNT(*) as count FROM english_definitions_wordset WHERE definition IS NULL OR definition = ''").get();
  const orphanedWordset = db.prepare(`
    SELECT COUNT(*) as count
    FROM english_definitions_wordset
    WHERE word_id NOT IN (SELECT word_id FROM word_mapping)
  `).get();

  if (nullWordset.count > 0) {
    console.warn(`   ⚠️  Found ${nullWordset.count} null Wordset definitions`);
  } else {
    console.log('   ✅ No null Wordset definitions');
  }

  if (orphanedWordset.count > 0) {
    console.warn(`   ⚠️  Found ${orphanedWordset.count} orphaned Wordset definitions`);
  } else {
    console.log('   ✅ No orphaned Wordset definitions');
  }

  console.log();
}

// Main build flow
await importModern();
await importHistoric();
await importWordset();
insertMetadata();
runIntegrityChecks();

console.log('🔧 Optimizing database...');
db.exec('ANALYZE');
db.exec('VACUUM');
console.log('   ✅ Optimized\n');

// Get final statistics
const stats = {
  modern: db.prepare('SELECT COUNT(*) as count FROM english_definitions_modern').get(),
  historic: db.prepare('SELECT COUNT(*) as count FROM english_definitions_historic').get(),
  wordset: db.prepare('SELECT COUNT(*) as count FROM english_definitions_wordset').get(),
  words: db.prepare('SELECT COUNT(*) as count FROM word_mapping').get()
};

const fileStats = fs.statSync(OUTPUT_DB);
const sizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

console.log('✅ Dictionary pack build complete!\n');
console.log('📊 Final Statistics:');
console.log(`   Words: ${stats.words.count.toLocaleString()}`);
console.log(`   Modern Definitions: ${stats.modern.count.toLocaleString()}`);
console.log(`   Historic Definitions: ${stats.historic.count.toLocaleString()}`);
console.log(`   Wordset Fallback Definitions: ${stats.wordset.count.toLocaleString()}`);
console.log(`   Total Definitions: ${(stats.modern.count + stats.historic.count + stats.wordset.count).toLocaleString()}`);
console.log(`   File Size: ${sizeMB} MB`);
console.log(`   Location: ${OUTPUT_DB}\n`);

db.close();

console.log('📝 Next steps:');
console.log('   1. Test locally with your app');
console.log('   2. Run integrity tests');
console.log('   3. Compress and publish to GitHub Releases\n');
