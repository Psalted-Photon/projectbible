#!/usr/bin/env node

/**
 * Build Consolidated Greek Pack
 * 
 * Combines all Greek original texts into one pack:
 * - LXX (Septuagint - Greek OT)
 * - Byzantine Majority Text (Greek NT)
 * - Textus Receptus (Greek NT)
 * - OpenGNT (Greek NT with morphology)
 * 
 * Usage: node scripts/build-greek-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const OUTPUT_PATH = 'packs/greek.sqlite';

const SOURCE_PACKS = [
  { file: 'packs/lxx-greek.sqlite', edition: 'lxx', name: 'Septuagint (LXX)', testament: 'OT' },
  { file: 'packs/byz-full.sqlite', edition: 'byz', name: 'Byzantine Majority Text', testament: 'NT' },
  { file: 'packs/tr-full.sqlite', edition: 'tr', name: 'Textus Receptus', testament: 'NT' },
  { file: 'packs/opengnt-morphology.sqlite', edition: 'opengnt', name: 'OpenGNT', testament: 'NT' }
];

function createSchema(db) {
  console.log('Creating schema...');
  
  db.exec(`
    -- Pack metadata
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    -- Editions contained in this pack
    CREATE TABLE IF NOT EXISTS editions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      testament TEXT NOT NULL,
      description TEXT
    );
    
    -- Verses from all editions
    CREATE TABLE IF NOT EXISTS verses (
      edition TEXT NOT NULL,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (edition, book, chapter, verse)
    );
    
    -- Morphology data (primarily from OpenGNT)
    CREATE TABLE IF NOT EXISTS morphology (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      wordPosition INTEGER NOT NULL,
      word TEXT NOT NULL,
      lemma TEXT NOT NULL,
      strongsId TEXT,
      parsing TEXT,
      gloss TEXT,
      language TEXT DEFAULT 'greek'
    );
    
    -- Strong's lexicon entries for Greek
    CREATE TABLE IF NOT EXISTS strongs_entries (
      id TEXT PRIMARY KEY,
      lemma TEXT NOT NULL,
      transliteration TEXT,
      definition TEXT NOT NULL,
      shortDefinition TEXT,
      partOfSpeech TEXT,
      language TEXT DEFAULT 'greek',
      derivation TEXT,
      kjvUsage TEXT,
      occurrences INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_verses_edition ON verses(edition);
    CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
    CREATE INDEX IF NOT EXISTS idx_verses_reference ON verses(edition, book, chapter);
    CREATE INDEX IF NOT EXISTS idx_morphology_verse ON morphology(book, chapter, verse, wordPosition);
    CREATE INDEX IF NOT EXISTS idx_morphology_strongs ON morphology(strongsId);
    CREATE INDEX IF NOT EXISTS idx_strongs_lemma ON strongs_entries(lemma);
  `);
}

function insertMetadata(db) {
  console.log('Inserting metadata...');
  
  const insert = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  
  insert.run('pack_id', 'greek');
  insert.run('translation_id', 'GREEK');
  insert.run('translation_name', 'Greek Original Texts');
  insert.run('version', '1.0');
  insert.run('type', 'original-language');
  insert.run('language', 'grc');
  insert.run('language_name', 'Ancient Greek (Koine)');
  insert.run('license', 'CC BY-SA 4.0');
  insert.run('attribution', 'Open Scriptures Project + Byzantine/TR texts');
  insert.run('description', 'Complete Greek Bible with LXX and multiple NT editions');
  insert.run('features', 'multi-edition,morphology,lemmas');
  insert.run('created', new Date().toISOString());
}

function insertEditions(db) {
  console.log('Inserting edition metadata...');
  
  const insert = db.prepare(`
    INSERT OR REPLACE INTO editions (id, name, testament, description)
    VALUES (?, ?, ?, ?)
  `);
  
  const descriptions = {
    lxx: 'Greek translation of Hebrew Bible (3rd-1st century BC)',
    byz: 'Greek NT based on majority of Byzantine manuscripts',
    tr: 'Greek NT underlying the King James Version translation',
    opengnt: 'Greek NT with morphological analysis (Nestle-Aland base)'
  };
  
  for (const src of SOURCE_PACKS) {
    insert.run(src.edition, src.name, src.testament, descriptions[src.edition]);
  }
}

function copyVerses(targetDb, sourcePack) {
  if (!existsSync(sourcePack.file)) {
    console.warn(`  ⚠️  Source pack not found: ${sourcePack.file}`);
    return 0;
  }
  
  console.log(`  📖 Processing ${sourcePack.name}...`);
  
  const sourceDb = new Database(sourcePack.file, { readonly: true });
  
  try {
    // Check if source has verses
    const tables = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);
    
    if (!tableNames.includes('verses')) {
      console.warn(`    ⚠️  No verses table in ${sourcePack.file}`);
      return 0;
    }
    
    const count = sourceDb.prepare('SELECT COUNT(*) as count FROM verses').get();
    if (count.count === 0) {
      console.warn(`    ⚠️  No verses found in ${sourcePack.file}`);
      return 0;
    }
    
    // Copy all verses with edition tag
    const verses = sourceDb.prepare('SELECT book, chapter, verse, text FROM verses').all();
    
    const insert = targetDb.prepare(`
      INSERT OR REPLACE INTO verses (edition, book, chapter, verse, text)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const insertMany = targetDb.transaction((verses) => {
      for (const v of verses) {
        insert.run(sourcePack.edition, v.book, v.chapter, v.verse, v.text);
      }
    });
    
    insertMany(verses);
    
    console.log(`    ✅ Copied ${verses.length.toLocaleString()} verses`);
    
    // Copy morphology/words data if present (OpenGNT has 'words' table)
    if (tableNames.includes('words')) {
      try {
        const morphCount = sourceDb.prepare(`SELECT COUNT(*) as count FROM words`).get();
        if (morphCount.count > 0) {
          const morphData = sourceDb.prepare(`
            SELECT book, chapter, verse, word_order, text, lemma, strongs, morph_code, gloss_en 
            FROM words
          `).all();
          
          const insertMorph = targetDb.prepare(`
            INSERT OR REPLACE INTO morphology (book, chapter, verse, wordPosition, word, lemma, strongsId, parsing, gloss, language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'greek')
          `);
          
          const insertMorphMany = targetDb.transaction((data) => {
            for (const m of data) {
              insertMorph.run(m.book, m.chapter, m.verse, m.word_order, m.text || m.text_accented, m.lemma, m.strongs, m.morph_code, m.gloss_en);
            }
          });
          
          insertMorphMany(morphData);
          console.log(`    ✅ Copied ${morphData.length.toLocaleString()} morphology entries`);
        }
      } catch (err) {
        console.warn(`    ⚠️  Error copying morphology:`, err.message);
      }
    } else if (tableNames.includes('morphology')) {
      try {
        const morphCount = sourceDb.prepare('SELECT COUNT(*) as count FROM morphology').get();
        if (morphCount.count > 0) {
          const morphData = sourceDb.prepare('SELECT book, chapter, verse, wordPosition, word, lemma, strongsId, parsing, gloss FROM morphology').all();
          
          const insertMorph = targetDb.prepare(`
            INSERT OR REPLACE INTO morphology (book, chapter, verse, wordPosition, word, lemma, strongsId, parsing, gloss, language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'greek')
          `);
          
          const insertMorphMany = targetDb.transaction((data) => {
            for (const m of data) {
              insertMorph.run(m.book, m.chapter, m.verse, m.wordPosition, m.word, m.lemma, m.strongsId, m.parsing, m.gloss);
            }
          });
          
          insertMorphMany(morphData);
          console.log(`    ✅ Copied ${morphData.length.toLocaleString()} morphology entries`);
        }
      } catch (err) {
        console.warn(`    ⚠️  Error copying morphology:`, err.message);
      }
    }
    
    // Copy Strong's entries if present
    if (tableNames.includes('strongs_entries')) {
      try {
        const strongsCount = sourceDb.prepare('SELECT COUNT(*) as count FROM strongs_entries').get();
        if (strongsCount.count > 0) {
          const strongsData = sourceDb.prepare('SELECT id, lemma, transliteration, definition, shortDefinition, partOfSpeech, derivation, kjvUsage, occurrences FROM strongs_entries').all();
          
          const insertStrongs = targetDb.prepare(`
            INSERT OR REPLACE INTO strongs_entries (id, lemma, transliteration, definition, shortDefinition, partOfSpeech, language, derivation, kjvUsage, occurrences)
            VALUES (?, ?, ?, ?, ?, ?, 'greek', ?, ?, ?)
          `);
          
          const insertStrongsMany = targetDb.transaction((data) => {
            for (const s of data) {
              insertStrongs.run(s.id, s.lemma, s.transliteration, s.definition, s.shortDefinition, s.partOfSpeech, s.derivation, s.kjvUsage, s.occurrences);
            }
          });
          
          insertStrongsMany(strongsData);
          console.log(`    ✅ Copied ${strongsData.length.toLocaleString()} Strong's entries`);
        }
      } catch (err) {
        console.warn(`    ⚠️  Error copying Strong's data:`, err.message);
      }
    }
    
    return verses.length;
  } finally {
    sourceDb.close();
  }
}

function buildGreekPack() {
  console.log('🏛️  Building Consolidated Greek Pack\n');
  
  // Remove old file if exists
  if (existsSync(OUTPUT_PATH)) {
    console.log('Removing existing pack...');
    // Note: Will be overwritten by Database constructor
  }
  
  const db = new Database(OUTPUT_PATH);
  
  try {
    createSchema(db);
    insertMetadata(db);
    insertEditions(db);
    
    console.log('\nCopying verses from source packs:\n');
    
    let totalVerses = 0;
    for (const sourcePack of SOURCE_PACKS) {
      totalVerses += copyVerses(db, sourcePack);
    }
    
    // Get final stats
    const stats = db.prepare('SELECT COUNT(*) as count FROM verses').get();
    const editions = db.prepare('SELECT COUNT(*) as count FROM editions').get();
    const size = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
    
    console.log('\n✨ Greek Pack Complete!\n');
    console.log('📊 Summary:');
    console.log(`   Editions: ${editions.count}`);
    console.log(`   Total verses: ${stats.count.toLocaleString()}`);
    console.log(`   File size: ${(size.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Output: ${OUTPUT_PATH}\n`);
    
    console.log('💡 Editions included:');
    const editionList = db.prepare('SELECT id, name, testament FROM editions').all();
    for (const ed of editionList) {
      const verseCount = db.prepare('SELECT COUNT(*) as count FROM verses WHERE edition = ?').get(ed.id);
      console.log(`   • ${ed.name} (${ed.testament}): ${verseCount.count.toLocaleString()} verses`);
    }
    
  } catch (error) {
    console.error('\n❌ Error building Greek pack:', error);
    throw error;
  } finally {
    db.close();
  }
}

buildGreekPack();
