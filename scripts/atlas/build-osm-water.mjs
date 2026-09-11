#!/usr/bin/env node
/**
 * Turn the harvested OpenStreetMap water into a fine detail level for the map.
 *
 * Natural Earth's lakes and coastline are right to about a kilometre, which is
 * invisible at country scale and glaring close in: fourteen harbour towns sit
 * out at sea and Capernaum sits in the Sea of Galilee. This builds the same
 * layers again from OpenStreetMap, over the ground where a reader actually
 * zooms deep — the cells holding a place Scripture names.
 *
 * It is a *level*, not a separate layer: it fills detail 1 alongside the
 * existing 110, 50 and 10, so the map's own detail-by-zoom picks it up without
 * learning anything new. Outside the covered ground there is nothing at this
 * level, so the map stays on 10 there — which is why coverage is written into
 * the index rather than left to be guessed.
 *
 * OpenStreetMap is ODbL, the same terms as the Barrington data already in use.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { open as openShape } from 'shapefile';
import { simplifyCollection, countPoints } from '../lib/geo-simplify.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const CACHE = path.join(ROOT, 'data-sources/maps/downloads/osm-water');
const SEA = path.join(ROOT, 'data-sources/maps/downloads/osm-coastline/water-polygons-split-4326');
const PACK = path.join(ROOT, 'packs/basemap.sqlite');
const OUT = path.join(ROOT, 'apps/pwa-polished/public/atlas');

/**
 * Fine, because the whole point is the last kilometre. Four decimals is about
 * eleven metres at this latitude, which is finer than any shoreline is known.
 */
const TUNING = { decimals: 4, tolerance: 0.00015, minArea: 0.0000004 };

/** Under this, it is a farm pond and not worth a name or the bytes. */
const MIN_AREA_SQ_DEG = 0.0000045;   // ~0.05 km² near the Levant

// ---------------------------------------------------------------- stitching

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/**
 * Join a relation's member ways end-to-end into rings.
 *
 * A multipolygon relation arrives as a bag of unordered fragments pointing
 * whichever way they were drawn, so each has to be tried at both ends and both
 * directions until the ring closes.
 */
function ringsFrom(members) {
  const segs = members
    .filter((m) => m.geometry && m.geometry.length)
    .map((m) => m.geometry.map((p) => [p.lon, p.lat]));

  const rings = [];
  while (segs.length) {
    let ring = segs.shift().slice();
    let joined = true;
    while (joined && !same(ring[0], ring[ring.length - 1])) {
      joined = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const head = ring[0];
        const tail = ring[ring.length - 1];
        if (same(tail, s[0]))                 { ring = ring.concat(s.slice(1)); }
        else if (same(tail, s[s.length - 1])) { ring = ring.concat(s.slice().reverse().slice(1)); }
        else if (same(head, s[s.length - 1])) { ring = s.slice(0, -1).concat(ring); }
        else if (same(head, s[0]))            { ring = s.slice().reverse().slice(0, -1).concat(ring); }
        else continue;
        segs.splice(i, 1);
        joined = true;
        break;
      }
    }
    // An unclosed ring is a fragment cut by the bounding box, not a shape.
    if (ring.length > 3 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

/** Shoelace area in square degrees — for ranking and thresholds, not measurement. */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(a / 2);
}

/** Inner rings are the islands; whichever ring encloses the most is the outer one. */
function toPolygons(outerRings, innerRings) {
  return outerRings
    .map((outer) => [outer, ...innerRings.filter((inner) => ringArea(inner) < ringArea(outer))])
    .filter((poly) => ringArea(poly[0]) >= MIN_AREA_SQ_DEG);
}

// ------------------------------------------------------------------- read in

if (!fs.existsSync(CACHE)) {
  console.error(`nothing harvested yet — run fetch-osm-water.mjs first`);
  process.exit(1);
}

const files = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json'));
console.log(`${files.length} harvested boxes`);

/** OSM ids, so a lake straddling two boxes is not drawn twice. */
const seenWater = new Set();
const seenCoast = new Set();
const water = [];
const coast = [];
const covered = [];

const nameFor = (t = {}) => t['name:en'] || t.name || null;

for (const file of files) {
  const m = file.match(/^osm_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)\.json$/);
  if (m) covered.push([Number(m[2]), Number(m[1]), Number(m[4]), Number(m[3])]); // w,s,e,n

  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(CACHE, file), 'utf8'));
  } catch {
    console.log(`  ${file} unreadable, skipped`);
    continue;
  }

  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const key = `${el.type}/${el.id}`;

    if (tags.natural === 'coastline') {
      if (seenCoast.has(key)) continue;
      seenCoast.add(key);
      const line = (el.geometry ?? []).filter(Boolean).map((p) => [p.lon, p.lat]);
      if (line.length > 1) {
        coast.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
      }
      continue;
    }

    if (seenWater.has(key)) continue;
    seenWater.add(key);

    let polys = [];
    if (el.type === 'way') {
      const ring = (el.geometry ?? []).filter(Boolean).map((p) => [p.lon, p.lat]);
      if (ring.length > 3 && same(ring[0], ring[ring.length - 1]) && ringArea(ring) >= MIN_AREA_SQ_DEG) {
        polys = [[ring]];
      }
    } else if (el.type === 'relation') {
      const members = el.members ?? [];
      polys = toPolygons(
        ringsFrom(members.filter((x) => x.role !== 'inner')),
        ringsFrom(members.filter((x) => x.role === 'inner')),
      );
    }
    if (!polys.length) continue;

    water.push({
      type: 'Feature',
      properties: { name: nameFor(tags) },
      geometry: polys.length === 1
        ? { type: 'Polygon', coordinates: polys[0] }
        : { type: 'MultiPolygon', coordinates: polys },
    });
  }
}

