#!/usr/bin/env node
/**
 * Split an existing art.sqlite into a scenes file plus image shards.
 *
 * Rebuilding from scratch would re-fetch every painting from Wikimedia, which is
 * rate-limited and slow. The images are already in the pack, so this reads them
 * back out and rewrites the same content in the sharded layout.
 *
 * Usage: node scripts/shard-art-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeArtPackFiles } from './art-pack-shards.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const PACKS_DIR = join(repoRoot, 'packs', 'consolidated');
const ART_PATH = join(PACKS_DIR, 'art.sqlite');
// writeArtPackFiles overwrites art.sqlite, so the images have to be read from a
// copy -- otherwise the source is destroyed halfway through.
const SOURCE_PATH = join(PACKS_DIR, 'art-source.tmp.sqlite');

if (!existsSync(ART_PATH)) {
  console.error(`❌ Not found: ${ART_PATH}`);
  process.exit(1);
}

console.log('📦 Sharding the art pack...\n');
copyFileSync(ART_PATH, SOURCE_PATH);

try {
  const src = new Database(SOURCE_PATH, { readonly: true });

  const hasImages = src
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='art_images'")
    .get();
  if (!hasImages) {
    console.error('❌ art.sqlite has no art_images table — it looks already sharded.');
    console.error('   Nothing to do. Restore a full art.sqlite first if this is wrong.');
    src.close();
    process.exit(1);
  }

  const createdAt =
    src.prepare("SELECT value FROM metadata WHERE key='createdAt'").get()?.value ?? undefined;

  const sceneRows = src.prepare('SELECT * FROM art_scenes').all().map((r) => ({
    id: r.id,
    title: r.title,
    book: r.book,
    chapter: r.chapter,
    verse: r.verse,
    passageLabel: r.passage_label,
    works: r.works, // already JSON; writeArtPackFiles passes strings through
  }));

  const images = new Map();
  let totalBytes = 0;
  for (const row of src.prepare('SELECT id, mime, data FROM art_images').iterate()) {
    images.set(row.id, { mime: row.mime, data: row.data });
    totalBytes += row.data.length;
  }
  src.close();

  console.log(
    `Read ${sceneRows.length} scenes and ${images.size} images ` +
      `(${(totalBytes / 1048576).toFixed(1)} MB)\n`
  );

  const { scenesPath, shardPaths } = writeArtPackFiles({
    packsDir: PACKS_DIR,
    sceneRows,
    images,
    createdAt,
  });

  console.log(`\n✅ Wrote ${shardPaths.length} shards`);
  console.log(`   Scenes: ${scenesPath}`);
  console.log('\nNext: node scripts/generate-manifest.mjs, then upload the new files.');
} finally {
  if (existsSync(SOURCE_PATH)) unlinkSync(SOURCE_PATH);
}
