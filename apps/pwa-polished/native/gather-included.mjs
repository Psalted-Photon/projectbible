#!/usr/bin/env node
// Gathers everything the Android app carries inside it: every pack and every
// Read Aloud voice. build-android.mjs runs this before Gradle; run on its own,
// it checks the packs and fetches any voice not yet on this PC.
//
//   node apps/pwa-polished/native/gather-included.mjs
//
// The app reads these at https://localhost/included/ (src/lib/platform.ts):
//
//   included/packs/    every file in packs/consolidated/manifest.json (the
//                      packs and Voice Control's models), and a copy of that
//                      manifest whose download addresses point here
//   included/voices/   the Read Aloud voices, one folder per engine, each file
//                      named as the app names it on the phone, and index.json
//                      listing them with their sizes
//
// They are staged in android/app/included-assets/public/included/, which
// app/build.gradle adds to the APK's assets, rather than in assets/public,
// which Capacitor empties on every sync. Staged as hard links where possible,
// so the packs take no second copy of disk space on this PC.
//
// Each pack is checked against the manifest's SHA-256 first: a pack rebuilt
// without regenerating the manifest would fail its install on the phone, so
// the build stops here instead. Checked hashes are remembered by file size and
// date in cache/pack-hashes.json, so an unchanged pack isn't read again.
//
// Voices are downloaded once into cache/voices/ from the same addresses the
// web app uses (src/lib/tts/voices.ts, read as it is), and reused after.
// Delete a file there to fetch it again. Jacob, a mix of three voices, is
// mixed here the way the app mixes him (kokoroEngine.ts blendStyles).

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const NATIVE = dirname(fileURLToPath(import.meta.url));
const APP = join(NATIVE, '..');
const REPO = join(APP, '..', '..');
const ANDROID_APP = join(NATIVE, 'android', 'app');
const STAGE = join(ANDROID_APP, 'included-assets', 'public', 'included');
const PACKS_SRC = join(REPO, 'packs', 'consolidated');
const CACHE = join(NATIVE, 'cache');
const VOICE_CACHE = join(CACHE, 'voices');
const HASH_CACHE = join(CACHE, 'pack-hashes.json');
/** Where the Phase 0 build put the packs; removed so they don't ship twice. */
const OLD_PACKS = join(ANDROID_APP, 'src', 'main', 'assets', 'public', 'api');

/** Must match INCLUDED_PACKS in src/lib/platform.ts. */
const PACKS_URL = '/included/packs';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

class GatherError extends Error {}

// ── Staging ─────────────────────────────────────────────────────────────────

/** Every file staged this run, relative to STAGE, so leftovers can go. */
const staged = new Set();

/** Put `src` at `rel` under STAGE: a hard link, or a copy where one can't be made. */
function stage(src, rel) {
  const dest = join(STAGE, rel);
  staged.add(rel.split(sep).join('/'));
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) {
    const a = statSync(src, { bigint: true });
    const b = statSync(dest, { bigint: true });
    if (a.ino === b.ino && a.dev === b.dev) return; // already this very file
    // A copy from an earlier run (no link possible), still current.
    if (a.size === b.size && b.mtimeMs >= a.mtimeMs) return;
    rmSync(dest);
  }
  try {
    linkSync(src, dest);
  } catch {
    copyFileSync(src, dest);
  }
}

/** Remove whatever an earlier run staged that this one didn't. */
function removeLeftovers(dir = STAGE) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      removeLeftovers(path);
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
    } else if (!staged.has(relative(STAGE, path).split(sep).join('/'))) {
      rmSync(path);
      console.log(`  removed ${relative(STAGE, path)}`);
    }
  }
}

// ── Packs ───────────────────────────────────────────────────────────────────

