#!/usr/bin/env node
/**
 * Build Biblical Art Pack (offline / images bundled)
 *
 * Reads the curated scene list (scripts/art-scenes-data.mjs). For each artwork it
 *   1. looks up its exact Wikimedia Commons `file`,
 *   2. downloads the image at 1920px (or the original, if smaller),
 *   3. embeds the raw bytes in the pack (art_images table, deduped by content id).
 * `art_scenes.works` references those images by id, so the app shows every
 * painting fully offline. All works are public domain.
 *
 * No thumbnails are bundled: the app makes its own small previews from the
 * full image (lib/artThumbs.ts), so works carry no `thumbId`.
 *
 * Strict: if any painting fails to resolve or download, nothing is written and
 * the build exits with an error, so a scene can never drop out of the pack
 * unnoticed.
 *
 * Output: packs/consolidated/art.sqlite + art-images-NN.sqlite
 * Usage: node scripts/build-art-pack.mjs
 */

import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { ART_SCENES } from './art-scenes-data.mjs';
import { writeArtPackFiles } from './art-pack-shards.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const PACKS_DIR = join(repoRoot, 'packs', 'consolidated');
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ProjectBible-art-pack/1.0 (offline Bible study app; build script)';
// Commons serves only its standard thumbnail widths (… 500, 960, 1280, 1920):
// any other request is rounded up, or refused outright for a direct thumb URL.
const FULL_WIDTH = 1920;

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
  sourceUrl: ii.descriptionurl,
  license: (ii.extmetadata?.LicenseShortName?.value || 'Public domain').replace(/<[^>]+>/g, '').trim(),
  mime: ii.mime || 'image/jpeg',
});

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
const failures = [];
let totalBytes = 0;

for (const scene of ART_SCENES) {
  const works = [];
  for (const w of scene.works) {
    if (!w.file) { failures.push(`no file: "${w.title}" (${scene.id})`); continue; }
    const info = await imageInfo(w.file);
    if (!info) { failures.push(`unresolved: "${w.file}" (${scene.id})`); continue; }
    const filename = info.filename;
    const imageId = id16(filename + ':full');
    if (!images.has(imageId)) {
      const full = await download(info.fullUrl);
      await sleep(150);
      if (!full) { failures.push(`download failed: "${filename}" (${scene.id})`); continue; }
      images.set(imageId, { mime: info.mime, data: full });
      totalBytes += full.length;
    }

    works.push({
      title: w.title,
      artist: w.artist,
      year: w.year,
      imageId,
      sourceUrl: info.sourceUrl,
      license: info.license,
      description: w.description,
    });
  }

  sceneRows.push({ ...scene, works });
  const mark = works.length === scene.works.length ? '✓' : '✗';
  console.log(`  ${mark}  ${scene.title.padEnd(34)} ${works.length} of ${scene.works.length} work(s)`);
}

if (failures.length) {
  console.error(`\n❌ ${failures.length} painting(s) failed; nothing was written:`);
  for (const f of failures) console.error(`   ${f}`);
  process.exit(1);
}

// ── Write the pack ──────────────────────────────────────────────────────────
//
// Scenes go in art.sqlite; images go in shards. See art-pack-shards.mjs for why
// (sql.js holds a whole database in memory, so one big file is what broke).

const { scenesPath, shardPaths } = writeArtPackFiles({
  packsDir: PACKS_DIR,
  sceneRows,
  images,
});

const mb = (totalBytes / (1024 * 1024)).toFixed(1);
console.log(
  `
✅ art pack built: ${sceneRows.length} scenes, ${images.size} images, ${mb} MB of art, 0 skipped`
);
console.log(`   Scenes: ${scenesPath}`);
console.log(`   Shards: ${shardPaths.length}`);
