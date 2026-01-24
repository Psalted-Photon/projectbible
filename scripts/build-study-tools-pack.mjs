#!/usr/bin/env node
/**
 * Build Consolidated Study Tools Pack
 * 
 * Merges maps, places, cross-references, chronological data.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
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

// Rebuild cleanly if file already exists
if (existsSync(OUTPUT_FILE)) {
  try {
    unlinkSync(OUTPUT_FILE);
  } catch (err) {
    console.warn('⚠️  Could not delete existing study-tools.sqlite, will try to overwrite:', err);
  }
}

const output = new Database(OUTPUT_FILE);
output.exec('PRAGMA foreign_keys = OFF;');

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
insertMeta.run('description', 'Maps, places, OpenBible, Pleiades, chronological ordering, cross-references');
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
    } catch (e) {
      console.log(`         Already exists, appending data`);
    }

    // Insert only shared columns to avoid schema mismatches
    const targetCols = output.prepare(`PRAGMA table_info(${table.name})`).all().map(c => c.name);
    const sourceCols = output.prepare(`PRAGMA source.table_info(${table.name})`).all().map(c => c.name);
    const sharedCols = targetCols.filter(c => sourceCols.includes(c));

    if (sharedCols.length === 0) {
      console.log(`         ⚠️  No shared columns, skipping ${table.name}`);
    } else {
      const columnList = sharedCols.map(c => `"${c}"`).join(', ');
      output.exec(
        `INSERT OR IGNORE INTO ${table.name} (${columnList}) SELECT ${columnList} FROM source.${table.name}`
      );
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

function mergeOpenBible(sourcePath) {
  if (!existsSync(join(repoRoot, sourcePath))) {
    console.log('      ⚠️  OpenBible not found, skipping');
    return;
  }

  const absPath = join(repoRoot, sourcePath).replace(/\\/g, '/');
  output.exec(`ATTACH DATABASE '${absPath}' AS source`);

  output.exec(`
    CREATE TABLE IF NOT EXISTS openbible_places (
      id TEXT PRIMARY KEY,
      friendly_id TEXT,
      type TEXT,
      class TEXT,
      verse_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS openbible_locations (
      id TEXT PRIMARY KEY,
      friendly_id TEXT,
      longitude REAL,
      latitude REAL,
      geometry_type TEXT,
      class TEXT,
      type TEXT,
      precision_meters INTEGER,
      thumbnail_file TEXT,
      thumbnail_credit TEXT,
      thumbnail_url TEXT
    );

    CREATE TABLE IF NOT EXISTS openbible_identifications (
      ancient_place_id TEXT,
      modern_location_id TEXT,
      time_total INTEGER,
      vote_total INTEGER,
      class TEXT,
      modifier TEXT
    );
  `);

  try {
    output.exec(`
      INSERT OR IGNORE INTO openbible_places (id, friendly_id, type, class, verse_count)
      SELECT id, friendly_id, type, class, verse_count FROM source.ancient_places
    `);
  } catch (e) {
    console.log('      ⚠️  openbible_places import skipped');
  }

  try {
    output.exec(`
      INSERT OR IGNORE INTO openbible_locations (
        id, friendly_id, longitude, latitude, geometry_type, class, type,
        precision_meters, thumbnail_file, thumbnail_credit, thumbnail_url
      )
      SELECT id, friendly_id, longitude, latitude, geometry_type, class, type,
             precision_meters, thumbnail_file, thumbnail_credit, thumbnail_url
      FROM source.modern_locations
    `);
  } catch (e) {
    console.log('      ⚠️  openbible_locations import skipped');
  }

  try {
    output.exec(`
      INSERT OR IGNORE INTO openbible_identifications (
        ancient_place_id, modern_location_id, time_total, vote_total, class, modifier
      )
      SELECT ancient_place_id, modern_location_id, time_total, vote_total, class, modifier
      FROM source.place_identifications
    `);
  } catch (e) {
    console.log('      ⚠️  openbible_identifications import skipped');
  }

  output.exec('DETACH DATABASE source');
}

function mergePleiades(sourcePath) {
  if (!existsSync(join(repoRoot, sourcePath))) {
    console.log('      ⚠️  Pleiades not found, skipping');
    return;
  }

  const absPath = join(repoRoot, sourcePath).replace(/\\/g, '/');
  output.exec(`ATTACH DATABASE '${absPath}' AS source`);

  output.exec(`
    CREATE TABLE IF NOT EXISTS pleiades_places (
      id TEXT PRIMARY KEY,
      title TEXT,
      uri TEXT,
      place_type TEXT,
      description TEXT,
      year_start INTEGER,
      year_end INTEGER,
      created TEXT,
      modified TEXT,
      bbox TEXT,
      latitude REAL,
      longitude REAL
    );

    CREATE TABLE IF NOT EXISTS pleiades_names (
      place_id TEXT,
      name TEXT,
      language TEXT,
      romanized TEXT,
      name_type TEXT,
      time_period TEXT,
      certainty TEXT
    );

    CREATE TABLE IF NOT EXISTS pleiades_locations (
      place_id TEXT,
      title TEXT,
      geometry_type TEXT,
      coordinates TEXT,
      latitude REAL,
      longitude REAL,
      certainty TEXT,
      time_period TEXT
    );
  `);

  try {
    output.exec(`
      INSERT OR IGNORE INTO pleiades_places (
        id, title, uri, place_type, description, year_start, year_end, created, modified, bbox, latitude, longitude
      )
      SELECT p.id, p.title, p.uri, p.place_type, p.description, p.year_start, p.year_end, p.created, p.modified, p.bbox,
             l.latitude, l.longitude
      FROM source.places p
      LEFT JOIN (
        SELECT place_id, latitude, longitude
        FROM source.place_locations
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        GROUP BY place_id
      ) l ON l.place_id = p.id
    `);
  } catch (e) {
    console.log('      ⚠️  pleiades_places import skipped');
  }

  try {
    output.exec(`
      INSERT OR IGNORE INTO pleiades_names (
        place_id, name, language, romanized, name_type, time_period, certainty
      )
      SELECT place_id, name, language, romanized, name_type, time_period, certainty
      FROM source.place_names
    `);
  } catch (e) {
    console.log('      ⚠️  pleiades_names import skipped');
  }

  try {
    output.exec(`
      INSERT OR IGNORE INTO pleiades_locations (
        place_id, title, geometry_type, coordinates, latitude, longitude, certainty, time_period
      )
      SELECT place_id, title, geometry_type, coordinates, latitude, longitude, certainty, time_period
      FROM source.place_locations
    `);
  } catch (e) {
    console.log('      ⚠️  pleiades_locations import skipped');
  }

  output.exec('DETACH DATABASE source');
}

// 1. Maps
console.log('\n   Merging maps...');
copyAllTables('packs/maps.sqlite', 'Maps');
copyAllTables('packs/maps-enhanced.sqlite', 'Enhanced Maps');
copyAllTables('packs/maps-biblical.sqlite', 'Biblical Maps');
console.log(`      ✅ Complete`);

// 2. Places
console.log('\n   Merging places...');
copyAllTables('packs/places.sqlite', 'Places');
copyAllTables('packs/places-biblical.sqlite', 'Biblical Places');
console.log(`      ✅ Complete`);

// 3. OpenBible
console.log('\n   Merging OpenBible...');
mergeOpenBible('packs/openbible.sqlite');
console.log(`      ✅ Complete`);

// 4. Pleiades
console.log('\n   Merging Pleiades...');
mergePleiades('packs/pleiades.sqlite');
console.log(`      ✅ Complete`);

// 5. Cross-references
console.log('\n   Merging cross-references...');
copyAllTables('packs/cross-references.sqlite', 'Cross-references');
console.log(`      ✅ Complete`);

// 6. Chronological
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
