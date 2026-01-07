#!/usr/bin/env node
/**
 * Convert scrollmapper JSON format to ProjectBible pack manifest and build packs
 * 
 * Input: scrollmapper JSON format:
 *   { "translation": "...", "books": [ { "name": "...", "chapters": [ { "chapter": N, "verses": [ { "verse": N, "text": "..." } ] } ] } ] }
 * 
 * Output: ProjectBible manifest + SQLite pack
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function convertToManifest(inputPath, packId, translationId, translationName, license, attribution) {
  console.log(`Converting ${inputPath} to manifest...`);
  
  const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
  
  const sourceData = [];
  
  for (const book of data.books) {
    for (const chapter of book.chapters) {
      for (const verseObj of chapter.verses) {
        sourceData.push({
          book: book.name,
          chapter: chapter.chapter,
          verse: verseObj.verse,
          text: verseObj.text
        });
      }
    }
  }
  
  const manifest = {
    id: packId,
    version: "1.0.0",
    type: "text",
    translationId: translationId,
    translationName: translationName,
    license: license,
    attribution: attribution,
    sourceData: sourceData
  };
  
  console.log(`  Total verses: ${sourceData.length}`);
  console.log(`  Total books: ${data.books.length}`);
  
  return manifest;
}

function buildPackDirectly(manifest, outputPath) {
  console.log(`Building pack: ${outputPath}`);
  
  const db = new Database(outputPath);
  
  try {
    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS verses (
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (book, chapter, verse)
      );
      
      CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
      CREATE INDEX IF NOT EXISTS idx_verses_book_chapter ON verses(book, chapter);
    `);
    
    // Insert metadata
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    insertMeta.run('pack_id', manifest.id);
    insertMeta.run('version', manifest.version);
    insertMeta.run('type', manifest.type);
    insertMeta.run('translation_id', manifest.translationId);
    insertMeta.run('translation_name', manifest.translationName);
    insertMeta.run('license', manifest.license);
    if (manifest.attribution) {
      insertMeta.run('attribution', manifest.attribution);
    }
    
    // Insert verses in batches
    console.log(`  Inserting ${manifest.sourceData.length} verses...`);
    
    const insertVerse = db.prepare('INSERT OR REPLACE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
    
    const insertMany = db.transaction((verses) => {
      for (const v of verses) {
        insertVerse.run(v.book, v.chapter, v.verse, v.text);
      }
    });
    
    const BATCH_SIZE = 1000;
    for (let i = 0; i < manifest.sourceData.length; i += BATCH_SIZE) {
      const batch = manifest.sourceData.slice(i, i + BATCH_SIZE);
      insertMany(batch);
      if ((i + BATCH_SIZE) % 5000 === 0) {
        console.log(`    Inserted ${i + BATCH_SIZE} verses...`);
      }
    }
    
    console.log(`  ✅ Inserted ${manifest.sourceData.length} verses`);
    
    // Optimize
    db.exec('PRAGMA optimize;');
    
  } finally {
    db.close();
  }
  
  console.log(`✅ Pack built successfully: ${outputPath}`);
}

// Main execution
const repoRoot = resolve(__dirname, '..');

console.log('📦 Building Full Bible Packs\n');
console.log('='.repeat(50));

// Build KJV
const kjvManifest = convertToManifest(
  resolve(repoRoot, 'data-sources/KJVPCE.json'),
  'kjv-full',
  'KJV',
  'King James Version (Pure Cambridge Edition)',
  'Public Domain',
  'King James Version: Pure Cambridge Edition. Public Domain.'
);

buildPackDirectly(kjvManifest, resolve(repoRoot, 'packs/kjv-full.sqlite'));

console.log('');

// Build WEB
const webManifest = convertToManifest(
  resolve(repoRoot, 'data-sources/WEB.json'),
  'web-full',
  'WEB',
  'World English Bible',
  'Public Domain',
  'World English Bible. Public Domain. See https://WorldEnglish.Bible'
);

buildPackDirectly(webManifest, resolve(repoRoot, 'packs/web-full.sqlite'));

console.log('');
console.log('='.repeat(50));
console.log('✅ All packs built successfully!');
