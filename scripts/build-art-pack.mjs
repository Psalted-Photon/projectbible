#!/usr/bin/env node
/**
 * Build Biblical Art Pack
 *
 * Reads the curated scene list (scripts/art-scenes-data.mjs) and resolves each
 * artwork's Wikimedia Commons filename to a verified, high-resolution image URL
 * (+ source page + license) via the Commons API. Outputs packs/art.sqlite with a
 * `metadata` table and an `art_scenes` table (works stored as JSON).
 *
 * Every image is public domain / CC0 (creator died 70+ years ago). Files that do
 * not resolve are skipped with a warning rather than shipped as broken links.
 *
 * Usage: node scripts/build-art-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ART_SCENES } from './art-scenes-data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs');
const OUTPUT_PATH = join(PACKS_DIR, 'art.sqlite');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ProjectBible-art-pack/1.0 (offline Bible study app; build script)';
const THUMB_WIDTH = 1600;

if (!existsSync(PACKS_DIR)) mkdirSync(PACKS_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve a batch (≤50) of Commons filenames → { name: {imageUrl, thumbUrl, sourceUrl, license} }. */
async function resolveBatch(files) {
  const titles = files.map((f) => 'File:' + f).join('|');
  const url =
    `${API}?action=query&format=json&prop=imageinfo` +
    `&iiprop=url|extmetadata|mime&iiurlwidth=${THUMB_WIDTH}` +
    `&titles=${encodeURIComponent(titles)}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Rate limited (plain-text error) — back off and retry.
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const out = {};
    const normMap = {};
    (data.query?.normalized || []).forEach((n) => { normMap[n.to] = n.from; });
    const pages = data.query?.pages || {};
    for (const pid in pages) {
      const p = pages[pid];
      const from = (normMap[p.title] || p.title).replace(/^File:/, '');
      if (p.missing !== undefined || !p.imageinfo?.[0]) { out[from] = null; continue; }
      const ii = p.imageinfo[0];
      const license = ii.extmetadata?.LicenseShortName?.value || 'Public domain';
      out[from] = {
        imageUrl: ii.thumburl,
        thumbUrl: ii.thumburl.replace(/\/\d+px-/, '/400px-'),
        sourceUrl: ii.descriptionurl,
        license: license.replace(/<[^>]+>/g, '').trim(),
      };
    }
    return out;
  }
  throw new Error('Commons API kept rate-limiting after retries');
}

// ── Resolve every work ─────────────────────────────────────────────────────

console.log('Building biblical art pack...\n');

// Collect unique filenames across all scenes
const allFiles = [...new Set(ART_SCENES.flatMap((s) => s.works.map((w) => w.file)))];
const resolved = {};
for (let i = 0; i < allFiles.length; i += 20) {
  const batch = allFiles.slice(i, i + 20);
  const map = await resolveBatch(batch);
  Object.assign(resolved, map);
  await sleep(400); // be polite to the API
}

// ── Build the pack ──────────────────────────────────────────────────────────

if (existsSync(OUTPUT_PATH)) {
  unlinkSync(OUTPUT_PATH);
  console.log('Removed existing art.sqlite\n');
}

const db = new Database(OUTPUT_PATH);
db.exec(`
  CREATE TABLE metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE art_scenes (
    id            TEXT PRIMARY KEY,
    title         TEXT    NOT NULL,
    book          TEXT    NOT NULL,
    chapter       INTEGER NOT NULL,
    verse         INTEGER NOT NULL,
    passage_label TEXT,
    works         TEXT    NOT NULL
  );

  CREATE INDEX idx_art_book_chapter ON art_scenes (book, chapter);
  CREATE INDEX idx_art_anchor       ON art_scenes (book, chapter, verse);
`);

const meta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
meta.run('pack_id', 'biblical-art');
meta.run('pack_type', 'art');
meta.run('pack_version', '1.0');
meta.run('source', 'Wikimedia Commons (public domain)');
meta.run('license', 'Public domain / CC0');
meta.run('attribution', 'Images courtesy of Wikimedia Commons — public-domain works of art.');
meta.run('description', 'Famous public-domain paintings tied to scenes in Scripture. Tap the in-text art icon to view.');

const insertScene = db.prepare(`
  INSERT OR REPLACE INTO art_scenes (id, title, book, chapter, verse, passage_label, works)
  VALUES (@id, @title, @book, @chapter, @verse, @passageLabel, @works)
`);

let sceneCount = 0;
let workCount = 0;
let skipped = 0;

for (const scene of ART_SCENES) {
  const works = [];
  for (const w of scene.works) {
    const r = resolved[w.file];
    if (!r) {
      console.warn(`  ⚠  MISSING on Commons, skipping work: "${w.file}" (${scene.id})`);
      skipped++;
      continue;
    }
    works.push({
      title: w.title,
      artist: w.artist,
      year: w.year,
      imageUrl: r.imageUrl,
      thumbUrl: r.thumbUrl,
      sourceUrl: r.sourceUrl,
      license: r.license,
      description: w.description,
    });
  }
  if (works.length === 0) {
    console.warn(`  ⚠  No resolvable works — skipping scene "${scene.id}"`);
    continue;
  }
  insertScene.run({
    id: scene.id,
    title: scene.title,
    book: scene.book,
    chapter: scene.chapter,
    verse: scene.verse,
    passageLabel: scene.passageLabel ?? null,
    works: JSON.stringify(works),
  });
  sceneCount++;
  workCount += works.length;
  console.log(`  ✓  ${scene.title.padEnd(34)} ${works.length} work(s)`);
}

db.close();

console.log(`\n✅ art.sqlite built: ${sceneCount} scenes, ${workCount} works` + (skipped ? `, ${skipped} skipped` : ''));
console.log(`   Output: ${OUTPUT_PATH}`);
