#!/usr/bin/env node
/**
 * Verify the three journey tables in the built atlas-map.sqlite.
 *
 * check-journey-index.mjs validates the index at authoring time, against the
 * source files. This validates the pack, against what actually got written —
 * a different question, and the one that matters once a reader downloads it.
 *
 * Four things are checked, and the licence boundary is one of them: a name or
 * a note leaking into atlas_journey_geometry would put our authored content
 * inside the BY-SA table, which is the whole thing the table split exists to
 * prevent, and nothing else would notice.
 *
 * Run: node scripts/atlas/checks/journeys-check.mjs
 */

import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PACK = join(ROOT, 'packs', 'consolidated', 'atlas-map.sqlite');
const INDEX = join(ROOT, 'data-sources', 'maps', 'journeys', 'journey-index.json');

let failures = 0;
let checks = 0;

function expect(condition, label, detail) {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`);
    if (detail) console.log(`       ${detail}`);
  }
}

if (!existsSync(PACK)) {
  console.error(`Missing ${PACK} — run scripts/atlas/build-atlas-packs.mjs first.`);
  process.exit(1);
}

const db = new Database(PACK, { readonly: true });
const index = JSON.parse(readFileSync(INDEX, 'utf8'));

// ------------------------------------------------------------ the tables exist

console.log('\nTables');
const tables = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
);
for (const t of ['atlas_journeys', 'atlas_journey_stops', 'atlas_journey_geometry']) {
  expect(tables.has(t), `${t} exists`);
}
if (failures) { db.close(); process.exit(1); }

// ------------------------------------------------------------ rows match the index

console.log('\nJourneys');
const journeys = db.prepare('SELECT * FROM atlas_journeys ORDER BY testament DESC, sort_order').all();
expect(
  journeys.length === index.journeys.length,
  `${journeys.length} journeys, matching the index`,
  `index has ${index.journeys.length}`
);

const fromIndex = new Map(index.journeys.map((j) => [j.id, j]));
for (const row of journeys) {
  const source = fromIndex.get(row.id);
  if (!source) {
    expect(false, `${row.id} is in the index`, 'the pack has a journey the index does not');
    continue;
  }
  const same =
    row.name === source.name &&
    row.traveller === source.traveller &&
    row.dates === source.dates &&
    row.colour === source.colour &&
    row.testament === source.testament;
  expect(same, `${row.id} carries the index's name, traveller, dates, colour and testament`);
}

// Every field the overlay and the Layers list read must be present: an empty
// colour draws a black line, an empty name is a blank row in the panel.
const blank = journeys.filter(
  (j) => !j.name || !j.traveller || !j.dates || !j.colour || !j.testament || !j.km
);
expect(!blank.length, 'no journey has an empty name, traveller, dates, colour, testament or km',
  blank.map((j) => j.id).join(', '));

const colours = new Set(journeys.map((j) => j.colour));
expect(colours.size === journeys.length, 'every journey has its own colour',
  `${colours.size} colours across ${journeys.length} journeys`);

// ------------------------------------------------------------ stops

console.log('\nStops');
const stops = db.prepare('SELECT * FROM atlas_journey_stops ORDER BY journey_id, seq').all();
const indexStops = index.journeys.reduce((n, j) => n + j.stops.length, 0);
expect(stops.length === indexStops, `${stops.length} stops, matching the index`,
  `index has ${indexStops}`);

// Per journey: the count the index states, and seq running 1..n with no gaps.
for (const j of index.journeys) {
  const mine = stops.filter((s) => s.journey_id === j.id);
  const seqs = mine.map((s) => s.seq);
  const contiguous = seqs.every((n, i) => n === i + 1);
  expect(
    mine.length === j.stops.length && contiguous,
    `${j.id}: ${mine.length} stops, numbered 1..${mine.length}`,
    `index says ${j.stops.length}, seq is ${seqs.join(',')}`
  );
}

// Every place_id resolves. This is the one the plan calls out: a silent miss
// puts a stop at 0,0 in the Gulf of Guinea.
const unresolved = db.prepare(`
  SELECT s.journey_id, s.place_id FROM atlas_journey_stops s
  LEFT JOIN atlas_biblical_places p ON p.id = s.place_id
  WHERE p.id IS NULL
`).all();
expect(!unresolved.length, 'every place_id resolves in atlas_biblical_places',
  unresolved.map((u) => `${u.journey_id}/${u.place_id}`).join(', '));

