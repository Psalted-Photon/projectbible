#!/usr/bin/env node
/**
 * Build Pleiades ancient places pack from JSON download
 * Input: data-sources/pleiades/pleiades-places-latest.json
 * Output: packs/pleiades.sqlite
 * 
 * Uses streaming JSON parser to handle large 1.6GB file
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import JSONStream from 'JSONStream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_FILE = path.join(__dirname, '../data-sources/pleiades/pleiades-places-latest.json');
const OUTPUT_FILE = path.join(__dirname, '../packs/pleiades.sqlite');

console.log('Building Pleiades ancient places pack...\n');

// Check input file
if (!fs.existsSync(JSON_FILE)) {
  console.error('ERROR: Pleiades JSON not found:', JSON_FILE);
  console.error('Run: scripts/download-pleiades.ps1 first');
  process.exit(1);
}

const fileSizeMB = (fs.statSync(JSON_FILE).size / (1024 * 1024)).toFixed(2);
console.log(`Streaming ${fileSizeMB}MB JSON file...`);

// Create SQLite database
if (fs.existsSync(OUTPUT_FILE)) {
  fs.unlinkSync(OUTPUT_FILE);
}

const db = new Database(OUTPUT_FILE);
db.pragma('journal_mode = WAL');

console.log('Creating tables...');

// Metadata table
db.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Places table - core data
db.exec(`
  CREATE TABLE places (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    uri TEXT,
    place_type TEXT,
    description TEXT,
    year_start INTEGER,
    year_end INTEGER,
    created TEXT,
    modified TEXT,
    bbox TEXT
  );
`);

// Names table - historical name variations
db.exec(`
  CREATE TABLE place_names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT,
    romanized TEXT,
    name_type TEXT,
    time_period TEXT,
    certainty TEXT,
    FOREIGN KEY (place_id) REFERENCES places(id)
  );
  CREATE INDEX idx_place_names_place_id ON place_names(place_id);
  CREATE INDEX idx_place_names_name ON place_names(name COLLATE NOCASE);
`);

// Locations table - coordinates
db.exec(`
  CREATE TABLE place_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT NOT NULL,
    title TEXT,
    geometry_type TEXT,
    coordinates TEXT,
    latitude REAL,
    longitude REAL,
    certainty TEXT,
    time_period TEXT,
    FOREIGN KEY (place_id) REFERENCES places(id)
  );
  CREATE INDEX idx_place_locations_place_id ON place_locations(place_id);
  CREATE INDEX idx_place_locations_coords ON place_locations(latitude, longitude);
`);

// Connections table - links to modern places (GeoNames)
db.exec(`
  CREATE TABLE place_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT NOT NULL,
    connection_type TEXT,
    connection_uri TEXT,
    certainty TEXT,
    FOREIGN KEY (place_id) REFERENCES places(id)
  );
  CREATE INDEX idx_place_connections_place_id ON place_connections(place_id);
`);

// Insert metadata
const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta.run('pack_id', 'pleiades-v1');
insertMeta.run('pack_type', 'places');
insertMeta.run('pack_version', '1.0.0');
insertMeta.run('pack_name', 'Pleiades Ancient Places Gazetteer');
insertMeta.run('source', 'https://pleiades.stoa.org');
insertMeta.run('license', 'CC-BY 3.0');
insertMeta.run('created', new Date().toISOString());
insertMeta.run('description', 'Scholarly gazetteer of 40,000+ ancient places from Britain to India, 3000 BC - 640 AD');

console.log('Streaming and importing places...\n');

const insertPlace = db.prepare(`
  INSERT INTO places (id, title, uri, place_type, description, year_start, year_end, created, modified, bbox)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertName = db.prepare(`
  INSERT INTO place_names (place_id, name, language, romanized, name_type, time_period, certainty)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertLocation = db.prepare(`
  INSERT INTO place_locations (place_id, title, geometry_type, coordinates, latitude, longitude, certainty, time_period)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertConnection = db.prepare(`
  INSERT INTO place_connections (place_id, connection_type, connection_uri, certainty)
  VALUES (?, ?, ?, ?)
`);

let count = 0;
let nameCount = 0;
let locationCount = 0;
let connectionCount = 0;

// Use JSONStream to parse the @graph array
const processPlace = db.transaction((place) => {
  try {
    const id = place.id || place['@id'];
    if (!id) return;

    // Extract temporal coverage
    let yearStart = null;
    let yearEnd = null;
    if (place.temporalCoverage) {
      const temporal = Array.isArray(place.temporalCoverage) ? place.temporalCoverage[0] : place.temporalCoverage;
      if (temporal?.start) yearStart = parseInt(temporal.start);
      if (temporal?.end) yearEnd = parseInt(temporal.end);
    }

    const bbox = place.bbox ? JSON.stringify(place.bbox) : null;

    insertPlace.run(
      id,
      place.title || '',
      place.uri || '',
      Array.isArray(place.placeType) ? place.placeType.join(', ') : (place.placeType || ''),
      place.description || '',
      yearStart,
      yearEnd,
      place.created || '',
      place.modified || '',
      bbox
    );
    count++;

    // Insert names
    if (place.names && Array.isArray(place.names)) {
      for (const name of place.names) {
        insertName.run(
          id,
          name.attested || name.romanized || '',
          name.language || '',
          name.romanized || '',
          name.nameType || '',
          name.period || '',
          name.accuracy || ''
        );
        nameCount++;
      }
    }

    // Insert locations
    if (place.locations && Array.isArray(place.locations)) {
      for (const loc of place.locations) {
        let lat = null;
        let lon = null;
        let geomType = '';
        let coords = null;

        if (loc.geometry) {
          geomType = loc.geometry.type || '';
          coords = JSON.stringify(loc.geometry.coordinates);

          if (geomType === 'Point' && Array.isArray(loc.geometry.coordinates)) {
            lon = loc.geometry.coordinates[0];
            lat = loc.geometry.coordinates[1];
          } else if (geomType === 'Polygon' && Array.isArray(loc.geometry.coordinates) && loc.geometry.coordinates.length > 0) {
            const ring = loc.geometry.coordinates[0];
            if (Array.isArray(ring) && ring.length > 0) {
              lon = ring[0][0];
              lat = ring[0][1];
            }
          }
        }

        insertLocation.run(
          id,
          loc.title || '',
          geomType,
          coords,
          lat,
          lon,
          loc.accuracy || '',
          loc.period || ''
        );
        locationCount++;
      }
    }

    // Insert connections
    if (place.connections && Array.isArray(place.connections)) {
      for (const conn of place.connections) {
        insertConnection.run(
          id,
          conn.connectionType || '',
          conn.uri || '',
          conn.certainty || ''
        );
        connectionCount++;
      }
    }

    if (count % 1000 === 0) {
      process.stdout.write(`\rProcessed ${count} places...`);
    }
  } catch (err) {
    console.error('Error processing place:', err.message);
  }
});

// Stream the JSON file and parse @graph array
const stream = createReadStream(JSON_FILE, { encoding: 'utf8' });
const parser = JSONStream.parse('@graph.*');

await new Promise((resolve, reject) => {
  stream.pipe(parser)
    .on('data', (place) => {
      processPlace(place);
    })
    .on('end', () => {
      resolve();
    })
    .on('error', (err) => {
      reject(err);
    });
});

console.log(`\n\nImport complete!`);
console.log(`Places: ${count.toLocaleString()}`);
console.log(`Names: ${nameCount.toLocaleString()}`);
console.log(`Locations: ${locationCount.toLocaleString()}`);
console.log(`Connections: ${connectionCount.toLocaleString()}`);

const dbSizeMB = (fs.statSync(OUTPUT_FILE).size / (1024 * 1024)).toFixed(2);
console.log(`\nOutput: ${OUTPUT_FILE} (${dbSizeMB} MB)`);
console.log('Ready to import into ProjectBible!');

db.close();
