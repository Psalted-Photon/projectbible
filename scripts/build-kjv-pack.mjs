#!/usr/bin/env node

/**
 * Build KJV Pack (King James Version)
 * 
 * Creates a standalone pack for the King James Version.
 * Note: If kjv-full.sqlite already exists with correct structure, just rename it.
 * 
 * Usage: node scripts/build-kjv-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, copyFileSync } from 'fs';

const SOURCE_PATH = 'packs/kjv-full.sqlite';
const OUTPUT_PATH = 'packs/kjv.sqlite';

function buildKJVPack() {
  console.log('👑 Building KJV Pack\n');
  
  if (!existsSync(SOURCE_PATH)) {
    console.error(`❌ Source pack not found: ${SOURCE_PATH}`);
    console.log('\nPlease ensure kjv-full.sqlite exists.');
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
      update.run('kjv', 'pack_id');
      update.run('KJV', 'translation_id');
      update.run('King James Version', 'translation_name');
      
      const stats = db.prepare('SELECT COUNT(*) as count FROM verses').get();
      const size = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
      
      console.log('\n✨ KJV Pack Complete!\n');
      console.log('📊 Summary:');
      console.log(`   Total verses: ${stats.count.toLocaleString()}`);
      console.log(`   File size: ${(size.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Output: ${OUTPUT_PATH}\n`);
      
    } finally {
      db.close();
    }
    
  } catch (error) {
    console.error('\n❌ Error building KJV pack:', error);
    throw error;
  }
}

buildKJVPack();
