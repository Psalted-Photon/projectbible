#!/usr/bin/env node
/**
 * Build Consolidated Lexical Pack (Simplified)
 * 
 * Uses ATTACH DATABASE to copy tables directly without schema mapping.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs');
const POLISHED_DIR = join(PACKS_DIR, 'polished');
const OUTPUT_DIR = join(repoRoot, 'packs/consolidated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'lexical.sqlite');

console.log('📦 Building Lexical Pack...\n');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

const output = new Database(OUTPUT_FILE);

// Just create metadata table
output.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Insert metadata
const insertMeta = output.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta.run('id', 'lexical');
insertMeta.run('version', '1.0.0');
insertMeta.run('type', 'lexicon');
insertMeta.run('schemaVersion', '1');
insertMeta.run('minAppVersion', '1.0.0');
insertMeta.run('name', 'Lexical Resources Pack');
insertMeta.run('description', "Strong's Greek/Hebrew + English wordlist/thesaurus/grammar");
insertMeta.run('createdAt', new Date().toISOString());

// Helper to copy all tables from source
function copyAllTables(sourcePath, prefix = '') {
  const absPath = join(repoRoot, sourcePath).replace(/\\/g, '/');
  output.exec(`ATTACH DATABASE '${absPath}' AS source`);
  
  // Get all table names except metadata
  const tables = output.prepare(`
    SELECT name FROM source.sqlite_master 
    WHERE type='table' AND name != 'metadata' AND name NOT LIKE 'sqlite_%'
  `).all();
  
  for (const table of tables) {
    const tableName = prefix ? `${prefix}_${table.name}` : table.name;
    console.log(`      Copying ${table.name} → ${tableName}`);
    
    // Get CREATE TABLE statement
    const createStmt = output.prepare(`
      SELECT sql FROM source.sqlite_master 
      WHERE type='table' AND name=?
    `).get(table.name);
    
    // Replace table name if prefix
    let sql = createStmt.sql;
    if (prefix) {
      sql = sql.replace(`CREATE TABLE ${table.name}`, `CREATE TABLE ${tableName}`);
    }
    
    output.exec(sql);
    
    // Copy data
    output.exec(`INSERT INTO ${tableName} SELECT * FROM source.${table.name}`);
    
    // Copy indexes
    const indexes = output.prepare(`
      SELECT sql FROM source.sqlite_master 
      WHERE type='index' AND tbl_name=? AND sql IS NOT NULL
    `).all(table.name);
    
    for (const idx of indexes) {
      try {
        let idxSql = idx.sql;
        if (prefix) {
          idxSql = idxSql.replace(` ON ${table.name}`, ` ON ${tableName}`);
        }
        output.exec(idxSql);
      } catch (e) {
        // Index might already exist, ignore
      }
    }
  }
  
  output.exec('DETACH DATABASE source');
}

// 1. Strong's Greek
console.log('\n   Merging Strong\'s Greek...');
copyAllTables('packs/strongs-greek.sqlite', 'greek');
console.log(`      ✅ Complete`);

// 2. Strong's Hebrew
console.log('\n   Merging Strong\'s Hebrew...');
copyAllTables('packs/strongs-hebrew.sqlite', 'hebrew');
console.log(`      ✅ Complete`);

// 3. English Wordlist
console.log('\n   Merging English wordlist...');
copyAllTables('packs/polished/english-wordlist-v1.sqlite', 'english');
console.log(`      ✅ Complete`);

// 4. English Thesaurus  
console.log('\n   Merging English thesaurus...');
copyAllTables('packs/polished/english-thesaurus-v1.sqlite', 'thesaurus');
console.log(`      ✅ Complete`);

// 5. English Grammar
console.log('\n   Merging English grammar...');
copyAllTables('packs/polished/english-grammar-v1.sqlite', 'grammar');
console.log(`      ✅ Complete`);

// Optimize
console.log('\nOptimizing database...');
output.exec('VACUUM');
output.exec('ANALYZE');

output.close();

const stats = statSync(OUTPUT_FILE);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('\n✅ Lexical pack complete!');
console.log(`📍 Output: ${OUTPUT_FILE}`);
console.log(`📊 Size: ${sizeMB} MB`);
