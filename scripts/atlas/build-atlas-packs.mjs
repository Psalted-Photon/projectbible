#!/usr/bin/env node
/**
 * Build the shipping atlas packs from the lab's three source databases.
 *
 * The lab reads loose JSON off the dev server. The app cannot: it has no
 * general SQLite query path, and 81 MB of raw JSON is well past the ~80 MB
 * import ceiling that has killed phone tabs in this codebase before. So the
 * same data ships as packs, with three things done to it:
 *
 *   1. Every GeoJSON layer is gzipped in the pack and inflated on read.
 *      67 MB of geometry becomes about 20. The browser inflates it with
 *      DecompressionStream, which costs nothing to ship.
 *
 *   2. The geometry is split across numbered shards on a byte budget, the way
 *      the art pack splits its paintings, so sql.js never holds the whole map
 *      in memory at once.
 *
 *   3. The gazetteer's 562,524 places become plain columns -- typed arrays and
 *      two text blobs -- instead of half a million JavaScript objects. The
 *      names go in one ASCII blob that search walks with native indexOf. That
 *      is the whole of the search index, and it is smaller than the 168,000-row
 *      trim the lab currently loads.
 *
 * Sources (all built by the other scripts in this folder):
 *   packs/atlas.sqlite      eras, era layers, era places
 *   packs/basemap.sqlite    world geometry at four levels of detail, points
 *   packs/gazetteer.sqlite  the modern world's places
 *   public/atlas/*.json     biblical places, ancient names, photographs
 *
 * Writes packs/consolidated/atlas-map.sqlite, atlas-map-NN.sqlite and atlas-places.sqlite.
 * Touches nothing the app runs.
 */

import Database from 'better-sqlite3';
import { gzipSync } from 'zlib';
import { existsSync, readFileSync, readdirSync, unlinkSync, renameSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
// Sources live in packs/; finished packs go to packs/consolidated/, which is
// what the dev server bundles and what the manifest generator reads.
const PACKS = join(ROOT, 'packs');
const OUT = join(ROOT, 'packs', 'consolidated');
const LAB = join(ROOT, 'apps', 'pwa-polished', 'public', 'atlas');

const VERSION = '1.0';

/**
 * Byte budget per geometry shard.
 *
 * The art pack measured roughly 25 MB of heap per MB of pack when sql.js opens
 * it, and settled on 10 MB a shard against an 1818 MB ceiling -- though its
 * largest shard actually ships at 11.9 MB, so that is the proven number rather
 * than the stated one. Geometry here is gzipped blobs rather than JPEGs, but
 * the sql.js cost is the same shape. Raise it only against a measurement from a
 * device that actually failed.
 */
const SHARD_MAX_BYTES = 11 * 1024 * 1024;

const ATTRIBUTION = [
  'Map data from Natural Earth (public domain).',
  'Ancient world geography © Ancient World Mapping Center (Barrington Atlas), ODbL 1.0.',
  'Roman provinces © Digital Atlas of the Roman Empire (imperium.ahlfeldt.se), CC BY-SA 3.0.',
  'Coastlines and lakes © OpenStreetMap contributors, ODbL 1.0.',
  'Biblical places © OpenBible.info, CC BY 4.0.',
  'Modern places © GeoNames, CC BY 4.0.',
].join(' ');

const LICENSE = 'ODbL-1.0 AND CC-BY-4.0 AND CC-BY-SA-3.0 AND public-domain';

// ---------------------------------------------------------------- helpers

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

/** Gzip at maximum effort. Build time is cheap; the reader's download is not. */
const gz = (buf) => gzipSync(buf, { level: 9 });

/**
 * Write to a `.building` file and rename into place at the end.
 *
 * A build killed halfway used to leave a truncated pack sitting where a good
 * one had been, and nothing downstream could tell the difference.
 */
function openOutput(filename) {
  const finalPath = join(OUT, filename);
  const tempPath = finalPath + '.building';
  if (existsSync(tempPath)) unlinkSync(tempPath);
  const db = new Database(tempPath);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  return {
    db,
    finish() {
      db.exec('VACUUM');
      db.close();
      if (existsSync(finalPath)) unlinkSync(finalPath);
      renameSync(tempPath, finalPath);
      return statSync(finalPath).size;
    },
  };
}

function writeMetadata(db, rows) {
  db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)');
  const insert = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  const all = db.transaction((pairs) => {
    for (const [k, v] of pairs) insert.run(k, v == null ? null : String(v));
  });
  all(rows);
}

