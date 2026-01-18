#!/usr/bin/env node

/**
 * Build BSB Audio Pack (Berean Standard Bible Audio)
 * 
 * Downloads CC0 BSB audio from BibleHub, organizes into chapter-level MP3s,
 * and creates a unified pack with SQLite metadata.
 * 
 * License: CC0 1.0 - https://creativecommons.org/publicdomain/zero/1.0/
 * Source: https://audiobible.org/ (via BibleHub)
 * 
 * Usage: node scripts/build-bsb-audio-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';

const PACK_DIR = 'packs/bsb-audio';
const AUDIO_DIR = join(PACK_DIR, 'audio');
const OUTPUT_DB = join(PACK_DIR, 'bsb-audio.sqlite');

// Bible book structure with chapter counts and abbreviations
const BIBLE_BOOKS = [
  // Old Testament
  { name: 'Genesis', abbrev: 'Gen', chapters: 50 },
  { name: 'Exodus', abbrev: 'Exo', chapters: 40 },
  { name: 'Leviticus', abbrev: 'Lev', chapters: 27 },
  { name: 'Numbers', abbrev: 'Num', chapters: 36 },
  { name: 'Deuteronomy', abbrev: 'Deu', chapters: 34 },
  { name: 'Joshua', abbrev: 'Jos', chapters: 24 },
  { name: 'Judges', abbrev: 'Jdg', chapters: 21 },
  { name: 'Ruth', abbrev: 'Rut', chapters: 4 },
  { name: '1 Samuel', abbrev: '1Sa', chapters: 31 },
  { name: '2 Samuel', abbrev: '2Sa', chapters: 24 },
  { name: '1 Kings', abbrev: '1Ki', chapters: 22 },
  { name: '2 Kings', abbrev: '2Ki', chapters: 25 },
  { name: '1 Chronicles', abbrev: '1Ch', chapters: 29 },
  { name: '2 Chronicles', abbrev: '2Ch', chapters: 36 },
  { name: 'Ezra', abbrev: 'Ezr', chapters: 10 },
  { name: 'Nehemiah', abbrev: 'Neh', chapters: 13 },
  { name: 'Esther', abbrev: 'Est', chapters: 10 },
  { name: 'Job', abbrev: 'Job', chapters: 42 },
  { name: 'Psalms', abbrev: 'Psa', chapters: 150 },
  { name: 'Proverbs', abbrev: 'Pro', chapters: 31 },
  { name: 'Ecclesiastes', abbrev: 'Ecc', chapters: 12 },
  { name: 'Song of Solomon', abbrev: 'Sng', chapters: 8 },
  { name: 'Isaiah', abbrev: 'Isa', chapters: 66 },
  { name: 'Jeremiah', abbrev: 'Jer', chapters: 52 },
  { name: 'Lamentations', abbrev: 'Lam', chapters: 5 },
  { name: 'Ezekiel', abbrev: 'Eze', chapters: 48 },
  { name: 'Daniel', abbrev: 'Dan', chapters: 12 },
  { name: 'Hosea', abbrev: 'Hos', chapters: 14 },
  { name: 'Joel', abbrev: 'Joe', chapters: 3 },
  { name: 'Amos', abbrev: 'Amo', chapters: 9 },
  { name: 'Obadiah', abbrev: 'Oba', chapters: 1 },
  { name: 'Jonah', abbrev: 'Jon', chapters: 4 },
  { name: 'Micah', abbrev: 'Mic', chapters: 7 },
  { name: 'Nahum', abbrev: 'Nah', chapters: 3 },
  { name: 'Habakkuk', abbrev: 'Hab', chapters: 3 },
  { name: 'Zephaniah', abbrev: 'Zep', chapters: 3 },
  { name: 'Haggai', abbrev: 'Hag', chapters: 2 },
  { name: 'Zechariah', abbrev: 'Zec', chapters: 14 },
  { name: 'Malachi', abbrev: 'Mal', chapters: 4 },
  // New Testament
  { name: 'Matthew', abbrev: 'Mat', chapters: 28 },
  { name: 'Mark', abbrev: 'Mar', chapters: 16 },
  { name: 'Luke', abbrev: 'Luk', chapters: 24 },
  { name: 'John', abbrev: 'Joh', chapters: 21 },
  { name: 'Acts', abbrev: 'Act', chapters: 28 },
  { name: 'Romans', abbrev: 'Rom', chapters: 16 },
  { name: '1 Corinthians', abbrev: '1Co', chapters: 16 },
  { name: '2 Corinthians', abbrev: '2Co', chapters: 13 },
  { name: 'Galatians', abbrev: 'Gal', chapters: 6 },
  { name: 'Ephesians', abbrev: 'Eph', chapters: 6 },
  { name: 'Philippians', abbrev: 'Php', chapters: 4 },
  { name: 'Colossians', abbrev: 'Col', chapters: 4 },
  { name: '1 Thessalonians', abbrev: '1Th', chapters: 5 },
  { name: '2 Thessalonians', abbrev: '2Th', chapters: 3 },
  { name: '1 Timothy', abbrev: '1Ti', chapters: 6 },
  { name: '2 Timothy', abbrev: '2Ti', chapters: 4 },
  { name: 'Titus', abbrev: 'Tit', chapters: 3 },
  { name: 'Philemon', abbrev: 'Phm', chapters: 1 },
  { name: 'Hebrews', abbrev: 'Heb', chapters: 13 },
  { name: 'James', abbrev: 'Jam', chapters: 5 },
  { name: '1 Peter', abbrev: '1Pe', chapters: 5 },
  { name: '2 Peter', abbrev: '2Pe', chapters: 3 },
  { name: '1 John', abbrev: '1Jo', chapters: 5 },
  { name: '2 John', abbrev: '2Jo', chapters: 1 },
  { name: '3 John', abbrev: '3Jo', chapters: 1 },
  { name: 'Jude', abbrev: 'Jud', chapters: 1 },
  { name: 'Revelation', abbrev: 'Rev', chapters: 22 }
];

// Download a single chapter audio file
async function downloadChapter(book, chapter) {
  // Special handling for Psalms (uses 3 digits)
  const chapterStr = book.abbrev === 'Psa' 
    ? String(chapter).padStart(3, '0')
    : String(chapter).padStart(2, '0');
  
  const audioUrl = `https://tim.z73.com/hays/audio/${book.abbrev}${chapterStr}.mp3`;
  
  const bookDir = join(AUDIO_DIR, book.name);
  if (!existsSync(bookDir)) {
    mkdirSync(bookDir, { recursive: true });
  }
  
  const outputFile = join(bookDir, `${String(chapter).padStart(2, '0')}.mp3`);
  
  // Skip if already downloaded
  if (existsSync(outputFile)) {
    return { success: true, cached: true, size: 0 };
  }
  
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${audioUrl}`);
    }
    
    const fileStream = createWriteStream(outputFile);
    await pipeline(response.body, fileStream);
    
    const stats = await import('fs/promises').then(fs => fs.stat(outputFile));
    return { success: true, cached: false, size: stats.size };
  } catch (error) {
    console.error(`   ⚠️  Failed to download ${book.name} ${chapter}: ${error.message}`);
    return { success: false, cached: false, size: 0 };
  }
}

// Download all audio files
async function downloadAllAudio() {
  console.log('📥 Downloading BSB Audio Files\n');
  
  let totalChapters = 0;
  let downloadedChapters = 0;
  let cachedChapters = 0;
  let failedChapters = 0;
  let totalBytes = 0;
  
  for (const book of BIBLE_BOOKS) {
    console.log(`📖 ${book.name} (${book.chapters} chapters)...`);
    
    for (let chapter = 1; chapter <= book.chapters; chapter++) {
      totalChapters++;
      const result = await downloadChapter(book, chapter);
      
      if (result.success) {
        if (result.cached) {
          cachedChapters++;
        } else {
          downloadedChapters++;
          totalBytes += result.size;
        }
      } else {
        failedChapters++;
      }
      
      // Progress indicator
      if (chapter % 10 === 0 || chapter === book.chapters) {
        process.stdout.write(`   Chapter ${chapter}/${book.chapters}\r`);
      }
    }
    console.log(''); // New line after book
  }
  
  console.log('\n📊 Download Summary:');
  console.log(`   Total chapters: ${totalChapters}`);
  console.log(`   Downloaded: ${downloadedChapters}`);
  console.log(`   Cached: ${cachedChapters}`);
  console.log(`   Failed: ${failedChapters}`);
  console.log(`   Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB\n`);
  
  return { totalChapters, downloadedChapters, failedChapters };
}

// Create SQLite metadata database
async function createMetadataDatabase(stats) {
  console.log('📦 Creating Metadata Database\n');
  
  // Remove existing DB
  if (existsSync(OUTPUT_DB)) {
    const fs = await import('fs');
    fs.unlinkSync(OUTPUT_DB);
  }
  
  const db = new Database(OUTPUT_DB);
  
  try {
    // Create schema
    db.exec(`
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      
      CREATE TABLE audio_chapters (
        book TEXT,
        chapter INTEGER,
        file_path TEXT,
        format TEXT,
        PRIMARY KEY (book, chapter)
      );
      
      CREATE INDEX idx_audio_book ON audio_chapters(book);
    `);
    
    // Insert metadata
    const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    insertMeta.run('pack_id', 'bsb-audio');
    insertMeta.run('pack_version', '1.0.0');
    insertMeta.run('pack_type', 'audio');
    insertMeta.run('translation_id', 'BSB');
    insertMeta.run('translation_name', 'Berean Standard Bible Audio');
    insertMeta.run('license', 'CC0 1.0 - https://creativecommons.org/publicdomain/zero/1.0/');
    insertMeta.run('narrator', 'Bob Souer, Barry Hays, Jordan Gilbert');
    insertMeta.run('source_url', 'https://audiobible.org/');
    insertMeta.run('description', 'Complete Bible audio narration in MP3 format (chapter-level)');
    
    // Insert audio chapter metadata
    const insertAudio = db.prepare('INSERT INTO audio_chapters (book, chapter, file_path, format) VALUES (?, ?, ?, ?)');
    
    let insertedCount = 0;
    for (const book of BIBLE_BOOKS) {
      for (let chapter = 1; chapter <= book.chapters; chapter++) {
        const filePath = `audio/${book.name}/${String(chapter).padStart(2, '0')}.mp3`;
        const fullPath = join(PACK_DIR, filePath);
        
        // Only insert if file exists
        if (existsSync(fullPath)) {
          insertAudio.run(book.name, chapter, filePath, 'mp3');
          insertedCount++;
        }
      }
    }
    
    const dbSize = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
    
    console.log('✨ Metadata Database Complete!\n');
    console.log('📊 Summary:');
    console.log(`   Audio chapters indexed: ${insertedCount}`);
    console.log(`   Database size: ${(dbSize.size / 1024).toFixed(2)} KB`);
    console.log(`   Output: ${OUTPUT_DB}\n`);
    
  } finally {
    db.close();
  }
}

// Create manifest.json
function createManifest() {
  const manifest = {
    id: 'bsb-audio',
    name: 'Berean Standard Bible Audio',
    version: '1.0.0',
    license: 'CC0 1.0',
    source_url: 'https://audiobible.org/',
    type: 'audio',
    format: 'mp3',
    structure: 'book/chapters',
    narrator: 'Bob Souer, Barry Hays, Jordan Gilbert',
    description: 'Complete Bible audio narration (chapter-level)',
    required: false
  };
  
  const manifestPath = join(PACK_DIR, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.log(`📄 Manifest created: ${manifestPath}\n`);
}

// Main build function
async function buildBSBAudioPack() {
  console.log('🎙️  Building BSB Audio Pack\n');
  console.log('License: CC0 1.0 (Public Domain Dedication)');
  console.log('Source: https://audiobible.org/\n');
  
  // Create directories
  if (!existsSync(PACK_DIR)) {
    mkdirSync(PACK_DIR, { recursive: true });
  }
  if (!existsSync(AUDIO_DIR)) {
    mkdirSync(AUDIO_DIR, { recursive: true });
  }
  
  // Download audio files
  const stats = await downloadAllAudio();
  
  if (stats.failedChapters > 0) {
    console.log(`\n⚠️  Warning: ${stats.failedChapters} chapters failed to download.`);
    console.log('The pack will be created with available chapters.\n');
  }
  
  // Create metadata database
  await createMetadataDatabase(stats);
  
  // Create manifest
  createManifest();
  
  console.log('✅ BSB Audio Pack Build Complete!\n');
  console.log(`📁 Pack location: ${PACK_DIR}`);
  console.log(`   - Audio files: ${AUDIO_DIR}`);
  console.log(`   - Metadata: ${OUTPUT_DB}`);
  console.log(`   - Manifest: ${join(PACK_DIR, 'manifest.json')}\n`);
}

buildBSBAudioPack().catch(error => {
  console.error('\n❌ Build failed:', error);
  process.exit(1);
});
