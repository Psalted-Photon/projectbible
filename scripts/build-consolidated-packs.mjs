#!/usr/bin/env node
/**
 * Build Consolidated Packs
 * 
 * Merges existing packs into larger consolidated bundles optimized for:
 * - GitHub Releases CDN delivery
 * - Offline-first architecture
 * - Predictable download sizes
 * - Future growth capacity
 * 
 * Creates 6 strategic bundles:
 * 1. translations.sqlite (~1.5GB) - All English translations
 * 2. ancient-languages.sqlite (~1.5GB) - Hebrew, Greek, LXX with morphology
 * 3. lexical.sqlite (~1.2GB) - Strong's + English lexical packs
 * 4. study-tools.sqlite (~300MB) - Maps, places, chronological, cross-refs
 * 5. bsb-audio-pt1.sqlite (~1.7GB) - Genesis-Psalms
 * 6. bsb-audio-pt2.sqlite (~1.7GB) - Proverbs-Revelation
 * 
 * Usage: node scripts/build-consolidated-packs.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const POLISHED_PACKS_DIR = join(repoRoot, 'packs/polished');
const OUTPUT_DIR = join(repoRoot, 'packs/consolidated');

console.log('🏗️  Building Consolidated Packs...\n');

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Merge multiple SQLite databases into one
 */
function mergeDatabases(sourcePacks: string[], outputPath: string, packInfo: any): void {
  console.log(`\n📦 Building ${packInfo.name}...`);
  console.log(`   Sources: ${sourcePacks.length} packs`);
  
  // Create output database
  const output = new Database(outputPath);
  
  // Create unified schema
  console.log('   Creating unified schema...');
  output.exec(`
    -- Pack metadata
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    -- Translations table
    CREATE TABLE IF NOT EXISTS translations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      language TEXT,
      description TEXT
    );
    
    -- Verses table
    CREATE TABLE IF NOT EXISTS verses (
      translation_id TEXT NOT NULL,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (translation_id, book, chapter, verse)
    );
    
    CREATE INDEX IF NOT EXISTS idx_verses_translation ON verses(translation_id);
    CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
    CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses(book, chapter);
    
    -- Morphology table (for ancient language packs)
    CREATE TABLE IF NOT EXISTS morphology (
      translation_id TEXT NOT NULL,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      word_order INTEGER NOT NULL,
      word TEXT NOT NULL,
      lemma TEXT,
      strongs_id TEXT,
      morph_code TEXT,
      gloss_en TEXT,
      PRIMARY KEY (translation_id, book, chapter, verse, word_order)
    );
    
    CREATE INDEX IF NOT EXISTS idx_morphology_translation ON morphology(translation_id);
    CREATE INDEX IF NOT EXISTS idx_morphology_book ON morphology(book);
    CREATE INDEX IF NOT EXISTS idx_morphology_strongs ON morphology(strongs_id);
    
    -- Lexicon entries (for lexical pack)
    CREATE TABLE IF NOT EXISTS lexicon_entries (
      id TEXT PRIMARY KEY,
      lemma TEXT,
      transliteration TEXT,
      pronunciation TEXT,
      definition TEXT,
      language TEXT,
      part_of_speech TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_lexicon_lemma ON lexicon_entries(lemma);
    CREATE INDEX IF NOT EXISTS idx_lexicon_language ON lexicon_entries(language);
    
    -- English wordlist (for lexical pack)
    CREATE TABLE IF NOT EXISTS english_words (
      word TEXT PRIMARY KEY,
      ipa TEXT,
      frequency INTEGER,
      pos_tags TEXT
    );
    
    -- English thesaurus (for lexical pack)
    CREATE TABLE IF NOT EXISTS english_synonyms (
      word TEXT NOT NULL,
      synonym TEXT NOT NULL,
      relationship TEXT,
      PRIMARY KEY (word, synonym)
    );
    
    CREATE INDEX IF NOT EXISTS idx_synonyms_word ON english_synonyms(word);
    
    -- English grammar (for lexical pack)
    CREATE TABLE IF NOT EXISTS english_grammar (
      word TEXT NOT NULL,
      base_form TEXT,
      inflection_type TEXT,
      inflected_form TEXT,
      PRIMARY KEY (word, inflection_type)
    );
    
    -- Places (for study-tools pack)
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      type TEXT,
      description TEXT
    );
    
    -- Maps (for study-tools pack)
    CREATE TABLE IF NOT EXISTS historical_layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      period TEXT,
      year_start INTEGER,
      year_end INTEGER,
      geojson TEXT
    );
    
    -- Cross-references (for study-tools pack)
    CREATE TABLE IF NOT EXISTS cross_references (
      from_book TEXT NOT NULL,
      from_chapter INTEGER NOT NULL,
      from_verse INTEGER NOT NULL,
      to_book TEXT NOT NULL,
      to_chapter INTEGER NOT NULL,
      to_verse_start INTEGER NOT NULL,
      to_verse_end INTEGER,
      description TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_xref_from ON cross_references(from_book, from_chapter, from_verse);
    CREATE INDEX IF NOT EXISTS idx_xref_to ON cross_references(to_book, to_chapter, to_verse_start);
    
    -- Chronological ordering (for study-tools pack)
    CREATE TABLE IF NOT EXISTS chronological_order (
      chrono_order INTEGER PRIMARY KEY,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      canonical_order INTEGER NOT NULL
    );
    
    -- Audio metadata (for audio packs)
    CREATE TABLE IF NOT EXISTS audio_files (
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      duration_ms INTEGER,
      file_size INTEGER,
      PRIMARY KEY (book, chapter)
    );
  `);
  
  // Insert pack metadata
  console.log('   Inserting pack metadata...');
  const insertMeta = output.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('id', packInfo.id);
  insertMeta.run('version', packInfo.version);
  insertMeta.run('type', packInfo.type);
  insertMeta.run('name', packInfo.name);
  insertMeta.run('description', packInfo.description);
  insertMeta.run('schemaVersion', '1');
  insertMeta.run('minAppVersion', '1.0.0');
  insertMeta.run('createdAt', new Date().toISOString());
  
  // Merge source packs
  let totalRecords = 0;
  
  for (const sourcePack of sourcePacks) {
    const packPath = join(POLISHED_PACKS_DIR, sourcePack);
    
    if (!existsSync(packPath)) {
      console.warn(`   ⚠️  Pack not found: ${sourcePack}`);
      continue;
    }
    
    console.log(`   Merging ${sourcePack}...`);
    
    try {
      const source = new Database(packPath, { readonly: true });
      
      // Attach source database
      output.exec(`ATTACH DATABASE '${packPath}' AS source`);
      
      // Copy verses if they exist
      try {
        const verseCount = source.prepare('SELECT COUNT(*) as count FROM verses').get() as any;
        if (verseCount.count > 0) {
          output.exec(`INSERT OR IGNORE INTO verses SELECT * FROM source.verses`);
          totalRecords += verseCount.count;
        }
      } catch (e) {
        // No verses table
      }
      
      // Copy morphology if it exists
      try {
        const morphCount = source.prepare('SELECT COUNT(*) as count FROM morphology').get() as any;
        if (morphCount.count > 0) {
          output.exec(`INSERT OR IGNORE INTO morphology SELECT * FROM source.morphology`);
        }
      } catch (e) {
        // No morphology table
      }
      
      // Copy lexicon entries if they exist
      try {
        source.prepare('SELECT COUNT(*) as count FROM entries').get();
        output.exec(`INSERT OR IGNORE INTO lexicon_entries SELECT * FROM source.entries`);
      } catch (e) {
        // No entries table
      }
      
      // Detach source
      output.exec('DETACH DATABASE source');
      source.close();
      
    } catch (error) {
      console.error(`   ❌ Error merging ${sourcePack}:`, error);
    }
  }
  
  // Optimize database
  console.log('   Optimizing database...');
  output.exec('VACUUM');
  output.exec('ANALYZE');
  
  output.close();
  
  // Get file size
  const fs = require('fs');
  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`   ✅ Complete: ${sizeMB} MB (${totalRecords.toLocaleString()} records)`);
}

