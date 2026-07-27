#!/usr/bin/env node
/**
 * Build Biblical Art Pack (offline / images bundled)
 *
 * Reads the curated scene list (scripts/art-scenes-data.mjs). For each artwork it
 *   1. resolves a Wikimedia Commons filename (exact `file`, or `search` query),
 *   2. downloads the image at ~1600px (full) and ~400px (thumbnail),
 *   3. embeds the raw bytes in the pack (art_images table, deduped by content id).
 * `art_scenes.works` references those images by id, so the app shows every
 * painting fully offline. All works are public domain.
 *
 * Output: packs/art.sqlite  ·  Usage: node scripts/build-art-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { ART_SCENES } from './art-scenes-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const PACKS_DIR = join(repoRoot, 'packs', 'consolidated');
const OUTPUT_PATH = join(PACKS_DIR, 'art.sqlite');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ProjectBible-art-pack/1.0 (offline Bible study app; build script)';
const FULL_WIDTH = 1600;
const THUMB_WIDTH = 400;

if (!existsSync(PACKS_DIR)) mkdirSync(PACKS_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id16 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

/** GET a Commons API URL as JSON. Polite base delay + long backoff; returns null if it keeps rate-limiting. */
async function apiJson(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(attempt === 0 ? 1800 : 4000 * attempt);
    let text;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      text = await res.text();
    } catch {
      continue;
    }
    try {
      return JSON.parse(text);
    } catch {
      /* rate limited (plain-text error) — back off and retry */
    }
  }
  return null;
}

const infoFromII = (ii) => ({
  fullUrl: ii.thumburl,
  thumbUrl: ii.thumburl.replace(/\/\d+px-/, `/${THUMB_WIDTH}px-`),
  sourceUrl: ii.descriptionurl,
  license: (ii.extmetadata?.LicenseShortName?.value || 'Public domain').replace(/<[^>]+>/g, '').trim(),
  mime: ii.mime || 'image/jpeg',
});

/** Resolve a search query in ONE call → { filename, fullUrl, thumbUrl, sourceUrl, license, mime } or null. */
async function searchResolve(query) {
  const url =
    `${API}?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8` +
    `&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=${FULL_WIDTH}`;
  const data = await apiJson(url);
  if (!data) return null;
  const pages = Object.values(data.query?.pages || {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  const raster = pages
    .map((p) => p.imageinfo?.[0])
    .filter((ii) => ii && (ii.mime === 'image/jpeg' || ii.mime === 'image/png') && (ii.width || 0) >= 700);
  if (raster.length === 0) return null;
  const chosen = raster.find((ii) => (ii.width || 0) >= 1200) || raster.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  const filename = decodeURIComponent(chosen.descriptionurl.split('/wiki/File:')[1] || '').replace(/_/g, ' ');
  return { filename, ...infoFromII(chosen) };
}

/** imageinfo for an exact filename → info or null. */
async function imageInfo(filename) {
  const url =
    `${API}?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|mime` +
    `&iiurlwidth=${FULL_WIDTH}&titles=${encodeURIComponent('File:' + filename)}`;
  const data = await apiJson(url);
  if (!data) return null;
  const page = Object.values(data.query?.pages || {})[0];
  if (!page || page.missing !== undefined || !page.imageinfo?.[0]) return null;
  return { filename, ...infoFromII(page.imageinfo[0]) };
}

/** Resolve a work (exact file or search) to image info, or null. */
async function resolveWork(w) {
  if (w.file) return await imageInfo(w.file);
  if (w.search) return await searchResolve(w.search);
  return null;
}

async function download(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      /* network hiccup / timeout — retry */
    }
    await sleep(1200 * (attempt + 1));
  }
  return null;
}

// ── Resolve + download every work ───────────────────────────────────────────

console.log(`Building biblical art pack from ${ART_SCENES.length} scenes...\n`);

const images = new Map(); // imageId → { mime, data:Buffer }
const sceneRows = [];
let totalBytes = 0;
let skipped = 0;

