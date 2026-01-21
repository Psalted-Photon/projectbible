#!/usr/bin/env node

/**
 * Parse GCIDE/Webster 1913 → english_definitions_historic
 * 
 * NO FILTERING - Preserves:
 * - All archaic/theological/legal senses
 * - Nested sense notation (1a, 1b, 2a)
 * - Exact ordering via definition_order
 * - All examples
 * 
 * Output: ~200k definitions, 20-40 MB
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

const DICT_PACK = join(projectRoot, 'packs', 'consolidated', 'dictionary-en.sqlite');
const WORD_MAPPING_CSV = join(projectRoot, 'data-manifests', 'word-mapping.csv');
const GCIDE_DIR = join(projectRoot, 'data-sources', 'gcide');

console.log('📚 Parsing GCIDE/Webster 1913...\n');

// Load word mapping
console.log('📝 Loading word_mapping.csv...');
const wordMap = new Map();

if (fs.existsSync(WORD_MAPPING_CSV)) {
  const csv = fs.readFileSync(WORD_MAPPING_CSV, 'utf8');
  const lines = csv.split('\n').slice(1); // Skip header
  
  for (const line of lines) {
    if (!line.trim()) continue;
    const [lemma, wordId] = line.split(',');
    wordMap.set(lemma.trim(), parseInt(wordId));
  }
  
  console.log(`✅ Loaded ${wordMap.size.toLocaleString()} word mappings`);
} else {
  console.error(`❌ word_mapping.csv not found at ${WORD_MAPPING_CSV}`);
  console.error('   Run: npm run seed-english-words first');
  process.exit(1);
}

// Check for GCIDE data
if (!fs.existsSync(GCIDE_DIR)) {
  console.error(`❌ GCIDE data not found at ${GCIDE_DIR}`);
  console.error('\n   Download from:');
  console.error('   http://ftp.gnu.org/gnu/gcide/');
  console.error('   File: gcide-0.53.tar.xz');
  console.error('\n   Extract to: data-sources/gcide/');
  process.exit(1);
}

console.log('⚠️  GCIDE parsing not yet fully implemented.');
console.log('\n   This requires:');
console.log('   1. DICT/TEI XML parser');
console.log('   2. Sense number extraction (1a, 1b notation)');
console.log('   3. Definition cleaner');
console.log('   4. Example extractor');
console.log('\n   Estimated development time: 2-3 hours');
console.log('\n   For now, placeholder structure created.');

// TODO: Implement GCIDE parser
// Key features:
// - Parse TEI XML or DICT format
// - Extract nested senses (preserve 1a, 1b notation in sense_number)
// - Map to definition_order for sorting
// - Keep all archaic/theological/legal definitions
// - Generate source_url: gcide:<entry-id>
// - Generate search_tokens
// - Chunked inserts (1000 rows per transaction)
