/**
 * Art pack layout: one small scenes file plus image shards.
 *
 * sql.js needs a whole database in memory to open it, and on an 83 MB art pack
 * that cost ~2.2 GB of heap -- fine on a roomy phone, fatal on one whose V8
 * ceiling is 1818 MB. Splitting the images across small files makes that cost
 * proportional to the shard, so the ceiling is a number we choose here rather
 * than one discovered on someone else's device.
 *
 * Shared by build-art-pack.mjs (fresh builds) and shard-art-pack.mjs (converting
 * a pack that already has its images) so the two cannot drift apart.
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Byte budget per shard.
 *
 * Measured: 83.45 MB of pack cost ~2226 MB of heap, on a baseline of ~113 MB --
 * roughly 25 MB of heap per MB of pack. At 10 MB that predicts ~365 MB, which is
 * 4x under the 1818 MB ceiling, so the estimate can be wrong by several times and
 * still fit. Raise it only against a measurement from the failing device.
 */
export const SHARD_TARGET_BYTES = 10 * 1024 * 1024;

export const shardFilename = (n) => `art-images-${String(n).padStart(2, '0')}.sqlite`;
export const shardPackId = (n) => `biblical-art-images-${String(n).padStart(2, '0')}`;

/** Every shard file currently on disk, in install order. */
export function listShardFiles(packsDir) {
  return readdirSync(packsDir)
    .filter((f) => /^art-images-\d+\.sqlite$/.test(f))
    .sort();
}

/** Remove shards from a previous run so a shrinking pack cannot leave orphans. */
export function clearShards(packsDir) {
  const stale = listShardFiles(packsDir);
  for (const f of stale) unlinkSync(join(packsDir, f));
  return stale.length;
}

function writeMetadata(db, rows) {
  const meta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  for (const [k, v] of rows) meta.run(k, v);
}

/**
 * Write art.sqlite (scenes only) plus the image shards.
 *
 * `images` is a Map of id -> { mime, data }. `sceneRows` carry an already-built
 * `works` array. Returns the paths written.
 */
export function writeArtPackFiles({ packsDir, sceneRows, images, createdAt }) {
  const scenesPath = join(packsDir, 'art.sqlite');
  const stamp = createdAt ?? new Date().toISOString();

  const commonMeta = [
    ['pack_version', '2.0'],
    ['version', '2.0'], // read by generate-manifest.mjs
    ['schemaVersion', '1'],
    ['minAppVersion', '1.0.0'],
    ['createdAt', stamp],
    ['source', 'Wikimedia Commons (public domain)'],
    ['license', 'Public domain / CC0'],
    ['attribution', 'Images courtesy of Wikimedia Commons — public-domain works of art.'],
  ];

  // ── art.sqlite: metadata + scenes, no images ──────────────────────────────
  //
  // Deliberately no art_images table. The importer's art branch checks for it
  // and takes its "scenes imported without images" path, so this file needs no
  // special handling on the app side.
  if (existsSync(scenesPath)) unlinkSync(scenesPath);
  const scenesDb = new Database(scenesPath);
  scenesDb.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE art_scenes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, book TEXT NOT NULL,
      chapter INTEGER NOT NULL, verse INTEGER NOT NULL, passage_label TEXT, works TEXT NOT NULL
    );
    CREATE INDEX idx_art_book_chapter ON art_scenes (book, chapter);
    CREATE INDEX idx_art_anchor       ON art_scenes (book, chapter, verse);
  `);
  writeMetadata(scenesDb, [
    ['pack_id', 'biblical-art'],
    ['pack_type', 'art'],
    ...commonMeta,
    ['description', 'Famous public-domain paintings tied to scenes in Scripture, bundled for offline viewing.'],
  ]);

  const insScene = scenesDb.prepare(`
    INSERT OR REPLACE INTO art_scenes (id, title, book, chapter, verse, passage_label, works)
    VALUES (@id, @title, @book, @chapter, @verse, @passageLabel, @works)
  `);
  scenesDb.transaction((rows) => {
    for (const s of rows)
      insScene.run({
        id: s.id,
        title: s.title,
        book: s.book,
        chapter: s.chapter,
        verse: s.verse,
        passageLabel: s.passageLabel ?? null,
        works: typeof s.works === 'string' ? s.works : JSON.stringify(s.works),
      });
  })(sceneRows);
  scenesDb.close();

  // ── Shards: metadata + images, filled to the byte budget ──────────────────
  clearShards(packsDir);

  const entries = [...images.entries()];
  const shardPaths = [];
  let shardNo = 0;
  let cursor = 0;

  while (cursor < entries.length) {
    shardNo++;
    const batch = [];
    let bytes = 0;
    // At least one image per shard, so an image larger than the budget still
    // gets its own file rather than looping forever.
    while (cursor < entries.length && (batch.length === 0 || bytes < SHARD_TARGET_BYTES)) {
      const entry = entries[cursor];
      batch.push(entry);
      bytes += entry[1].data.length;
      cursor++;
    }

    const path = join(packsDir, shardFilename(shardNo));
    if (existsSync(path)) unlinkSync(path);
    const db = new Database(path);
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE art_images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
    `);
    writeMetadata(db, [
      ['pack_id', shardPackId(shardNo)],
      ['pack_type', 'art-images'],
      ...commonMeta,
      ['description', `Biblical Art images, part ${shardNo}.`],
    ]);
    const insImg = db.prepare('INSERT OR REPLACE INTO art_images (id, mime, data) VALUES (?, ?, ?)');
    db.transaction((rows) => {
      for (const [id, img] of rows) insImg.run(id, img.mime, img.data);
    })(batch);
    db.close();

    shardPaths.push(path);
    console.log(
      `   shard ${String(shardNo).padStart(2, '0')}: ${String(batch.length).padStart(3)} images, ` +
        `${(bytes / 1048576).toFixed(1)} MB`
    );
  }

  return { scenesPath, shardPaths };
}