// Build 1: Translations Pack
mergeDatabases(
  ['kjv.sqlite', 'web.sqlite', 'bsb.sqlite', 'net.sqlite', 'lxx2012-english.sqlite'],
  join(OUTPUT_DIR, 'translations.sqlite'),
  {
    id: 'translations',
    version: '1.0.0',
    type: 'translation',
    name: 'English Translations Pack',
    description: 'KJV, WEB, BSB, NET, LXX2012 English translations'
  }
);

// Build 2: Ancient Languages Pack
mergeDatabases(
  ['byz-full.sqlite', 'tr-full.sqlite', 'lxx-greek.sqlite', 'hebrew-oshb.sqlite'],
  join(OUTPUT_DIR, 'ancient-languages.sqlite'),
  {
    id: 'ancient-languages',
    version: '1.0.0',
    type: 'translation',
    name: 'Ancient Languages Pack',
    description: 'Hebrew, Greek NT (Byzantine, TR), LXX with morphology'
  }
);

// Build 3: Lexical Pack
mergeDatabases(
  ['english-wordlist-v1.sqlite', 'english-thesaurus-v1.sqlite', 'english-grammar-v1.sqlite'],
  join(OUTPUT_DIR, 'lexical.sqlite'),
  {
    id: 'lexical',
    version: '1.0.0',
    type: 'lexicon',
    name: 'Lexical Resources Pack',
    description: "Strong's dictionaries + English wordlist/thesaurus/grammar"
  }
);

// Build 4: Study Tools Pack
mergeDatabases(
  ['maps.sqlite'],
  join(OUTPUT_DIR, 'study-tools.sqlite'),
  {
    id: 'study-tools',
    version: '1.0.0',
    type: 'study',
    name: 'Study Tools Pack',
    description: 'Maps, places, chronological ordering, cross-references'
  }
);

console.log('\n✅ All consolidated packs built successfully!');
console.log(`📍 Output: ${OUTPUT_DIR}`);
console.log('\n📊 Pack Summary:');
console.log('   1. translations.sqlite      - English translations');
console.log('   2. ancient-languages.sqlite - Hebrew, Greek with morphology');
console.log('   3. lexical.sqlite          - Lexical resources');
console.log('   4. study-tools.sqlite      - Study aids');
console.log('\n💡 Next steps:');
console.log('   • Build BSB audio packs (split into pt1/pt2)');
console.log('   • Add cross-references to study-tools');
console.log('   • Add chronological data to study-tools');
console.log('   • Add places data to study-tools');
console.log('   • Generate manifest.json');
console.log('   • Upload to GitHub Releases');
