#!/usr/bin/env node
/**
 * Build basemap.sqlite — the rendered world the map draws when it isn't using
 * Esri's tiles, and the ground every overlay reads against.
 *
 * Natural Earth, public domain. It ships the same world at three
 * generalisations, so the map can hold coarse shapes at world zoom and swap to
 * finer ones as the reader comes in, instead of drawing every fjord in Norway
 * to fill forty pixels.
 *
 *   110m  world view      fast, coarse
 *    50m  regional view
 *    10m  close view      every bay and island
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { open } from 'shapefile';
import { simplifyCollection, countPoints } from '../lib/geo-simplify.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const SRC = path.join(ROOT, 'data-sources/maps/downloads/natural-earth/extracted');
const OUT = path.join(ROOT, 'packs/basemap.sqlite');

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
const log = (...a) => console.log(...a);

/**
 * Natural Earth is already generalised per level, so this only strips float
 * noise and specks — the shapes themselves are left as the cartographers drew
 * them.
 */
const TUNING = {
  110: { decimals: 3, tolerance: 0.01, minArea: 0.002 },
  50:  { decimals: 3, tolerance: 0.004, minArea: 0.0004 },
  10:  { decimals: 4, tolerance: 0.0008, minArea: 0.00002 },
};

/** Layers to carry, and which attributes are worth the bytes. */
const LAYERS = [
  { kind: 'ocean',     file: 'ocean',                            title: 'Ocean',            props: [] },
  { kind: 'land',      file: 'land',                             title: 'Land',             props: [] },
  { kind: 'lakes',     file: 'lakes',                            title: 'Lakes',            props: ['name'] },
  { kind: 'rivers',    file: 'rivers_lake_centerlines',          title: 'Rivers',           props: ['name'] },
  { kind: 'coastline', file: 'coastline',                        title: 'Coastline',        props: [] },
  { kind: 'terrain',   file: 'geography_regions_polys',          title: 'Ranges & deserts', props: ['NAME', 'FEATURECLA'] },
  { kind: 'marine',    file: 'geography_marine_polys',           title: 'Seas',             props: ['name'] },
  { kind: 'countries', file: 'admin_0_countries',                title: 'Countries',        props: ['NAME', 'ADMIN', 'CONTINENT'] },
];

if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
const db = new Database(OUT);
db.pragma('journal_mode = OFF');
db.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE basemap_layers (
    id      TEXT PRIMARY KEY,
    kind    TEXT NOT NULL,
    detail  INTEGER NOT NULL,   -- 110 | 50 | 10
    title   TEXT NOT NULL,
    geojson TEXT NOT NULL
  );
  CREATE INDEX idx_base_kind ON basemap_layers(kind, detail);

  CREATE TABLE basemap_points (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,   -- peak | city
    name       TEXT NOT NULL,
    lat        REAL NOT NULL,
    lon        REAL NOT NULL,
    elevation  INTEGER,
    country    TEXT,
    population INTEGER,
    rank       INTEGER
  );
  CREATE INDEX idx_pts_kind ON basemap_points(kind, rank);
  CREATE INDEX idx_pts_name ON basemap_points(name);
`);

const insLayer = db.prepare('INSERT INTO basemap_layers (id, kind, detail, title, geojson) VALUES (?,?,?,?,?)');
const insPoint = db.prepare('INSERT INTO basemap_points (kind, name, lat, lon, elevation, country, population, rank) VALUES (?,?,?,?,?,?,?,?)');

/** The .dbf carries UTF-8; without saying so, Mälaren arrives as MÃ¤laren. */
async function readShape(base) {
  const shp = path.join(SRC, `${base}.shp`);
  const dbf = path.join(SRC, `${base}.dbf`);
  if (!fs.existsSync(shp)) return null;
  const src = await open(shp, fs.existsSync(dbf) ? dbf : undefined, { encoding: 'utf8' });
  const features = [];
  for (let r = await src.read(); !r.done; r = await src.read()) {
    if (r.value?.geometry) features.push(r.value);
  }
  return { type: 'FeatureCollection', features };
}

const clean = (v) => (typeof v === 'string' ? v.trim() : v);

let total = 0;

for (const detail of [110, 50, 10]) {
  log(`\n── ${detail}m ──`);
  for (const layer of LAYERS) {
    const fc = await readShape(`ne_${detail}m_${layer.file}`);
    if (!fc) { log(`  ${layer.kind.padEnd(10)} (absent)`); continue; }

    for (const f of fc.features) {
      for (const k of Object.keys(f.properties ?? {})) f.properties[k] = clean(f.properties[k]);
    }

    const out = simplifyCollection(fc, { ...TUNING[detail], keepProps: layer.props });
    const json = JSON.stringify(out);
    total += json.length;
    insLayer.run(`${layer.kind}@${detail}`, layer.kind, detail, layer.title, json);
    log(`  ${layer.kind.padEnd(10)} ${String(out.features.length).padStart(6)} feats  ${String(countPoints(out).toLocaleString()).padStart(10)} pts  ${mb(json.length)}`);
  }
}

// The graticule is drawn, not generalised — one set of lines serves every zoom.
{
  const fc = await readShape('ne_10m_graticules_10');
  if (fc) {
    const out = simplifyCollection(fc, { decimals: 2, tolerance: 0, minArea: 0, keepProps: ['degrees', 'direction'] });
    const json = JSON.stringify(out);
    total += json.length;
    insLayer.run('graticule@0', 'graticule', 0, 'Grid', json);
    log(`\n  graticule  ${out.features.length} lines  ${mb(json.length)}`);
  }
}

// ---- points: peaks for drawn terrain, cities for labels and search ----
log('\n── points ──');
{
  const peaks = await readShape('ne_10m_geography_regions_elevation_points');
  let n = 0;
  for (const f of peaks?.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    insPoint.run('peak', clean(p.name) || '(unnamed)', lat, lon, p.elevation ?? null, null, null, p.scalerank ?? 99);
    n++;
  }
  log(`  peaks  ${n}`);
}
{
  const cities = await readShape('ne_10m_populated_places');
  let n = 0;
  for (const f of cities?.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    insPoint.run('city', clean(p.NAME) || '(unnamed)', lat, lon, null, clean(p.ADM0NAME) ?? null, p.POP_MAX ?? null, p.SCALERANK ?? 99);
    n++;
  }
  log(`  cities ${n}`);
}

const meta = db.prepare('INSERT INTO metadata (key, value) VALUES (?,?)');
for (const [k, v] of Object.entries({
  id: 'basemap',
  name: 'World Basemap',
  version: '1',
  description: 'A drawn world map at three levels of detail, for offline use and as the ground beneath historical overlays.',
  attribution: 'Map data from Natural Earth (public domain).',
  built: new Date().toISOString(),
})) meta.run(k, v);

db.close();
log(`\ntotal geojson: ${mb(total)}`);
log(`file: ${mb(fs.statSync(OUT).size)}  ->  ${OUT}`);