for (const scene of ART_SCENES) {
  const works = [];
  for (const w of scene.works) {
    const info = await resolveWork(w);
    if (!info || !info.filename) {
      console.warn(`  ⚠  unresolved: "${w.file || w.search}" (${scene.id})`);
      skipped++;
      continue;
    }
    const filename = info.filename;
    const imageId = id16(filename + ':full');
    const thumbId = id16(filename + ':thumb');
    if (!images.has(imageId)) {
      const full = await download(info.fullUrl);
      await sleep(150);
      const thumb = await download(info.thumbUrl);
      if (!full) { console.warn(`  ⚠  download failed: "${filename}"`); skipped++; continue; }
      images.set(imageId, { mime: info.mime, data: full });
      totalBytes += full.length;
      if (thumb) { images.set(thumbId, { mime: info.mime, data: thumb }); totalBytes += thumb.length; }
    }

    works.push({
      title: w.title,
      artist: w.artist,
      year: w.year,
      imageId,
      thumbId: images.has(thumbId) ? thumbId : imageId,
      sourceUrl: info.sourceUrl,
      license: info.license,
      description: w.description,
    });
  }

  if (works.length === 0) { console.warn(`  ⚠  skipping scene "${scene.id}" (no works)`); continue; }
  sceneRows.push({ ...scene, works });
  console.log(`  ✓  ${scene.title.padEnd(34)} ${works.length} work(s)`);
}

// ── Write the pack ──────────────────────────────────────────────────────────

if (existsSync(OUTPUT_PATH)) { unlinkSync(OUTPUT_PATH); console.log('\nRemoved existing art.sqlite'); }

const db = new Database(OUTPUT_PATH);
db.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE art_scenes (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, book TEXT NOT NULL,
    chapter INTEGER NOT NULL, verse INTEGER NOT NULL, passage_label TEXT, works TEXT NOT NULL
  );
  CREATE TABLE art_images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL);
  CREATE INDEX idx_art_book_chapter ON art_scenes (book, chapter);
  CREATE INDEX idx_art_anchor       ON art_scenes (book, chapter, verse);
`);

const meta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
for (const [k, v] of [
  ['pack_id', 'biblical-art'],
  ['pack_type', 'art'],
  ['pack_version', '2.0'],
  ['version', '2.0'],          // read by generate-manifest.mjs
  ['schemaVersion', '1'],
  ['minAppVersion', '1.0.0'],
  ['createdAt', new Date().toISOString()],
  ['source', 'Wikimedia Commons (public domain)'],
  ['license', 'Public domain / CC0'],
  ['attribution', 'Images courtesy of Wikimedia Commons — public-domain works of art.'],
  ['description', 'Famous public-domain paintings tied to scenes in Scripture, bundled for offline viewing.'],
]) meta.run(k, v);

const insImg = db.prepare('INSERT OR REPLACE INTO art_images (id, mime, data) VALUES (?, ?, ?)');
const insImgAll = db.transaction((entries) => { for (const [id, img] of entries) insImg.run(id, img.mime, img.data); });
insImgAll([...images.entries()]);

const insScene = db.prepare(`
  INSERT OR REPLACE INTO art_scenes (id, title, book, chapter, verse, passage_label, works)
  VALUES (@id, @title, @book, @chapter, @verse, @passageLabel, @works)
`);
const insSceneAll = db.transaction((rows) => {
  for (const s of rows) insScene.run({
    id: s.id, title: s.title, book: s.book, chapter: s.chapter, verse: s.verse,
    passageLabel: s.passageLabel ?? null, works: JSON.stringify(s.works),
  });
});
insSceneAll(sceneRows);

db.close();

const mb = (totalBytes / (1024 * 1024)).toFixed(1);
console.log(`\n✅ art.sqlite built: ${sceneRows.length} scenes, ${images.size} images, ${mb} MB of art` + (skipped ? `, ${skipped} skipped` : ''));
console.log(`   Output: ${OUTPUT_PATH}`);
