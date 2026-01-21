#!/usr/bin/env node
/**
 * Verify Pack Integrity
 * 
 * Computes row counts for all tables in each consolidated pack.
 * This serves as:
 * - Pre-release sanity check
 * - Future regression test baseline
 * - Schema drift detection
 */

import Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs/consolidated');

const PACKS = [
  'translations.sqlite',
  'ancient-languages.sqlite',
  'lexical.sqlite',
  'study-tools.sqlite',
  'bsb-audio-pt1.sqlite',
  'bsb-audio-pt2.sqlite'
];

console.log('📊 Verifying Pack Integrity...\n');

const results = {};

for (const packFile of PACKS) {
  const packPath = join(PACKS_DIR, packFile);
  
  if (!existsSync(packPath)) {
    console.warn(`⚠️  Pack not found: ${packFile}`);
    continue;
  }
  
  const stats = statSync(packPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`\n📦 ${packFile} (${sizeMB} MB)`);
  
  const db = new Database(packPath, { readonly: true });
  
  // Get all tables
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  
  const packResults = {
    size_mb: parseFloat(sizeMB),
    tables: {}
  };
  
  for (const { name } of tables) {
    try {
      const result = db.prepare(`SELECT COUNT(*) as count FROM ${name}`).get();
      const count = result.count;
      
      packResults.tables[name] = count;
      
      if (count > 0) {
        console.log(`   ${name.padEnd(30)} ${count.toLocaleString().padStart(12)} rows`);
      }
    } catch (error) {
      console.error(`   ❌ Error counting ${name}:`, error.message);
    }
  }
  
  // Get total database size in pages
  const pageInfo = db.pragma('page_count');
  const pageSize = db.pragma('page_size');
  console.log(`   ${'Database pages'.padEnd(30)} ${pageInfo[0].page_count.toLocaleString().padStart(12)}`);
  
  db.close();
  
  results[packFile] = packResults;
}

// Print summary
console.log('\n' + '='.repeat(60));
console.log('📋 SUMMARY');
console.log('='.repeat(60));

for (const [packFile, data] of Object.entries(results)) {
  console.log(`\n${packFile}:`);
  console.log(`  Size: ${data.size_mb} MB`);
  
  const totalRows = Object.values(data.tables).reduce((sum, count) => sum + count, 0);
  console.log(`  Total rows: ${totalRows.toLocaleString()}`);
  
  const tableCount = Object.keys(data.tables).length;
  console.log(`  Tables: ${tableCount}`);
}

const totalSize = Object.values(results).reduce((sum, pack) => sum + pack.size_mb, 0);
console.log(`\n📊 Total: ${totalSize.toFixed(2)} MB across ${Object.keys(results).length} packs`);

console.log('\n✅ Integrity verification complete!');
