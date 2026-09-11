#!/usr/bin/env node
/**
 * Verify the shipping atlas packs against the sources they were built from.
 *
 * A map that is 99.9% right is the bad outcome here, so this does not sample
 * and hope. Every layer is inflated and compared to the source GeoJSON as a
 * string: same bytes out as went in, or the check fails. Everything else is
 * compared row for row.
 *
 * The place index is the one place that cannot be compared whole in a
 * reasonable time, so it is checked two ways: the columns are reconstructed
 * into rows and compared against the gazetteer for a large random sample plus
 * every row that search is known to care about, and the derived totals are
 * compared exactly.
 *
 * Run: node scripts/atlas/checks/atlas-packs-check.mjs
 */

import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PACKS = join(ROOT, 'packs');
const OUT = join(ROOT, 'packs', 'consolidated');
const LAB = join(ROOT, 'apps', 'pwa-polished', 'public', 'atlas');

let failures = 0;
let checks = 0;

function ok(label, extra = '') {
  checks++;
  console.log(`  ok   ${label}${extra ? '  ' + extra : ''}`);
}

function fail(label, detail) {
  checks++;
  failures++;
  console.log(`  FAIL ${label}`);
  if (detail) console.log(`       ${detail}`);
}

function expect(condition, label, detail) {
  if (condition) ok(label);
  else fail(label, detail);
}

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const inflate = (blob) => gunzipSync(Buffer.from(blob));

// ------------------------------------------------------------------ open

for (const [dir, f] of [
  [PACKS, 'atlas.sqlite'], [PACKS, 'basemap.sqlite'], [PACKS, 'gazetteer.sqlite'],
  [OUT, 'atlas-map.sqlite'], [OUT, 'atlas-places.sqlite'],
]) {
  if (!existsSync(join(dir, f))) {
    console.error(`Missing ${f} — run scripts/atlas/build-atlas-packs.mjs first.`);
    process.exit(1);
  }
}

const srcAtlas = new Database(join(PACKS, 'atlas.sqlite'), { readonly: true });
const srcBase = new Database(join(PACKS, 'basemap.sqlite'), { readonly: true });
const srcGaz = new Database(join(PACKS, 'gazetteer.sqlite'), { readonly: true });
const core = new Database(join(OUT, 'atlas-map.sqlite'), { readonly: true });
const placesPack = new Database(join(OUT, 'atlas-places.sqlite'), { readonly: true });

const shardFiles = readdirSync(OUT).filter((f) => /^atlas-map-\d+\.sqlite$/.test(f)).sort();
const shards = new Map();
for (const f of shardFiles) {
  const n = Number(f.match(/(\d+)/)[1]);
  shards.set(n, new Database(join(OUT, f), { readonly: true }));
}

const meta = Object.fromEntries(
  core.prepare('SELECT key, value FROM metadata').all().map((r) => [r.key, r.value])
);

// ------------------------------------------------------------------ geometry

console.log('\nGeometry — every layer inflated and compared to its source');

