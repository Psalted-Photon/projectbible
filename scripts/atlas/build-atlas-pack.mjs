#!/usr/bin/env node
/**
 * Build atlas.sqlite — the timeline of historical maps.
 *
 * Three kinds of thing go in:
 *
 *   base       the physical world, shared by every era: ancient coastlines and
 *              inland water from AWMC. This is what makes each era a map of its
 *              own time rather than today's world with shapes on top.
 *   territory  political extents from the Barrington Atlas, for the eras where
 *              real surveyed borders exist (Persia onward).
 *   region     for earlier eras, where no one knows where the borders ran: the
 *              lands Scripture names in that period, drawn from OpenBible as
 *              probability bands rather than invented lines.
 *   overlay    roads, walls, aqueducts and cities, available on any era.
 *
 * Sources and licences, both attribution-only:
 *   AWMC / Barrington Atlas  — ODbL 1.0
 *   OpenBible.info           — CC BY 4.0
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { ERAS } from './eras.mjs';
import { simplifyCollection, countPoints } from '../lib/geo-simplify.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const AWMC = path.join(ROOT, 'data-sources/maps/downloads/awmc/geodata');
const OB_GEOM = path.join(ROOT, 'data-sources/maps/downloads/openbible-geometry');
const OUT = path.join(ROOT, 'packs/atlas.sqlite');

/** Atlas zoom never needs survey precision; ~200 m is invisible here. */
const PHYSICAL = { decimals: 4, tolerance: 0.002, minArea: 0.00002, keepProps: [] };
const POLITICAL = { decimals: 4, tolerance: 0.0015, minArea: 0.00002, keepProps: [] };
const LINEWORK = { decimals: 4, tolerance: 0.002, keepProps: [] };

const log = (...a) => console.log(...a);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

// ---------------------------------------------------------------- schema

if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
const db = new Database(OUT);
db.pragma('journal_mode = OFF');
db.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE atlas_eras (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    subtitle    TEXT,
    year_start  INTEGER NOT NULL,
    year_end    INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL,
    confidence  TEXT NOT NULL,   -- 'attested' | 'approximate'
    blurb       TEXT,
    dating_note TEXT,            -- named when the dating itself is disputed
    books       TEXT             -- JSON: the biblical books that witness this era
  );

  CREATE TABLE atlas_layers (
    id          TEXT PRIMARY KEY,
    era_id      TEXT,            -- NULL = shown on every era
    kind        TEXT NOT NULL,   -- base | territory | region | overlay
    title       TEXT NOT NULL,
    source      TEXT NOT NULL,
    confidence  TEXT,
    sort_order  INTEGER DEFAULT 0,
    geojson     TEXT NOT NULL
  );
  CREATE INDEX idx_layers_era  ON atlas_layers(era_id);
  CREATE INDEX idx_layers_kind ON atlas_layers(kind);

  CREATE TABLE atlas_places (
    id        TEXT NOT NULL,
    era_id    TEXT NOT NULL,
    name      TEXT NOT NULL,
    lat       REAL NOT NULL,
    lon       REAL NOT NULL,
    kind      TEXT,
    verses    INTEGER DEFAULT 0,
    PRIMARY KEY (id, era_id)
  );
  CREATE INDEX idx_places_era ON atlas_places(era_id);