/** Remove shards from a previous run so a shrinking build leaves no orphans. */
function clearShards() {
  let removed = 0;
  for (const f of readdirSync(OUT)) {
    if (/^atlas-map-\d+\.sqlite(\.building)?$/.test(f)) {
      unlinkSync(join(OUT, f));
      removed++;
    }
  }
  return removed;
}

const shardFilename = (n) => `atlas-map-${String(n).padStart(2, '0')}.sqlite`;
const shardPackId = (n) => `atlas-map-${String(n).padStart(2, '0')}`;

function readLabJson(name) {
  const path = join(LAB, name);
  if (!existsSync(path)) throw new Error(`Missing lab data: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------- geometry

/**
 * Every drawn layer in one list, basemap and overlay alike.
 *
 * The two source databases keep them apart because they are built by different
 * scripts from different sources. The app does not care: it asks for a layer id
 * and gets back GeoJSON. Merging them here means one lookup table and one set
 * of shards rather than two of each.
 */
function collectGeometry(atlasDb, basemapDb) {
  const layers = [];

  for (const row of basemapDb
    .prepare('SELECT id, kind, detail, title, geojson FROM basemap_layers ORDER BY kind, detail')
    .all()) {
    layers.push({
      id: row.id,
      group: 'basemap',
      kind: row.kind,
      detail: row.detail,
      eraId: null,
      title: row.title,
      source: 'naturalearth',
      confidence: null,
      sortOrder: 0,
      json: row.geojson,
    });
  }

  for (const row of atlasDb
    .prepare(
      'SELECT id, era_id, kind, title, source, confidence, sort_order, geojson FROM atlas_layers ORDER BY kind, id'
    )
    .all()) {
    layers.push({
      id: row.id,
      group: 'overlay',
      kind: row.kind,
      // Overlay layers carry their own detail in the id suffix where they have
      // one at all (terr-rome-provinces-0 / -1); nothing switches them by zoom.
      detail: null,
      eraId: row.era_id,
      title: row.title,
      source: row.source,
      confidence: row.confidence,
      sortOrder: row.sort_order ?? 0,
      json: row.geojson,
    });
  }

  const seen = new Set();
  for (const layer of layers) {
    if (seen.has(layer.id)) {
      throw new Error(`Two layers share the id "${layer.id}" — the app looks them up by id`);
    }
    seen.add(layer.id);
  }

  return layers;
}

/**
 * Pack the layers into shards.
 *
 * The count comes first, from the total against the ceiling, and then the
 * layers are dealt largest-first into whichever shard is currently emptiest.
 * Filling each shard to the brim before starting the next would be simpler, but
 * it leaves a last shard holding almost nothing -- a whole extra download for a
 * rounding error. Balancing keeps the shard count honest and every download the
 * same size.
 */
function shardGeometry(layers) {
  const compressed = layers
    .map((layer) => {
      const raw = Buffer.from(layer.json, 'utf8');
      const blob = gz(raw);
      return { ...layer, json: undefined, raw: raw.length, blob };
    })
    .sort((a, b) => b.blob.length - a.blob.length);

  const total = compressed.reduce((n, l) => n + l.blob.length, 0);
  const biggest = compressed[0]?.blob.length ?? 0;
  // At least enough shards to fit the total, and never fewer than it takes to
  // hold the single largest layer -- a layer cannot be split.
  const count = Math.max(
    Math.ceil(total / SHARD_MAX_BYTES),
    Math.ceil(biggest / SHARD_MAX_BYTES),
    1
  );

  const shards = Array.from({ length: count }, (_, i) => ({ n: i + 1, bytes: 0, layers: [] }));
  for (const layer of compressed) {
    const target = shards.reduce((a, b) => (b.bytes < a.bytes ? b : a));
    target.bytes += layer.blob.length;
    target.layers.push(layer);
  }

  for (const shard of shards) {
    if (shard.bytes > SHARD_MAX_BYTES) {
      throw new Error(`Shard ${shard.n} came out at ${mb(shard.bytes)}, over the ceiling`);
    }
  }
  return shards;
}

// ---------------------------------------------------------------- place index

/**
 * The gazetteer as columns.
 *
 * Half a million rows as JavaScript objects is tens of megabytes of heap and
 * seconds of parsing. As typed arrays plus two text blobs it is about 28 MB
 * resident, loads in one pass, and searches with indexOf.
 *
 * Row order is population, descending, and has to stay that way: search walks
 * the names blob from the front and stops early, so the order of the blob *is*
 * the ranking.
 */
function buildPlaceIndex(gazetteerDb) {
  const total = gazetteerDb.prepare('SELECT COUNT(*) c FROM places').get().c;

  const countries = [];
  const countryIndex = new Map();
  const admin1s = [];
  const admin1Index = new Map();
  const fcodes = [];
  const fcodeIndex = new Map();

  const intern = (list, index, value) => {
    const key = value ?? '';
    let at = index.get(key);
    if (at === undefined) {
      at = list.length;
      list.push(key);
      index.set(key, at);
    }
    return at;
  };

  const lat = new Int32Array(total);
  const lon = new Int32Array(total);
  const pop = new Uint32Array(total);
  const importance = new Uint16Array(total);
  const countryCol = new Uint8Array(total);
  const admin1Col = new Uint16Array(total);
  const fcodeCol = new Uint8Array(total);

  // Populations are stored in 32 bits, which every real place fits inside.
  // "Earth" does not, at 6.8 billion. Rather than round it or widen every row
  // by four bytes, the handful that overflow are listed exactly, by row.
  const popExceptions = {};
  const POP_CEILING = 0xffffffff;

  const normParts = [];
  const displayParts = [];

  const rows = gazetteerDb
    .prepare(
      'SELECT name, norm, lat, lon, fcode, country, admin1, population, importance FROM places ORDER BY population DESC, importance DESC, id ASC'
    )
    .iterate();

  let i = 0;
  for (const row of rows) {
    // 1e6 gives about 11 cm, which is finer than anything GeoNames records, and
    // 180e6 sits well inside a signed 32-bit integer.
    lat[i] = Math.round(row.lat * 1e6);
    lon[i] = Math.round(row.lon * 1e6);

    const population = row.population ?? 0;
    if (population > POP_CEILING) {
      popExceptions[i] = population;
      pop[i] = POP_CEILING;
    } else {
      pop[i] = population;
    }

    importance[i] = Math.min(row.importance ?? 0, 0xffff);
    countryCol[i] = intern(countries, countryIndex, row.country);
    admin1Col[i] = intern(admin1s, admin1Index, row.admin1);
    fcodeCol[i] = intern(fcodes, fcodeIndex, row.fcode);

    normParts.push(row.norm);
    displayParts.push(row.name);
    i++;
  }

  if (i !== total) throw new Error(`Expected ${total} places, read ${i}`);
  if (countries.length > 256) throw new Error(`${countries.length} countries will not fit in a byte`);
  if (fcodes.length > 256) throw new Error(`${fcodes.length} feature codes will not fit in a byte`);
  if (admin1s.length > 65536) throw new Error(`${admin1s.length} regions will not fit in two bytes`);

  // A leading newline so every name in the blob is preceded by one. Search uses
  // that to tell "starts with" from "contains" without consulting an index, and
  // a name at offset 0 would be the one exception to the rule.
  const normBlob = '\n' + normParts.join('\n') + '\n';
  const displayBlob = '\n' + displayParts.join('\n') + '\n';

  return {
    rows: total,
    columns: [
      ['norm', 'utf8', Buffer.from(normBlob, 'utf8')],
      ['display', 'utf8', Buffer.from(displayBlob, 'utf8')],
      ['lat', 'int32', Buffer.from(lat.buffer)],
      ['lon', 'int32', Buffer.from(lon.buffer)],
      ['population', 'uint32', Buffer.from(pop.buffer)],
      ['importance', 'uint16', Buffer.from(importance.buffer)],
      ['country', 'uint8', Buffer.from(countryCol.buffer)],
      ['admin1', 'uint16', Buffer.from(admin1Col.buffer)],
      ['fcode', 'uint8', Buffer.from(fcodeCol.buffer)],
      ['countries', 'json', Buffer.from(JSON.stringify(countries), 'utf8')],
      ['admin1s', 'json', Buffer.from(JSON.stringify(admin1s), 'utf8')],
      ['fcodes', 'json', Buffer.from(JSON.stringify(fcodes), 'utf8')],
      ['population_exceptions', 'json', Buffer.from(JSON.stringify(popExceptions), 'utf8')],
    ],
  };
}

// ---------------------------------------------------------------- build

function main() {
  const built = new Date().toISOString();

  for (const f of ['atlas.sqlite', 'basemap.sqlite', 'gazetteer.sqlite']) {
    if (!existsSync(join(PACKS, f))) throw new Error(`Missing source pack: packs/${f}`);
  }

  const atlasDb = new Database(join(PACKS, 'atlas.sqlite'), { readonly: true });
  const basemapDb = new Database(join(PACKS, 'basemap.sqlite'), { readonly: true });
  const gazetteerDb = new Database(join(PACKS, 'gazetteer.sqlite'), { readonly: true });

  const basemapMeta = Object.fromEntries(
    basemapDb.prepare('SELECT key, value FROM metadata').all().map((r) => [r.key, r.value])
  );

  // ---- geometry ----------------------------------------------------------
  console.log('Reading geometry…');
  const layers = collectGeometry(atlasDb, basemapDb);
  const rawTotal = layers.reduce((n, l) => n + Buffer.byteLength(l.json, 'utf8'), 0);
  console.log(`  ${layers.length} layers, ${mb(rawTotal)} of GeoJSON`);

  console.log('Compressing…');
  const shards = shardGeometry(layers);
  const gzTotal = shards.reduce((n, s) => n + s.bytes, 0);
  console.log(
    `  ${mb(gzTotal)} gzipped (${Math.round((1 - gzTotal / rawTotal) * 100)}% smaller), ${shards.length} shards`
  );

  const removed = clearShards();
  if (removed) console.log(`  cleared ${removed} shard(s) from a previous build`);

  const placement = new Map();
  for (const shard of shards) {
    const out = openOutput(shardFilename(shard.n));
    writeMetadata(out.db, [
      ['pack_id', shardPackId(shard.n)],
      ['pack_type', 'atlas-map-geometry'],
      ['pack_version', VERSION],
      ['name', `Historical Map geometry (part ${shard.n})`],
      ['description', 'Drawn map layers for the Historical Map pack.'],
      ['shard', shard.n],
      ['shard_count', shards.length],
      ['license', LICENSE],
      ['attribution', ATTRIBUTION],
      ['built', built],
    ]);
    out.db.exec(`
      CREATE TABLE atlas_geometry (
        id        TEXT PRIMARY KEY,
        encoding  TEXT NOT NULL,   -- always 'gzip'; named so a future change is readable
        raw_bytes INTEGER NOT NULL,
        data      BLOB NOT NULL
      )
    `);
    const insert = out.db.prepare(
      'INSERT INTO atlas_geometry (id, encoding, raw_bytes, data) VALUES (?, ?, ?, ?)'
    );
    out.db.transaction(() => {
      for (const layer of shard.layers) {
        insert.run(layer.id, 'gzip', layer.raw, layer.blob);
        placement.set(layer.id, { shard: shard.n, raw: layer.raw, gz: layer.blob.length });
      }
    })();
    const size = out.finish();
    console.log(`  ${shardFilename(shard.n)}  ${shard.layers.length} layers  ${mb(size)}`);
  }

  // ---- the place index ---------------------------------------------------
  console.log('Building the place index…');
  const index = buildPlaceIndex(gazetteerDb);
  const placesOut = openOutput('atlas-places.sqlite');
  writeMetadata(placesOut.db, [
    ['pack_id', 'atlas-map-places'],
    ['pack_type', 'atlas-map-places'],
    ['pack_version', VERSION],
    ['name', 'Historical Map place search'],
    ['description', 'Every place the modern world names, as a searchable index.'],
    ['rows', index.rows],
    ['license', 'CC-BY-4.0'],
    ['attribution', 'Modern places © GeoNames, CC BY 4.0.'],
    ['built', built],
  ]);
  placesOut.db.exec(`
    CREATE TABLE atlas_place_columns (
      name      TEXT PRIMARY KEY,
      kind      TEXT NOT NULL,     -- utf8 | int32 | uint32 | uint16 | uint8 | json
      encoding  TEXT NOT NULL,     -- always 'gzip'
      raw_bytes INTEGER NOT NULL,
      data      BLOB NOT NULL
    )
  `);
  {
    const insert = placesOut.db.prepare(
      'INSERT INTO atlas_place_columns (name, kind, encoding, raw_bytes, data) VALUES (?, ?, ?, ?, ?)'
    );
    let resident = 0;
    let packed = 0;
    placesOut.db.transaction(() => {
      for (const [name, kind, buf] of index.columns) {
        const blob = gz(buf);
        insert.run(name, kind, 'gzip', buf.length, blob);
        resident += buf.length;
        packed += blob.length;
      }
    })();
    console.log(`  ${index.rows.toLocaleString()} places, ${mb(resident)} resident, ${mb(packed)} packed`);
  }
  const placesSize = placesOut.finish();
  console.log(`  atlas-places.sqlite  ${mb(placesSize)}`);

  // ---- the core ----------------------------------------------------------
  console.log('Building the core…');
  const biblical = readLabJson('biblical-places.json');
  const ancient = readLabJson('ancient-names.json');
  const photos = readLabJson('place-photos.json');

  const core = openOutput('atlas-map.sqlite');
  writeMetadata(core.db, [
    ['pack_id', 'atlas-map'],
    ['pack_type', 'atlas-map'],
    ['pack_version', VERSION],
    ['name', 'Historical Map'],
    ['description', 'A drawn world map, sixteen eras of the biblical world, and every place Scripture names.'],
    // What the app checks a finished install against. "Not empty" is not a
    // completeness test: a shard that failed halfway leaves rows behind and
    // looks healthy. This is the list those rows have to add up to.
    ['geometry_layers', layers.length],
    ['geometry_shards', shards.length],
    ['place_rows', index.rows],
    // Where the OSM shoreline harvest actually reaches. Outside these boxes the
    // map must not switch to detail 1, because there is nothing there to draw.
    ['detail1_coverage', basemapMeta.detail1_coverage ?? '[]'],
    ['license', LICENSE],
    ['attribution', ATTRIBUTION],
    ['built', built],
  ]);

  core.db.exec(`
    CREATE TABLE atlas_eras (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      subtitle    TEXT,
      year_start  INTEGER NOT NULL,
      year_end    INTEGER NOT NULL,
      sort_order  INTEGER NOT NULL,
      confidence  TEXT NOT NULL,
      blurb       TEXT,
      dating_note TEXT,
      books       TEXT
    );

    -- Every drawn layer and which shard holds its geometry. The app reads this
    -- to know what exists; the bytes come from atlas_geometry in the shard.
    CREATE TABLE atlas_geometry_index (
      id         TEXT PRIMARY KEY,
      layer_group TEXT NOT NULL,   -- basemap | overlay
      kind       TEXT NOT NULL,
      detail     INTEGER,          -- 110 | 50 | 10 | 1 for basemap, NULL otherwise
      era_id     TEXT,             -- NULL = shown on every era
      title      TEXT NOT NULL,
      source     TEXT,
      confidence TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      shard      INTEGER NOT NULL,
      raw_bytes  INTEGER NOT NULL,
      gz_bytes   INTEGER NOT NULL
    );

    CREATE TABLE atlas_era_places (
      id      TEXT NOT NULL,
      era_id  TEXT NOT NULL,
      name    TEXT NOT NULL,
      lat     REAL NOT NULL,
      lon     REAL NOT NULL,
      kind    TEXT,
      verses  INTEGER DEFAULT 0,
      PRIMARY KEY (id, era_id)
    );

    CREATE TABLE atlas_points (
      id         INTEGER PRIMARY KEY,
      kind       TEXT NOT NULL,    -- peak | city
      name       TEXT NOT NULL,
      lat        REAL NOT NULL,
      lon        REAL NOT NULL,
      elevation  INTEGER,
      country    TEXT,
      population INTEGER,
      rank       INTEGER
    );

    -- The places Scripture names, with every verse that names them.
    CREATE TABLE atlas_biblical_places (
      id     TEXT PRIMARY KEY,
      name   TEXT NOT NULL,
      lat    REAL NOT NULL,
      lon    REAL NOT NULL,
      kind   TEXT,
      modern TEXT,
      verses TEXT NOT NULL       -- JSON [[label, ref], …]
    );

    -- Dated names off the Barrington regional linework, for search.
    CREATE TABLE atlas_ancient_names (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      kind       TEXT,
      lat        REAL NOT NULL,
      lon        REAL NOT NULL,
      year_start INTEGER,
      year_end   INTEGER
    );

    -- One Wikimedia photograph per place, pre-cropped, with its credit.
    CREATE TABLE atlas_place_photos (
      place     TEXT PRIMARY KEY,
      thumb_url TEXT NOT NULL,
      full_url  TEXT NOT NULL,
      author    TEXT,
      license   TEXT,
      page_url  TEXT,
      caption   TEXT,
      palette   TEXT
    );

    CREATE INDEX idx_geometry_era ON atlas_geometry_index(era_id);
    CREATE INDEX idx_geometry_kind ON atlas_geometry_index(layer_group, kind, detail);
    CREATE INDEX idx_era_places_era ON atlas_era_places(era_id);
    CREATE INDEX idx_points_kind ON atlas_points(kind);
  `);

  const copyEras = core.db.prepare(`
    INSERT INTO atlas_eras (id, title, subtitle, year_start, year_end, sort_order, confidence, blurb, dating_note, books)
    VALUES (@id, @title, @subtitle, @year_start, @year_end, @sort_order, @confidence, @blurb, @dating_note, @books)
  `);
  const eras = atlasDb.prepare('SELECT * FROM atlas_eras ORDER BY sort_order').all();
  core.db.transaction(() => {
    for (const era of eras) copyEras.run(era);
  })();

  const insertIndex = core.db.prepare(`
    INSERT INTO atlas_geometry_index
      (id, layer_group, kind, detail, era_id, title, source, confidence, sort_order, shard, raw_bytes, gz_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  core.db.transaction(() => {
    for (const layer of layers) {
      const where = placement.get(layer.id);
      insertIndex.run(
        layer.id, layer.group, layer.kind, layer.detail, layer.eraId,
        layer.title, layer.source, layer.confidence, layer.sortOrder,
        where.shard, where.raw, where.gz
      );
    }
  })();

  const insertEraPlace = core.db.prepare(
    'INSERT INTO atlas_era_places (id, era_id, name, lat, lon, kind, verses) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const eraPlaces = atlasDb.prepare('SELECT * FROM atlas_places').all();
  core.db.transaction(() => {
    for (const p of eraPlaces) {
      insertEraPlace.run(p.id, p.era_id, p.name, p.lat, p.lon, p.kind, p.verses ?? 0);
    }
  })();

  const insertPoint = core.db.prepare(
    'INSERT INTO atlas_points (id, kind, name, lat, lon, elevation, country, population, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const points = basemapDb.prepare('SELECT * FROM basemap_points').all();
  core.db.transaction(() => {
    for (const p of points) {
      insertPoint.run(p.id, p.kind, p.name, p.lat, p.lon, p.elevation, p.country, p.population, p.rank);
    }
  })();

  const insertBiblical = core.db.prepare(
    'INSERT INTO atlas_biblical_places (id, name, lat, lon, kind, modern, verses) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  core.db.transaction(() => {
    for (const p of biblical) {
      insertBiblical.run(p.id, p.n, p.y, p.x, p.t ?? null, p.m ?? null, JSON.stringify(p.v ?? []));
    }
  })();

  const insertAncient = core.db.prepare(
    'INSERT INTO atlas_ancient_names (name, kind, lat, lon, year_start, year_end) VALUES (?, ?, ?, ?, ?, ?)'
  );
  core.db.transaction(() => {
    for (const a of ancient) {
      insertAncient.run(a.n, a.k ?? null, a.y, a.x, a.a ?? null, a.b ?? null);
    }
  })();

  const insertPhoto = core.db.prepare(
    'INSERT INTO atlas_place_photos (place, thumb_url, full_url, author, license, page_url, caption, palette) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  core.db.transaction(() => {
    for (const [place, photo] of Object.entries(photos)) {
      insertPhoto.run(place, photo.t, photo.f, photo.a ?? null, photo.l ?? null, photo.u ?? null, photo.d ?? null, photo.p ?? null);
    }
  })();

  const coreSize = core.finish();
  console.log(
    `  atlas-map.sqlite  ${eras.length} eras, ${layers.length} layers indexed, ` +
      `${eraPlaces.length} era places, ${points.length} points, ${biblical.length} biblical places, ` +
      `${ancient.length} ancient names, ${Object.keys(photos).length} photographs  ${mb(coreSize)}`
  );

  atlasDb.close();
  basemapDb.close();
  gazetteerDb.close();

  const shardSizes = shards.map((s) => statSync(join(OUT, shardFilename(s.n))).size);
  const grand = coreSize + placesSize + shardSizes.reduce((a, b) => a + b, 0);
  console.log(`\nAtlas packs: ${2 + shards.length} files, ${mb(grand)} total.`);
}

main();
