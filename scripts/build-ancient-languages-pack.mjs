#!/usr/bin/env node
/**
 * Build Consolidated Ancient Languages Pack
 * 
 * Merges Hebrew, Greek NT, and LXX with morphology data.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs');
const OUTPUT_DIR = join(repoRoot, 'packs/consolidated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'ancient-languages.sqlite');

console.log('📦 Building Ancient Languages Pack...\n');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Always build from scratch — the schema CREATEs fail against a previous build.
if (existsSync(OUTPUT_FILE)) {
  rmSync(OUTPUT_FILE);
}

const output = new Database(OUTPUT_FILE);

// Create schema
output.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT,
    description TEXT
  );
  
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
  
  -- Hebrew/Greek word-by-word morphology
  CREATE TABLE words (
    translation_id TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    word_order INTEGER NOT NULL,
    text TEXT NOT NULL,
    lemma TEXT,
    strongs TEXT,
    morph_code TEXT,
    gloss_en TEXT,
    transliteration TEXT,
    PRIMARY KEY (translation_id, book, chapter, verse, word_order)
  );
  
  CREATE INDEX idx_words_translation ON words(translation_id);
  CREATE INDEX idx_words_book ON words(book);
  CREATE INDEX idx_words_strongs ON words(strongs);
`);

// Insert metadata
const insertMeta = output.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta.run('id', 'ancient-languages');
insertMeta.run('version', '1.0.0');
insertMeta.run('type', 'translation');
insertMeta.run('schemaVersion', '1');
insertMeta.run('minAppVersion', '1.0.0');
insertMeta.run('name', 'Ancient Languages Pack');
insertMeta.run('description', 'Hebrew OT, Greek NT (Byzantine, TR), LXX with morphology');
insertMeta.run('createdAt', new Date().toISOString());

let totalVerses = 0;
let totalWords = 0;

// 1. Hebrew OSHB (has morphology in 'words' table)
console.log('\n   Merging Hebrew OSHB...');
const hebrewPath = join(PACKS_DIR, 'hebrew-oshb.sqlite');
if (existsSync(hebrewPath)) {
  const source = new Database(hebrewPath, { readonly: true });
  
  output.prepare(`
    INSERT INTO translations (id, name, language, description)
    VALUES ('hebrew-oshb', 'Hebrew OSHB', 'he', 'Open Scriptures Hebrew Bible with morphology')
  `).run();
  
  const verses = source.prepare('SELECT book, chapter, verse, text FROM verses').all();
  console.log(`      ${verses.length.toLocaleString()} verses`);
  
  const insertVerse = output.prepare(`
    INSERT INTO verses (translation_id, book, chapter, verse, text)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const copyVerses = output.transaction((verses) => {
    for (const v of verses) {
      insertVerse.run('hebrew-oshb', v.book, v.chapter, v.verse, v.text);
    }
  });
  copyVerses(verses);
  totalVerses += verses.length;
  
  // Copy morphology from 'words' table
  const words = source.prepare('SELECT * FROM words').all();
  console.log(`      ${words.length.toLocaleString()} morphology entries`);
  
  const insertWord = output.prepare(`
    INSERT INTO words (translation_id, book, chapter, verse, word_order, text, lemma, strongs, morph_code, gloss_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const copyWords = output.transaction((words) => {
    for (const w of words) {
      insertWord.run('hebrew-oshb', w.book, w.chapter, w.verse, w.word_order, w.text, w.lemma, w.strongs, w.morph_code, w.gloss_en);
    }
  });
  copyWords(words);
  totalWords += words.length;
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 2. Byzantine Greek
console.log('\n   Merging Byzantine Greek...');
const byzPath = join(PACKS_DIR, 'byz-full.sqlite');
if (existsSync(byzPath)) {
  const source = new Database(byzPath, { readonly: true });
  
  output.prepare(`
    INSERT INTO translations (id, name, language, description)
    VALUES ('byz', 'Byzantine Greek NT', 'grc', 'Byzantine Greek New Testament')
  `).run();
  
  const verses = source.prepare('SELECT book, chapter, verse, text FROM verses').all();
  console.log(`      ${verses.length.toLocaleString()} verses`);
  
  const insertVerse = output.prepare(`
    INSERT INTO verses (translation_id, book, chapter, verse, text)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const copyVerses = output.transaction((verses) => {
    for (const v of verses) {
      insertVerse.run('byz', v.book, v.chapter, v.verse, v.text);
    }
  });
  copyVerses(verses);
  totalVerses += verses.length;
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 3. Textus Receptus Greek
console.log('\n   Merging Textus Receptus...');
const trPath = join(PACKS_DIR, 'tr-full.sqlite');
if (existsSync(trPath)) {
  const source = new Database(trPath, { readonly: true });
  
  output.prepare(`
    INSERT INTO translations (id, name, language, description)
    VALUES ('tr', 'Textus Receptus', 'grc', 'Textus Receptus Greek New Testament')
  `).run();
  
  const verses = source.prepare('SELECT book, chapter, verse, text FROM verses').all();
  console.log(`      ${verses.length.toLocaleString()} verses`);
  
  const insertVerse = output.prepare(`
    INSERT INTO verses (translation_id, book, chapter, verse, text)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const copyVerses = output.transaction((verses) => {
    for (const v of verses) {
      insertVerse.run('tr', v.book, v.chapter, v.verse, v.text);
    }
  });
  copyVerses(verses);
  totalVerses += verses.length;
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 4. LXX Greek
console.log('\n   Merging LXX Greek...');
const lxxPath = join(PACKS_DIR, 'lxx-greek.sqlite');
if (existsSync(lxxPath)) {
  const source = new Database(lxxPath, { readonly: true });
  
  output.prepare(`
    INSERT INTO translations (id, name, language, description)
    VALUES ('lxx', 'Septuagint Greek', 'grc', 'Septuagint (LXX) Greek Old Testament')
  `).run();
  
  const verses = source.prepare('SELECT book, chapter, verse, text FROM verses').all();
  console.log(`      ${verses.length.toLocaleString()} verses`);
  
  const insertVerse = output.prepare(`
    INSERT INTO verses (translation_id, book, chapter, verse, text)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const copyVerses = output.transaction((verses) => {
    for (const v of verses) {
      insertVerse.run('lxx', v.book, v.chapter, v.verse, v.text);
    }
  });
  copyVerses(verses);
  totalVerses += verses.length;
  
  source.close();
  console.log(`      ✅ Complete`);
}

// 5. Per-edition Greek NT morphology from TAGNT
//
// This used to copy one OpenGNT dataset in twice, once as 'byz' and once as
// 'tr', so the two editions had byte-identical tagging and the word study could
// never tell them apart. Worse, OpenGNT is Nestle-Aland family, so neither
// label was correct — the Byzantine text was being explained by a critical one.
//
// TAGNT records which editions actually contain each word, so every edition
// gets its own tagging and Acts 8:37 exists in TR and nowhere else.
console.log('\nMerging TAGNT per-edition Greek morphology...');
const tagntPath = join(PACKS_DIR, 'tagnt-morphology.sqlite');
if (!existsSync(tagntPath)) {
  // Deliberately fatal. Falling back to the old one-text-two-labels behaviour
  // is what produced silently wrong data for months; a loud failure is better.
  console.error(`\n❌ Missing ${tagntPath}`);
  console.error('   Run: node scripts/build-tagnt-morphology.mjs');
  process.exit(1);
}
{
  const source = new Database(tagntPath, { readonly: true });

  // Only ship tagging for editions that have text to read. TAGNT also yields
  // SBLGNT, but there is no SBLGNT reading text in this pack, so shipping its
  // morphology would put an edition in the word study's source picker that you
  // cannot open in the reader. The moment SBLGNT verses are added above, its
  // tagging flows through here on its own.
  const readable = new Set(
    output.prepare('SELECT DISTINCT translation_id FROM verses').all().map((r) => r.translation_id),
  );

  const morphRows = source
    .prepare(
      'SELECT translation_id, book, chapter, verse, word_order, text, lemma, strongs, morph_code, gloss_en, transliteration FROM words',
    )
    .all()
    .filter((r) => readable.has(r.translation_id));

  const skipped = source.prepare('SELECT DISTINCT translation_id FROM words').all()
    .map((r) => r.translation_id)
    .filter((id) => !readable.has(id));
  if (skipped.length) {
    console.log(`      (holding back, no reading text: ${skipped.join(', ')})`);
  }

  const insertWord = output.prepare(`
    INSERT OR IGNORE INTO words
      (translation_id, book, chapter, verse, word_order, text, lemma, strongs, morph_code, gloss_en, transliteration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const copyMorph = output.transaction((rows) => {
    for (const r of rows) {
      insertWord.run(
        r.translation_id, r.book, r.chapter, r.verse, r.word_order,
        r.text, r.lemma, r.strongs, r.morph_code, r.gloss_en, r.transliteration,
      );
    }
  });
  copyMorph(morphRows);
  totalWords += morphRows.length;

  // Report what actually landed, not what the source offered.
  for (const row of output
    .prepare('SELECT translation_id, COUNT(*) n FROM words GROUP BY translation_id ORDER BY 1')
    .all()) {
    console.log(`      ${row.translation_id.padEnd(12)} ${row.n.toLocaleString()} words`);
  }
  source.close();
  console.log('      ✅ Complete');
}

// Optimize
console.log('\nOptimizing database...');
output.exec('VACUUM');
output.exec('ANALYZE');

output.close();

const stats = statSync(OUTPUT_FILE);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('\n✅ Ancient Languages pack complete!');
console.log(`📍 Output: ${OUTPUT_FILE}`);
console.log(`📊 Size: ${sizeMB} MB`);
console.log(`📖 Verses: ${totalVerses.toLocaleString()}`);
console.log(`📝 Words: ${totalWords.toLocaleString()}`);