`);

const insLayer = db.prepare(
  'INSERT OR REPLACE INTO atlas_layers (id, era_id, kind, title, source, confidence, sort_order, geojson) VALUES (?,?,?,?,?,?,?,?)'
);
const insEra = db.prepare(
  'INSERT INTO atlas_eras (id, title, subtitle, year_start, year_end, sort_order, confidence, blurb, dating_note, books) VALUES (?,?,?,?,?,?,?,?,?,?)'
);
const insPlace = db.prepare(
  'INSERT OR REPLACE INTO atlas_places (id, era_id, name, lat, lon, kind, verses) VALUES (?,?,?,?,?,?,?)'
);

let totalBytes = 0;
function addLayer(id, eraId, kind, title, source, confidence, order, fc) {
  const json = JSON.stringify(fc);
  totalBytes += json.length;
  insLayer.run(id, eraId, kind, title, source, confidence, order, json);
  return json.length;
}

// ------------------------------------- the overlay's own physical world

/**
 * The historical overlay carries its own geography so it can stand alone with
 * the basemap faded out.
 *
 * The shoreline is MultiLineString — drawn coast, not filled land. An earlier
 * build styled it as a fill, which paints nothing at all, and is why the first
 * attempt looked like wisps. As ink on a transparent overlay it is exactly the
 * right material.
 */
log('');
log("-- the overlay physical world (AWMC) --");
const OVERLAY_BASE = [
  ['coast', 'Ancient coastline', 'Physical Data/shoreline/shoreline.geojson', PHYSICAL],
  ['water', 'Inland water', 'Physical Data/inland_water/inland-water-OSM.geojson', PHYSICAL],
];
for (const [kind, title, rel, opts] of OVERLAY_BASE) {
  const src = readJson(path.join(AWMC, rel));
  const before = countPoints(src);
  const out = simplifyCollection(src, opts);
  const types = {};
  for (const f of out.features) types[f.geometry.type] = (types[f.geometry.type] || 0) + 1;
  const size = addLayer(`ov-${kind}`, null, kind, title, 'awmc', 'attested', 0, out);
  log(`  ${title.padEnd(18)} ${String(before.toLocaleString()).padStart(9)} -> ${countPoints(out).toLocaleString()} pts  ${mb(size)}  ${JSON.stringify(types)}`);
}

// ------------------------------------------------------------- territories

log('\n── political territory (Barrington Atlas) ──');
const POLITICAL_DIR = path.join(AWMC, 'Cultural-Data/political_shading');

// AWMC folders don't reliably match the file inside them — persian_extent holds
// extent_of_the_persian_empire.geojson, herod holds herods_kingdom.geojson —
// so find layers by filename rather than trusting the directory name.
const politicalFiles = new Map();
for (const dir of fs.readdirSync(POLITICAL_DIR)) {
  const full = path.join(POLITICAL_DIR, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const f of fs.readdirSync(full)) {
    if (f.endsWith('.geojson')) politicalFiles.set(f.replace(/\.geojson$/, ''), path.join(full, f));
  }
}

/**
 * The eleven regions of Italy, which arrive as bare numerals.
 *
 * Augustus divided Italy into these and Pliny lists them in order in the
 * Natural History; the numerals and the names are one published pair, not a
 * reconstruction. Checked before use: every region's centre falls where its
 * name belongs — I below Rome, III in the toe, IX on the Ligurian coast, X in
 * the north-east, XI beyond the Po.
 */
const ITALIAN_REGIONS = {
  I: 'Latium et Campania', II: 'Apulia et Calabria', III: 'Lucania et Bruttii',
  IV: 'Samnium', V: 'Picenum', VI: 'Umbria et Ager Gallicus', VII: 'Etruria',
  VIII: 'Aemilia', IX: 'Liguria', X: 'Venetia et Histria', XI: 'Transpadana',
};

/**
 * Roman provinces that arrive already named, from the Digital Atlas of the
 * Roman Empire — the same Barrington base as everything else here, in a version
 * where somebody filled the name column in.
 *
 * This is the AD 200 arrangement and is used only for the AD 200 era. Carrying
 * it back to the apostolic age would put Galatia and Cappadocia together a
 * century before they were joined, and Judaea at a size it did not yet have.
 */
const DARE_PROVINCES = path.join(ROOT, 'data-sources/maps/downloads/dare/roman-provinces-ad200.geojson');

function namedProvinces() {
  if (!fs.existsSync(DARE_PROVINCES)) return null;
  const fc = readJson(DARE_PROVINCES);
  for (const f of fc.features) {
    const raw = f.properties?.name ?? '';
    f.properties = { name: ITALIAN_REGIONS[raw] ?? raw };
  }
  return simplifyCollection(fc, { ...POLITICAL, keepProps: ['name'] });
}

for (const era of ERAS) {
  for (const [i, name] of (era.territory || []).entries()) {
    const file = politicalFiles.get(name);
    if (!file) {
      log(`  !! missing ${name}`);
      continue;
    }
    const out = simplifyCollection(readJson(file), POLITICAL);
    const size = addLayer(`terr-${era.id}-${i}`, era.id, 'territory', era.title, 'awmc', 'attested', i, out);
    log(`  ${era.id.padEnd(17)} ${name.slice(0, 38).padEnd(40)} ${out.features.length.toString().padStart(4)} feats  ${mb(size)}`);
  }

  if (era.namedProvinces) {
    const out = namedProvinces();
    if (!out) {
      log(`  !! ${era.id}: no province file — the era will draw unnamed`);
    } else {
      const order = (era.territory || []).length;
      const size = addLayer(`terr-${era.id}-${order}`, era.id, 'territory', era.title, 'dare', 'attested', order, out);
      const named = out.features.filter((f) => f.properties?.name).length;
      log(`  ${era.id.padEnd(17)} ${'named provinces (DARE)'.padEnd(40)} ${out.features.length.toString().padStart(4)} feats  ${mb(size)}  ${named} named`);
    }
  }
}

// ---------------------------------------------------------------- overlays

log('\n── overlays (available on any era) ──');
const OVERLAYS = [
  ['roads', 'Roman roads', 'Cultural-Data/roads/roads.geojson', LINEWORK],
  ['walls', 'City walls', 'Cultural-Data/walls/walls.geojson', LINEWORK],
  ['aqueducts', 'Aqueducts', 'Cultural-Data/aqueducts/aqueducts.geojson', LINEWORK],
  ['urban', 'Urban areas', 'Cultural-Data/urban_areas/urban_areas.geojson', POLITICAL],
];
for (const [id, title, rel, opts] of OVERLAYS) {
  const file = path.join(AWMC, rel);
  if (!fs.existsSync(file)) { log(`  !! missing ${rel}`); continue; }
  const out = simplifyCollection(readJson(file), opts);
  const size = addLayer(`overlay-${id}`, null, 'overlay', title, 'awmc', 'attested', 0, out);
  log(`  ${title.padEnd(14)} ${out.features.length.toString().padStart(6)} feats  ${mb(size)}`);
}


// ----------------------------------------------------- lands named in Scripture

/**
 * For eras with no surveyed borders, show the lands the text of that period
 * actually names. A land earns its place on the 700 BC map because Isaiah and
 * Kings name it, not because someone guessed a frontier.
 *
 * OpenBible's own format does the honest work here: `isobands` are nested
 * confidence rings, so drawing them stacked gives a gradient that is densest
 * where the evidence agrees and fades where it doesn't.
 */
log('');
log('── lands named in Scripture (OpenBible) ──');

const ob = new Database(path.join(ROOT, 'packs/openbible.sqlite'), { readonly: true });

/** Which books name each place, and how often. */
const versesByPlace = new Map();
for (const row of ob.prepare('SELECT place_id, osis FROM place_verses').all()) {
  const book = row.osis.split('.')[0];
  let m = versesByPlace.get(row.place_id);
  if (!m) versesByPlace.set(row.place_id, (m = new Map()));
  m.set(book, (m.get(book) || 0) + 1);
}

/** Resolve each place to its region shape and/or its point. */
const places = new Map();
for (const row of ob.prepare('SELECT id, friendly_id, identifications_json FROM ancient_places').all()) {
  if (!row.identifications_json) continue;
  let idents;
  try { idents = JSON.parse(row.identifications_json); } catch { continue; }

  const entry = { name: row.friendly_id, geomId: null, lat: null, lon: null, kind: null };
  for (const ident of idents || []) {
    for (const res of ident.resolutions || []) {
      if (!entry.kind) entry.kind = res.type || null;
      if (entry.lat == null && typeof res.lonlat === 'string') {
        const [lon, lat] = res.lonlat.split(',').map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { entry.lat = lat; entry.lon = lon; }
      }
      const shape = res.ancient_geometry;
      if (!entry.geomId && (shape === 'polygon' || shape === 'rough_boundary' || shape === 'isobands')) {
        const roles = res.geojson_roles || {};
        const role = roles.simplified_precise || roles.geometry || roles.precise;
        if (role?.id && fs.existsSync(path.join(OB_GEOM, `${role.id}.geojson`))) entry.geomId = role.id;
      }
    }
  }
  places.set(row.id, entry);
}

/** Strip OpenBible's disambiguation suffix: "Moab 1" reads as "Moab". */
const cleanName = (n) => n.replace(/\s+\d+$/, '');

for (const era of ERAS) {
  if (!era.books?.length) continue;
  const books = new Set(era.books);

  const regionFeatures = [];
  const seenGeom = new Set();
  let pointCount = 0;

  for (const [placeId, place] of places) {
    const byBook = versesByPlace.get(placeId);
    if (!byBook) continue;
    let verses = 0;
    for (const [book, n] of byBook) if (books.has(book)) verses += n;
    if (!verses) continue;

    if (place.geomId && !seenGeom.has(place.geomId)) {
      seenGeom.add(place.geomId);
      const raw = readJson(path.join(OB_GEOM, `${place.geomId}.geojson`));
      const geom = raw.geometry ?? raw;
      if (geom?.coordinates) {
        regionFeatures.push({
          type: 'Feature',
          properties: {
            name: cleanName(place.name),
            kind: place.kind || '',
            verses,
            bands: raw.properties?.format === 'isobands' ? 1 : 0,
            minConfidence: raw.properties?.min_confidence ?? null,
            maxConfidence: raw.properties?.max_confidence ?? null,
          },
          geometry: geom,
        });
      }
    }

    if (place.lat != null) {
      insPlace.run(placeId, era.id, cleanName(place.name), place.lat, place.lon, place.kind, verses);
      pointCount++;
    }
  }

  let size = 0;
  if (regionFeatures.length) {
    // Larger lands first, so small ones draw on top and stay clickable.
    regionFeatures.sort((a, b) => b.properties.verses - a.properties.verses);
    const fc = simplifyCollection(
      { type: 'FeatureCollection', features: regionFeatures },
      { decimals: 4, tolerance: 0.001, minArea: 0, keepProps: ['name', 'kind', 'verses', 'bands', 'minConfidence', 'maxConfidence'] }
    );
    size = addLayer(`region-${era.id}`, era.id, 'region', `Lands named in ${era.title}`, 'openbible', era.confidence, 1, fc);
  }

  log(`  ${era.id.padEnd(17)} ${String(regionFeatures.length).padStart(3)} lands  ${String(pointCount).padStart(4)} places  ${mb(size)}`);
}

ob.close();

// ------------------------------------------------------------------ metadata

const meta = db.prepare('INSERT INTO metadata (key, value) VALUES (?,?)');
for (const era of ERAS) {
  insEra.run(era.id, era.title, era.subtitle ?? null, era.yearStart, era.yearEnd,
             ERAS.indexOf(era), era.confidence, era.blurb ?? null, era.datingNote ?? null,
             JSON.stringify(era.books ?? []));
}
for (const [k, v] of Object.entries({
  id: 'atlas',
  name: 'Historical Atlas',
  version: '1',
  description: 'A timeline of the biblical world, from the patriarchs to the later Roman empire.',
  attribution: 'Ancient world geography © Ancient World Mapping Center (Barrington Atlas), ODbL 1.0. Biblical lands and places © OpenBible.info, CC BY 4.0.',
  sources: 'awmc,openbible',
  built: new Date().toISOString(),
})) meta.run(k, v);


db.close();
log(`\ntotal geojson: ${mb(totalBytes)}`);
log(`file: ${mb(fs.statSync(OUT).size)}  →  ${OUT}`);
