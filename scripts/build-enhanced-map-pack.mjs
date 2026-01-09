#!/usr/bin/env node

/**
 * Build enhanced map pack combining all geographic data
 * 
 * Creates maps-enhanced.sqlite containing:
 * - 12,606 biblical places with precise coordinates (from Pleiades)
 * - Verse-place correlations (2,047 verses → 153 places)
 * - 3 annotated journey routes (Paul, Exodus, Jesus)
 * - 10 points of interest with historical events
 * - Ancient empire/province boundaries (AWMC GeoJSON)
 * 
 * Output: packs/maps-enhanced.sqlite
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const EXTRACTED_DIR = path.join(projectRoot, 'data-sources/maps/extracted');
const AWMC_DIR = path.join(projectRoot, 'data-sources/maps/downloads/awmc/geodata');
const PACKS_DIR = path.join(projectRoot, 'packs');
const OUTPUT_FILE = path.join(PACKS_DIR, 'maps-enhanced.sqlite');

console.log('🗺️  Building Enhanced Map Pack...\n');

// Load all JSON data
console.log('📂 Loading data files...');

const biblicalPlaces = JSON.parse(
  fs.readFileSync(path.join(EXTRACTED_DIR, 'biblical-places.json'), 'utf8')
);
console.log(`✓ Loaded ${biblicalPlaces.features.length.toLocaleString()} biblical places`);

const placeVerseLinks = JSON.parse(
  fs.readFileSync(path.join(EXTRACTED_DIR, 'place-verse-links.json'), 'utf8')
);
console.log(`✓ Loaded ${Object.keys(placeVerseLinks.verseToPlaces).length.toLocaleString()} verse-place links`);

const journeyRoutes = JSON.parse(
  fs.readFileSync(path.join(EXTRACTED_DIR, 'journey-routes.json'), 'utf8')
);
console.log(`✓ Loaded ${journeyRoutes.journeys.length} journey routes`);

const poiDatabase = JSON.parse(
  fs.readFileSync(path.join(EXTRACTED_DIR, 'poi-database.json'), 'utf8')
);
console.log(`✓ Loaded ${poiDatabase.pois.length} points of interest`);

// Find AWMC GeoJSON files
console.log('\n📂 Scanning for AWMC map layers...');
const mapLayers = [];

function findGeoJSON(dir) {
  if (!fs.existsSync(dir)) return;
  
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      findGeoJSON(fullPath);
    } else if (item.endsWith('.geojson')) {
      const name = item.replace('.geojson', '').replace(/_/g, ' ');
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      mapLayers.push({
        id: item.replace('.geojson', ''),
        name: name.charAt(0).toUpperCase() + name.slice(1),
        type: 'geojson',
        data: JSON.stringify(data)
      });
    }
  }
}

findGeoJSON(AWMC_DIR);
console.log(`✓ Found ${mapLayers.length} map layers`);

// Create database
console.log('\n💾 Creating SQLite database...');

if (!fs.existsSync(PACKS_DIR)) {
  fs.mkdirSync(PACKS_DIR, { recursive: true });
}

// Remove old pack if exists
if (fs.existsSync(OUTPUT_FILE)) {
  fs.unlinkSync(OUTPUT_FILE);
}

const db = new Database(OUTPUT_FILE);

// Create schema
console.log('📐 Creating tables...');

db.exec(`
  -- Metadata table
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Biblical places (12,606 places from Pleiades)
  CREATE TABLE places (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    place_type TEXT,
    modern_name TEXT,
    description TEXT,
    time_periods TEXT,
    ancient_names TEXT
  );
  CREATE INDEX idx_places_name ON places(name);
  CREATE INDEX idx_places_coords ON places(latitude, longitude);

  -- Verse-to-place correlations
  CREATE TABLE place_verses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT NOT NULL,
    verse_ref TEXT NOT NULL,
    FOREIGN KEY (place_id) REFERENCES places(id)
  );
  CREATE INDEX idx_place_verses_place ON place_verses(place_id);
  CREATE INDEX idx_place_verses_verse ON place_verses(verse_ref);

  -- Journey routes
  CREATE TABLE journey_routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    traveler TEXT,
    date_range TEXT,
    total_distance_km REAL
  );

  -- Journey waypoints
  CREATE TABLE journey_waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    place_name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    distance_from_previous_km REAL,
    travel_method TEXT,
    icon TEXT,
    FOREIGN KEY (journey_id) REFERENCES journey_routes(id)
  );
  CREATE INDEX idx_waypoints_journey ON journey_waypoints(journey_id);

  -- Journey events
  CREATE TABLE journey_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    waypoint_id INTEGER NOT NULL,
    event_description TEXT NOT NULL,
    verse_reference TEXT,
    FOREIGN KEY (waypoint_id) REFERENCES journey_waypoints(id)
  );

  -- Points of Interest
  CREATE TABLE points_of_interest (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    poi_type TEXT NOT NULL,
    icon TEXT,
    significance TEXT
  );

  -- POI Historical Events
  CREATE TABLE poi_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poi_id TEXT NOT NULL,
    event_description TEXT NOT NULL,
    verse_reference TEXT,
    date_range TEXT,
    FOREIGN KEY (poi_id) REFERENCES points_of_interest(id)
  );

  -- Map Layers (GeoJSON for empires, provinces, etc.)
  CREATE TABLE map_layers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layer_type TEXT NOT NULL,
    geojson_data TEXT NOT NULL
  );
`);

console.log('✓ Schema created');

// Insert metadata
console.log('\n📝 Inserting metadata...');
const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
const metaTransaction = db.transaction(() => {
  insertMeta.run('version', '1.0');
  insertMeta.run('title', 'Enhanced Biblical Map Pack');
  insertMeta.run('description', 'Comprehensive geographic data for biblical study');
  insertMeta.run('created', new Date().toISOString());
  insertMeta.run('total_places', biblicalPlaces.features.length);
  insertMeta.run('linked_verses', Object.keys(placeVerseLinks.verseToPlaces).length);
  insertMeta.run('journey_routes', journeyRoutes.journeys.length);
  insertMeta.run('points_of_interest', poiDatabase.pois.length);
  insertMeta.run('map_layers', mapLayers.length);
});
metaTransaction();
console.log('✓ Metadata inserted');

// Insert biblical places
console.log('\n📍 Inserting biblical places...');
const insertPlace = db.prepare(`
  INSERT INTO places (id, name, latitude, longitude, place_type, modern_name, description, time_periods, ancient_names)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const placesTransaction = db.transaction(() => {
  for (const feature of biblicalPlaces.features) {
    const props = feature.properties;
    const [lon, lat] = feature.geometry.coordinates;
    
    insertPlace.run(
      props.id,
      props.name,
      lat,
      lon,
      props.placeType || null,
      props.modernName || null,
      props.description || null,
      props.timePeriods ? JSON.stringify(props.timePeriods) : null,
      props.names?.ancient ? JSON.stringify(props.names.ancient) : null
    );
  }
});

placesTransaction();
console.log(`✓ Inserted ${biblicalPlaces.features.length.toLocaleString()} places`);

// Insert verse-place correlations
console.log('\n🔗 Inserting verse-place correlations...');
const insertPlaceVerse = db.prepare('INSERT INTO place_verses (place_id, verse_ref) VALUES (?, ?)');

const versesTransaction = db.transaction(() => {
  let count = 0;
  for (const [verseRef, placeIds] of Object.entries(placeVerseLinks.verseToPlaces)) {
    for (const placeId of placeIds) {
      insertPlaceVerse.run(placeId, verseRef);
      count++;
    }
  }
  return count;
});

const verseCount = versesTransaction();
console.log(`✓ Inserted ${verseCount.toLocaleString()} verse-place correlations`);

// Insert journey routes
console.log('\n🚶 Inserting journey routes...');
const insertJourney = db.prepare(`
  INSERT INTO journey_routes (id, name, description, traveler, date_range, total_distance_km)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertWaypoint = db.prepare(`
  INSERT INTO journey_waypoints (journey_id, sequence, place_name, latitude, longitude, distance_from_previous_km, travel_method, icon)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertEvent = db.prepare(`
  INSERT INTO journey_events (waypoint_id, event_description, verse_reference)
  VALUES (?, ?, ?)
`);

const journeysTransaction = db.transaction(() => {
  for (const journey of journeyRoutes.journeys) {
    // Insert journey
    insertJourney.run(
      journey.id,
      journey.name,
      journey.description,
      journey.traveler,
      journey.dateRange || null,
      journey.totalDistanceKm || null
    );
    
    // Insert waypoints
    for (let i = 0; i < journey.waypoints.length; i++) {
      const wp = journey.waypoints[i];
      const result = insertWaypoint.run(
        journey.id,
        i + 1,
        wp.name,
        wp.coordinates[1], // lat
        wp.coordinates[0], // lon
        wp.distanceFromPreviousKm || null,
        wp.travelMethod || null,
        wp.icon || null
      );
      
      const waypointId = result.lastInsertRowid;
      
      // Insert events for this waypoint
      if (wp.events) {
        for (const event of wp.events) {
          insertEvent.run(
            waypointId,
            event.description,
            event.verse || null
          );
        }
      }
    }
  }
});

journeysTransaction();
console.log(`✓ Inserted ${journeyRoutes.journeys.length} journeys with waypoints and events`);

// Insert points of interest
console.log('\n⭐ Inserting points of interest...');
const insertPOI = db.prepare(`
  INSERT INTO points_of_interest (id, name, latitude, longitude, poi_type, icon, significance)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertPOIEvent = db.prepare(`
  INSERT INTO poi_events (poi_id, event_description, verse_reference, date_range)
  VALUES (?, ?, ?, ?)
`);

const poisTransaction = db.transaction(() => {
  for (const poi of poiDatabase.pois) {
    insertPOI.run(
      poi.id,
      poi.name,
      poi.coordinates[1], // lat
      poi.coordinates[0], // lon
      poi.type,
      poi.icon || null,
      poi.significance || null
    );
    
    if (poi.events) {
      for (const event of poi.events) {
        insertPOIEvent.run(
          poi.id,
          event.description,
          event.verse || null,
          event.date || null
        );
      }
    }
  }
});

poisTransaction();
console.log(`✓ Inserted ${poiDatabase.pois.length} points of interest`);

// Insert map layers
console.log('\n🗾 Inserting map layers...');
const insertLayer = db.prepare(`
  INSERT INTO map_layers (id, name, layer_type, geojson_data)
  VALUES (?, ?, ?, ?)
`);

const layersTransaction = db.transaction(() => {
  for (const layer of mapLayers) {
    insertLayer.run(layer.id, layer.name, layer.type, layer.data);
  }
});

layersTransaction();
console.log(`✓ Inserted ${mapLayers.length} map layers`);

// Optimize database
console.log('\n⚡ Optimizing database...');
db.pragma('optimize');
db.close();

const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2);
console.log(`\n✅ Success! Created maps-enhanced.sqlite (${fileSize} MB)`);

console.log('\n📊 Pack Contents:');
console.log(`   ${biblicalPlaces.features.length.toLocaleString()} biblical places`);
console.log(`   ${verseCount.toLocaleString()} verse-place correlations`);
console.log(`   ${journeyRoutes.journeys.length} journey routes`);
console.log(`   ${poiDatabase.pois.length} points of interest`);
console.log(`   ${mapLayers.length} map layers (empires, provinces, etc.)`);
console.log(`\n🎯 Ready to load in PWA for interactive biblical geography! 🗺️`);
