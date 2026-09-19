#!/usr/bin/env node
/**
 * The three journey tables, built from journey-index.json and the UBS routes.
 *
 * This is a module, not a standalone script: it is called from
 * build-atlas-packs.mjs while atlas-map.sqlite is open, so the tables land in
 * the same file as atlas_biblical_places and the stop→place join is local.
 * Running this file directly does a dry run against the shipped pack, which is
 * how you check the index without rebuilding 340 MB of map.
 *
 * The licence boundary is a table boundary, so it is enforced here:
 *
 *   atlas_journeys          ours — names, travellers, colours, descriptions
 *   atlas_journey_stops     ours — the stop sequence, by place_id
 *   atlas_journey_geometry  UBS, CC BY-SA 4.0 — id and gzipped coordinates, and
 *                           nothing else. No names, no notes, no verses.
 *
 * Every stop's coordinates and verses are looked up from atlas_biblical_places
 * by place_id rather than copied. An unresolved id is fatal: a silent miss puts
 * a stop at 0,0 in the Gulf of Guinea, several thousand km from anywhere the
 * reader would notice it was wrong.
 */

import Database from 'better-sqlite3';
import { orientLegs } from './journey-geometry.mjs';
import { gzipSync } from 'zlib';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const JOURNEYS = join(ROOT, 'data-sources', 'maps', 'journeys');

/**
 * How far a stop may sit from the line drawn for its journey before the build
 * refuses it. Two journeys are legitimately further and say so in the index
 * with a `geometry_note` — Joseph's Egypt, where the UBS line stops at the
 * border, and Jonah's Tarshish, where the Atlantic leg was never drawn. Those
 * are exempted by name rather than by raising the ceiling for everyone, since
 * the whole point of the check is to catch a journey mapped to the wrong file.
 */
const STOP_DISTANCE_LIMIT_KM = 120;

/** Great-circle km. The same formula the app's overlay uses to identify taps. */
function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The LineStrings of one UBS file, in file order.
 *
 * Two shapes appear in the 179 files — a bare Feature and a FeatureCollection —
 * and `061` carries a null feature, so both are handled rather than assumed.
 * The index's segment indices count LineStrings in this order, so the filter
 * must not be reordered or the indices silently point at different lines.
 */
function segmentsOf(file) {
  const path = join(JOURNEYS, 'ubs-routes', file);
  if (!existsSync(path)) return null;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const features = json.type === 'FeatureCollection' ? json.features : [json];
  return features
    .filter((f) => f && f.geometry && f.geometry.type === 'LineString')
    .map((f) => f.geometry.coordinates);
}

/**
 * The journey's line, as an array of legs.
 *
 * Not one flat path: the segments genuinely do not join. Ritmeyer drew open
 * water as separate strokes, so the Second Journey's parts are 309 km apart and
 * the Third's 370 km. Chaining them would invent a line across the Aegean that
 * UBS never drew. Each leg is therefore kept as its own stroke, in the travel
 * order the index states, reversed where the index says the file runs backwards.
 */
function buildGeometry(journey) {
  const legs = [];
  for (const src of journey.source || []) {
    const segs = segmentsOf(src.file);
    if (segs === null) throw new Error(`${journey.id}: missing route file ${src.file}`);
    const reverse = new Set(src.reverse || []);
    for (const i of src.segments) {
      if (!Number.isInteger(i) || i < 0 || i >= segs.length) {
        throw new Error(
          `${journey.id}: ${src.file} has ${segs.length} segments, index ${i} out of range`
        );
      }
      // Rounded to 5 decimal places — about a metre, which is far finer than a
      // hand-drawn Roman road is accurate to, and roughly halves the blob.
      const coords = segs[i].map(([lon, lat]) => [round5(lon), round5(lat)]);
      legs.push(reverse.has(i) ? coords.reverse() : coords);
    }
  }
  if (!legs.length) throw new Error(`${journey.id}: no geometry`);
  return legs;
}

/**
 * Reverse the legs that are stored backwards, measured against the stops.
 *
 * `reverse[]` in the index is hand-maintained and incomplete, and it is kept:
 * it encodes editorial knowledge about source files, and six of these journeys
 * are only right because of it. This runs after it and catches what it missed.
 *
 * Only a leg whose stops descend *strictly* through the journey's sequence is
 * reversed. Paul's First leg 5 meets Derbe, Lystra, Iconium and Antioch in that
 * order against a travel order of 6, 7, 8, 9, so it is drawn against its own
 * direction and that is a fact about the data rather than a reading of it.
 * A leg that zigzags — David's flight meets its stops 5, 6, 1, 2, 7, 3, 4 —
 * has no one direction to be wrong about, and reversing it on a majority vote
 * would swap one arbitrary order for another. Those are left exactly as the
 * index states them.
 *
 * Measured across all 17 journeys: six legs reverse, five ambiguous ones are
 * left alone, and no journey's drawn line gets worse. Reversing the ambiguous
 * ones too makes five journeys worse, which is why the line is drawn here.
 */
