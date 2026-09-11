/**
 * Build a self-contained preview page for viewing on a phone.
 *
 * The lab loads a 9.8 MB JSON from the dev server; a published page has to
 * carry its data inside itself and survive a mobile connection. So this crops
 * to the biblical world, simplifies harder, and trims labels — enough to judge
 * the look and the scrub, not the shipping pack.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { simplifyCollection } from '../lib/geo-simplify.mjs';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../..'
);

/** The world the Bible actually moves through — Spain to Persia, Nubia to the Black Sea. */
const CROP = { west: -11, south: 11, east: 66, north: 49 };

/** Coarser than the real pack: this is a look-and-feel preview on a small screen. */
const COARSE = { decimals: 3, tolerance: 0.02, minArea: 0.004, keepProps: [] };
const REGION = {
  decimals: 3,
  tolerance: 0.01,
  minArea: 0,
  keepProps: ['name', 'kind', 'verses', 'bands'],
};

const db = new Database(path.join(ROOT, 'packs/atlas.sqlite'), { readonly: true });

/** Keep a feature only if some part of it falls inside the crop. */
function inCrop(geom) {
  let hit = false;
  const walk = (c) => {
    if (hit) return;
    if (typeof c[0] === 'number') {
      if (c[0] >= CROP.west && c[0] <= CROP.east && c[1] >= CROP.south && c[1] <= CROP.north) hit = true;
      return;
    }
    for (const part of c) walk(part);
  };
  if (geom?.coordinates) walk(geom.coordinates);
  return hit;
}

const crop = (fc) => ({
  type: 'FeatureCollection',
  features: fc.features.filter((f) => inCrop(f.geometry)),
});

const eras = db.prepare('SELECT * FROM atlas_eras ORDER BY sort_order').all();

const layers = [];
for (const row of db.prepare("SELECT id, era_id, kind, geojson FROM atlas_layers WHERE kind <> 'overlay'").all()) {
  const opts = row.kind === 'region' ? REGION : COARSE;
  const out = simplifyCollection(crop(JSON.parse(row.geojson)), opts);
  if (!out.features.length) continue;
  layers.push({ id: row.id, era_id: row.era_id, kind: row.kind, geojson: out });
}

/** Fewer, bigger names — a phone can't carry forty labels legibly. */
const places = db
  .prepare(
    `SELECT era_id, name, lat, lon, verses FROM atlas_places
     WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
  )
  .all(CROP.south, CROP.north, CROP.west, CROP.east);

const topPlaces = [];
for (const era of eras) {
  topPlaces.push(
    ...places
      .filter((p) => p.era_id === era.id)
      .sort((a, b) => b.verses - a.verses)
      .slice(0, 14)
      .map((p) => ({
        e: p.era_id,
        n: p.name,
        y: Math.round(p.lat * 1000) / 1000,
        x: Math.round(p.lon * 1000) / 1000,
      }))
  );
}

const payload = {
  eras: eras.map((e) => ({
    id: e.id,
    title: e.title,
    subtitle: e.subtitle,
    y0: e.year_start,
    y1: e.year_end,
    conf: e.confidence,
    blurb: e.blurb,
  })),
  layers,
  places: topPlaces,
  crop: CROP,
  attribution: db.prepare("SELECT value FROM metadata WHERE key='attribution'").get()?.value ?? '',
};

const json = JSON.stringify(payload);
const dest = path.join(ROOT, 'scripts/atlas/phone-preview-data.json');
fs.writeFileSync(dest, json);

console.log(`eras   ${payload.eras.length}`);
console.log(`layers ${layers.length}`);
console.log(`places ${topPlaces.length}`);
console.log(`size   ${(json.length / 1e6).toFixed(2)} MB`);
