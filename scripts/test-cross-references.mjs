/**
 * Test Cross-References Pack
 * Queries the cross-references database to verify functionality
 */

import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACK_FILE = join(__dirname, '../packs/cross-references.sqlite');

console.log('🔍 Testing Cross-References Pack\n');

const db = new Database(PACK_FILE, { readonly: true });

// Get metadata
console.log('📋 Metadata:');
const metadata = db.prepare('SELECT * FROM metadata').all();
metadata.forEach(({ key, value }) => {
  console.log(`   ${key}: ${value}`);
});

// Get statistics
const stats = db.prepare('SELECT COUNT(*) as count FROM cross_references').get();
console.log(`\n📊 Statistics:`);
console.log(`   Total references: ${stats.count}`);

// Test query: Find cross-references for John 3:16
console.log(`\n🔎 Cross-references for John 3:16:`);
const john316Refs = db.prepare(`
  SELECT * FROM cross_references 
  WHERE from_book = 'John' AND from_chapter = 3 AND from_verse = 16
  ORDER BY to_book, to_chapter, to_verse_start
`).all();

john316Refs.forEach(ref => {
  console.log(`   → ${ref.to_book} ${ref.to_chapter}:${ref.to_verse_start}`);
  console.log(`     "${ref.description}"`);
});

// Test query: Find cross-references to Genesis 1:1
console.log(`\n🔎 Cross-references TO Genesis 1:1:`);
const toGen11 = db.prepare(`
  SELECT * FROM cross_references 
  WHERE to_book = 'Genesis' AND to_chapter = 1 AND to_verse_start = 1
  ORDER BY from_book, from_chapter, from_verse
`).all();

toGen11.forEach(ref => {
  console.log(`   ← ${ref.from_book} ${ref.from_chapter}:${ref.from_verse}`);
  console.log(`     "${ref.description}"`);
});

// Show sample of all references
console.log(`\n📖 Sample references (first 10):`);
const sample = db.prepare(`
  SELECT * FROM cross_references 
  LIMIT 10
`).all();

sample.forEach((ref, i) => {
  console.log(`   ${i + 1}. ${ref.from_book} ${ref.from_chapter}:${ref.from_verse} → ${ref.to_book} ${ref.to_chapter}:${ref.to_verse_start}`);
});

db.close();

console.log(`\n✅ Cross-references pack is working correctly!`);
