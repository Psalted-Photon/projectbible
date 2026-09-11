#!/usr/bin/env node
/**
 * Split the packs into one file per layer for the lab.
 *
 * The app will query the sqlite pack directly; the lab is a plain page, so it
 * fetches the same slices over HTTP. Splitting them is what makes detail-by-zoom
 * real — the world view pulls 110m and nothing else until the reader zooms in.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const OUT = path.join(ROOT, 'apps/pwa-polished/public/atlas');
fs.mkdirSync(OUT, { recursive: true });

/**
 * Clear only what this script writes.
 *
 * It used to empty the whole folder, which quietly destroyed the work of every
 * other builder that writes there — the biblical places, the ancient names, the
 * search index — leaving a lab that loaded and then failed on the first tap.
 * Anything not matching these is somebody else's and is left alone.
 */
const MINE = /^(base-|points-|ov-|index\.json$)/;

// Read before clearing, or the merge at the end has nothing left to merge with.
const indexPath = path.join(OUT, 'index.json');
let existing = {};
if (fs.existsSync(indexPath)) {
  try {
    existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    existing = {};
  }
}

for (const f of fs.readdirSync(OUT)) {
  if (MINE.test(f)) fs.rmSync(path.join(OUT, f), { force: true });
}

const mb = (n) => (n / 1e6).toFixed(2);
const index = { basemap: {}, points: {}, eras: [], overlays: {} };

// ---- basemap ----
const base = new Database(path.join(ROOT, 'packs/basemap.sqlite'), { readonly: true });
for (const row of base.prepare('SELECT id, kind, detail, title, geojson FROM basemap_layers').all()) {
  const file = `base-${row.kind}-${row.detail}.json`;
  fs.writeFileSync(path.join(OUT, file), row.geojson);
  (index.basemap[row.kind] ??= {})[row.detail] = { file, title: row.title, bytes: row.geojson.length };
}
for (const kind of ['peak', 'city']) {
  const rows = base.prepare('SELECT name, lat, lon, elevation, country, population, rank FROM basemap_points WHERE kind=? ORDER BY rank').all(kind);
  const file = `points-${kind}.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(rows));
  index.points[kind] = { file, count: rows.length };
}
index.basemapAttribution = base.prepare("SELECT value v FROM metadata WHERE key='attribution'").get()?.v ?? '';

// The ground where detail 1 has fine water. The map needs it to know when it
// may switch down; without it there is nothing to draw beyond the harvest.
const coverage = base.prepare("SELECT value v FROM metadata WHERE key='detail1_coverage'").get()?.v;
if (coverage) {
  fs.writeFileSync(path.join(OUT, 'base-detail1-coverage.json'), JSON.stringify({ boxes: JSON.parse(coverage) }));
  index.detail1Coverage = { file: 'base-detail1-coverage.json', boxes: JSON.parse(coverage).length };
}
base.close();

// ---- historical overlay (eras built earlier) ----
const atlasPath = path.join(ROOT, 'packs/atlas.sqlite');
if (fs.existsSync(atlasPath)) {
  const atlas = new Database(atlasPath, { readonly: true });
  index.eras = atlas.prepare('SELECT * FROM atlas_eras ORDER BY sort_order').all();
  for (const row of atlas.prepare('SELECT id, era_id, kind, title, geojson FROM atlas_layers').all()) {
    const file = `ov-${row.id}.json`;
    fs.writeFileSync(path.join(OUT, file), row.geojson);
    (index.overlays[row.era_id ?? '_always'] ??= []).push({ id: row.id, kind: row.kind, title: row.title, file });
  }
  const places = atlas.prepare('SELECT era_id, name, lat, lon, kind, verses FROM atlas_places').all();
  fs.writeFileSync(path.join(OUT, 'ov-places.json'), JSON.stringify(places));
  index.overlayPlaces = { file: 'ov-places.json', count: places.length };
  index.overlayAttribution = atlas.prepare("SELECT value v FROM metadata WHERE key='attribution'").get()?.v ?? '';
  atlas.close();
}

/**
 * Merge rather than replace.
 *
 * Other builders add their own entries here — the biblical places, the ancient
 * names, the search index — and writing this file from scratch silently dropped
 * every one of them, leaving a lab that started and then died looking for a
 * file the index no longer mentioned. Only the keys this script owns are
 * overwritten; anything else already recorded is carried through.
 */
fs.writeFileSync(indexPath, JSON.stringify({ ...existing, ...index }, null, 1));

let total = 0;
for (const f of fs.readdirSync(OUT)) total += fs.statSync(path.join(OUT, f)).size;
console.log(`${fs.readdirSync(OUT).length} files, ${mb(total)} MB -> ${OUT}`);
for (const d of [110, 50, 10]) {
  let n = 0;
  for (const kind of Object.keys(index.basemap)) n += index.basemap[kind][d]?.bytes ?? 0;
  console.log(`  ${d}m basemap: ${mb(n)} MB`);
}
