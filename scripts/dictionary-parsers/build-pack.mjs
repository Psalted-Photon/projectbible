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
import { filterWordSenses, BLOCKED_HEADWORDS } from './content-filter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Wiktionary is deliberately absent. Its sense inventory and example sentences
// were unfit for this app, and the live api.dictionaryapi.dev lookup that served
// the same content has been removed from the client too.
const GCIDE_NDJSON = process.argv[3] || 'gcide-historic.ndjson';
const OUTPUT_DB = process.argv[4] || path.join(__dirname, '../../packs/consolidated/dictionary-en.sqlite');
const WORDSET_NDJSON = 'wordset.ndjson';

console.log('📖 Building English Dictionary Pack\n');
console.log(`   GCIDE: ${GCIDE_NDJSON}`);
console.log(`   Wordset: ${WORDSET_NDJSON} (fallback)`);
console.log(`   Output: ${OUTPUT_DB}\n`);

if (!fs.existsSync(GCIDE_NDJSON)) {
  console.error('❌ gcide-historic.ndjson not found. Run parse-gcide-simple.mjs first.');
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
 * Add any GCIDE headword the mapping has never seen.
 *
 * Definitions are keyed only by word_mapping.word_id, and an unmapped headword
 * is dropped silently at insert time. Recovering the lost third of Webster
 * brought in ~7,400 headwords the older, smaller parse never produced; without
 * this they would be parsed and then thrown away.
 */
async function extendWordMapping() {
  console.log('Extending word_mapping with new GCIDE headwords...');

  const unseen = new Set();
  const rl = readline.createInterface({
    input: fs.createReadStream(GCIDE_NDJSON),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const lemma = String(JSON.parse(line).word).toLowerCase();
      if (lemma && !wordMapping.has(lemma)) unseen.add(lemma);
    } catch {
      /* malformed line; the importer reports it */
    }
  }

  if (unseen.size === 0) {
    console.log('   Nothing to add');
    console.log();
    return;
  }

  let nextId = db.prepare('SELECT COALESCE(MAX(word_id), 0) AS m FROM word_mapping').get().m;
  const insert = db.prepare('INSERT OR IGNORE INTO word_mapping (lemma, word_id) VALUES (?, ?)');
  const addAll = db.transaction((lemmas) => {
    for (const lemma of lemmas) {
      nextId += 1;
      insert.run(lemma, nextId);
      wordMapping.set(lemma, nextId);
    }
  });
  addAll([...unseen]);

  console.log(`   Added ${unseen.size.toLocaleString()} headwords`);
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
  let blocked = 0;

  // Webster gives a homograph its own entry -- Harlot n., Harlot a., Harlot v.
  // -- and each restarts at sense 1. Left alone the pack holds three rows all
  // numbered 1 for the same word and the reader gets them in arbitrary order,
  // so definition_order is made sequential across every entry for a lemma.
  // sense_number keeps whatever Webster actually printed.
  const orderByWord = new Map();
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const row = JSON.parse(line);
      const lemma = String(row.word).toLowerCase();

      // Same blocklist as the modern layer, so a word barred from one is not
      // reachable through the other.
      if (BLOCKED_HEADWORDS.has(lemma)) {
        blocked++;
        continue;
      }

      const wordId = wordMapping.get(lemma);
      
      if (!wordId) {
        skipped++;
        continue;
      }
      
      const nextOrder = (orderByWord.get(wordId) || 0) + 1;
      orderByWord.set(wordId, nextOrder);

      batch.push({
        word_id: wordId,
        pos: row.pos || null,
        sense_number: row.sense_number || null,
        definition_order: nextOrder,
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
  if (blocked > 0) {
    console.log(`   -> ${blocked.toLocaleString()} rows dropped on blocked headwords`);
  }
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

  // Senses are judged per headword, not per row. A sense is dropped only when
  // its word does not itself denote the thing -- "street" is not a word about
  // prostitution, "prostitute" is -- so every sense of a word has to be in hand
  // before any of them can be decided. See content-filter.mjs.
  let pendingWord = null;
  let pendingRows = [];
  let droppedSenses = 0;
  let blockedWords = 0;

  // A lemma can turn up in more than one run of the NDJSON (different source
  // files normalising to the same word), so the counter is kept per word_id
  // rather than per flush. Otherwise those words restart at 1 mid-entry and the
  // reader sees two senses both numbered 1.
  const orderByWord = new Map();

  function flushPending() {
    if (!pendingWord || pendingRows.length === 0) return;

    const { kept, blocked, dropped } = filterWordSenses(pendingWord, pendingRows);
    if (blocked) blockedWords++;
    droppedSenses += dropped.length;

    const wordId = wordMapping.get(pendingWord);
    if (!wordId) {
      skipped += pendingRows.length;
    } else {
      // Renumber, so a filtered word still reads 1, 2, 3 instead of skipping
      // the sense that was removed.
      for (const row of kept) {
        const order = (orderByWord.get(wordId) || 0) + 1;
        orderByWord.set(wordId, order);
        batch.push({
          word_id: wordId,
          pos: row.pos || null,
          sense_number: row.sense_number || null,
          definition_order: order,
          definition_text: row.definition_text,
          // Examples carry the innuendo no keyword rule can catch: "street"
          // sense 4 is a clean definition with the example "I worked both
          // sides of the street". The modern layer ships definitions only;
          // Webster keeps its quotations.
          example: null,
          source: row.source || 'wordset',
          source_url: row.source_url || null
        });
      }
    }

    pendingWord = null;
    pendingRows = [];
  }

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const row = JSON.parse(line);
      const lemma = String(row.word).toLowerCase();

      // The NDJSON groups a word's senses together; flushPending also runs
      // after the loop, so the last word is not left behind.
      if (lemma !== pendingWord) {
        flushPending();
        pendingWord = lemma;
      }
      pendingRows.push(row);

      if (batch.length >= 5000) {
        insertBatch(batch);
        count += batch.length;
        batch = [];
      }
    } catch (err) {
      console.warn(`   Warning: Could not parse line: ${line.substring(0, 50)}...`);
    }
  }

  flushPending();

  if (batch.length > 0) {
    insertBatch(batch);
    count += batch.length;
  }

  console.log(`   ✅ Inserted ${count.toLocaleString()} Wordset definitions`);
  console.log(`   -> removed ${droppedSenses.toLocaleString()} imported senses, ${blockedWords.toLocaleString()} blocked headwords, and every example`);
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
    description: 'Modern (Wordset, filtered) + Historic (Webster 1913) definitions',
    build_date: new Date().toISOString(),
    sources: JSON.stringify([
      { name: 'GCIDE/Webster 1913', license: 'Public Domain' },
      { name: 'Wordset', url: 'https://github.com/wordset/wordset-dictionary', license: 'CC BY-SA 4.0' }
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
  const nullHistoric = db.prepare("SELECT COUNT(*) as count FROM english_definitions_historic WHERE definition IS NULL OR definition = ''").get();
  
  if (nullHistoric.count > 0) {
    console.warn(`   ⚠️  Found ${nullHistoric.count} null historic definitions`);
  } else {
    console.log('   ✅ No null historic definitions');
  }
  
  // Check for orphaned definitions
  const orphanedHistoric = db.prepare(`
    SELECT COUNT(*) as count 
    FROM english_definitions_historic 
    WHERE word_id NOT IN (SELECT word_id FROM word_mapping)
  `).get();
  
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
await extendWordMapping();
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
  historic: db.prepare('SELECT COUNT(*) as count FROM english_definitions_historic').get(),
  wordset: db.prepare('SELECT COUNT(*) as count FROM english_definitions_wordset').get(),
  words: db.prepare('SELECT COUNT(*) as count FROM word_mapping').get()
};

const fileStats = fs.statSync(OUTPUT_DB);
const sizeMB = (fileStats.size / 1024 / 1024).toFixed(2);

console.log('✅ Dictionary pack build complete!\n');
console.log('📊 Final Statistics:');
console.log(`   Words: ${stats.words.count.toLocaleString()}`);
console.log(`   Historic Definitions: ${stats.historic.count.toLocaleString()}`);
console.log(`   Wordset Fallback Definitions: ${stats.wordset.count.toLocaleString()}`);
console.log(`   Total Definitions: ${(stats.historic.count + stats.wordset.count).toLocaleString()}`);
console.log(`   File Size: ${sizeMB} MB`);
console.log(`   Location: ${OUTPUT_DB}\n`);

db.close();

console.log('📝 Next steps:');
console.log('   1. Test locally with your app');
console.log('   2. Run integrity tests');
console.log('   3. Compress and publish to GitHub Releases\n');
