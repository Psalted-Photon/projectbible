#!/usr/bin/env node

/**
 * Quick fix to add missing packId metadata to maps-enhanced.sqlite
 */

import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const PACK_FILE = path.join(projectRoot, 'packs/maps-enhanced.sqlite');

console.log('🔧 Fixing maps-enhanced.sqlite metadata...\n');

const db = new Database(PACK_FILE);

// Check if packId already exists
const existing = db.prepare('SELECT value FROM metadata WHERE key = ?').get('packId');

if (existing) {
  console.log('✓ packId already exists:', existing.value);
} else {
  console.log('Adding missing metadata fields...');
  
  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  
  insertMeta.run('packId', 'maps-enhanced-v1');
  insertMeta.run('type', 'map');
  insertMeta.run('license', 'CC BY-SA 4.0');
  insertMeta.run('attribution', 'Pleiades, AWMC Geodata');
  
  console.log('✓ Added packId: maps-enhanced-v1');
  console.log('✓ Added type: map');
  console.log('✓ Added license: CC BY-SA 4.0');
  console.log('✓ Added attribution: Pleiades, AWMC Geodata');
}

// Show all metadata
console.log('\nCurrent metadata:');
const allMeta = db.prepare('SELECT key, value FROM metadata').all();
allMeta.forEach(row => {
  console.log(`  ${row.key}: ${row.value}`);
});

db.close();

console.log('\n✅ Done!');