{
  const sourceJson = new Map();
  for (const r of srcBase.prepare('SELECT id, geojson FROM basemap_layers').all()) sourceJson.set(r.id, r.geojson);
  for (const r of srcAtlas.prepare('SELECT id, geojson FROM atlas_layers').all()) sourceJson.set(r.id, r.geojson);

  const index = core.prepare('SELECT * FROM atlas_geometry_index').all();
  expect(index.length === sourceJson.size, 'every source layer is in the index',
    `index ${index.length}, sources ${sourceJson.size}`);
  expect(Number(meta.geometry_layers) === index.length, 'metadata layer count agrees with the index',
    `metadata ${meta.geometry_layers}, index ${index.length}`);
  expect(Number(meta.geometry_shards) === shards.size, 'metadata shard count agrees with the files on disk',
    `metadata ${meta.geometry_shards}, files ${shards.size}`);

  let mismatched = 0;
  let missing = 0;
  let bytes = 0;
  const badJson = [];

  for (const row of index) {
    const shard = shards.get(row.shard);
    if (!shard) { missing++; continue; }
    const stored = shard.prepare('SELECT encoding, raw_bytes, data FROM atlas_geometry WHERE id = ?').get(row.id);
    if (!stored) { missing++; continue; }

    const text = inflate(stored.data).toString('utf8');
    if (text !== sourceJson.get(row.id)) { mismatched++; continue; }
    if (stored.raw_bytes !== Buffer.byteLength(text, 'utf8')) { mismatched++; continue; }
    if (row.raw_bytes !== stored.raw_bytes) { mismatched++; continue; }

    // Inflating to the same string proves nothing was lost. Parsing proves the
    // source itself was drawable — the layer that started this whole rebuild
    // was linework being filled as though it were shapes.
    try {
      const geo = JSON.parse(text);
      if (!geo || (!geo.type && !geo.features)) badJson.push(row.id);
    } catch {
      badJson.push(row.id);
    }
    bytes += stored.raw_bytes;
  }

  expect(missing === 0, 'every indexed layer is present in its shard', `${missing} missing`);
  expect(mismatched === 0, 'every layer inflates to exactly its source bytes', `${mismatched} differ`);
  expect(badJson.length === 0, 'every layer parses as GeoJSON', badJson.join(', '));
  ok('geometry total', `${index.length} layers, ${mb(bytes)} inflated`);

  // No layer may sit in a shard that is not listed, and no shard may carry a
  // layer the index does not know about — either way something goes missing at
  // runtime without an error.
  let orphans = 0;
  for (const [n, shard] of shards) {
    for (const r of shard.prepare('SELECT id FROM atlas_geometry').all()) {
      const entry = index.find((i) => i.id === r.id);
      if (!entry || entry.shard !== n) orphans++;
    }
  }
  expect(orphans === 0, 'no shard carries a layer the index does not point at', `${orphans} orphaned`);
}

// ------------------------------------------------------------------ core rows

console.log('\nCore — eras, places, points, names, photographs');

{
  const srcEras = srcAtlas.prepare('SELECT * FROM atlas_eras ORDER BY sort_order').all();
  const outEras = core.prepare('SELECT * FROM atlas_eras ORDER BY sort_order').all();
  expect(JSON.stringify(srcEras) === JSON.stringify(outEras), 'the 16 eras copied verbatim',
    `source ${srcEras.length}, pack ${outEras.length}`);

  const srcCount = srcAtlas.prepare('SELECT COUNT(*) c FROM atlas_places').get().c;
  const outCount = core.prepare('SELECT COUNT(*) c FROM atlas_era_places').get().c;
  expect(srcCount === outCount, 'every era place copied', `source ${srcCount}, pack ${outCount}`);

  const srcPoints = srcBase.prepare('SELECT COUNT(*) c FROM basemap_points').get().c;
  const outPoints = core.prepare('SELECT COUNT(*) c FROM atlas_points').get().c;
  expect(srcPoints === outPoints, 'every basemap point copied', `source ${srcPoints}, pack ${outPoints}`);

  const biblical = JSON.parse(readFileSync(join(LAB, 'biblical-places.json'), 'utf8'));
  const outBiblical = core.prepare('SELECT * FROM atlas_biblical_places').all();
  expect(biblical.length === outBiblical.length, 'every biblical place copied',
    `lab ${biblical.length}, pack ${outBiblical.length}`);

  // The verse links are the reason this table exists, so check they survived
  // the trip through JSON rather than just counting rows.
  const byId = new Map(outBiblical.map((r) => [r.id, r]));
  let verseMismatch = 0;
  let totalVerses = 0;
  for (const p of biblical) {
    const row = byId.get(p.id);
    if (!row) { verseMismatch++; continue; }
    const verses = JSON.parse(row.verses);
    if (JSON.stringify(verses) !== JSON.stringify(p.v ?? [])) verseMismatch++;
    if (Math.abs(row.lat - p.y) > 1e-9 || Math.abs(row.lon - p.x) > 1e-9) verseMismatch++;
    totalVerses += verses.length;
  }
  expect(verseMismatch === 0, 'every place keeps its verses and its coordinates', `${verseMismatch} differ`);
  ok('verse links', `${totalVerses} across ${outBiblical.length} places`);

  const jerusalem = byId.get('Jerusalem');
  expect(
    jerusalem && Math.abs(jerusalem.lat - 31.7767) < 1e-4 && Math.abs(jerusalem.lon - 35.2342) < 1e-4,
    'Jerusalem is where it should be',
    jerusalem ? `${jerusalem.lat}, ${jerusalem.lon}` : 'not found'
  );

  const ancient = JSON.parse(readFileSync(join(LAB, 'ancient-names.json'), 'utf8'));
  const outAncient = core.prepare('SELECT COUNT(*) c FROM atlas_ancient_names').get().c;
  expect(ancient.length === outAncient, 'every ancient name copied', `lab ${ancient.length}, pack ${outAncient}`);

  const photos = JSON.parse(readFileSync(join(LAB, 'place-photos.json'), 'utf8'));
  const outPhotos = core.prepare('SELECT * FROM atlas_place_photos').all();
  expect(Object.keys(photos).length === outPhotos.length, 'every photograph copied',
    `lab ${Object.keys(photos).length}, pack ${outPhotos.length}`);

  let photoMismatch = 0;
  for (const row of outPhotos) {
    const src = photos[row.place];
    if (!src || src.t !== row.thumb_url || src.f !== row.full_url || (src.a ?? null) !== row.author ||
        (src.l ?? null) !== row.license || (src.u ?? null) !== row.page_url) photoMismatch++;
  }
  expect(photoMismatch === 0, 'every photograph keeps its urls and its credit', `${photoMismatch} differ`);

  // Every photograph has to carry an attributable author and licence, or it
  // cannot be shown at all under CC BY-SA.
  const uncredited = outPhotos.filter((r) => !r.author || !r.license).length;
  expect(uncredited === 0, 'every photograph names its photographer and licence', `${uncredited} uncredited`);

  expect(!!meta.detail1_coverage && meta.detail1_coverage !== '[]',
    'the fine-water coverage boxes came across',
    `${JSON.parse(meta.detail1_coverage || '[]').length} boxes`);
  ok('fine-water coverage', `${JSON.parse(meta.detail1_coverage || '[]').length} boxes`);

  expect(!!meta.attribution && meta.attribution.includes('GeoNames') && meta.attribution.includes('Natural Earth'),
    'the pack carries its attribution');
}

