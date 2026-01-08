#!/usr/bin/env node

/**
 * Build Consolidated Hebrew Pack
 * 
 * Combines all Hebrew original texts into one pack:
 * - WLC (Westminster Leningrad Codex with OSHB morphology)
 * 
 * Usage: node scripts/build-hebrew-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const OUTPUT_PATH = 'packs/hebrew.sqlite';

const SOURCE_PACKS = [
  { file: 'packs/hebrew-oshb.sqlite', edition: 'wlc', name: 'Westminster Leningrad Codex', testament: 'OT' },
  { file: 'packs/wlc-full.sqlite', edition: 'wlc', name: 'Westminster Leningrad Codex', testament: 'OT' }
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
    
    -- Morphology data (from OSHB)
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
      language TEXT DEFAULT 'hebrew'
    );
    
    -- Strong's lexicon entries for Hebrew
    CREATE TABLE IF NOT EXISTS strongs_entries (
      id TEXT PRIMARY KEY,
      lemma TEXT NOT NULL,
      transliteration TEXT,
      definition TEXT NOT NULL,
      shortDefinition TEXT,
      partOfSpeech TEXT,
      language TEXT DEFAULT 'hebrew',
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
  
  insert.run('pack_id', 'hebrew');
  insert.run('translation_id', 'HEBREW');
  insert.run('translation_name', 'Hebrew Original Texts');
  insert.run('version', '4.20');
  insert.run('type', 'original-language');
  insert.run('language', 'heb');
  insert.run('language_name', 'Biblical Hebrew');
  insert.run('license', 'CC BY 4.0');
  insert.run('attribution', 'Open Scriptures Hebrew Bible (OSHB) Project');
  insert.run('description', 'Hebrew Bible (Tanakh) with morphological analysis');
  insert.run('features', 'multi-edition,morphology,lemmas,cantillation');
  insert.run('created', new Date().toISOString());
}

function insertEditions(db) {
  console.log('Inserting edition metadata...');
  
  const insert = db.prepare(`
    INSERT OR REPLACE INTO editions (id, name, testament, description)
    VALUES (?, ?, ?, ?)
  `);
  
  insert.run('wlc', 'Westminster Leningrad Codex', 'OT', 'Authoritative Hebrew text of the Old Testament with morphology');
}

function copyVerses(targetDb, sourcePack) {
  if (!existsSync(sourcePack.file)) {
    console.warn(`  ⚠️  Source pack not found: ${sourcePack.file}`);
    return 0;
  }
  
  console.log(`  📖 Processing ${sourcePack.name}...`);
  
  const sourceDb = new Database(sourcePack.file, { readonly: true });
  
  try {
    // Check what tables exist
    const tables = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);
    
    if (!tableNames.includes('verses')) {
      console.warn(`    ⚠️  No verses table in ${sourcePack.file}`);
      return 0;
    }
    
    // Check if source has verses
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
    
    // Copy morphology/words data if present
    if (tableNames.includes('words')) {
      try {
        const morphCount = sourceDb.prepare(`SELECT COUNT(*) as count FROM words`).get();
        if (morphCount.count > 0) {
          // Check column structure
          const sampleRow = sourceDb.prepare('SELECT * FROM words LIMIT 1').get();
          const columns = Object.keys(sampleRow || {});
          
          const morphData = sourceDb.prepare(`SELECT * FROM words`).all();
          
          const insertMorph = targetDb.prepare(`
            INSERT OR REPLACE INTO morphology (book, chapter, verse, wordPosition, word, lemma, strongsId, parsing, gloss, language)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hebrew')
          `);
          
          const insertMorphMany = targetDb.transaction((data) => {
            for (const m of data) {
              // Map column names (may vary between sources)
              const book = m.book || m.bookName;
              const chapter = m.chapter || m.chapterNum;
              const verse = m.verse || m.verseNum;
              const wordPosition = m.wordPosition || m.word_order || m.wordNum;
              const word = m.word || m.text || m.hebrew;
              const lemma = m.lemma || m.root;
              const strongsId = m.strongsId || m.strongs;
              const parsing = m.parsing || m.morph_code || m.morph || m.morphology;
              const gloss = m.gloss || m.gloss_en || m.english;
              
              if (book && chapter && verse && wordPosition) {
                insertMorph.run(book, chapter, verse, wordPosition, word, lemma, strongsId, parsing, gloss);
              }
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hebrew')
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
            VALUES (?, ?, ?, ?, ?, ?, 'hebrew', ?, ?, ?)
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

function buildHebrewPack() {
  console.log('✡️  Building Consolidated Hebrew Pack\n');
  
  const db = new Database(OUTPUT_PATH);
  
  try {
    createSchema(db);
    insertMetadata(db);
    insertEditions(db);
    
    console.log('\nCopying verses from source packs:\n');
    
    let totalVerses = 0;
    let foundSource = false;
    
    // Try each source (use first one that exists)
    for (const sourcePack of SOURCE_PACKS) {
      if (existsSync(sourcePack.file) && !foundSource) {
        totalVerses += copyVerses(db, sourcePack);
        foundSource = true;
        break;
      }
    }
    
    if (!foundSource) {
      console.error('\n❌ No Hebrew source packs found!');
      console.log('Expected one of:');
      for (const src of SOURCE_PACKS) {
        console.log(`  - ${src.file}`);
      }
      throw new Error('No Hebrew source packs available');
    }
    
    // Get final stats
    const stats = db.prepare('SELECT COUNT(*) as count FROM verses').get();
    const editions = db.prepare('SELECT COUNT(*) as count FROM editions').get();
    const size = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
    
    console.log('\n✨ Hebrew Pack Complete!\n');
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
    console.error('\n❌ Error building Hebrew pack:', error);
    throw error;
  } finally {
    db.close();
  }
}

buildHebrewPack();
