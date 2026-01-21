#!/usr/bin/env node
/**
 * Build BSB Audio Packs (Part 1 & 2)
 * 
 * Splits BSB audio into two packs to stay under 2GB SQLite limit:
 * - Part 1: Genesis through Psalms (OT first half)
 * - Part 2: Proverbs through Revelation (OT second half + NT)
 * 
 * Each pack includes:
 * - SQLite database with audio_chapters metadata
 * - Embedded MP3 audio files as BLOBs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const SOURCE_DB = join(repoRoot, 'packs/bsb-audio/bsb-audio.sqlite');
const AUDIO_DIR = join(repoRoot, 'packs/bsb-audio/audio');
const OUTPUT_DIR = join(repoRoot, 'packs/consolidated');

// Book split point: everything through Psalms in pt1, Proverbs onward in pt2
const PART1_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms'
];

console.log('📦 Building BSB Audio Packs...\n');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Load source database
const source = new Database(SOURCE_DB, { readonly: true });

// Get all audio entries
const allAudio = source.prepare('SELECT * FROM audio_chapters ORDER BY book, chapter').all();
console.log(`Total audio chapters: ${allAudio.length}`);

// Split into two parts
const part1Audio = allAudio.filter(a => PART1_BOOKS.includes(a.book));
const part2Audio = allAudio.filter(a => !PART1_BOOKS.includes(a.book));

console.log(`Part 1 (Genesis-Psalms): ${part1Audio.length} chapters`);
console.log(`Part 2 (Proverbs-Revelation): ${part2Audio.length} chapters`);

source.close();

// Build Part 1
console.log('\n📦 Building Part 1 (Genesis-Psalms)...');
const output1 = new Database(join(OUTPUT_DIR, 'bsb-audio-pt1.sqlite'));

output1.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  CREATE TABLE audio_chapters (
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    audio_data BLOB NOT NULL,
    format TEXT DEFAULT 'mp3',
    duration_ms INTEGER,
    file_size INTEGER,
    PRIMARY KEY (book, chapter)
  );
  
  CREATE INDEX idx_audio_book ON audio_chapters(book);
`);

const insertMeta1 = output1.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta1.run('id', 'bsb-audio-pt1');
insertMeta1.run('version', '1.0.0');
insertMeta1.run('type', 'audio');
insertMeta1.run('schemaVersion', '1');
insertMeta1.run('minAppVersion', '1.0.0');
insertMeta1.run('name', 'BSB Audio Part 1');
insertMeta1.run('description', 'Genesis through Psalms audio (BSB narration)');
insertMeta1.run('createdAt', new Date().toISOString());

const insertAudio1 = output1.prepare(`
  INSERT INTO audio_chapters (book, chapter, audio_data, format, file_size)
  VALUES (?, ?, ?, ?, ?)
`);

let pt1Size = 0;
let pt1Count = 0;
const copyAudio1 = output1.transaction((audioList) => {
  for (const audio of audioList) {
    // Convert file_path to platform-specific path
    const relativePath = audio.file_path.split('/').join('\\');
    const filePath = join(repoRoot, 'packs', 'bsb-audio', relativePath);
    if (existsSync(filePath)) {
      const audioData = readFileSync(filePath);
      insertAudio1.run(audio.book, audio.chapter, audioData, audio.format, audioData.length);
      pt1Size += audioData.length;
      pt1Count++;
    } else {
      console.log(`   ⚠️  Missing: ${audio.file_path}`);
    }
  }
});

copyAudio1(part1Audio);

console.log(`   ✅ Part 1 complete: ${pt1Count}/${part1Audio.length} files, ${(pt1Size / (1024 * 1024 * 1024)).toFixed(2)} GB`);

output1.exec('VACUUM');
output1.exec('ANALYZE');
output1.close();

// Build Part 2
console.log('\n📦 Building Part 2 (Proverbs-Revelation)...');
const output2 = new Database(join(OUTPUT_DIR, 'bsb-audio-pt2.sqlite'));

output2.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  CREATE TABLE audio_chapters (
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    audio_data BLOB NOT NULL,
    format TEXT DEFAULT 'mp3',
    duration_ms INTEGER,
    file_size INTEGER,
    PRIMARY KEY (book, chapter)
  );
  
  CREATE INDEX idx_audio_book ON audio_chapters(book);
`);

const insertMeta2 = output2.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta2.run('id', 'bsb-audio-pt2');
insertMeta2.run('version', '1.0.0');
insertMeta2.run('type', 'audio');
insertMeta2.run('schemaVersion', '1');
insertMeta2.run('minAppVersion', '1.0.0');
insertMeta2.run('name', 'BSB Audio Part 2');
insertMeta2.run('description', 'Proverbs through Revelation audio (BSB narration)');
insertMeta2.run('createdAt', new Date().toISOString());

const insertAudio2 = output2.prepare(`
  INSERT INTO audio_chapters (book, chapter, audio_data, format, file_size)
  VALUES (?, ?, ?, ?, ?)
`);

let pt2Size = 0;
let pt2Count = 0;
const copyAudio2 = output2.transaction((audioList) => {
  for (const audio of audioList) {
    // Convert file_path to platform-specific path
    const relativePath = audio.file_path.split('/').join('\\');
    const filePath = join(repoRoot, 'packs', 'bsb-audio', relativePath);
    if (existsSync(filePath)) {
      const audioData = readFileSync(filePath);
      insertAudio2.run(audio.book, audio.chapter, audioData, audio.format, audioData.length);
      pt2Size += audioData.length;
      pt2Count++;
    } else {
      console.log(`   ⚠️  Missing: ${audio.file_path}`);
    }
  }
});

copyAudio2(part2Audio);

console.log(`   ✅ Part 2 complete: ${pt2Count}/${part2Audio.length} files, ${(pt2Size / (1024 * 1024 * 1024)).toFixed(2)} GB`);

output2.exec('VACUUM');
output2.exec('ANALYZE');
output2.close();

// Final stats
const stats1 = statSync(join(OUTPUT_DIR, 'bsb-audio-pt1.sqlite'));
const stats2 = statSync(join(OUTPUT_DIR, 'bsb-audio-pt2.sqlite'));

console.log('\n✅ BSB Audio packs complete!');
console.log(`\n📊 Part 1: ${(stats1.size / (1024 * 1024 * 1024)).toFixed(2)} GB (${part1Audio.length} chapters)`);
console.log(`📊 Part 2: ${(stats2.size / (1024 * 1024 * 1024)).toFixed(2)} GB (${part2Audio.length} chapters)`);
console.log(`📊 Total: ${((stats1.size + stats2.size) / (1024 * 1024 * 1024)).toFixed(2)} GB`);
