#!/usr/bin/env node
/**
 * Run the app's own place search against the real 562,524 rows.
 *
 * Not a reimplementation: this imports searchIn and boundsIn from the shipping
 * module and assembles the columns with the shipping columnsFrom, so what is
 * checked here is exactly what runs in the browser. Only the source of the
 * bytes differs — the pack file rather than IndexedDB.
 *
 * These queries are the ones that were wrong at some point and had to be fixed.
 * A ranking is the kind of thing that quietly regresses, and a map that is
 * 99.9% right is the bad outcome.
 *
 * Run: node --experimental-strip-types scripts/atlas/checks/place-search-check.mjs
 */

import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { columnsFrom } from '../../../apps/pwa-polished/src/lib/atlas/place-search.ts';
import { searchIn, boundsIn } from '../../../apps/pwa-polished/src/lib/atlas/place-search.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..', '..', '..', 'packs', 'consolidated', 'atlas-places.sqlite');

if (!existsSync(PACK)) {
  console.error('Missing atlas-places.sqlite — run scripts/atlas/build-atlas-packs.mjs first.');
  process.exit(1);
}

let checks = 0;
let failures = 0;
const ok = (label, extra = '') => { checks++; console.log(`  ok   ${label}${extra ? '  ' + extra : ''}`); };
const fail = (label, detail) => {
  checks++; failures++;
  console.log(`  FAIL ${label}`);
  if (detail) console.log(`       ${detail}`);
};

// ---------------------------------------------------------------- load

const db = new Database(PACK, { readonly: true });
const raw = new Map();
for (const row of db.prepare('SELECT name, data FROM atlas_place_columns').all()) {
  raw.set(row.name, new Uint8Array(gunzipSync(row.data)));
}
db.close();

const started = Date.now();
const cols = columnsFrom(raw);
console.log(`\nLoaded ${cols.rows.toLocaleString()} places in ${Date.now() - started} ms\n`);

const show = (h) =>
  h ? `${h.name}, ${h.admin1 || '—'}, ${h.country || '—'} (${h.fclass}${h.fcode ? '/' + h.fcode : ''}, pop ${h.population})` : 'nothing';

/** The first hit has to be this place. */
function top(query, expect, note = '') {
  const hits = searchIn(cols, query, 10);
  const h = hits[0];
  const matches =
    h &&
    (!expect.name || h.name === expect.name) &&
    (!expect.admin1 || h.admin1 === expect.admin1) &&
    (!expect.country || h.country === expect.country) &&
    (!expect.fclass || h.fclass === expect.fclass);
  if (matches) ok(`"${query}"${note ? ' — ' + note : ''}`, `→ ${show(h)}`);
  else fail(`"${query}" lands on the right place${note ? ' — ' + note : ''}`, `got ${show(h)}`);
}

console.log('Search — the queries that had to be fixed');

// Plain names.
top('tampa', { name: 'Tampa', admin1: 'Florida', country: 'United States' });
top('jerusalem', { name: 'Jerusalem', country: 'Israel' });
top('saint cloud', { name: 'Saint Cloud', admin1: 'Minnesota' });

// Abbreviations have to collapse onto the same request.
top('st cloud', { name: 'Saint Cloud' }, 'st = saint');
top('st. cloud', { name: 'Saint Cloud' }, 'punctuation ignored');

// A trailing region says which one.
top('saint cloud mn', { name: 'Saint Cloud', admin1: 'Minnesota' }, 'state abbreviation');
top('st cloud florida', { name: 'Saint Cloud', admin1: 'Florida' }, 'named state');

// The kind-word has to beat population, or every landmark loses to the town
// named after it.
top('grand canyon', { fclass: 'T', admin1: 'Arizona' }, 'the canyon, not the village');
top('mount carmel', { fclass: 'T' }, 'the ridge, not the Illinois town');
top('jordan river', { fclass: 'H' }, 'the river');
top('lake victoria', { fclass: 'H' }, 'the lake');

// Nothing is named "Tampa Bay" as a settlement, so the trailing word is
// dropped and the reader gets what they meant.
top('tampa bay', { admin1: 'Florida' }, 'falls back to Tampa');

// Mount Carmel: the Israeli ridge is what a Bible reader means, and the hint
// word is what gets them there past an Illinois town of 7,000.
top('mount carmel israel', { country: 'Israel' }, 'region narrows it');

// Mount Sinai is the exception worth stating out loud: GeoNames has no place
// named that. It calls the mountain Jabal Mūsá, and nothing carries "Mount
// Sinai" as a primary name. A Bible reader still finds it, because it is in the
// biblical places with the right coordinates — but not from this half of search.
{
  const modern = searchIn(cols, 'mount sinai', 10);
  const named = modern.filter((h) => h.name === 'Mount Sinai' && h.fclass === 'T');
  if (!named.length) {
    ok(
      '"mount sinai" — nothing modern is actually named that',
      `falls back to mountains in the Sinai (${show(modern[0])}); the real one is in the biblical places`
    );
  } else {
    fail('the Mount Sinai note is out of date', `the gazetteer now has ${show(named[0])} — drop this note`);
  }
}

console.log('\nRanking — ties broken by how widely a place is named');
{
  const hits = searchIn(cols, 'grand canyon', 10).filter((h) => h.fclass === 'T');
  if (hits.length >= 2 && hits[0].admin1 === 'Arizona') {
    ok('Arizona outranks the other Grand Canyons', `${show(hits[0])} then ${show(hits[1])}`);
  } else if (hits.length && hits[0].admin1 === 'Arizona') {
    ok('the Arizona Grand Canyon comes first', show(hits[0]));
  } else {
    fail('the Arizona Grand Canyon comes first', hits.map(show).join(' | '));
  }
}

console.log('\nSpeed — what a keystroke costs');
for (const q of ['jer', 'jerus', 'saint c', 'mount', 'tampa']) {
  const t0 = performance.now();
  const n = searchIn(cols, q, 40).length;
  const ms = performance.now() - t0;
  if (ms < 60) ok(`"${q}"`, `${ms.toFixed(1)} ms, ${n} hits`);
  else fail(`"${q}" answers within 60 ms`, `${ms.toFixed(1)} ms`);
}

console.log('\nDots — what the map draws inside a view');
{
  // Galilee, roughly the view you get zooming to Capernaum.
  const t0 = performance.now();
  const rows = boundsIn(cols, { west: 35.3, south: 32.7, east: 35.8, north: 33.1 }, { limit: 200 });
  const ms = performance.now() - t0;
  if (ms < 60) ok('a bounding-box query', `${ms.toFixed(1)} ms, ${rows.length} places`);
  else fail('a bounding-box query answers within 60 ms', `${ms.toFixed(1)} ms`);

  const outside = rows.filter(
    (r) => r.lat < 32.7 || r.lat > 33.1 || r.lon < 35.3 || r.lon > 35.8
  );
  if (!outside.length) ok('every dot is inside the box');
  else fail('every dot is inside the box', `${outside.length} outside`);

  const wrongClass = rows.filter((r) => !['P', 'H', 'T'].includes(r.fclass));
  if (!wrongClass.length) ok('dots are only towns, water and terrain');
  else fail('dots are only towns, water and terrain', wrongClass.slice(0, 3).map(show).join(' | '));

  // Biggest first, so cutting the list short keeps what matters.
  let descending = true;
  for (let i = 1; i < rows.length; i++) if (rows[i].population > rows[i - 1].population) descending = false;
  if (descending) ok('dots arrive biggest first');
  else fail('dots arrive biggest first');
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures) {
  console.log(`${failures} FAILED.`);
  process.exit(1);
}
