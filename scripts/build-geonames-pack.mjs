#!/usr/bin/env node
/**
 * Build GeoNames Modern Places Pack
 *
 * Reads downloaded GeoNames data files and produces packs/geonames.sqlite,
 * which the app can import to enable searching for any modern place worldwide.
 *
 * Sources (all CC BY 4.0):
 *   data-sources/geonames/cities1000.txt    — ~130K cities/towns (pop > 1,000)
 *   data-sources/geonames/admin1CodesASCII.txt — ~3,800 states/provinces
 *   data-sources/geonames/countryInfo.txt   — ~250 countries
 *
 * Usage:
 *   node scripts/build-geonames-pack.mjs
 *
 * Prerequisites:
 *   node scripts/download-geonames.mjs   (run first if files not present)
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DATA_DIR = join(REPO_ROOT, 'data-sources', 'geonames');
const OUTPUT = join(REPO_ROOT, 'packs', 'geonames.sqlite');

// ── Sanity check inputs ────────────────────────────────────────────────────
const REQUIRED = ['cities1000.txt', 'admin1CodesASCII.txt', 'countryInfo.txt'];
for (const f of REQUIRED) {
  if (!existsSync(join(DATA_DIR, f))) {
    console.error(`❌ Missing: data-sources/geonames/${f}`);
    console.error('   Run:  node scripts/download-geonames.mjs');
    process.exit(1);
  }
}

if (!existsSync(join(REPO_ROOT, 'packs'))) {
  mkdirSync(join(REPO_ROOT, 'packs'), { recursive: true });
}
if (existsSync(OUTPUT)) {
  unlinkSync(OUTPUT);
}

// ── Open DB ────────────────────────────────────────────────────────────────
const db = new Database(OUTPUT);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

console.log('📦 Building GeoNames Modern Places Pack...\n');

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE modern_places (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    ascii_name   TEXT,
    country_code TEXT,
    country_name TEXT,
    admin1_code  TEXT,
    admin1_name  TEXT,
    admin2_name  TEXT,
    feature_class TEXT,
    feature_code  TEXT,
    latitude     REAL,
    longitude    REAL,
    population   INTEGER,
    elevation    INTEGER,
    timezone     TEXT
  );

  CREATE INDEX idx_mp_name        ON modern_places(name COLLATE NOCASE);
  CREATE INDEX idx_mp_ascii       ON modern_places(ascii_name COLLATE NOCASE);
  CREATE INDEX idx_mp_country     ON modern_places(country_code);
  CREATE INDEX idx_mp_admin1name  ON modern_places(admin1_name COLLATE NOCASE);
  CREATE INDEX idx_mp_feature     ON modern_places(feature_class, feature_code);
  CREATE INDEX idx_mp_pop         ON modern_places(population DESC);
`);

// ── Metadata ───────────────────────────────────────────────────────────────
const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
insertMeta.run('id',           'geonames-modern-places-v1');
insertMeta.run('type',         'geonames');
insertMeta.run('version',      '1.0.0');
insertMeta.run('schemaVersion','1');
insertMeta.run('name',         'World Places (GeoNames)');
insertMeta.run('description',  'Modern world geography: cities, states, countries. 130,000+ places worldwide.');
insertMeta.run('license',      'CC BY 4.0');
insertMeta.run('attribution',  'GeoNames (geonames.org) — CC BY 4.0');
insertMeta.run('source',       'https://download.geonames.org/export/dump/');
insertMeta.run('createdAt',    new Date().toISOString());

// ── Load admin1 codes (state/province names) ───────────────────────────────
console.log('Loading admin1 codes (states/provinces)...');
const admin1Map = new Map(); // "US.MN" → "Minnesota"

const admin1Lines = readFileSync(join(DATA_DIR, 'admin1CodesASCII.txt'), 'utf8').split('\n');
for (const line of admin1Lines) {
  if (!line.trim()) continue;
  const [code, name] = line.split('\t');
  if (code && name) admin1Map.set(code.trim(), name.trim());
}
console.log(`  Loaded ${admin1Map.size} admin1 entries`);

// ── Load country info ──────────────────────────────────────────────────────
console.log('Loading country info...');
const countryMap = new Map(); // "US" → "United States"

const countryLines = readFileSync(join(DATA_DIR, 'countryInfo.txt'), 'utf8').split('\n');
for (const line of countryLines) {
  if (!line.trim() || line.startsWith('#')) continue;
  const cols = line.split('\t');
  // columns: ISO, ISO3, ISO-Numeric, fips, Country, Capital, Area, Population, Continent, ...
  const iso = cols[0]?.trim();
  const name = cols[4]?.trim();
  if (iso && name) countryMap.set(iso, name);
}
console.log(`  Loaded ${countryMap.size} countries`);

// ── Insert countries as feature_class='A', feature_code='PCLI' ────────────
//    so users can search "Peru", "France", etc.
console.log('\nInserting countries...');
const insertPlace = db.prepare(`
  INSERT OR IGNORE INTO modern_places
    (id, name, ascii_name, country_code, country_name, admin1_code, admin1_name,
     admin2_name, feature_class, feature_code, latitude, longitude, population, elevation, timezone)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// We'll use negative synthetic IDs for country rows (they don't have geoname IDs here)
let syntheticId = -1;
const insertCountries = db.transaction(() => {
  // We get coordinates from countryInfo.txt cols[14]=latitude, [15]=longitude
  for (const line of countryLines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const cols = line.split('\t');
    if (cols.length < 18) continue;
    const iso   = cols[0]?.trim();
    const name  = cols[4]?.trim();
    const capital = cols[5]?.trim();
    const pop   = parseInt(cols[7]) || 0;
    const lat   = parseFloat(cols[14]);
    const lon   = parseFloat(cols[15]);
    if (!iso || !name) continue;
    insertPlace.run(
      syntheticId--, name, name, iso, name,
      '', '', '',
      'A', 'PCLI',
      isNaN(lat) ? null : lat,
      isNaN(lon) ? null : lon,
      pop, null, null
    );
  }
});
insertCountries();
console.log(`  Inserted ${Math.abs(syntheticId) - 1} countries`);

// ── Parse and insert cities1000.txt ───────────────────────────────────────
// GeoNames tab-delimited columns (19 total):
// 0:geonameid 1:name 2:asciiname 3:alternatenames 4:latitude 5:longitude
// 6:feature_class 7:feature_code 8:country_code 9:cc2 10:admin1_code
// 11:admin2_code 12:admin3_code 13:admin4_code 14:population 15:elevation
// 16:dem 17:timezone 18:modification_date

console.log('\nParsing cities1000.txt...');
const citiesText = readFileSync(join(DATA_DIR, 'cities1000.txt'), 'utf8');
const cityLines = citiesText.split('\n');
console.log(`  Lines to process: ${cityLines.length.toLocaleString()}`);

let inserted = 0;
let skipped = 0;
const BATCH = 2000;

const insertBatch = db.transaction((rows) => {
  for (const row of rows) {
    insertPlace.run(
      row.id, row.name, row.asciiName, row.countryCode, row.countryName,
      row.admin1Code, row.admin1Name, row.admin2Code,
      row.featureClass, row.featureCode,
      row.latitude, row.longitude, row.population,
      row.elevation, row.timezone
    );
    inserted++;
  }
});

let batch = [];
for (const line of cityLines) {
  if (!line.trim()) continue;
  const cols = line.split('\t');
  if (cols.length < 18) { skipped++; continue; }

  const countryCode  = cols[8]?.trim() || '';
  const admin1Code   = cols[10]?.trim() || '';
  const admin1Key    = `${countryCode}.${admin1Code}`;

  batch.push({
    id:           parseInt(cols[0]) || 0,
    name:         cols[1]?.trim() || '',
    asciiName:    cols[2]?.trim() || '',
    countryCode,
    countryName:  countryMap.get(countryCode) || countryCode,
    admin1Code,
    admin1Name:   admin1Map.get(admin1Key) || '',
    admin2Code:   cols[11]?.trim() || '',
    featureClass: cols[6]?.trim() || '',
    featureCode:  cols[7]?.trim() || '',
    latitude:     parseFloat(cols[4]) || null,
    longitude:    parseFloat(cols[5]) || null,
    population:   parseInt(cols[14]) || 0,
    elevation:    parseInt(cols[15]) || null,
    timezone:     cols[17]?.trim() || '',
  });

  if (batch.length >= BATCH) {
    insertBatch(batch);
    batch = [];
    process.stdout.write(`\r  Inserted ${inserted.toLocaleString()} places...`);
  }
}
if (batch.length > 0) {
  insertBatch(batch);
}
process.stdout.write('\n');

// ── Also insert admin1 entries (states, provinces) ────────────────────────
// Many of these will already be in cities1000 as feature_class=A rows,
// but add them explicitly so "Minnesota" always resolves.
console.log('\nInserting admin1 regions (states/provinces)...');
let adminInserted = 0;
const insertAdmins = db.transaction(() => {
  for (const [code, name] of admin1Map) {
    const [countryCode, admin1Code] = code.split('.');
    const countryName = countryMap.get(countryCode) || countryCode;
    // Use syntheticId range so no collision with geoname IDs (which are positive integers)
    insertPlace.run(
      syntheticId--, name, name, countryCode, countryName,
      admin1Code, name,
      '', 'A', 'ADM1',
      null, null, null, null, null
    );
    adminInserted++;
  }
});
insertAdmins();
console.log(`  Inserted ${adminInserted} admin1 regions`);

// ── Optimize ───────────────────────────────────────────────────────────────
console.log('\nOptimizing database...');
db.pragma('optimize');
db.exec('ANALYZE;');

// ── Summary ────────────────────────────────────────────────────────────────
const totalRows = db.prepare('SELECT COUNT(*) as n FROM modern_places').get().n;
const fileSize  = statSync(OUTPUT).size;
const fileSizeMB = (fileSize / 1024 / 1024).toFixed(1);

console.log(`
📊 GeoNames Pack Summary:
   Total places:   ${totalRows.toLocaleString()}
   Output:         packs/geonames.sqlite
   File size:      ${fileSizeMB} MB
   Countries:      ${countryMap.size}
   Admin1 regions: ${adminInserted}
   Cities/towns:   ${inserted.toLocaleString()} (pop > 1,000)
   Skipped rows:   ${skipped}

✅ Pack built successfully!
   Next: import geonames.sqlite in the app via the Packs panel.
`);

db.close();
