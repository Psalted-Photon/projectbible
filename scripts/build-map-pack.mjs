#!/usr/bin/env node

/**
 * Build Biblical Map Pack
 * 
 * Creates an SQLite pack with:
 * - Historical map layers (boundaries, empires, journeys)
 * - Optional: Base map tiles for offline viewing
 * - Geographic data for biblical places
 * 
 * Usage:
 *   node scripts/build-map-pack.mjs [--with-tiles]
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Import the real GeoJSON boundaries
import boundaries from '../data-sources/maps/boundaries.js';

const PACK_OUTPUT = join(repoRoot, 'packs/maps.sqlite');

// Map layer IDs to their data in boundaries.js
const LAYER_MAP = {
  'ancient-near-east-2000bc': 'ancient-near-east',
  'twelve-tribes-1000bc': 'twelve-tribes',
  'united-kingdom-1000bc': 'united-kingdom',
  'divided-kingdom-800bc': 'divided-kingdom',
  'assyrian-empire-700bc': 'assyrian-empire',
  'babylonian-empire-600bc': 'babylonian-empire',
  'persian-empire-500bc': 'persian-empire',
  'roman-empire-30ad': 'roman-empire-30ad',
  'exodus-route': 'exodus-route',
  'pauls-first-journey': 'pauls-journeys',
  'pauls-second-journey': 'pauls-journeys',
  'pauls-third-journey': 'pauls-journeys'
};

// Historical layers to include
const HISTORICAL_LAYERS = [
  {
    id: 'ancient-near-east-2000bc',
    name: 'Ancient Near East',
    displayName: 'Ancient Near East (2000 BC)',
    period: 'patriarchs',
    yearStart: -2500,
    yearEnd: -1500,
    type: 'region',
    description: 'Major civilizations during the time of Abraham, Isaac, and Jacob',
    dataFile: 'layers/ancient-near-east.geojson'
  },
  {
    id: 'twelve-tribes-1000bc',
    name: 'Twelve Tribes of Israel',
    displayName: 'Tribal Territories (1000 BC)',
    period: 'united-kingdom',
    yearStart: -1200,
    yearEnd: -930,
    type: 'tribal',
    description: 'Tribal allotments after the conquest of Canaan',
    dataFile: 'layers/twelve-tribes.geojson'
  },
  {
    id: 'united-kingdom-1000bc',
    name: 'United Kingdom',
    displayName: 'United Kingdom (1000 BC)',
    period: 'united-kingdom',
    yearStart: -1050,
    yearEnd: -931,
    type: 'political',
    description: 'United Israel under Saul, David, and Solomon',
    dataFile: 'layers/united-kingdom.geojson'
  },
  {
    id: 'divided-kingdom-800bc',
    name: 'Israel and Judah',
    displayName: 'Divided Kingdom (800 BC)',
    period: 'divided-kingdom',
    yearStart: -931,
    yearEnd: -722,
    type: 'political',
    description: 'Northern Kingdom (Israel) and Southern Kingdom (Judah)',
    dataFile: 'layers/divided-kingdom.geojson'
  },
  {
    id: 'assyrian-empire-700bc',
    name: 'Assyrian Empire',
    displayName: 'Assyrian Empire (700 BC)',
    period: 'exile',
    yearStart: -900,
    yearEnd: -612,
    type: 'empire',
    description: 'Assyrian conquest and exile of northern Israel',
    dataFile: 'layers/assyrian-empire.geojson'
  },
  {
    id: 'babylonian-empire-600bc',
    name: 'Babylonian Empire',
    displayName: 'Babylonian Empire (600 BC)',
    period: 'exile',
    yearStart: -626,
    yearEnd: -539,
    type: 'empire',
    description: 'Babylonian conquest and exile of Judah',
    dataFile: 'layers/babylonian-empire.geojson'
  },
  {
    id: 'persian-empire-500bc',
    name: 'Persian Empire',
    displayName: 'Persian Empire (500 BC)',
    period: 'persian',
    yearStart: -539,
    yearEnd: -332,
    type: 'empire',
    description: 'Persian rule and Jewish return from exile',
    dataFile: 'layers/persian-empire.geojson'
  },
  {
    id: 'roman-empire-30ad',
    name: 'Roman Empire',
    displayName: 'Roman Empire (30 AD)',
    period: 'roman',
    yearStart: -30,
    yearEnd: 100,
    type: 'empire',
    description: 'Roman rule during the time of Jesus and early church',
    dataFile: 'layers/roman-empire.geojson'
  },
  {
    id: 'pauls-first-journey',
    name: "Paul's First Journey",
    displayName: "Paul's First Missionary Journey (46-48 AD)",
    period: 'early-church',
    yearStart: 46,
    yearEnd: 48,
    type: 'journey',
    description: 'Route of Paul and Barnabas through Cyprus and Asia Minor',
    dataFile: 'layers/paul-journey-1.geojson'
  },
  {
    id: 'pauls-second-journey',
    name: "Paul's Second Journey",
    displayName: "Paul's Second Missionary Journey (49-52 AD)",
    period: 'early-church',
    yearStart: 49,
    yearEnd: 52,
    type: 'journey',
    description: 'Route through Asia Minor, Macedonia, and Greece',
    dataFile: 'layers/paul-journey-2.geojson'
  },
  {
    id: 'pauls-third-journey',
    name: "Paul's Third Journey",
    displayName: "Paul's Third Missionary Journey (53-57 AD)",
    period: 'early-church',
    yearStart: 53,
    yearEnd: 57,
    type: 'journey',
    description: 'Extended ministry in Ephesus and final visit to Greece',
    dataFile: 'layers/paul-journey-3.geojson'
  },
  {
    id: 'exodus-route',
    name: 'Exodus Route',
    displayName: 'Exodus from Egypt (Traditional Route)',
    period: 'exodus',
    yearStart: -1446,
    yearEnd: -1406,
    type: 'journey',
    description: 'Proposed route of the Israelite exodus and wilderness wandering',
    dataFile: 'layers/exodus-route.geojson'
  }
];

function buildMapPack() {
  console.log('🗺️  Building Biblical Map Pack...\n');
  
  // Ensure packs directory exists
  if (!existsSync('packs')) {
    mkdirSync('packs', { recursive: true });
  }
  
  // Create/open database
  const db = new Database(PACK_OUTPUT);
  
  // Create schema
  console.log('Creating schema...');
  db.exec(`
    -- Pack metadata
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    -- Historical map layers
    CREATE TABLE IF NOT EXISTS historical_layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      period TEXT NOT NULL,
      year_start INTEGER NOT NULL,
      year_end INTEGER NOT NULL,
      type TEXT NOT NULL,
      boundaries TEXT,
      overlay_url TEXT,
      opacity REAL DEFAULT 0.7,
      description TEXT,
      attribution TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_layers_period ON historical_layers(period);
    CREATE INDEX IF NOT EXISTS idx_layers_type ON historical_layers(type);
    CREATE INDEX IF NOT EXISTS idx_layers_year ON historical_layers(year_start, year_end);
    
    -- Map tiles (for offline base maps)
    CREATE TABLE IF NOT EXISTS map_tiles (
      zoom INTEGER NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      tile_data BLOB NOT NULL,
      PRIMARY KEY (zoom, x, y)
    );
    
    CREATE INDEX IF NOT EXISTS idx_tiles_zoom ON map_tiles(zoom);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('packId', 'biblical-maps-v1');
  insertMeta.run('packVersion', '1.0.0');
  insertMeta.run('packType', 'map');
  insertMeta.run('license', 'CC BY 4.0');
  insertMeta.run('attribution', 'Compiled from Bible Mapper, OpenBible.info, and public domain sources');
  insertMeta.run('description', 'Historical map layers showing biblical geography across different time periods');
  insertMeta.run('createdAt', new Date().toISOString());
  
  console.log('✅ Schema created\n');
  
  // Insert historical layers
  console.log('Adding historical layers with real GeoJSON data...');
  const insertLayer = db.prepare(`
    INSERT OR REPLACE INTO historical_layers 
    (id, name, display_name, period, year_start, year_end, type, boundaries, description, opacity, attribution)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let layersAdded = 0;
  
  for (const layer of HISTORICAL_LAYERS) {
    const boundaryKey = LAYER_MAP[layer.id];
    let geojsonData = null;
    
    if (boundaryKey && boundaries[boundaryKey]) {
      // Use the real GeoJSON data from boundaries.js
      geojsonData = JSON.stringify(boundaries[boundaryKey]);
      console.log(`  ✅ ${layer.displayName} - ${boundaries[boundaryKey].features.length} features`);
      layersAdded++;
    } else {
      // Placeholder for layers without data yet
      geojsonData = JSON.stringify({
        type: 'FeatureCollection',
        features: [],
        _placeholder: true,
        _note: `GeoJSON data not yet available for ${layer.id}`
      });
      console.log(`  ⚠️  ${layer.displayName} - placeholder (no data)`);
    }
    
    insertLayer.run(
      layer.id,
      layer.name,
      layer.displayName,
      layer.period,
      layer.yearStart,
      layer.yearEnd,
      layer.type,
      geojsonData,
      layer.description,
      0.7,
      'Compiled from historical atlases and biblical geography resources. CC BY 4.0'
    );
  }
  
  console.log(`\n✅ Added ${layersAdded} layers with real GeoJSON data`);
  
  // Summary
  const layerCount = db.prepare('SELECT COUNT(*) as count FROM historical_layers').get();
  const dbSize = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
  
  console.log('\n📊 Pack Summary:');
  console.log(`   Layers: ${layerCount.count}`);
  console.log(`   Size: ${(dbSize.size / 1024).toFixed(1)} KB`);
  console.log(`   Output: ${PACK_OUTPUT}`);
  
  db.close();
  
  console.log('\n✅ Map pack built successfully!');
  console.log('\n💡 Next steps:');
  console.log('   1. Add GeoJSON boundary files to data-sources/maps/layers/');
  console.log('   2. Import pack into PWA to test');
  console.log('   3. Optionally add base map tiles with --with-tiles flag\n');
}

// Run the builder
buildMapPack();
