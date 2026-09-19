#!/usr/bin/env node
/**
 * Read-only measurement of how the drawn legs sit against the stops.
 *
 * This is a reporter, not a check: it asserts nothing and always exits 0. Its
 * job is to make the geometry problem measurable before it is fixed, and to
 * show the fix landed afterwards. Nothing else reads its output.
 *
 * It answers four questions per journey:
 *
 *   orientation   does the leg run in travel order, or backwards?
 *   ordering      do the legs, in stored order, follow the stop sequence?
 *   chain breaks  how far is one leg's end from the next leg's start?
 *   anchors       how far is the first leg's start from stop 1, and the
 *                 last leg's end from the final stop?
 *
 * Orientation is derived the way the builder is about to derive it, so running
 * this before and after the builder change shows the same measurement moving.
 * The derivation lives in journey-geometry.mjs and is imported rather than
 * copied — a reporter that reimplemented it could agree with itself while both
 * were wrong.
 *
 * Run: node scripts/atlas/checks/journeys-geometry-report.mjs
 */

import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { haversineKm, orientLegs, nearestOnLeg } from '../journey-geometry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PACK = join(ROOT, 'packs', 'consolidated', 'atlas-map.sqlite');

if (!existsSync(PACK)) {
  console.error(`No pack at ${PACK} — run the atlas build first.`);
  process.exit(1);
}

const db = new Database(PACK, { readonly: true });

const journeys = db
  .prepare('SELECT id, name, testament, sort_order FROM atlas_journeys ORDER BY testament DESC, sort_order')
  .all();

const stopsOf = db.prepare(
  'SELECT seq, place_id, name, lat, lon, travel_method FROM atlas_journey_stops WHERE journey_id = ? ORDER BY seq'
);
const geometryOf = db.prepare('SELECT data FROM atlas_journey_geometry WHERE journey_id = ?');

/** Every stop→line distance across every journey, for the closing distribution. */
const allStopDistances = [];
let backwards = 0;
let totalLegs = 0;
const weakAnchors = [];

for (const journey of journeys) {
  const stops = stopsOf.all(journey.id);
  const row = geometryOf.get(journey.id);
  if (!row) {
    console.log(`\n${journey.name}: no geometry\n`);
    continue;
  }
  const legs = JSON.parse(gunzipSync(row.data).toString('utf8'));

  console.log(`\n── ${journey.name}  (${stops.length} stops, ${legs.length} legs)`);

  // What the derivation would choose for these legs, as they are stored now.
  const decided = orientLegs(legs, stops);

  decided.forEach((d, i) => {
    totalLegs++;
    if (d.flip) backwards++;
    if (d.weak) weakAnchors.push(`${journey.id} leg ${i + 1}`);
    const span = d.touched.length
      ? `stops ${d.touched[0].seq}→${d.touched[d.touched.length - 1].seq}`
      : 'no stop within range';
    console.log(
      `   leg ${String(i + 1).padStart(2)}  ${String(legs[i].length).padStart(4)} pts  ` +
        `${span}${d.flip ? '   BACKWARDS' : ''}${d.weak ? '   (weak anchor)' : ''}`
    );
  });

  // Chain breaks in the order the legs are stored, which is what draws today.
  const breaks = [];
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1][legs[i - 1].length - 1];
    const next = legs[i][0];
    breaks.push(Math.round(haversineKm(prev[1], prev[0], next[1], next[0])));
  }
  if (breaks.length) console.log(`   chain breaks (stored order): ${breaks.join('/')} km`);

  // Anchors: first leg start to stop 1, last leg end to the final stop.
  const first = legs[0][0];
  const last = legs[legs.length - 1][legs[legs.length - 1].length - 1];
  const s1 = stops[0];
  const sn = stops[stops.length - 1];
  console.log(
    `   anchor start ${Math.round(haversineKm(s1.lat, s1.lon, first[1], first[0]))} km to ${s1.name}, ` +
      `end ${Math.round(haversineKm(sn.lat, sn.lon, last[1], last[0]))} km to ${sn.name}`
  );

  // Every stop against the whole journey's line.
  const far = [];
  for (const stop of stops) {
    let nearest = Infinity;
    for (const leg of legs) {
      const d = nearestOnLeg(stop, leg).km;
      if (d < nearest) nearest = d;
    }
    allStopDistances.push(nearest);
    if (nearest > 10) far.push(`${stop.name} ${nearest.toFixed(0)}`);
  }
  if (far.length) console.log(`   stops over 10 km from the line: ${far.join(', ')}`);
}

const sorted = allStopDistances.slice().sort((a, b) => a - b);
const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

console.log(`\n${'─'.repeat(64)}`);
console.log(`legs ${totalLegs}, of which ${backwards} would be reversed by derivation`);
if (weakAnchors.length) {
  console.log(`weak anchors (fewer than 2 stops in range): ${weakAnchors.join(', ')}`);
}
console.log(
  `stop→line  median ${at(0.5).toFixed(1)} km   p90 ${at(0.9).toFixed(1)} km   ` +
    `max ${sorted[sorted.length - 1].toFixed(1)} km   over 10 km: ${sorted.filter((d) => d > 10).length}/${sorted.length}`
);

db.close();
