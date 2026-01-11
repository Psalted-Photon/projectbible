import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

const DATA_DIR = path.join(projectRoot, 'data-sources', 'openbible', 'data');
const OUTPUT_PACK = path.join(projectRoot, 'packs', 'openbible.sqlite');

console.log('🌍 Building OpenBible Places Pack...');
console.log(`📁 Data directory: ${DATA_DIR}`);
console.log(`📦 Output pack: ${OUTPUT_PACK}`);

// Ensure packs directory exists
const packsDir = path.dirname(OUTPUT_PACK);
if (!fs.existsSync(packsDir)) {
  fs.mkdirSync(packsDir, { recursive: true });
}

// Delete existing pack if it exists
if (fs.existsSync(OUTPUT_PACK)) {
  fs.unlinkSync(OUTPUT_PACK);
  console.log('🗑️  Deleted existing pack');
}

// Create database
const db = new Database(OUTPUT_PACK);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

console.log('📋 Creating database schema...');

// Create schema
db.exec(`
  -- Metadata table
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  
  INSERT INTO metadata (key, value) VALUES 
    ('pack_id', 'openbible'),
    ('pack_type', 'places'),
    ('pack_version', '1.0.0'),
    ('pack_name', 'OpenBible.info Biblical Places'),
    ('description', 'Comprehensive biblical geography with verse references and scholarly confidence scores'),
    ('data_source', 'https://github.com/openbibleinfo/Bible-Geocoding-Data'),
    ('license', 'CC-BY-4.0'),
    ('attribution', 'Data © OpenBible.info contributors, licensed under CC-BY-4.0'),
    ('build_date', datetime('now'));
  
  -- Ancient places (biblical names as they appear in Scripture)
  CREATE TABLE ancient_places (
    id TEXT PRIMARY KEY,
    friendly_id TEXT NOT NULL,
    type TEXT,
    class TEXT,
    preceding_article TEXT,
    verse_count INTEGER DEFAULT 0,
    verses_json TEXT,
    identifications_json TEXT,
    modern_associations_json TEXT,
    linked_data_json TEXT
  );
  
  -- Verses where places are mentioned
  CREATE TABLE place_verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT NOT NULL,
    osis TEXT NOT NULL,
    readable TEXT NOT NULL,
    sort_key TEXT NOT NULL,
    translations_json TEXT,
    instance_types_json TEXT,
    FOREIGN KEY (place_id) REFERENCES ancient_places(id)
  );
  
  -- Modern locations with coordinates
  CREATE TABLE modern_locations (
    id TEXT PRIMARY KEY,
    friendly_id TEXT NOT NULL,
    longitude REAL,
    latitude REAL,
    epsg_28191 TEXT,
    geometry_type TEXT DEFAULT 'point',
    class TEXT,
    type TEXT,
    precision_meters INTEGER,
    precision_type TEXT,
    precision_description TEXT,
    thumbnail_file TEXT,
    thumbnail_credit TEXT,
    thumbnail_url TEXT,
    thumbnail_description TEXT,
    names_json TEXT,
    coordinates_source_json TEXT,
    secondary_sources_json TEXT
  );
  
  -- Place identifications (linking ancient -> modern with confidence)
  CREATE TABLE place_identifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ancient_place_id TEXT NOT NULL,
    modern_location_id TEXT,
    id_source TEXT,
    class TEXT,
    modifier TEXT,
    types_json TEXT,
    vote_total INTEGER,
    vote_average INTEGER,
    vote_count INTEGER,
    time_total INTEGER,
    time_values_json TEXT,
    time_slope REAL,
    time_r_squared REAL,
    time_intercept REAL,
    resolutions_json TEXT,
    FOREIGN KEY (ancient_place_id) REFERENCES ancient_places(id),
    FOREIGN KEY (modern_location_id) REFERENCES modern_locations(id)
  );
  
  -- Geometry for complex features (rivers, regions, etc.)
  CREATE TABLE place_geometry (
    id TEXT PRIMARY KEY,
    geometry_type TEXT NOT NULL,
    geojson TEXT,
    simplified_geojson TEXT,
    suggested_json TEXT
  );
  
  -- Images metadata
  CREATE TABLE place_images (
    id TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    credit TEXT,
    credit_url TEXT,
    description TEXT,
    license TEXT,
    width INTEGER,
    height INTEGER,
    edits_json TEXT
  );
  
  -- Indexes for fast lookups
  CREATE INDEX idx_ancient_friendly ON ancient_places(friendly_id);
  CREATE INDEX idx_ancient_type ON ancient_places(type);
  CREATE INDEX idx_ancient_class ON ancient_places(class);
  CREATE INDEX idx_verses_place ON place_verses(place_id);
  CREATE INDEX idx_verses_osis ON place_verses(osis);
  CREATE INDEX idx_modern_friendly ON modern_locations(friendly_id);
  CREATE INDEX idx_modern_type ON modern_locations(type);
  CREATE INDEX idx_modern_class ON modern_locations(class);
  CREATE INDEX idx_modern_coords ON modern_locations(latitude, longitude);
  CREATE INDEX idx_ident_ancient ON place_identifications(ancient_place_id);
  CREATE INDEX idx_ident_modern ON place_identifications(modern_location_id);
  CREATE INDEX idx_ident_confidence ON place_identifications(time_total DESC);
`);

