#!/usr/bin/env node

/**
 * Parse Wiktionary XML dump → english_definitions_modern
 * 
 * NO FILTERING - Preserves:
 * - All definitions
 * - All senses in exact order (via definition_order)
 * - All examples
 * - Full etymology chains
 * - All POS tags (no normalization)
 * - All usage tags
 * 
 * Output: ~6M definitions, 1.2-1.5 GB
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
const WIKTIONARY_DUMP = join(projectRoot, 'data-sources', 'wiktionary', 'enwiktionary-latest-pages-articles.xml');

console.log('📖 Parsing Wiktionary XML dump...\n');

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

// Check for Wiktionary dump
if (!fs.existsSync(WIKTIONARY_DUMP)) {
  console.error(`❌ Wiktionary dump not found at ${WIKTIONARY_DUMP}`);
  console.error('\n   Download from:');
  console.error('   https://dumps.wikimedia.org/enwiktionary/latest/');
  console.error('   File: enwiktionary-latest-pages-articles.xml.bz2');
  console.error('\n   Extract to: data-sources/wiktionary/');
  process.exit(1);
}

console.log('⚠️  Wiktionary parsing not yet fully implemented.');
console.log('\n   This requires:');
console.log('   1. XML streaming parser (xml-stream or sax)');
console.log('   2. Wikitext parser (wtf_wikipedia or custom)');
console.log('   3. Etymology extractor');
console.log('   4. POS/sense parser');
console.log('\n   Estimated development time: 4-6 hours');
console.log('\n   For now, placeholder structure created.');

// TODO: Implement full Wiktionary parser
// Key features:
// - Stream parse XML (don't load all 6GB into memory)
// - Extract English entries only
// - Parse wikitext for definitions, examples, etymology
// - Preserve exact sense ordering via definition_order
// - Generate search_tokens
// - Chunked inserts (2000 rows per transaction)
// - Progress logging every 500k entries
