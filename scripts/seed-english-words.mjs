#!/usr/bin/env node

/**
 * Seed english_words with all Wiktionary lemmas
 * 
 * This pre-seeds the lexical.sqlite database with all English words from Wiktionary,
 * ensuring every dictionary entry has a valid word_id.
 * 
 * Steps:
 * 1. Extract all lemmas from Wiktionary dump
 * 2. Load existing english_words
 * 3. Add new words with sequential IDs
 * 4. Generate word_mapping.csv for parsers
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const LEXICAL_PACK = join(projectRoot, 'packs', 'consolidated', 'lexical.sqlite');
const WORD_MAPPING_CSV = join(projectRoot, 'data-manifests', 'word-mapping.csv');

console.log('🌱 Seeding english_words with Wiktionary lemmas...\n');

// TODO: This is a placeholder - actual implementation requires Wiktionary XML parsing
// For now, create the word_mapping structure

const db = new Database(LEXICAL_PACK);

// Get existing words
console.log('📖 Loading existing english_words...');
const existingWords = db.prepare('SELECT id, word FROM words').all();
console.log(`   Found ${existingWords.length.toLocaleString()} existing words`);

// Create word mapping
const wordMap = new Map();
for (const row of existingWords) {
  wordMap.set(row.word.toLowerCase(), row.id);
}

// Get next available ID
const maxId = Math.max(...existingWords.map(w => w.id), 0);
let nextId = maxId + 1;

console.log(`   Next available ID: ${nextId}`);

// TODO: Parse Wiktionary dump and extract lemmas
// For now, create mapping CSV from existing words
console.log('\n📝 Generating word_mapping.csv...');

const mappingDir = dirname(WORD_MAPPING_CSV);
if (!fs.existsSync(mappingDir)) {
  fs.mkdirSync(mappingDir, { recursive: true });
}

// Write CSV header
let csvContent = 'lemma,word_id\n';

// Add existing words to mapping
for (const [lemma, wordId] of wordMap.entries()) {
  csvContent += `${lemma},${wordId}\n`;
}

fs.writeFileSync(WORD_MAPPING_CSV, csvContent, 'utf8');
console.log(`✅ Word mapping written: ${WORD_MAPPING_CSV}`);
console.log(`   Entries: ${wordMap.size.toLocaleString()}`);

db.close();

console.log('\n⚠️  Note: Full Wiktionary parsing not yet implemented.');
console.log('   Current mapping uses existing english_words only.');
console.log('\n   Next steps:');
console.log('   1. Download Wiktionary dump');
console.log('   2. Parse XML to extract all English lemmas');
console.log('   3. Add new lemmas to english_words');
console.log('   4. Update word_mapping.csv');
