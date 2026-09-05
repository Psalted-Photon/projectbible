#!/usr/bin/env node

/**
 * Build BSB Pack (Berean Standard Bible)
 * 
 * Downloads and builds a SQLite pack for the Berean Standard Bible with rich text,
 * footnotes, cross-references, and section headings.
 * 
 * BSB is public domain and freely available at https://berean.bible
 * Source: scrollmapper/bible_databases (MIT License) or Berean Bible website
 * 
 * Usage: node scripts/build-bsb-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseUSFM,
  processVerses,
  cleanUSFMMarkup,
} from '../packages/packtools/src/parsers/usfm-scanner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const DATA_DIR = join(repoRoot, 'data-sources');
const PACKS_DIR = join(repoRoot, 'packs');
const OUTPUT_PATH = join(PACKS_DIR, 'bsb.sqlite');

// Ensure packs directory exists
if (!existsSync(PACKS_DIR)) {
  mkdirSync(PACKS_DIR, { recursive: true });
}

// All Bible books in canonical order
const BIBLE_BOOKS = [
  // Old Testament
  { name: 'Genesis', abbr: 'GEN', testament: 'OT', file: '01GENBSB.SFM' },
  { name: 'Exodus', abbr: 'EXO', testament: 'OT', file: '02EXOBSB.SFM' },
  { name: 'Leviticus', abbr: 'LEV', testament: 'OT', file: '03LEVBSB.SFM' },
  { name: 'Numbers', abbr: 'NUM', testament: 'OT', file: '04NUMBSB.SFM' },
  { name: 'Deuteronomy', abbr: 'DEU', testament: 'OT', file: '05DEUBSB.SFM' },
  { name: 'Joshua', abbr: 'JOS', testament: 'OT', file: '06JOSBSB.SFM' },
  { name: 'Judges', abbr: 'JDG', testament: 'OT', file: '07JDGBSB.SFM' },
  { name: 'Ruth', abbr: 'RUT', testament: 'OT', file: '08RUTBSB.SFM' },
  { name: '1 Samuel', abbr: '1SA', testament: 'OT', file: '091SABSB.SFM' },
  { name: '2 Samuel', abbr: '2SA', testament: 'OT', file: '102SABSB.SFM' },
  { name: '1 Kings', abbr: '1KI', testament: 'OT', file: '111KIBSB.SFM' },
  { name: '2 Kings', abbr: '2KI', testament: 'OT', file: '122KIBSB.SFM' },
  { name: '1 Chronicles', abbr: '1CH', testament: 'OT', file: '131CHBSB.SFM' },
  { name: '2 Chronicles', abbr: '2CH', testament: 'OT', file: '142CHBSB.SFM' },
  { name: 'Ezra', abbr: 'EZR', testament: 'OT', file: '15EZRBSB.SFM' },
  { name: 'Nehemiah', abbr: 'NEH', testament: 'OT', file: '16NEHBSB.SFM' },
  { name: 'Esther', abbr: 'EST', testament: 'OT', file: '17ESTBSB.SFM' },
  { name: 'Job', abbr: 'JOB', testament: 'OT', file: '18JOBBSB.SFM' },
  { name: 'Psalms', abbr: 'PSA', testament: 'OT', file: '19PSABSB.SFM' },
  { name: 'Proverbs', abbr: 'PRO', testament: 'OT', file: '20PROBSB.SFM' },
  { name: 'Ecclesiastes', abbr: 'ECC', testament: 'OT', file: '21ECCBSB.SFM' },
  { name: 'Song of Solomon', abbr: 'SNG', testament: 'OT', file: '22SNGBSB.SFM' },
  { name: 'Isaiah', abbr: 'ISA', testament: 'OT', file: '23ISABSB.SFM' },
  { name: 'Jeremiah', abbr: 'JER', testament: 'OT', file: '24JERBSB.SFM' },
  { name: 'Lamentations', abbr: 'LAM', testament: 'OT', file: '25LAMBSB.SFM' },
  { name: 'Ezekiel', abbr: 'EZK', testament: 'OT', file: '26EZKBSB.SFM' },
  { name: 'Daniel', abbr: 'DAN', testament: 'OT', file: '27DANBSB.SFM' },
  { name: 'Hosea', abbr: 'HOS', testament: 'OT', file: '28HOSBSB.SFM' },
  { name: 'Joel', abbr: 'JOL', testament: 'OT', file: '29JOLBSB.SFM' },
  { name: 'Amos', abbr: 'AMO', testament: 'OT', file: '30AMOBSB.SFM' },
  { name: 'Obadiah', abbr: 'OBA', testament: 'OT', file: '31OBABSB.SFM' },
  { name: 'Jonah', abbr: 'JON', testament: 'OT', file: '32JONBSB.SFM' },
  { name: 'Micah', abbr: 'MIC', testament: 'OT', file: '33MICBSB.SFM' },
  { name: 'Nahum', abbr: 'NAM', testament: 'OT', file: '34NAMBSB.SFM' },
  { name: 'Habakkuk', abbr: 'HAB', testament: 'OT', file: '35HABBSB.SFM' },
  { name: 'Zephaniah', abbr: 'ZEP', testament: 'OT', file: '36ZEPBSB.SFM' },
  { name: 'Haggai', abbr: 'HAG', testament: 'OT', file: '37HAGBSB.SFM' },
  { name: 'Zechariah', abbr: 'ZEC', testament: 'OT', file: '38ZECBSB.SFM' },
  { name: 'Malachi', abbr: 'MAL', testament: 'OT', file: '39MALBSB.SFM' },
  // New Testament
  { name: 'Matthew', abbr: 'MAT', testament: 'NT', file: '41MATBSB.SFM' },
  { name: 'Mark', abbr: 'MRK', testament: 'NT', file: '42MRKBSB.SFM' },
  { name: 'Luke', abbr: 'LUK', testament: 'NT', file: '43LUKBSB.SFM' },
  { name: 'John', abbr: 'JHN', testament: 'NT', file: '44JHNBSB.SFM' },
  { name: 'Acts', abbr: 'ACT', testament: 'NT', file: '45ACTBSB.SFM' },
  { name: 'Romans', abbr: 'ROM', testament: 'NT', file: '46ROMBSB.SFM' },
  { name: '1 Corinthians', abbr: '1CO', testament: 'NT', file: '471COBSB.SFM' },
  { name: '2 Corinthians', abbr: '2CO', testament: 'NT', file: '482COBSB.SFM' },
  { name: 'Galatians', abbr: 'GAL', testament: 'NT', file: '49GALBSB.SFM' },
  { name: 'Ephesians', abbr: 'EPH', testament: 'NT', file: '50EPHBSB.SFM' },
  { name: 'Philippians', abbr: 'PHP', testament: 'NT', file: '51PHPBSB.SFM' },
  { name: 'Colossians', abbr: 'COL', testament: 'NT', file: '52COLBSB.SFM' },
  { name: '1 Thessalonians', abbr: '1TH', testament: 'NT', file: '531THBSB.SFM' },
  { name: '2 Thessalonians', abbr: '2TH', testament: 'NT', file: '542THBSB.SFM' },
  { name: '1 Timothy', abbr: '1TI', testament: 'NT', file: '551TIBSB.SFM' },
  { name: '2 Timothy', abbr: '2TI', testament: 'NT', file: '562TIBSB.SFM' },
  { name: 'Titus', abbr: 'TIT', testament: 'NT', file: '57TITBSB.SFM' },
  { name: 'Philemon', abbr: 'PHM', testament: 'NT', file: '58PHMBSB.SFM' },
  { name: 'Hebrews', abbr: 'HEB', testament: 'NT', file: '59HEBBSB.SFM' },
  { name: 'James', abbr: 'JAS', testament: 'NT', file: '60JASBSB.SFM' },
  { name: '1 Peter', abbr: '1PE', testament: 'NT', file: '611PEBSB.SFM' },
  { name: '2 Peter', abbr: '2PE', testament: 'NT', file: '622PEBSB.SFM' },
  { name: '1 John', abbr: '1JN', testament: 'NT', file: '631JNBSB.SFM' },
  { name: '2 John', abbr: '2JN', testament: 'NT', file: '642JNBSB.SFM' },
  { name: '3 John', abbr: '3JN', testament: 'NT', file: '653JNBSB.SFM' },
  { name: 'Jude', abbr: 'JUD', testament: 'NT', file: '66JUDBSB.SFM' },
  { name: 'Revelation', abbr: 'REV', testament: 'NT', file: '67REVBSB.SFM' }
];


/**
 * Build BSB pack from USFM files with footnotes and cross-references
 */
