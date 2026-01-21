#!/usr/bin/env node
/**
 * Build Consolidated Lexical Pack
 * 
 * Merges Strong's dictionaries + English lexical resources.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs');
const POLISHED_DIR = join(PACKS_DIR, 'polished');
const OUTPUT_DIR = join(repoRoot, 'packs/consolidated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'lexical.sqlite');

console.log('📦 Building Lexical Pack...\n');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

const output = new Database(OUTPUT_FILE);

// Create schema
output.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  -- Strong's entries
  CREATE TABLE strongs_entries (
    id TEXT PRIMARY KEY,
    lemma TEXT,
    transliteration TEXT,
    definition TEXT,
    shortDefinition TEXT,
    partOfSpeech TEXT,
    language TEXT,
    derivation TEXT,
    kjvUsage TEXT,
    occurrences INTEGER
  );
  
  CREATE INDEX idx_strongs_language ON strongs_entries(language);
  CREATE INDEX idx_strongs_lemma ON strongs_entries(lemma);
  
  -- English words
  CREATE TABLE words (
    id INTEGER PRIMARY KEY,
    word TEXT UNIQUE NOT NULL,
    ipa_us TEXT,
    ipa_uk TEXT,
    pos TEXT,
    frequency INTEGER
  );
  
  CREATE INDEX idx_words_frequency ON words(frequency DESC);
  
  -- English synonyms
  CREATE TABLE synonyms (
    word TEXT NOT NULL,
    synonym TEXT NOT NULL,
    relationship TEXT,
    PRIMARY KEY (word, synonym)
  );
  
  CREATE INDEX idx_synonyms_word ON synonyms(word);
  
  -- English antonyms
  CREATE TABLE antonyms (
    word TEXT NOT NULL,
    antonym TEXT NOT NULL,
    relationship TEXT,
    PRIMARY KEY (word, antonym)
  );
  
  CREATE INDEX idx_antonyms_word ON antonyms(word);
  
  -- English verb forms
  CREATE TABLE verb_forms (
    base_form TEXT,
    inflection_type TEXT,
    inflected_form TEXT,
    PRIMARY KEY (base_form, inflection_type, inflected_form)
  );
  
  -- English noun plurals
  CREATE TABLE noun_plurals (
    singular TEXT PRIMARY KEY,
    plural TEXT
  );
  
  -- POS tags
  CREATE TABLE pos_tags (
    word TEXT,
    tag TEXT,
    PRIMARY KEY (word, tag)
  );
`);

// Insert metadata
const insertMeta = output.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta.run('id', 'lexical');
insertMeta.run('version', '1.0.0');
insertMeta.run('type', 'lexicon');
insertMeta.run('schemaVersion', '1');
insertMeta.run('minAppVersion', '1.0.0');
insertMeta.run('name', 'Lexical Resources Pack');
insertMeta.run('description', "Strong's Greek/Hebrew + English wordlist/thesaurus/grammar");
insertMeta.run('createdAt', new Date().toISOString());

let totalEntries = 0;

// 1. Strong's Greek
console.log('\n   Merging Strong\'s Greek...');
const greekPath = join(PACKS_DIR, 'strongs-greek.sqlite');
if (existsSync(greekPath)) {
  const source = new Database(greekPath, { readonly: true });
  const entries = source.prepare('SELECT * FROM strongs_entries').all();
  console.log(`      ${entries.length.toLocaleString()} entries`);
  
  const insert = output.prepare(`
    INSERT INTO strongs_entries (id, lemma, transliteration, definition, shortDefinition, partOfSpeech, language, derivation, kjvUsage, occurrences)
    VALUES (@id, @lemma, @transliteration, @definition, @shortDefinition, @partOfSpeech, @language, @derivation, @kjvUsage, @occurrences)
  `);
  
  const copy = output.transaction((entries) => {
    for (const e of entries) {
      insert.run(e);
    }
  });
  copy(entries);
  totalEntries += entries.length;
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 2. Strong's Hebrew
console.log('\n   Merging Strong\'s Hebrew...');
const hebrewPath = join(PACKS_DIR, 'strongs-hebrew.sqlite');
if (existsSync(hebrewPath)) {
  const source = new Database(hebrewPath, { readonly: true });
  const entries = source.prepare('SELECT * FROM strongs_entries').all();
  console.log(`      ${entries.length.toLocaleString()} entries`);
  
  const insert = output.prepare(`
    INSERT INTO strongs_entries (id, lemma, transliteration, definition, shortDefinition, partOfSpeech, language, derivation, kjvUsage, occurrences)
    VALUES (@id, @lemma, @transliteration, @definition, @shortDefinition, @partOfSpeech, @language, @derivation, @kjvUsage, @occurrences)
  `);
  
  const copy = output.transaction((entries) => {
    for (const e of entries) {
      insert.run(e);
    }
  });
  copy(entries);
  totalEntries += entries.length;
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 3. English Wordlist
console.log('\n   Merging English wordlist...');
const wordlistPath = join(POLISHED_DIR, 'english-wordlist-v1.sqlite');
if (existsSync(wordlistPath)) {
  const source = new Database(wordlistPath, { readonly: true });
  const words = source.prepare('SELECT * FROM words').all();
  console.log(`      ${words.length.toLocaleString()} words`);
  
  const insert = output.prepare(`
    INSERT INTO words (id, word, ipa_us, ipa_uk, pos, frequency)
    VALUES (@id, @word, @ipa_us, @ipa_uk, @pos, @frequency)
  `);
  
  const copy = output.transaction((words) => {
    for (const w of words) {
      insert.run(w);
    }
  });
  copy(words);
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 4. English Thesaurus
console.log('\n   Merging English thesaurus...');
const thesaurusPath = join(POLISHED_DIR, 'english-thesaurus-v1.sqlite');
if (existsSync(thesaurusPath)) {
  const source = new Database(thesaurusPath, { readonly: true });
  
  const synonyms = source.prepare('SELECT * FROM synonyms').all();
  console.log(`      ${synonyms.length.toLocaleString()} synonyms`);
  
  const insertSyn = output.prepare(`
    INSERT INTO synonyms (word, synonym, relationship)
    VALUES (@word, @synonym, @relationship)
  `);
  
  const copySyn = output.transaction((synonyms) => {
    for (const s of synonyms) {
      insertSyn.run(s);
    }
  });
  copySyn(synonyms);
  
  const antonyms = source.prepare('SELECT * FROM antonyms').all();
  console.log(`      ${antonyms.length.toLocaleString()} antonyms`);
  
  const insertAnt = output.prepare(`
    INSERT INTO antonyms (word, antonym, relationship)
    VALUES (@word, @antonym, @relationship)
  `);
  
  const copyAnt = output.transaction((antonyms) => {
    for (const a of antonyms) {
      insertAnt.run(a);
    }
  });
  copyAnt(antonyms);
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 5. English Grammar
console.log('\n   Merging English grammar...');
const grammarPath = join(POLISHED_DIR, 'english-grammar-v1.sqlite');
if (existsSync(grammarPath)) {
  const source = new Database(grammarPath, { readonly: true });
  
  const verbs = source.prepare('SELECT * FROM verb_forms').all();
  console.log(`      ${verbs.length.toLocaleString()} verb forms`);
  
  const insertVerb = output.prepare(`
    INSERT INTO verb_forms (base_form, inflection_type, inflected_form)
    VALUES (@base_form, @inflection_type, @inflected_form)
  `);
  
  const copyVerb = output.transaction((verbs) => {
    for (const v of verbs) {
      insertVerb.run(v);
    }
  });
  copyVerb(verbs);
  
  const nouns = source.prepare('SELECT * FROM noun_plurals').all();
  console.log(`      ${nouns.length.toLocaleString()} noun plurals`);
  
  const insertNoun = output.prepare(`
    INSERT INTO noun_plurals (singular, plural)
    VALUES (@singular, @plural)
  `);
  
  const copyNoun = output.transaction((nouns) => {
    for (const n of nouns) {
      insertNoun.run(n);
    }
  });
  copyNoun(nouns);
  
  const pos = source.prepare('SELECT * FROM pos_tags').all();
  console.log(`      ${pos.length.toLocaleString()} POS tags`);
  
  const insertPOS = output.prepare(`
    INSERT INTO pos_tags (word, tag)
    VALUES (@word, @tag)
  `);
  
  const copyPOS = output.transaction((pos) => {
    for (const p of pos) {
      insertPOS.run(p);
    }
  });
  copyPOS(pos);
  
  source.close();
  console.log(`      ✅ Complete`);
}

// Optimize
console.log('\nOptimizing database...');
output.exec('VACUUM');
output.exec('ANALYZE');

output.close();

const stats = statSync(OUTPUT_FILE);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('\n✅ Lexical pack complete!');
console.log(`📍 Output: ${OUTPUT_FILE}`);
console.log(`📊 Size: ${sizeMB} MB`);
console.log(`📚 Strong\'s entries: ${totalEntries.toLocaleString()}`);
