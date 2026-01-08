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
    
    CREATE INDEX IF NOT EXISTS idx_verses_edition ON verses(edition);
    CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
    CREATE INDEX IF NOT EXISTS idx_verses_reference ON verses(edition, book, chapter);
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