// And the coordinates carried on the stop are the gazetteer's, not a copy that
// has drifted from it.
const drifted = db.prepare(`
  SELECT s.journey_id, s.place_id FROM atlas_journey_stops s
  JOIN atlas_biblical_places p ON p.id = s.place_id
  WHERE s.lat != p.lat OR s.lon != p.lon OR s.name != p.name
`).all();
expect(!drifted.length, 'every stop\'s name and coordinates match its gazetteer row',
  drifted.map((d) => `${d.journey_id}/${d.place_id}`).join(', '));

const nowhere = stops.filter((s) => !s.lat && !s.lon);
expect(!nowhere.length, 'no stop sits at 0,0',
  nowhere.map((s) => `${s.journey_id}/${s.place_id}`).join(', '));

const noMethod = stops.filter((s) => !s.travel_method);
expect(!noMethod.length, 'every stop has a travel method',
  noMethod.map((s) => `${s.journey_id}/${s.place_id}`).join(', '));

// Stops carry verses by reference, so the join has to actually produce them.
const withVerses = db.prepare(`
  SELECT COUNT(DISTINCT s.journey_id || '/' || s.seq) n
  FROM atlas_journey_stops s
  JOIN atlas_biblical_places p ON p.id = s.place_id
  WHERE p.verses IS NOT NULL AND p.verses != '[]'
`).get().n;
expect(withVerses === stops.length, `all ${stops.length} stops reach verses through their place`,
  `${withVerses} of ${stops.length}`);

// ------------------------------------------------------------ geometry

console.log('\nGeometry');
const geometry = db.prepare('SELECT * FROM atlas_journey_geometry').all();
expect(geometry.length === journeys.length, `${geometry.length} geometry rows, one per journey`);

// The BY-SA boundary. Coordinates only — four columns, and the blob parses to
// arrays of numbers with nothing else in it.
const columns = db.prepare('PRAGMA table_info(atlas_journey_geometry)').all().map((c) => c.name);
expect(
  columns.join(',') === 'journey_id,encoding,raw_bytes,data',
  'atlas_journey_geometry has only id, encoding, raw_bytes and data',
  columns.join(',')
);

let totalPoints = 0;
let badGeometry = [];
for (const row of geometry) {
  try {
    const raw = gunzipSync(Buffer.from(row.data));
    if (raw.length !== row.raw_bytes) {
      badGeometry.push(`${row.journey_id}: inflates to ${raw.length}, says ${row.raw_bytes}`);
      continue;
    }
    const legs = JSON.parse(raw.toString('utf8'));
    if (!Array.isArray(legs) || !legs.length) {
      badGeometry.push(`${row.journey_id}: not a non-empty array of legs`);
      continue;
    }
    for (const leg of legs) {
      if (!Array.isArray(leg) || leg.length < 2) {
        badGeometry.push(`${row.journey_id}: a leg has fewer than 2 points`);
        break;
      }
      for (const point of leg) {
        if (
          !Array.isArray(point) || point.length !== 2 ||
          typeof point[0] !== 'number' || typeof point[1] !== 'number' ||
          Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90
        ) {
          badGeometry.push(`${row.journey_id}: ${JSON.stringify(point)} is not a [lon,lat] pair`);
          break;
        }
        totalPoints++;
      }
    }
  } catch (err) {
    badGeometry.push(`${row.journey_id}: ${err.message}`);
  }
}
expect(!badGeometry.length, `every journey inflates to valid [lon,lat] line work (${totalPoints.toLocaleString()} points)`,
  badGeometry.slice(0, 5).join('; '));

// Each leg must be usable as a GeoJSON LineString by the overlay, which is what
// the app will actually do with it.
const asGeoJson = geometry.map((row) => ({
  type: 'MultiLineString',
  coordinates: JSON.parse(gunzipSync(Buffer.from(row.data)).toString('utf8')),
}));
expect(
  asGeoJson.every((g) => g.coordinates.every((l) => l.length >= 2)),
  'each journey forms a valid GeoJSON MultiLineString'
);

// ------------------------------------------------------------ attribution

console.log('\nAttribution');
const meta = Object.fromEntries(
  db.prepare('SELECT key, value FROM metadata').all().map((r) => [r.key, r.value])
);
expect(/United Bible Societies/i.test(meta.attribution || ''), 'the pack credits UBS');
expect(/CC.BY.SA.4\.0/i.test(meta.attribution || ''), 'the pack names CC BY-SA 4.0');
expect(/CC-BY-SA-4\.0/.test(meta.license || ''), 'the pack\'s license field includes CC-BY-SA-4.0');

// ------------------------------------------------------------ done

db.close();
console.log(`\n${checks} checks, ${failures} failed.`);
if (failures) process.exit(1);
console.log('Journey tables OK.');