async function buildBSBPack() {
  console.log('📖 Building Berean Standard Bible Pack (with footnotes & cross-references)\n');
  
  const USFM_DIR = join(DATA_DIR, 'bsb_usfm', 'bsb_usfm');
  
  if (!existsSync(USFM_DIR)) {
    console.error(`❌ USFM files not found: ${USFM_DIR}`);
    console.log('\nThe USFM files should already be extracted.');
    console.log('If not, download and extract:');
    console.log('  cd data-sources');
    console.log('  Invoke-WebRequest -Uri "https://bereanbible.com/bsb_usfm.zip" -OutFile "bsb_usfm.zip"');
    console.log('  Expand-Archive -Path "bsb_usfm.zip" -DestinationPath "bsb_usfm"\n');
    process.exit(1);
  }
  
  // Create database. Start from scratch: rows are written with INSERT OR
  // REPLACE, so building over a previous file would leave stale verses behind
  // wherever a run was interrupted — a pack that is half one build, half another.
  if (existsSync(OUTPUT_PATH)) unlinkSync(OUTPUT_PATH);
  const db = new Database(OUTPUT_PATH);
  
  try {
    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      
      CREATE TABLE IF NOT EXISTS verses (
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        heading TEXT,
        PRIMARY KEY (book, chapter, verse)
      );
      
      CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
      CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses(book, chapter);
    `);
    
    // Insert metadata
    const metaInsert = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    metaInsert.run('pack_id', 'bsb');
    metaInsert.run('type', 'text');
    metaInsert.run('translation_id', 'BSB');
    metaInsert.run('translation_name', 'Berean Standard Bible');
    metaInsert.run('description', 'Public domain modern English translation with section headings, footnotes, and cross-references');
    metaInsert.run('language', 'en');
    metaInsert.run('license', 'Public Domain');
    metaInsert.run('attribution', 'Berean Standard Bible (BSB) - Public Domain. https://berean.bible');
    metaInsert.run('version', '1.0.0');
    metaInsert.run('build_date', new Date().toISOString());
    
    // Insert verses from USFM files
    const verseInsert = db.prepare('INSERT OR REPLACE INTO verses (book, chapter, verse, text, heading) VALUES (?, ?, ?, ?, ?)');
    let totalVerses = 0;
    
    for (const book of BIBLE_BOOKS) {
      const filePath = join(USFM_DIR, book.file);
      
      if (!existsSync(filePath)) {
        console.log(`⚠️  ${book.name}: File not found (${book.file})`);
        continue;
      }
      
      console.log(`Processing ${book.name}...`);
      
      const content = readFileSync(filePath, 'utf-8').replace(/\r/g, '');
      const rawVerses = parseUSFM(content);
      const verses = processVerses(rawVerses);
      
      for (const verse of verses) {
        const cleanText = cleanUSFMMarkup(verse.text);
        verseInsert.run(book.name, verse.chapter, verse.verse, cleanText, verse.heading || null);
        totalVerses++;
      }
      
      console.log(`  ✓ ${verses.length} verses`);
    }
    
    // Optimize database
    db.exec('VACUUM');
    db.exec('ANALYZE');
    
    const stats = db.prepare('SELECT COUNT(*) as count FROM verses').get();
    const size = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
    
    console.log('\n✨ BSB Pack Complete!\n');
    console.log('📊 Summary:');
    console.log(`   Total verses: ${stats.count.toLocaleString()}`);
    console.log(`   File size: ${(size.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Output: ${OUTPUT_PATH}`);
    console.log('\n� Features included:');
    console.log('   • Section headings as inline notes');
    console.log('   • Footnotes with references and explanations');
    console.log('   • Cross-references to parallel passages');
    console.log('\n�📖 The Berean Standard Bible is public domain and free to use.');
    console.log('   Learn more at https://berean.bible\n');
    
  } catch (error) {
    console.error('\n❌ Error building BSB pack:', error);
    throw error;
  } finally {
    db.close();
  }
}

buildBSBPack().catch(error => {
  console.error(error);
  process.exit(1);
});