console.log(`  ${water.length} water bodies, ${coast.length} shoreline runs`);

// --------------------------------------------------------------- the sea

/**
 * Ground worth the finest treatment: the one-degree cells holding a place
 * Scripture names. The same rule the harvest used, recomputed here because the
 * sea comes from a file rather than from the harvest and need not be limited to
 * what a busy server was willing to give.
 */
function cellsWithPlaces() {
  const places = JSON.parse(fs.readFileSync(path.join(OUT, 'biblical-places.json'), 'utf8'));
  const seen = new Set();
  for (const p of places) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    seen.add(`${Math.floor(p.x)},${Math.floor(p.y)}`);
  }
  // A tenth of a degree past the edge, so a shore right on a boundary is whole.
  return [...seen].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return [x - 0.1, y - 0.1, x + 1.1, y + 1.1];
  });
}

function bboxOf(g) {
  let w = 180, s = 90, e = -180, n = -90, seen = false;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      seen = true;
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
      return;
    }
    for (const x of c) walk(x);
  };
  walk(g.coordinates);
  return seen ? [w, s, e, n] : null;
}

const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * The sea, as filled shapes rather than a line.
 *
 * A shoreline drawn as a line does not say which side is wet, and the fourteen
 * harbour towns sitting out at sea need exactly that. Closing coastline into sea
 * polygons is the fiddly part of this job — rings have to be cut and closed
 * against each edge, and getting it subtly wrong puts a town on the wrong side
 * of the water — so the closing is not done here. It arrives already done, from
 * the OpenStreetMap project's own coastline product, which exists because
 * everyone who needs this needs it correct.
 */
async function readSea(cells) {
  const shp = path.join(SEA, 'water_polygons.shp');
  if (!fs.existsSync(shp)) {
    console.log('  (no coastline download — sea skipped)');
    return [];
  }
  const src = await openShape(shp, path.join(SEA, 'water_polygons.dbf'), { encoding: 'utf8' });
  const kept = [];
  let read = 0;
  for (let r = await src.read(); !r.done; r = await src.read()) {
    read++;
    const g = r.value?.geometry;
    if (!g) continue;
    const bbox = bboxOf(g);
    if (!bbox || !cells.some((c) => overlaps(bbox, c))) continue;
    kept.push({ type: 'Feature', properties: {}, geometry: g });
  }
  console.log(`  sea: ${kept.length} pieces of ${read.toLocaleString()} worldwide`);
  return kept;
}

/**
 * Lakes the harvest never reached, so that switching to this level never makes
 * a lake disappear. Inside a harvested box the OpenStreetMap outline wins;
 * everywhere else the coarse one is carried across unchanged — coarse is worse
 * than accurate but far better than absent.
 */
function coarseLakesOutside(harvested) {
  const row = db.prepare("SELECT geojson FROM basemap_layers WHERE kind='lakes' AND detail=10").get();
  if (!row) return [];
  const fc = JSON.parse(row.geojson);
  return fc.features.filter((ft) => {
    const bbox = ft.geometry && bboxOf(ft.geometry);
    return bbox && !harvested.some((h) => overlaps(bbox, h));
  });
}

// ------------------------------------------------------------------- write

/**
 * Detail 1 lives in the same table as 110, 50 and 10, so the map's own
 * detail-by-zoom finds it without learning anything new. Rebuilt in place
 * rather than appended, so running this twice does not double the map.
 */
const db = new Database(PACK);
db.prepare('DELETE FROM basemap_layers WHERE detail = 1').run();
const insLayer = db.prepare('INSERT INTO basemap_layers (id, kind, detail, title, geojson) VALUES (?,?,?,?,?)');

function store(kind, title, features, tuning = TUNING) {
  const fc = simplifyCollection({ type: 'FeatureCollection', features }, { ...tuning, keepProps: ['name'] });
  const json = JSON.stringify(fc);
  insLayer.run(`${kind}@1`, kind, 1, title, json);
  console.log(`  ${kind.padEnd(11)} ${String(fc.features.length).padStart(6)} feats  ${String(countPoints(fc).toLocaleString()).padStart(9)} pts  ${(json.length / 1e6).toFixed(2)} MB`);
  return json.length;
}

/**
 * The sea is one enormous smooth boundary, so it can be generalised harder than
 * a lake without anyone seeing it: forty-odd metres, against the kilometre it
 * replaces.
 */
const SEA_TUNING = { decimals: 4, tolerance: 0.0004, minArea: 0.0000004 };

const cells = cellsWithPlaces();
console.log('');
let bytes = 0;

const sea = await readSea(cells);
bytes += store('ocean', 'Sea (OSM)', sea, SEA_TUNING);
bytes += store('lakes', 'Lakes (OSM)', [...water, ...coarseLakesOutside(covered)]);

/**
 * Where this level has anything to say. Without it the map would switch to a
 * detail that is empty over most of the world and the sea would vanish.
 *
 * It belongs in the pack rather than beside the exported files, because the
 * exporter clears what it owns before it writes.
 */
db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?,?)')
  .run('detail1_coverage', JSON.stringify(sea.length ? cells : covered));
db.close();

console.log(`  coverage    ${(sea.length ? cells : covered).length} boxes`);
console.log('');
console.log(`total ${(bytes / 1e6).toFixed(2)} MB written to the basemap pack at detail 1`);
console.log('run export-lab-layers.mjs to publish it to the lab');
