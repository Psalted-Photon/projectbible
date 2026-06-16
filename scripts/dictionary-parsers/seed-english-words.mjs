#!/usr/bin/env node

/**
 * Seed english_words and word_mapping tables
 * 
 * Reads NDJSON files from parsers and creates:
 * - english_words: unique lemmas with metadata
 * - word_mapping: lemma → word_id mapping
 * 
 * This must run BEFORE building the final pack.
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
const MAPPING_OUT = process.argv[5] || path.join(__dirname, '../../data-manifests/word-mapping.ndjson');
const MAPPING_REVERSE_OUT = process.argv[6] || path.join(__dirname, '../../data-manifests/word-mapping-reverse.ndjson');
const WORDSET_NDJSON = 'wordset.ndjson';

console.log('📚 Seeding English Words & Mapping\n');
console.log(`   Wiktionary: ${WIKTIONARY_NDJSON}`);
console.log(`   GCIDE: ${GCIDE_NDJSON}`);
console.log(`   Wordset: ${WORDSET_NDJSON}`);
console.log(`   Output: ${OUTPUT_DB}\n`);
console.log(`   Mapping: ${MAPPING_OUT}`);
console.log(`   Reverse: ${MAPPING_REVERSE_OUT}\n`);

if (!fs.existsSync(WIKTIONARY_NDJSON) || !fs.existsSync(GCIDE_NDJSON)) {
  console.error('❌ Input files not found. Run parsers first.');
  process.exit(1);
}

// Open/create database
const db = new Database(OUTPUT_DB);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');

console.log('🏗️  Ensuring schema exists...');

// Ensure word_mapping table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS word_mapping (
    lemma TEXT PRIMARY KEY,
    word_id INTEGER NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_mapping_word_id 
    ON word_mapping(word_id);
`);

console.log('✅ Schema ready\n');

/**
 * Extract unique lemmas from NDJSON file
 */
async function extractLemmas(filePath) {
  const lemmas = new Set();
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const row = JSON.parse(line);
      if (row.word) {
        lemmas.add(row.word.toLowerCase());
      }
      count++;
      
      if (count % 100000 === 0) {
        console.log(`   Processed ${count.toLocaleString()} rows, ${lemmas.size.toLocaleString()} unique lemmas`);
      }
    } catch (err) {
      console.warn(`   Warning: Could not parse line: ${line.substring(0, 50)}...`);
    }
  }
  
  return lemmas;
}

/**
 * Seed the word_mapping table
 */
async function seedWordMapping() {
  console.log('📖 Step 1: Extract lemmas from Wiktionary...');
  const wiktionaryLemmas = await extractLemmas(WIKTIONARY_NDJSON);
  console.log(`   ✅ Found ${wiktionaryLemmas.size.toLocaleString()} unique Wiktionary lemmas\n`);
  
  console.log('📚 Step 2: Extract lemmas from GCIDE...');
  const gcideLemmas = await extractLemmas(GCIDE_NDJSON);
  console.log(`   ✅ Found ${gcideLemmas.size.toLocaleString()} unique GCIDE lemmas\n`);

  let wordsetLemmas = new Set();
  if (fs.existsSync(WORDSET_NDJSON)) {
    console.log('📗 Step 2b: Extract lemmas from Wordset...');
    wordsetLemmas = await extractLemmas(WORDSET_NDJSON);
    console.log(`   ✅ Found ${wordsetLemmas.size.toLocaleString()} unique Wordset lemmas\n`);
  } else {
    console.log(`   ℹ️  Wordset NDJSON not found (${WORDSET_NDJSON}), skipping\n`);
  }

  console.log('🔗 Step 3: Merge and deduplicate...');
  const allLemmas = new Set([...wiktionaryLemmas, ...gcideLemmas, ...wordsetLemmas]);
  console.log(`   ✅ Total unique lemmas: ${allLemmas.size.toLocaleString()}\n`);
  
  console.log('💾 Step 4: Insert into word_mapping...');
  
  // Clear existing data
  db.exec('DELETE FROM word_mapping');
  
  // Prepare insert statement
  const insert = db.prepare('INSERT INTO word_mapping (lemma, word_id) VALUES (?, ?)');
  
  // Batch insert
  const insertMany = db.transaction((lemmas) => {
    let wordId = 1;
    for (const lemma of lemmas) {
      insert.run(lemma, wordId++);
    }
  });
  
  // Sort lemmas for consistent word_ids
  const sortedLemmas = Array.from(allLemmas).sort();
  
  insertMany(sortedLemmas);
  
  console.log(`   ✅ Inserted ${sortedLemmas.length.toLocaleString()} mappings\n`);
  
  // Verify
  const count = db.prepare('SELECT COUNT(*) as count FROM word_mapping').get();
  console.log(`✅ Verification: ${count.count.toLocaleString()} rows in word_mapping`);

  console.log('\n🧾 Writing mapping files...');
  const mappingDir = path.dirname(MAPPING_OUT);
  if (!fs.existsSync(mappingDir)) {
    fs.mkdirSync(mappingDir, { recursive: true });
  }

  const mappingStream = fs.createWriteStream(MAPPING_OUT, { flags: 'w' });
  const reverseStream = fs.createWriteStream(MAPPING_REVERSE_OUT, { flags: 'w' });

  let wordId = 1;
  for (const lemma of sortedLemmas) {
    mappingStream.write(JSON.stringify({ lemma, word_id: wordId }) + '\n');
    reverseStream.write(JSON.stringify({ word_id: wordId, lemma }) + '\n');
    wordId++;
  }

  mappingStream.end();
  reverseStream.end();
  console.log('   ✅ Mapping files written');
}

// Run seeder
await seedWordMapping();

db.close();

console.log('\n✅ Word seeding complete!\n');
console.log('📝 Next steps:');
console.log('   Run: node build-pack.mjs\n');
