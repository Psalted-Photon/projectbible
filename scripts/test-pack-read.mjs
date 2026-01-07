#!/usr/bin/env node
/**
 * Test script to verify pack data is readable and correct
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function testPack(packPath) {
  console.log(`\n📖 Testing pack: ${packPath}\n`);
  
  const db = new Database(packPath, { readonly: true });
  
  try {
    // Test 1: Read metadata
    console.log('✓ Test 1: Reading metadata...');
    const metadata = {};
    const metaRows = db.prepare('SELECT key, value FROM metadata').all();
    metaRows.forEach(row => {
      metadata[row.key] = row.value;
    });
    console.log(`  Pack ID: ${metadata.pack_id}`);
    console.log(`  Translation: ${metadata.translation_id} - ${metadata.translation_name}`);
    console.log(`  Version: ${metadata.version}`);
    
    // Test 2: Count verses
    console.log('\n✓ Test 2: Counting verses...');
    const count = db.prepare('SELECT COUNT(*) as count FROM verses').get();
    console.log(`  Total verses: ${count.count}`);
    
    if (count.count === 0) {
      throw new Error('No verses found in pack!');
    }
    
    // Test 3: Read specific verses
    console.log('\n✓ Test 3: Reading specific verses...');
    const testVerses = [
      { book: 'Genesis', chapter: 1, verse: 1, expected: /beginning/i },
      { book: 'John', chapter: 3, verse: 16, expected: /God.*loved.*world/i },
      { book: 'Psalm', chapter: 23, verse: 1, expected: /(Lord|Yahweh).*shepherd/i }
    ];
    
    for (const test of testVerses) {
      const verse = db.prepare(
        'SELECT book, chapter, verse, text FROM verses WHERE book = ? AND chapter = ? AND verse = ?'
      ).get(test.book, test.chapter, test.verse);
      
      if (!verse) {
        console.log(`  ⚠ ${getBookName(test.book)} ${test.chapter}:${test.verse} not found (might not be in sample)`);
        continue;
      }
      
      if (!test.expected.test(verse.text)) {
        throw new Error(`Unexpected text for ${getBookName(test.book)} ${test.chapter}:${test.verse}: ${verse.text}`);
      }
      
      console.log(`  ✓ ${getBookName(test.book)} ${test.chapter}:${test.verse}: ${verse.text.substring(0, 50)}...`);
    }
    
    // Test 4: Read a chapter
    console.log('\n✓ Test 4: Reading full chapter (Genesis 1)...');
    const chapter = db.prepare(
      "SELECT verse, text FROM verses WHERE book = 'Genesis' AND chapter = 1 ORDER BY verse"
    ).all();
    
    if (chapter.length === 0) {
      throw new Error('Genesis 1 not found in pack!');
    }
    
    console.log(`  Found ${chapter.length} verses in Genesis 1`);
    console.log(`  First verse: ${chapter[0].text.substring(0, 60)}...`);
    console.log(`  Last verse: ${chapter[chapter.length - 1].text.substring(0, 60)}...`);
    
    // Test 5: Verify indexes exist
    console.log('\n✓ Test 5: Verifying indexes...');
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'"
    ).all();
    
    const expectedIndexes = ['idx_verses_book', 'idx_verses_book_chapter'];
    for (const expected of expectedIndexes) {
      if (!indexes.some(idx => idx.name === expected)) {
        throw new Error(`Missing index: ${expected}`);
      }
      console.log(`  ✓ ${expected}`);
    }
    
    console.log('\n✅ All tests passed!\n');
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}\n`);
    process.exit(1);
  } finally {
    db.close();
  }
}

function getBookName(bookNum) {
  // For now, book is stored as string, so just return it
  return bookNum;
}

// Test both packs
const repoRoot = resolve(__dirname, '..');
const kjvPack = resolve(repoRoot, 'packs/kjv.sqlite');
const webPack = resolve(repoRoot, 'packs/web.sqlite');

console.log('🧪 Testing Sample Packs\n');
console.log('='.repeat(50));

testPack(kjvPack);
testPack(webPack);

console.log('='.repeat(50));
console.log('\n✅ All packs tested successfully!\n');