function orientGeometry(journey, legs, stops) {
  const decided = orientLegs(legs, stops);
  const flipped = [];
  const mixed = [];
  const out = legs.map((leg, i) => {
    if (decided[i].mixed) mixed.push(i + 1);
    if (!decided[i].flip) return leg;
    flipped.push(i + 1);
    return leg.slice().reverse();
  });
  return { legs: out, flipped, mixed };
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

/**
 * Resolve the stops against atlas_biblical_places and measure the result.
 *
 * Fails on an unresolved id. Also fails when a stop sits further from its own
 * drawn line than the limit, which is the check that catches a journey pointed
 * at the wrong file — that mistake passes every other test, because the names
 * are all real and the line is all valid, and only the distance shows it.
 */
function resolveStops(journey, places, legs) {
  const exempt = new Set(journey.geometry_exempt_stops || []);
  const points = legs.flat();
  const stops = [];
  let previous = null;

  (journey.stops || []).forEach((stop, i) => {
    const place = places.get(stop.place_id);
    if (!place) {
      throw new Error(
        `${journey.id}: stop ${i + 1} "${stop.place_id}" is not in atlas_biblical_places`
      );
    }

    let nearest = Infinity;
    for (const [lon, lat] of points) {
      const d = haversineKm(place.lat, place.lon, lat, lon);
      if (d < nearest) nearest = d;
    }
    if (nearest > STOP_DISTANCE_LIMIT_KM && !exempt.has(stop.place_id)) {
      throw new Error(
        `${journey.id}: stop "${stop.place_id}" is ${nearest.toFixed(0)} km from the drawn line ` +
          `(limit ${STOP_DISTANCE_LIMIT_KM}). Either the journey is mapped to the wrong file, or ` +
          `the gap is real and the stop belongs in geometry_exempt_stops with a geometry_note.`
      );
    }

    stops.push({
      journey_id: journey.id,
      seq: i + 1,
      place_id: stop.place_id,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      travel_method: stop.by,
      // Straight-line distance from the stop before, which is what the popup
      // says. Not the length of the drawn line between them: that would be the
      // honest road distance, but the drawn line does not reach several of
      // these stops at all, so it would be missing exactly where it mattered.
      km_from_previous: previous
        ? Math.round(haversineKm(previous.lat, previous.lon, place.lat, place.lon))
        : null,
      note: stop.note || null,
      _nearest: nearest,
    });
    previous = place;
  });

  if (stops.length < 2) throw new Error(`${journey.id}: fewer than 2 stops`);
  return stops;
}

/** Total journey length, the sum of its legs between stops. */
const totalKm = (stops) => stops.reduce((n, s) => n + (s.km_from_previous || 0), 0);

/**
 * Create the tables and fill them. `db` is an open atlas-map.sqlite that
 * already holds atlas_biblical_places.
 */
export function buildJourneyTables(db, { log = console.log } = {}) {
  const indexPath = join(JOURNEYS, 'journey-index.json');
  if (!existsSync(indexPath)) throw new Error(`Missing ${indexPath}`);
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));

  const places = new Map(
    db
      .prepare('SELECT id, name, lat, lon FROM atlas_biblical_places')
      .all()
      .map((p) => [p.id, p])
  );
  if (!places.size) throw new Error('atlas_biblical_places is empty — build it before the journeys');

  db.exec(`
    -- Ours. Names, travellers, colours, descriptions — the editorial layer.
    CREATE TABLE atlas_journeys (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      traveller   TEXT NOT NULL,
      dates       TEXT NOT NULL,
      description TEXT,
      colour      TEXT NOT NULL,
      testament   TEXT NOT NULL,   -- old | new, the grouping in the Layers list
      sort_order  INTEGER NOT NULL,
      km          INTEGER NOT NULL
    );

    -- Ours. place_id references atlas_biblical_places, which is where the
    -- coordinates and the verses actually live; name/lat/lon are carried here
    -- so the overlay can draw without a join, and are copied from that row.
    CREATE TABLE atlas_journey_stops (
      journey_id       TEXT NOT NULL,
      seq              INTEGER NOT NULL,
      place_id         TEXT NOT NULL,
      name             TEXT NOT NULL,
      lat              REAL NOT NULL,
      lon              REAL NOT NULL,
      travel_method    TEXT NOT NULL,
      km_from_previous INTEGER,
      note             TEXT,
      PRIMARY KEY (journey_id, seq)
    );

    -- UBS Project MARBLE, CC BY-SA 4.0. Coordinates and nothing else: no names,
    -- no notes, no verses. The BY-SA boundary is this table's boundary, so it
    -- stays that way — anything descriptive belongs in the two tables above.
    CREATE TABLE atlas_journey_geometry (
      journey_id TEXT PRIMARY KEY,
      encoding   TEXT NOT NULL,    -- always 'gzip'
      raw_bytes  INTEGER NOT NULL,
      data       BLOB NOT NULL     -- JSON [[[lon,lat], …], …] — one array per leg
    );

    CREATE INDEX idx_journey_stops_journey ON atlas_journey_stops(journey_id);
  `);

  const insertJourney = db.prepare(`
    INSERT INTO atlas_journeys (id, name, traveller, dates, description, colour, testament, sort_order, km)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStop = db.prepare(`
    INSERT INTO atlas_journey_stops
      (journey_id, seq, place_id, name, lat, lon, travel_method, km_from_previous, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGeometry = db.prepare(
    'INSERT INTO atlas_journey_geometry (journey_id, encoding, raw_bytes, data) VALUES (?, ?, ?, ?)'
  );

  const seen = new Set();
  const built = [];

  for (const journey of index.journeys) {
    if (seen.has(journey.id)) throw new Error(`Two journeys share the id "${journey.id}"`);
    seen.add(journey.id);
    for (const field of ['id', 'name', 'traveller', 'dates', 'colour', 'testament']) {
      if (!journey[field]) throw new Error(`${journey.id || '(no id)'}: empty ${field}`);
    }
    if (!['old', 'new'].includes(journey.testament)) {
      throw new Error(`${journey.id}: testament "${journey.testament}" is not old or new`);
    }

    // Stops are resolved against the unoriented legs on purpose: resolveStops
    // measures each stop's distance to the nearest drawn point, which is the
    // same set of points whichever way the leg runs. Orienting first would
    // change nothing it measures and would hide a missing-file error behind a
    // derivation error.
    const rawLegs = buildGeometry(journey);
    const stops = resolveStops(journey, places, rawLegs);
    const { legs, flipped, mixed } = orientGeometry(journey, rawLegs, stops);
    const raw = Buffer.from(JSON.stringify(legs), 'utf8');
    const blob = gzipSync(raw, { level: 9 });

    built.push({ journey, stops, legs, flipped, mixed, raw: raw.length, gz: blob.length });

    insertJourney.run(
      journey.id,
      journey.name,
      journey.traveller,
      journey.dates,
      journey.description || null,
      journey.colour,
      journey.testament,
      journey.sort_order ?? 0,
      totalKm(stops)
    );
    for (const s of stops) {
      insertStop.run(
        s.journey_id, s.seq, s.place_id, s.name, s.lat, s.lon,
        s.travel_method, s.km_from_previous, s.note
      );
    }
    insertGeometry.run(journey.id, 'gzip', raw.length, blob);
  }

  const stopCount = built.reduce((n, b) => n + b.stops.length, 0);
  const pointCount = built.reduce((n, b) => n + b.legs.flat().length, 0);
  const gzTotal = built.reduce((n, b) => n + b.gz, 0);
  const rawTotal = built.reduce((n, b) => n + b.raw, 0);

  for (const b of built) {
    const far = b.stops.reduce((m, s) => Math.max(m, s._nearest), 0);
    log(
      `  ${b.journey.testament === 'old' ? 'OT' : 'NT'}${b.journey.sort_order} ` +
        `${b.journey.name}: ${b.stops.length} stops, ${b.legs.length} legs, ` +
        `${b.legs.flat().length} pts, ${totalKm(b.stops)} km, furthest stop ${far.toFixed(0)} km` +
        (b.flipped.length ? `, reversed leg ${b.flipped.join(', ')}` : '') +
        (b.mixed.length ? `, leg ${b.mixed.join(', ')} ambiguous (left as indexed)` : '')
    );
  }

  return {
    journeys: built.length,
    stops: stopCount,
    points: pointCount,
    rawBytes: rawTotal,
    gzBytes: gzTotal,
  };
}

/** Attribution line for the pack description. BY-SA needs naming in the pack. */
export const JOURNEY_ATTRIBUTION =
  'Journey routes © United Bible Societies (Project MARBLE), drawn by Dr. Leen Ritmeyer, CC BY-SA 4.0.';

// ------------------------------------------------------------------ dry run

/**
 * Run directly to check the index without rebuilding the packs: it copies the
 * shipped atlas-map.sqlite into memory, builds the tables there, and throws
 * away the result. Nothing on disk is touched.
 */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const shipped = join(ROOT, 'packs', 'consolidated', 'atlas-map.sqlite');
  if (!existsSync(shipped)) {
    console.error(`No pack to check against: ${shipped}`);
    process.exit(1);
  }
  const db = new Database(readFileSync(shipped));
  for (const t of ['atlas_journeys', 'atlas_journey_stops', 'atlas_journey_geometry']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  console.log('Dry run against the shipped pack (nothing is written):\n');
  const stats = buildJourneyTables(db);
  console.log(
    `\n${stats.journeys} journeys, ${stats.stops} stops, ${stats.points} points, ` +
      `${(stats.rawBytes / 1024).toFixed(0)} KB raw / ${(stats.gzBytes / 1024).toFixed(0)} KB gzipped.`
  );
  db.close();
}
