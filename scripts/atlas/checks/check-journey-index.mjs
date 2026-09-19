#!/usr/bin/env node
/**
 * Validate journey-index.json against the two things it makes claims about:
 * the UBS route files, and atlas_biblical_places.
 *
 * Phase 3's builder fails loudly on an unresolved place id — a silent miss puts
 * a stop at 0,0 in the Gulf of Guinea. This runs the same checks at authoring
 * time, so the index is known good before anything is built from it.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '../../..'
);
const DIR = path.join(ROOT, 'data-sources/maps/journeys');
const PACK = path.join(ROOT, 'apps/pwa-polished/public/packs/consolidated/atlas-map.sqlite');

const index = JSON.parse(fs.readFileSync(path.join(DIR, 'journey-index.json'), 'utf8'));
const db = new Database(PACK, { readonly: true });
const place = db.prepare('SELECT id, name, lat, lon FROM atlas_biblical_places WHERE id = ?');

const errors = [];
const warnings = [];
const seenIds = new Set();
const seenColours = new Map();

function segmentsOf(file) {
  const p = path.join(DIR, index.source_dir, file);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const feats = j.type === 'FeatureCollection' ? j.features : [j];
  return feats
    .filter((f) => f && f.geometry && f.geometry.type === 'LineString')
    .map((f) => f.geometry.coordinates);
}

const km = (a, b) => {
  const dx = (a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dx, a[1] - b[1]) * 111;
};

console.log(`${index.journeys.length} journeys\n`);

for (const j of index.journeys) {
  const where = j.id || '(no id)';

  if (seenIds.has(j.id)) errors.push(`${where}: duplicate journey id`);
  seenIds.add(j.id);

  for (const f of ['id', 'name', 'traveller', 'dates', 'testament', 'colour', 'description']) {
    if (!j[f]) errors.push(`${where}: empty ${f}`);
  }
  if (!['old', 'new'].includes(j.testament)) errors.push(`${where}: testament "${j.testament}"`);
  if (!/^#[0-9a-f]{6}$/i.test(j.colour || '')) errors.push(`${where}: colour "${j.colour}" is not #rrggbb`);
  if (seenColours.has(j.colour)) warnings.push(`${where}: shares colour ${j.colour} with ${seenColours.get(j.colour)}`);
  seenColours.set(j.colour, j.id);

  // Geometry: the file must exist and every segment index must be in range.
  let totalPts = 0;
  for (const src of j.source || []) {
    const segs = segmentsOf(src.file);
    if (segs === null) { errors.push(`${where}: missing file ${src.file}`); continue; }
    for (const s of src.segments) {
      if (!Number.isInteger(s) || s < 0 || s >= segs.length) {
        errors.push(`${where}: ${src.file} has ${segs.length} segments, index ${s} out of range`);
      } else {
        totalPts += segs[s].length;
      }
    }
    for (const r of src.reverse || []) {
      if (!src.segments.includes(r)) errors.push(`${where}: ${src.file} reverses segment ${r} it does not use`);
    }
    const dupes = src.segments.filter((s, i) => src.segments.indexOf(s) !== i);
    if (dupes.length) warnings.push(`${where}: ${src.file} uses segment ${dupes.join(',')} more than once`);
  }
  if (!totalPts) errors.push(`${where}: no geometry at all`);

  // Stops: every place_id must resolve, or Phase 3 puts a dot in the ocean.
  const coords = [];
  for (const st of j.stops || []) {
    const row = place.get(st.place_id);
    if (!row) { errors.push(`${where}: place_id "${st.place_id}" does not resolve`); continue; }
    if (!st.by) errors.push(`${where}: stop ${st.place_id} has no travel method`);
    if (!st.note) warnings.push(`${where}: stop ${st.place_id} has no note`);
    coords.push([row.lon, row.lat]);
  }
  if ((j.stops || []).length < 2) errors.push(`${where}: fewer than 2 stops`);

  // Does the drawn line actually go near the stops we claim? A route mapped to
  // the wrong file would pass every check above and still be nonsense.
  let worst = 0, worstStop = '';
  const allPts = (j.source || []).flatMap((src) => {
    const segs = segmentsOf(src.file) || [];
    return src.segments.filter((s) => segs[s]).flatMap((s) => segs[s]);
  });
  if (allPts.length) {
    (j.stops || []).forEach((st, i) => {
      const c = coords[i];
      if (!c) return;
      let best = Infinity;
      for (const p of allPts) { const d = km(c, p); if (d < best) best = d; }
      if (best > worst) { worst = best; worstStop = st.place_id; }
    });
  }
  const flag = worst > 120 ? '  <-- FAR' : '';
  if (worst > 120) warnings.push(`${where}: stop ${worstStop} is ${worst.toFixed(0)} km from the drawn line`);

  const methods = [...new Set((j.stops || []).map((s) => s.by))].join('/');
  console.log(
    `  ${j.testament === 'old' ? 'OT' : 'NT'}${j.sort_order} ${j.name}\n` +
    `     ${j.stops.length} stops, ${totalPts} pts, ${j.colour}, by ${methods}` +
    `, furthest stop ${worst.toFixed(0)} km from line${flag}`
  );
}

db.close();

console.log();
if (warnings.length) {
  console.log(`${warnings.length} warning(s):`);
  warnings.forEach((w) => console.log(`  ! ${w}`));
  console.log();
}
if (errors.length) {
  console.error(`${errors.length} error(s):`);
  errors.forEach((e) => console.error(`  X ${e}`));
  process.exit(1);
}
console.log('journey-index.json OK');
