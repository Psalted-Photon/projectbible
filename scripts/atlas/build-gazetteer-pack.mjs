#!/usr/bin/env node
/**
 * Build gazetteer.sqlite — the map's search index.
 *
 * Reads the full GeoNames dump and keeps the part of it worth shipping. What
 * counts as worth shipping is the whole problem, and it is set out at
 * shouldKeep() below.
 *
 * Search is FTS5 over a normalised form of each name, so "st cloud",
 * "St. Cloud" and "Saint Cloud" are one query, and prefixes match as you type.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createReadStream } from 'fs';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const SRC = path.join(ROOT, 'data-sources/maps/downloads/geonames-full');
const OUT = path.join(ROOT, 'packs/gazetteer.sqlite');
/**
 * Build beside the real pack and move it into place at the end.
 *
 * Two reasons. A build that dies half way leaves a partial file rather than a
 * broken pack where a good one used to be. And the dev server holds the pack
 * open to answer searches, so on Windows it cannot be deleted underneath it —
 * a rename it can survive.
 */
const BUILDING = OUT + '.building';

/**
 * What earns a place in the pack.
 *
 * The whole GeoNames dump is 10.7 million rows and 1.57 GB, which is more than
 * a release can carry and more than anyone wants — zoomed in it offered
 * drainage ditches and stock ponds by name. But the previous index went too far
 * the other way: towns only, so Tampa Bay could not be found at all, because it
 * is a bay.
 *
 * So the cut is by significance rather than by category, using the one measure
 * GeoNames actually carries — how many languages name the thing. A feature the
 * world names in five tongues is a feature worth finding. It sorts the
 * duplicates out at the same time: Florida's Tampa Bay is named in 35 languages
 * and the Bahamian one in a single, the Jordan River in Israel in 36 and the
 * six other Jordan Rivers in four or fewer, Israel's Mount Carmel in 31 and the
 * Jamaican and Australian ones in one apiece. The right answer rises on its own
 * and the wrong ones are simply not there.
 *
 * Two exemptions keep that test from cutting real things:
 *
 *  - Some kinds of feature are rare by nature. There are sixteen oceans, 236
 *    seas and 347 deserts in the entire dump. They are kept whole; no test is
 *    needed to know an ocean matters.
 *  - The lands the Bible is set in are kept whole. This is a Bible atlas, and
 *    the Kidron Valley — named in no language but English, in GeoNames' telling
 *    — is exactly the sort of thing a reader comes here to find.
 */

/** Water, terrain and named areas worth a search. Buildings, farms and roads are not here. */
const NATURAL = new Set([
  // water
  'SEA', 'OCN', 'GULF', 'BAY', 'BAYS', 'STRT', 'SD', 'FJD', 'CHN',
  'LK', 'LKS', 'LGN', 'RSV', 'FLLS', 'STM', 'STMS', 'SPNG', 'WAD', 'WADS',
  // terrain
  'MT', 'MTS', 'PK', 'PKS', 'RDGE', 'VLC', 'ISL', 'ISLS', 'CAPE', 'PEN',
  'DSRT', 'PLN', 'VAL', 'PASS', 'CNYN', 'PLAT', 'HLL', 'HLLS',
  // areas
  'PRK', 'RGN', 'CONT', 'RESN', 'AREA',
]);

/**
 * Kinds of feature there are only ever a few thousand of worldwide, kept whole
 * because no test is needed to know an ocean matters. Counted from the dump:
 * 7 continents, 16 oceans, 236 seas, 347 deserts, 395 gulfs.
 *
 * Capes, mountain ranges and peninsulas were in this list and have been taken
 * out — there are 29,083 capes and 29,644 ranges, which is not rare by any
 * reading. They go through the same test as everything else, and the ones
 * anybody has heard of pass it easily.
 */
const RARE = new Set([
  'SEA', 'OCN', 'GULF', 'DSRT', 'CONT', 'PKS', 'BAYS',
  'SD', 'STRT', 'FJD', 'PLAT', 'RGN', 'RESN', 'LKS', 'ISLS', 'CNYN',
]);