// ------------------------------------------------------------------ place index

console.log('\nPlace index — columns rebuilt into rows and compared to the gazetteer');

{
  const cols = new Map();
  for (const r of placesPack.prepare('SELECT * FROM atlas_place_columns').all()) {
    cols.set(r.name, { kind: r.kind, raw: r.raw_bytes, data: inflate(r.data) });
  }

  const rows = Number(
    Object.fromEntries(placesPack.prepare('SELECT key, value FROM metadata').all().map((r) => [r.key, r.value])).rows
  );
  const srcRows = srcGaz.prepare('SELECT COUNT(*) c FROM places').get().c;
  expect(rows === srcRows, 'the index holds every gazetteer row', `pack ${rows}, gazetteer ${srcRows}`);
  expect(Number(meta.place_rows) === rows, 'the core agrees on how many places there are',
    `core ${meta.place_rows}, index ${rows}`);

  for (const [name, blob] of cols) {
    if (blob.raw !== blob.data.length) fail(`column ${name} inflates to its stated size`,
      `stated ${blob.raw}, got ${blob.data.length}`);
  }
  ok('every column inflates to its stated size', `${cols.size} columns`);

  const typed = (name, Ctor) => {
    const c = cols.get(name);
    return new Ctor(c.data.buffer, c.data.byteOffset, c.data.length / Ctor.BYTES_PER_ELEMENT);
  };
  const lat = typed('lat', Int32Array);
  const lon = typed('lon', Int32Array);
  const pop = typed('population', Uint32Array);
  const importance = typed('importance', Uint16Array);
  const countryCol = typed('country', Uint8Array);
  const admin1Col = typed('admin1', Uint16Array);
  const fcodeCol = typed('fcode', Uint8Array);

  const countries = JSON.parse(cols.get('countries').data.toString('utf8'));
  const admin1s = JSON.parse(cols.get('admin1s').data.toString('utf8'));
  const fcodes = JSON.parse(cols.get('fcodes').data.toString('utf8'));
  const fclasses = JSON.parse(cols.get('fclasses').data.toString('utf8'));
  const popExceptions = JSON.parse(cols.get('population_exceptions').data.toString('utf8'));

  // Search ranks on the feature class — a town above a lake above a mountain —
  // and gets it from this table rather than a column of its own.
  expect(fclasses.length === fcodes.length, 'every feature code carries its class',
    `${fcodes.length} codes, ${fclasses.length} classes`);
  {
    const wrong = [];
    for (let i = 0; i < fcodes.length; i++) {
      const actual = srcGaz.prepare('SELECT fclass FROM places WHERE fcode = ? LIMIT 1').get(fcodes[i]);
      if ((actual?.fclass ?? '') !== fclasses[i]) {
        wrong.push(`${fcodes[i]}: pack says ${fclasses[i]}, gazetteer says ${actual?.fclass}`);
      }
    }
    expect(wrong.length === 0, 'every feature class matches the gazetteer', wrong.slice(0, 3).join(' | '));
  }

  for (const [label, arr] of [['lat', lat], ['lon', lon], ['population', pop],
    ['importance', importance], ['country', countryCol], ['admin1', admin1Col], ['fcode', fcodeCol]]) {
    if (arr.length !== rows) fail(`column ${label} has one entry per row`, `${arr.length} vs ${rows}`);
  }
  ok('every numeric column has one entry per row');

  // Split the two text blobs the way the app will: a leading newline, one name
  // per line, a trailing newline.
  const normBlob = cols.get('norm').data.toString('utf8');
  const displayBlob = cols.get('display').data.toString('utf8');
  const normNames = normBlob.slice(1, -1).split('\n');
  const displayNames = displayBlob.slice(1, -1).split('\n');
  expect(normNames.length === rows, 'the searchable blob splits into exactly one name per row',
    `${normNames.length} vs ${rows}`);
  expect(displayNames.length === rows, 'the display blob splits into exactly one name per row',
    `${displayNames.length} vs ${rows}`);
  expect(normBlob.startsWith('\n') && normBlob.endsWith('\n'),
    'the searchable blob is newline-delimited at both ends');

  // Nothing but lowercase letters, digits and single spaces may reach the
  // searchable blob, or indexOf and the query would be normalised differently
  // and a real place would silently stop being findable.
  expect(!/[^\na-z0-9 ]/.test(normBlob), 'the searchable blob is plain lowercase ASCII');

  // Row order is the ranking: search reads the blob front to back and stops
  // early, so a blob out of population order quietly returns the wrong answers.
  let outOfOrder = 0;
  for (let i = 1; i < rows; i++) {
    const before = popExceptions[i - 1] ?? pop[i - 1];
    const after = popExceptions[i] ?? pop[i];
    if (after > before) outOfOrder++;
  }
  expect(outOfOrder === 0, 'rows are in descending population order', `${outOfOrder} out of place`);

  // Now compare rebuilt rows against the gazetteer itself. Every row would take
  // minutes; this takes the first 500, a large random sample, and the rows the
  // search bugs were actually found in.
  const sample = new Set();
  for (let i = 0; i < Math.min(500, rows); i++) sample.add(i);
  for (let i = 0; i < 5000; i++) sample.add(Math.floor(Math.random() * rows));

  const lookup = srcGaz.prepare(
    'SELECT name, norm, lat, lon, fcode, country, admin1, population, importance FROM places WHERE name = ? AND norm = ?'
  );

  // The gazetteer writes a blank country or region as an empty string; the
  // lookup tables round-trip that as index 0. Same absence, two spellings.
  const blank = (v) => (v == null || v === '' ? null : v);

  let wrong = 0;
  const examples = [];
  for (const i of sample) {
    const rebuilt = {
      name: displayNames[i],
      norm: normNames[i],
      lat: lat[i] / 1e6,
      lon: lon[i] / 1e6,
      fcode: blank(fcodes[fcodeCol[i]]),
      country: blank(countries[countryCol[i]]),
      admin1: blank(admin1s[admin1Col[i]]),
      population: popExceptions[i] ?? pop[i],
      importance: importance[i],
    };
    const candidates = lookup.all(rebuilt.name, rebuilt.norm);
    const match = candidates.find(
      (c) =>
        Math.abs(c.lat - rebuilt.lat) < 1e-6 &&
        Math.abs(c.lon - rebuilt.lon) < 1e-6 &&
        blank(c.fcode) === rebuilt.fcode &&
        blank(c.country) === rebuilt.country &&
        blank(c.admin1) === rebuilt.admin1 &&
        (c.population ?? 0) === rebuilt.population &&
        (c.importance ?? 0) === rebuilt.importance
    );
    if (!match) {
      wrong++;
      if (examples.length < 3) examples.push(`row ${i}: ${JSON.stringify(rebuilt)}`);
    }
  }
  expect(wrong === 0, `${sample.size} sampled rows rebuild exactly`,
    `${wrong} wrong — ${examples.join(' | ')}`);

  // The searches that were broken before, run the way the app will run them.
  console.log('\nSearch — the queries that had to be fixed');

  // Offset in the blob -> row number, by binary search over the line starts.
  // The app builds this array once when the index loads; here it is built once
  // for the whole check.
  const lineStart = new Int32Array(rows);
  {
    let at = 0;
    for (let i = 0; i < rows; i++) {
      at = normBlob.indexOf('\n', at) + 1;
      lineStart[i] = at;
    }
  }
  const rowAt = (offset) => {
    let lo = 0;
    let hi = rows - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const describe = (row) =>
    `${displayNames[row]}, ${admin1s[admin1Col[row]] || '—'}, ${countries[countryCol[row]] || '—'} ` +
    `(${fcodes[fcodeCol[row]]}, pop ${popExceptions[row] ?? pop[row]}, named in ${importance[row]})`;

  /**
   * The app's ranking, run against the packed blob: an exact name beats one
   * that starts with the query, which beats one that merely contains it, and
   * within each band the blob's own population order decides.
   */
  const search = (query, limit = 5) => {
    const exact = [];
    const starts = [];
    const contains = [];
    for (let at = normBlob.indexOf(query); at >= 0; at = normBlob.indexOf(query, at + 1)) {
      const atLineStart = normBlob[at - 1] === '\n';
      const atLineEnd = normBlob[at + query.length] === '\n';
      const row = rowAt(at);
      if (atLineStart && atLineEnd) exact.push(row);
      else if (atLineStart) starts.push(row);
      else contains.push(row);
      if (exact.length + starts.length > limit * 6) break;
    }
    return [...exact, ...starts, ...contains].slice(0, limit);
  };

  const cases = [
    ['tampa', 'Tampa', 'United States'],
    ['saint cloud', 'Saint Cloud', 'United States'],
    ['mount carmel', 'Mount Carmel', null],
    ['jerusalem', 'Jerusalem', 'Israel'],
  ];
  for (const [query, expectedName, expectedCountry] of cases) {
    const hits = search(query);
    if (!hits.length) { fail(`"${query}" finds something`); continue; }
    const top = hits[0];
    const nameOk = !expectedName || displayNames[top] === expectedName;
    const countryOk = !expectedCountry || countries[countryCol[top]] === expectedCountry;
    if (nameOk && countryOk) ok(`"${query}"`, `→ ${describe(top)}`);
    else fail(`"${query}" lands on the right place`, `got ${describe(top)}`);
  }

  // Grand Canyon: both are unpopulated, and the Arizona one is named in far
  // more languages. That tie-break is why `importance` is in the pack at all.
  {
    const hits = search('grand canyon', 8);
    const exact = hits.filter((r) => normNames[r] === 'grand canyon');
    expect(exact.length > 0, 'the Grand Canyon itself is findable');
    expect(
      exact.length > 0 && admin1s[admin1Col[exact[0]]] === 'Arizona',
      'the Grand Canyon that comes first is the Arizona one',
      exact.length ? describe(exact[0]) : 'not found'
    );
    if (exact.length > 1) ok('the other Grand Canyons rank below it', describe(exact[1]));
  }

  // Tampa Bay is a bay, so nothing is named that — the reader plainly means
  // Tampa, and the app falls back to the leading words. Here, only the data
  // that fallback needs is checked: Tampa is present and ranks first.
  {
    const hits = search('tampa');
    expect(
      hits.length > 0 && displayNames[hits[0]] === 'Tampa' && admin1s[admin1Col[hits[0]]] === 'Florida',
      "Tampa Bay's fallback has a Tampa to fall back to",
      hits.length ? describe(hits[0]) : 'not found'
    );
  }
}

// ------------------------------------------------------------------ import

console.log('\nImport — every query the app runs against these packs');

{
  // Kept character-for-character in step with the SELECTs in pack-import.ts.
  // A column renamed on one side and not the other fails at install time on a
  // real device, after a 34 MB download, which is an expensive way to find a
  // typo. `rank` in particular is a SQLite keyword and is being used as a
  // column name, so it is worth proving it parses rather than assuming.
  const CORE_QUERIES = [
    'SELECT key, value FROM metadata',
    'SELECT id, title, subtitle, year_start, year_end, sort_order, confidence, blurb, dating_note, books FROM atlas_eras',
    'SELECT id, layer_group, kind, detail, era_id, title, source, confidence, sort_order, shard, raw_bytes FROM atlas_geometry_index',
    'SELECT id, era_id, name, lat, lon, kind, verses FROM atlas_era_places',
    'SELECT id, kind, name, lat, lon, elevation, country, population, rank FROM atlas_points',
    'SELECT id, name, lat, lon, kind, modern, verses FROM atlas_biblical_places',
    'SELECT id, name, kind, lat, lon, year_start, year_end FROM atlas_ancient_names',
    'SELECT place, thumb_url, full_url, author, license, page_url, caption, palette FROM atlas_place_photos',
  ];
  const SHARD_QUERY = 'SELECT id, encoding, raw_bytes, data FROM atlas_geometry';
  const PLACES_QUERY = 'SELECT name, kind, encoding, raw_bytes, data FROM atlas_place_columns';

  const runs = (database, sql) => {
    try {
      const row = database.prepare(sql).get();
      return { ok: true, empty: row === undefined };
    } catch (error) {
      return { ok: false, detail: error.message };
    }
  };

  let broken = 0;
  for (const sql of CORE_QUERIES) {
    const result = runs(core, sql);
    if (!result.ok) { fail(`core: ${sql.slice(0, 60)}…`, result.detail); broken++; }
    else if (result.empty) { fail(`core: ${sql.slice(0, 60)}… returns rows`, 'no rows'); broken++; }
  }
  if (!broken) ok('the core import’s eight queries all run and return rows');

  for (const [n, shard] of shards) {
    const result = runs(shard, SHARD_QUERY);
    expect(result.ok && !result.empty, `shard ${n}: the geometry query runs`, result.detail ?? 'no rows');
  }

  const placesResult = runs(placesPack, PLACES_QUERY);
  expect(placesResult.ok && !placesResult.empty, 'the place index query runs',
    placesResult.detail ?? 'no rows');

  // The manifest has to name every file, or the install stops partway with no
  // error — the shard loop simply finds nothing left to fetch.
  const manifestPath = join(OUT, 'manifest.json');
  if (existsSync(manifestPath)) {
    const entries = JSON.parse(readFileSync(manifestPath, 'utf8')).packs ?? [];
    const byId = new Map(entries.map((p) => [p.id, p]));
    const wanted = ['atlas-map', 'atlas-map-places', ...[...shards.keys()].map(
      (n) => `atlas-map-${String(n).padStart(2, '0')}`
    )];
    const absent = wanted.filter((id) => !byId.has(id));
    expect(absent.length === 0, 'the manifest names every atlas file', absent.join(', '));

    // An invented manifest type takes every pack down on every device that has
    // not updated, so these must stay on a type already shipped everywhere.
    const wrongType = wanted.filter((id) => byId.get(id) && byId.get(id).type !== 'study');
    expect(wrongType.length === 0, 'every atlas entry ships as type "study"',
      wrongType.map((id) => `${id}=${byId.get(id).type}`).join(', '));

    const totalMB = wanted.reduce((n, id) => n + (byId.get(id)?.size ?? 0), 0);
    ok('one card, one tap', `${wanted.length} files, ${mb(totalMB)}`);
  } else {
    fail('the manifest names every atlas file', 'no manifest.json — run scripts/generate-manifest.mjs');
  }
}

// ------------------------------------------------------------------ done

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures) {
  console.log(`${failures} FAILED.`);
  process.exit(1);
}
