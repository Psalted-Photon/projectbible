#!/usr/bin/env node
/**
 * Build Consolidated Study Tools Pack
 * 
 * Merges maps, places, cross-references, chronological data.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs');
const OUTPUT_DIR = join(repoRoot, 'packs/consolidated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'study-tools.sqlite');

console.log('📦 Building Study Tools Pack...\n');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

const output = new Database(OUTPUT_FILE);

// Create metadata table
output.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Insert metadata
const insertMeta = output.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta.run('id', 'study-tools');
insertMeta.run('version', '1.0.0');
insertMeta.run('type', 'study');
insertMeta.run('schemaVersion', '1');
insertMeta.run('minAppVersion', '1.0.0');
insertMeta.run('name', 'Study Tools Pack');
insertMeta.run('description', 'Maps, places, chronological ordering, cross-references');
insertMeta.run('createdAt', new Date().toISOString());

// Helper to copy all tables
function copyAllTables(sourcePath, packName) {
  if (!existsSync(join(repoRoot, sourcePath))) {
    console.log(`      ⚠️  ${packName} not found, skipping`);
    return;
  }
  
  const absPath = join(repoRoot, sourcePath).replace(/\\/g, '/');
  output.exec(`ATTACH DATABASE '${absPath}' AS source`);
  
  const tables = output.prepare(`
    SELECT name FROM source.sqlite_master 
    WHERE type='table' AND name != 'metadata' AND name NOT LIKE 'sqlite_%'
  `).all();
  
  for (const table of tables) {
    console.log(`      Copying ${table.name}`);
    
    const createStmt = output.prepare(`
      SELECT sql FROM source.sqlite_master 
      WHERE type='table' AND name=?
    `).get(table.name);
    
    try {
      output.exec(createStmt.sql);
      output.exec(`INSERT INTO ${table.name} SELECT * FROM source.${table.name}`);
    } catch (e) {
      console.log(`         Already exists, appending data`);
      output.exec(`INSERT OR IGNORE INTO ${table.name} SELECT * FROM source.${table.name}`);
    }
    
    // Copy indexes
    const indexes = output.prepare(`
      SELECT sql FROM source.sqlite_master 
      WHERE type='index' AND tbl_name=? AND sql IS NOT NULL
    `).all(table.name);
    
    for (const idx of indexes) {
      try {
        output.exec(idx.sql);
      } catch (e) {
        // Index might already exist
      }
    }
  }
  
  output.exec('DETACH DATABASE source');
}

// 1. Maps
console.log('\n   Merging maps...');
copyAllTables('packs/maps.sqlite', 'Maps');
console.log(`      ✅ Complete`);

// 2. Cross-references
console.log('\n   Merging cross-references...');
copyAllTables('packs/cross-references.sqlite', 'Cross-references');
console.log(`      ✅ Complete`);

// 3. Chronological
console.log('\n   Merging chronological data...');
copyAllTables('packs/chronological.sqlite', 'Chronological');
console.log(`      ✅ Complete`);

// Optimize
console.log('\nOptimizing database...');
output.exec('VACUUM');
output.exec('ANALYZE');

output.close();

const stats = statSync(OUTPUT_FILE);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('\n✅ Study Tools pack complete!');
console.log(`📍 Output: ${OUTPUT_FILE}`);
console.log(`📊 Size: ${sizeMB} MB`);
