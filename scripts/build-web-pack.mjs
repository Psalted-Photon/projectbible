#!/usr/bin/env node

/**
 * Build WEB Pack (World English Bible)
 * 
 * Creates a standalone pack for the World English Bible.
 * Note: If web-full.sqlite already exists with correct structure, just rename it.
 * 
 * Usage: node scripts/build-web-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, copyFileSync } from 'fs';

const SOURCE_PATH = 'packs/web-full.sqlite';
const OUTPUT_PATH = 'packs/web.sqlite';

function buildWebPack() {
  console.log('📖 Building WEB Pack\n');
  
  if (!existsSync(SOURCE_PATH)) {
    console.error(`❌ Source pack not found: ${SOURCE_PATH}`);
    console.log('\nPlease ensure web-full.sqlite exists.');
    console.log('It should have been built by previous scripts.\n');
    process.exit(1);
  }
  
  // Check if source has correct structure
  const sourceDb = new Database(SOURCE_PATH, { readonly: true });
  
  try {
    // Verify it has verses
    const count = sourceDb.prepare('SELECT COUNT(*) as count FROM verses').get();
    console.log(`Found ${count.count.toLocaleString()} verses in source pack`);
    
    if (count.count === 0) {
      console.error('❌ Source pack has no verses!');
      process.exit(1);
    }
    
    sourceDb.close();
    
    // Copy to new location
    console.log(`\nCopying ${SOURCE_PATH} → ${OUTPUT_PATH}...`);
    copyFileSync(SOURCE_PATH, OUTPUT_PATH);
    
    // Update metadata
    const db = new Database(OUTPUT_PATH);
    
    try {
      const update = db.prepare('UPDATE metadata SET value = ? WHERE key = ?');
      update.run('web', 'pack_id');
      update.run('WEB', 'translation_id');
      update.run('World English Bible', 'translation_name');
      
      const stats = db.prepare('SELECT COUNT(*) as count FROM verses').get();
      const size = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
      
      console.log('\n✨ WEB Pack Complete!\n');
      console.log('📊 Summary:');
      console.log(`   Total verses: ${stats.count.toLocaleString()}`);
      console.log(`   File size: ${(size.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Output: ${OUTPUT_PATH}\n`);
      
    } finally {
      db.close();
    }
    
  } catch (error) {
    console.error('\n❌ Error building WEB pack:', error);
    throw error;
  }
}

buildWebPack();