console.log('✅ Schema created');

// Parse JSONL files
async function parseJSONL(filePath, handler) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: stream });
    
    let count = 0;
    rl.on('line', (line) => {
      if (line.trim()) {
        try {
          const obj = JSON.parse(line);
          handler(obj);
          count++;
        } catch (err) {
          console.error(`Error parsing line: ${err.message}`);
        }
      }
    });
    
    rl.on('close', () => resolve(count));
    rl.on('error', reject);
  });
}

// Import ancient places
console.log('\n📖 Importing ancient places...');
const ancientFile = path.join(DATA_DIR, 'ancient.jsonl');
const insertAncient = db.prepare(`
  INSERT INTO ancient_places (
    id, friendly_id, type, class, preceding_article, verse_count,
    verses_json, identifications_json, modern_associations_json, linked_data_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertVerse = db.prepare(`
  INSERT INTO place_verses (
    place_id, osis, readable, sort_key, translations_json, instance_types_json
  ) VALUES (?, ?, ?, ?, ?, ?)
`);

const insertIdentification = db.prepare(`
  INSERT INTO place_identifications (
    ancient_place_id, modern_location_id, id_source, class, modifier,
    types_json, vote_total, vote_average, vote_count, time_total,
    time_values_json, time_slope, time_r_squared, time_intercept, resolutions_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let ancientCount = 0;
let verseCount = 0;
let identCount = 0;

await parseJSONL(ancientFile, (place) => {
  // Insert ancient place
  insertAncient.run(
    place.id,
    place.friendly_id,
    place.type || null,
    place.class || null,
    place.preceding_article || null,
    (place.verses || []).length,
    JSON.stringify(place.verses || []),
    JSON.stringify(place.identifications || []),
    JSON.stringify(place.modern_associations || {}),
    JSON.stringify(place.linked_data || {})
  );
  ancientCount++;
  
  // Insert verses
  if (place.verses) {
    for (const verse of place.verses) {
      insertVerse.run(
        place.id,
        verse.osis,
        verse.readable,
        verse.sort || verse.osis,
        JSON.stringify(verse.translations || []),
        JSON.stringify(verse.instance_types || {})
      );
      verseCount++;
    }
  }
  
  // Insert identifications
  if (place.identifications) {
    for (const ident of place.identifications) {
      insertIdentification.run(
        place.id,
        ident.id || null,
        ident.id_source || null,
        ident.class || null,
        ident.modifier || null,
        JSON.stringify(ident.types || []),
        ident.score?.vote_total || 0,
        ident.score?.vote_average || 0,
        ident.score?.vote_count || 0,
        ident.score?.time_total || 0,
        JSON.stringify(ident.score?.time_values || []),
        ident.score?.time_slope || null,
        ident.score?.time_r_squared || null,
        ident.score?.time_intercept || null,
        JSON.stringify(ident.resolutions || [])
      );
      identCount++;
    }
  }
  
  if (ancientCount % 100 === 0) {
    process.stdout.write(`\r  Processed ${ancientCount} ancient places...`);
  }
});

console.log(`\r✅ Imported ${ancientCount} ancient places`);
console.log(`✅ Imported ${verseCount} verse references`);
console.log(`✅ Imported ${identCount} place identifications`);

// Import modern locations
console.log('\n📍 Importing modern locations...');
const modernFile = path.join(DATA_DIR, 'modern.jsonl');
const insertModern = db.prepare(`
  INSERT INTO modern_locations (
    id, friendly_id, longitude, latitude, epsg_28191, geometry_type,
    class, type, precision_meters, precision_type, precision_description,
    thumbnail_file, thumbnail_credit, thumbnail_url, thumbnail_description,
    names_json, coordinates_source_json, secondary_sources_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let modernCount = 0;
await parseJSONL(modernFile, (location) => {
  // Parse lonlat
  let longitude = null;
  let latitude = null;
  if (location.lonlat) {
    const [lon, lat] = location.lonlat.split(',').map(s => parseFloat(s.trim()));
    longitude = lon;
    latitude = lat;
  }
  
  // Extract thumbnail info
  const thumbnail = location.media?.thumbnail;
  
  insertModern.run(
    location.id,
    location.friendly_id,
    longitude,
    latitude,
    location.epsg_28191 || null,
    location.geometry || 'point',
    location.class || null,
    location.type || null,
    location.precision?.meters || null,
    location.precision?.type || null,
    location.precision?.description || null,
    thumbnail?.file || null,
    thumbnail?.credit || null,
    thumbnail?.credit_url || null,
    thumbnail?.description || null,
    JSON.stringify(location.names || []),
    JSON.stringify(location.coordinates_source || {}),
    JSON.stringify(location.secondary_sources || [])
  );
  modernCount++;
  
  if (modernCount % 100 === 0) {
    process.stdout.write(`\r  Processed ${modernCount} modern locations...`);
  }
});

console.log(`\r✅ Imported ${modernCount} modern locations`);

// Import geometry
console.log('\n🗺️  Importing geometry...');
const geometryFile = path.join(DATA_DIR, 'geometry.jsonl');
const insertGeometry = db.prepare(`
  INSERT INTO place_geometry (
    id, geometry_type, geojson, simplified_geojson, suggested_json
  ) VALUES (?, ?, ?, ?, ?)
`);

let geometryCount = 0;
await parseJSONL(geometryFile, (geom) => {
  // Load GeoJSON files if they exist
  let geojson = null;
  let simplifiedGeojson = null;
  
  if (geom.geojson_file) {
    const geojsonPath = path.join(projectRoot, 'data-sources', 'openbible', geom.geojson_file);
    if (fs.existsSync(geojsonPath)) {
      geojson = fs.readFileSync(geojsonPath, 'utf8');
    }
  }
  
  if (geom.simplified_geojson_file) {
    const simplifiedPath = path.join(projectRoot, 'data-sources', 'openbible', geom.simplified_geojson_file);
    if (fs.existsSync(simplifiedPath)) {
      simplifiedGeojson = fs.readFileSync(simplifiedPath, 'utf8');
    }
  }
  
  insertGeometry.run(
    geom.id,
    geom.geometry,
    geojson,
    simplifiedGeojson,
    JSON.stringify(geom.suggested || {})
  );
  geometryCount++;
  
  if (geometryCount % 50 === 0) {
    process.stdout.write(`\r  Processed ${geometryCount} geometry features...`);
  }
});

console.log(`\r✅ Imported ${geometryCount} geometry features`);

// Import images
console.log('\n🖼️  Importing image metadata...');
const imageFile = path.join(DATA_DIR, 'image.jsonl');
const insertImage = db.prepare(`
  INSERT INTO place_images (
    id, file, credit, credit_url, description, license,
    width, height, edits_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let imageCount = 0;
await parseJSONL(imageFile, (image) => {
  insertImage.run(
    image.id,
    image.file,
    image.credit || null,
    image.credit_url || null,
    image.description || null,
    image.license || null,
    image.width || 512,
    image.height || 512,
    JSON.stringify(image.edits || [])
  );
  imageCount++;
  
  if (imageCount % 100 === 0) {
    process.stdout.write(`\r  Processed ${imageCount} images...`);
  }
});

console.log(`\r✅ Imported ${imageCount} image metadata records`);

// Optimize database
console.log('\n🔧 Optimizing database...');
db.pragma('optimize');
db.exec('VACUUM');

// Get statistics
const stats = {
  ancientPlaces: db.prepare('SELECT COUNT(*) as count FROM ancient_places').get().count,
  modernLocations: db.prepare('SELECT COUNT(*) as count FROM modern_locations').get().count,
  verses: db.prepare('SELECT COUNT(*) as count FROM place_verses').get().count,
  identifications: db.prepare('SELECT COUNT(*) as count FROM place_identifications').get().count,
  geometry: db.prepare('SELECT COUNT(*) as count FROM place_geometry').get().count,
  images: db.prepare('SELECT COUNT(*) as count FROM place_images').get().count
};

// Get file size
const fileStats = fs.statSync(OUTPUT_PACK);
const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);

console.log('\n✨ Pack build complete!');
console.log('\n📊 Statistics:');
console.log(`  Ancient Places:     ${stats.ancientPlaces.toLocaleString()}`);
console.log(`  Modern Locations:   ${stats.modernLocations.toLocaleString()}`);
console.log(`  Verse References:   ${stats.verses.toLocaleString()}`);
console.log(`  Identifications:    ${stats.identifications.toLocaleString()}`);
console.log(`  Geometry Features:  ${stats.geometry.toLocaleString()}`);
console.log(`  Images:             ${stats.images.toLocaleString()}`);
console.log(`  File Size:          ${fileSizeMB} MB`);

// Show sample data
console.log('\n🔍 Sample Ancient Places:');
const samplePlaces = db.prepare(`
  SELECT friendly_id, type, verse_count 
  FROM ancient_places 
  WHERE verse_count > 0
  ORDER BY verse_count DESC 
  LIMIT 5
`).all();

for (const place of samplePlaces) {
  console.log(`  ${place.friendly_id} (${place.type}) - ${place.verse_count} verses`);
}

console.log('\n🔍 Sample Modern Locations:');
const sampleLocations = db.prepare(`
  SELECT friendly_id, type, class, latitude, longitude
  FROM modern_locations 
  WHERE latitude IS NOT NULL
  LIMIT 5
`).all();

for (const loc of sampleLocations) {
  console.log(`  ${loc.friendly_id} (${loc.type}, ${loc.class}) - ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`);
}

// Sample high-confidence identifications
console.log('\n🔍 High-Confidence Identifications:');
const highConfidence = db.prepare(`
  SELECT 
    ap.friendly_id as ancient_name,
    ml.friendly_id as modern_name,
    pi.time_total as confidence
  FROM place_identifications pi
  JOIN ancient_places ap ON pi.ancient_place_id = ap.id
  LEFT JOIN modern_locations ml ON pi.modern_location_id = ml.id
  WHERE pi.time_total >= 500
  ORDER BY pi.time_total DESC
  LIMIT 5
`).all();

for (const ident of highConfidence) {
  console.log(`  ${ident.ancient_name} → ${ident.modern_name || 'region'} (confidence: ${ident.confidence})`);
}

db.close();

console.log('\n✅ Pack saved to:', OUTPUT_PACK);
console.log('🎉 Done!');