async function sha256Of(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function gatherPacks() {
  const manifestFile = join(PACKS_SRC, 'manifest.json');
  if (!existsSync(manifestFile)) throw new GatherError(`No pack manifest at ${manifestFile}.`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const known = readJson(HASH_CACHE, {});
  const checked = {};
  const kept = [];
  const missing = [];
  const wrong = [];
  let total = 0;

  for (const pack of manifest.packs ?? []) {
    const file = basename(String(pack.downloadUrl ?? ''));
    const src = join(PACKS_SRC, file);
    if (!file || !existsSync(src)) {
      missing.push(pack.id);
      continue;
    }
    const { size, mtimeMs } = statSync(src);
    const key = `${size}:${mtimeMs}`;
    const sha = known[file]?.key === key ? known[file].sha : await sha256Of(src);
    checked[file] = { key, sha };
    if (sha !== String(pack.sha256).toLowerCase()) {
      wrong.push(file);
      continue;
    }
    stage(src, join('packs', file));
    kept.push({ ...pack, downloadUrl: `${PACKS_URL}/${file}` });
    total += size;
  }

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(HASH_CACHE, JSON.stringify(checked, null, 1));

  if (wrong.length) {
    throw new GatherError(
      `These packs don't match the manifest: ${wrong.join(', ')}.\n` +
        '  Regenerate it (node scripts/generate-manifest.mjs) and build again.',
    );
  }

  // The manifest the app reads: only what is really inside, pointing here.
  const out = join(STAGE, 'packs', 'manifest.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ...manifest, packs: kept }, null, 2));
  staged.add('packs/manifest.json');

  console.log(`  ${kept.length} pack files, ${mb(total)}, all match the manifest`);
  if (missing.length) console.warn(`  ⚠ not in packs/consolidated, so not in the app: ${missing.join(', ')}`);
}

// ── Voices ──────────────────────────────────────────────────────────────────

/** src/lib/tts/voices.ts, which has no imports, turned into JavaScript and loaded. */
async function loadVoiceCatalog() {
  // The repo's own esbuild (Vite brings it); this folder is its own npm project.
  const esbuild = createRequire(join(REPO, 'package.json'))('esbuild');
  const source = readFileSync(join(APP, 'src', 'lib', 'tts', 'voices.ts'), 'utf8');
  const { code } = await esbuild.transform(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** Download `url` to `dest` once. Later runs find it there and skip it. */
async function fetchOnce(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return false;
  mkdirSync(dirname(dest), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new GatherError(`Download failed (${response.status}) for ${url}`);
  const total = Number(response.headers.get('content-length')) || 0;
  console.log(`  downloading ${basename(dest)}${total ? ` (${mb(total)})` : ''}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
  renameSync(part, dest);
  return true;
}

/** The same sum as kokoroEngine.ts blendStyles, so Jacob sounds as he does on the web. */
function blendStyles(files, shares) {
  const total = shares.reduce((sum, s) => sum + s, 0);
  let out = null;
  files.forEach((file, i) => {
    const bytes = readFileSync(file);
    const vec = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    out ??= new Float32Array(vec.length);
    if (vec.length !== out.length) throw new GatherError(`Style vectors differ in size: ${file}`);
    const weight = shares[i] / total;
    for (let j = 0; j < out.length; j++) out[j] += vec[j] * weight;
  });
  return Buffer.from(out.buffer);
}

async function gatherVoices() {
  const catalog = await loadVoiceCatalog();
  const voices = [...catalog.TTS_VOICES, ...catalog.KOKORO_VOICES];
  /** engine folder → file name → size, the index the app lists from. */
  const index = { piper: {}, kokoro: {} };
  let fetched = 0;

  const put = (engine, name, file) => {
    stage(file, join('voices', engine, name));
    index[engine][name] = statSync(file).size;
  };

  for (const voice of voices) {
    const source = catalog.resolveVoiceSource(voice);
    if (!source) continue;

    if (source.engine === 'piper') {
      const model = join(VOICE_CACHE, 'piper', catalog.voiceModelName(voice.id));
      const config = join(VOICE_CACHE, 'piper', catalog.voiceConfigName(voice.id));
      if (await fetchOnce(source.configUrl, config)) fetched++;
      if (await fetchOnce(source.modelUrl, model)) fetched++;
      put('piper', basename(model), model);
      put('piper', basename(config), config);
      continue;
    }

    const model = join(VOICE_CACHE, 'kokoro', catalog.KOKORO_MODEL_FILE);
    if (await fetchOnce(source.modelUrl, model)) fetched++;
    put('kokoro', catalog.KOKORO_MODEL_FILE, model);

    // Every style vector the voice is made of, kept apart from the voices
    // themselves so a vector used only in a mix never shows as a voice.
    const parts = [];
    for (const style of source.styles) {
      const file = join(VOICE_CACHE, 'kokoro-styles', basename(new URL(style.url).pathname));
      if (await fetchOnce(style.url, file)) fetched++;
      parts.push(file);
    }
    const name = `${voice.id}.bin`;
    if (parts.length === 1) {
      put('kokoro', name, parts[0]);
    } else {
      const mixed = join(VOICE_CACHE, 'kokoro-mixed', name);
      const bytes = blendStyles(parts, source.styles.map((s) => s.share));
      if (!existsSync(mixed) || !readFileSync(mixed).equals(bytes)) {
        mkdirSync(dirname(mixed), { recursive: true });
        writeFileSync(mixed, bytes);
      }
      put('kokoro', name, mixed);
    }
  }

  const out = join(STAGE, 'voices', 'index.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(index, null, 2));
  staged.add('voices/index.json');

  const sizes = [...Object.values(index.piper), ...Object.values(index.kokoro)];
  const count = Object.keys(index.piper).filter((n) => !n.endsWith('.json')).length +
    Object.keys(index.kokoro).filter((n) => n.endsWith('.bin')).length;
  console.log(
    `  ${count} voices, ${mb(sizes.reduce((a, b) => a + b, 0))}` +
      (fetched ? ` (${fetched} files downloaded to native/cache/voices)` : ''),
  );
}

// ── All of it ───────────────────────────────────────────────────────────────

export async function gatherIncluded() {
  rmSync(OLD_PACKS, { recursive: true, force: true });
  await gatherPacks();
  await gatherVoices();
  removeLeftovers();
}

const runDirectly =
  !!process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (runDirectly) {
  gatherIncluded().catch((error) => {
    console.error(`\n✗ ${error instanceof GatherError ? error.message : error?.stack ?? error}`);
    process.exit(1);
  });
}