/** Towns that are somewhere in their own right even with no population recorded. */
const SEATS = new Set(['PPLC', 'PPLA', 'PPLA1', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5']);

/** Countries, states, counties. Not parishes, wards or historical subdivisions. */
const ADMIN = new Set(['PCLI', 'PCL', 'PCLD', 'PCLF', 'PCLS', 'ADM1', 'ADM2', 'TERR']);

/**
 * The Nile delta east to Susa, Ararat south to the Red Sea. Kept in full, at
 * every scale, whatever the wider world calls it — this is a Bible atlas, and
 * the Kidron Valley, named in no language but English as GeoNames has it, is
 * exactly what a reader comes here to find.
 *
 * The east edge is what matters and it is easy to get wrong: Nineveh is at 43,
 * Babylon at 44, Ararat at 44, Ur at 46. A box that stops at 40 throws all of
 * Mesopotamia away. 1,187 of the 1,278 places Scripture names fall inside this
 * one; the rest are Rome, Athens, Ephesus and Tarshish, which the wider world
 * names well enough to pass on their own.
 */
const BIBLE_LANDS = { west: 29, east: 49, south: 25, north: 40 };

/** How many languages name this thing. GeoNames' fourth column, counted. */
function altNameCount(field) {
  if (!field) return 0;
  let n = 0;
  for (const part of field.split(',')) if (part) n++;
  return n;
}

function inBibleLands(lat, lon) {
  return lon >= BIBLE_LANDS.west && lon <= BIBLE_LANDS.east
      && lat >= BIBLE_LANDS.south && lat <= BIBLE_LANDS.north;
}

/** The smallest number of languages that makes a common feature worth keeping. */
const SPOKEN_IN = 5;

function shouldKeep({ fclass, fcode, population, altNames, lat, lon }) {
  if (fclass === 'P') return population >= 500 || SEATS.has(fcode);
  if (fclass === 'A') return ADMIN.has(fcode);
  if (!NATURAL.has(fcode)) return false;
  if (RARE.has(fcode)) return true;
  if (inBibleLands(lat, lon)) return true;
  return altNames >= SPOKEN_IN;
}

/** Same rules as the client's normalise(), so queries and rows agree. */
const WORDS = {
  st: 'saint', ste: 'sainte', mt: 'mount', mtn: 'mountain', ft: 'fort',
  n: 'north', s: 'south', e: 'east', w: 'west',
};
function normalise(text) {
  const cleaned = String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.split(' ').map((w) => WORDS[w] ?? w).join(' ');
}

// ---------------------------------------------------------------- lookups

function readTsv(file, onRow) {
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    onRow(line.split('\t'));
  }
}

const countryName = new Map();
const countryFile = path.join(SRC, 'countryInfo.txt');
if (fs.existsSync(countryFile)) {
  readTsv(countryFile, (c) => { if (c[0] && c[4]) countryName.set(c[0], c[4]); });
}

const admin1Name = new Map();
const adminFile = path.join(SRC, 'admin1CodesASCII.txt');
if (fs.existsSync(adminFile)) {
  readTsv(adminFile, (c) => { if (c[0] && c[1]) admin1Name.set(c[0], c[1]); });
}
console.log(`lookups: ${countryName.size} countries, ${admin1Name.size} admin regions`);

// ------------------------------------------------------------------ build

if (fs.existsSync(BUILDING)) fs.unlinkSync(BUILDING);
const db = new Database(BUILDING);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');
db.exec(`
  CREATE TABLE places (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    norm       TEXT NOT NULL,
    lat        REAL NOT NULL,
    lon        REAL NOT NULL,
    fclass     TEXT,
    fcode      TEXT,
    country    TEXT,
    admin1     TEXT,
    population INTEGER DEFAULT 0,
    -- How many languages name this thing. It decides what gets into the pack,
    -- and then decides ranking among things that tie: two Grand Canyons both
    -- have no population, and the one in Arizona is named in eight languages
    -- while the one in Missouri is named in two.
    importance INTEGER DEFAULT 0
  );
`);

const insert = db.prepare(`
  INSERT INTO places (id, name, norm, lat, lon, fclass, fcode, country, admin1, population, importance)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`);

const dump = path.join(SRC, 'allCountries.txt');
if (!fs.existsSync(dump)) {
  console.error(`missing ${dump} — unzip allCountries.zip first`);
  process.exit(1);
}

let read = 0;
let kept = 0;
const byClass = {};

const rl = readline.createInterface({
  input: createReadStream(dump, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

db.exec('BEGIN');
for await (const line of rl) {
  read++;
  if (read % 2_000_000 === 0) console.log(`  read ${(read / 1e6).toFixed(0)}M, kept ${kept.toLocaleString()}`);

  const c = line.split('\t');
  const fclass = c[6];
  const fcode = c[7];

  const name = c[1];
  if (!name) continue;
  const lat = Number(c[4]);
  const lon = Number(c[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

  const population = Number(c[14]) || 0;
  const importance = altNameCount(c[3]);
  if (!shouldKeep({ fclass, fcode, population, altNames: importance, lat, lon })) continue;

  const norm = normalise(c[2] || name);
  if (!norm) continue;

  const cc = c[8];
  const admin = admin1Name.get(`${cc}.${c[10]}`) ?? '';

  insert.run(
    Number(c[0]), name, norm, lat, lon,
    fclass, fcode, countryName.get(cc) ?? cc ?? '', admin,
    population, importance
  );
  kept++;
  byClass[fclass] = (byClass[fclass] ?? 0) + 1;
}
db.exec('COMMIT');

console.log(`\nread ${read.toLocaleString()} rows, kept ${kept.toLocaleString()}`);
console.log('by class:', byClass);

console.log('\nbuilding search index…');
db.exec(`
  CREATE INDEX idx_places_norm ON places(norm);
  CREATE INDEX idx_places_pop  ON places(population DESC, importance DESC);

  -- Prefix indexes let short queries match as the reader types.
  CREATE VIRTUAL TABLE places_fts USING fts5(
    norm, content='places', content_rowid='id', prefix='2 3 4 5'
  );
  INSERT INTO places_fts(rowid, norm) SELECT id, norm FROM places;
`);

const meta = db.prepare('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)');
meta.run();
const put = db.prepare('INSERT INTO metadata (key, value) VALUES (?,?)');
for (const [k, v] of Object.entries({
  id: 'gazetteer',
  name: 'Place Gazetteer',
  version: '1',
  description: 'Searchable world places: towns, water, terrain, regions and administrative areas, kept where the world names them.',
  attribution: 'GeoNames, CC BY 4.0.',
  rows: String(kept),
  built: new Date().toISOString(),
})) put.run(k, v);

db.exec('VACUUM');
db.close();

const size = fs.statSync(BUILDING).size;
const mb = (size / 1e6).toFixed(1);
try {
  fs.renameSync(BUILDING, OUT);
  console.log('');
  console.log(`${mb} MB -> ${OUT}`);
} catch (err) {
  console.log('');
  console.log(`${mb} MB -> ${BUILDING}`);
  console.log(`could not replace the live pack (${err.code ?? err.message}).`);
  console.log('stop the dev server, then rename it over the old one.');
}
