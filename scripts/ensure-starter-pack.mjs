/**
 * ensure-starter-pack.mjs
 *
 * Puts starter.sqlite where the app can fetch it from its own origin —
 * apps/pwa-polished/public/, which vite copies into dist.
 *
 * Two sources, because CI and a laptop have different things available. Locally
 * the built pack is sitting in packs/ and is simply copied. On Vercel that file
 * is an unmaterialised Git LFS pointer, so it is downloaded from the release
 * instead — the same trick ensure-bundled-packs.mjs uses.
 *
 * This one is deliberately fatal. Every other pack is optional and downloads on
 * demand; the starter is the text a first-time visitor reads, so a deploy
 * without it ships an app that opens to an empty page.
 *
 * Usage: node scripts/ensure-starter-pack.mjs
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const releaseBase =
  process.env.PACK_RELEASE_BASE ||
  'https://github.com/Psalted-Photon/projectbible/releases/download/packs-v1.0.0';

const FILENAME = 'starter.sqlite';
const source = resolve(__dirname, '../packs', FILENAME);
const dest = resolve(__dirname, '../apps/pwa-polished/public', FILENAME);

/** An LFS pointer is a ~130-byte text file, so size alone is not enough. */
function isSqlite(buffer) {
  return buffer.subarray(0, 15).toString('utf8') === 'SQLite format 3';
}

async function readLocal() {
  try {
    const buffer = await readFile(source);
    if (!isSqlite(buffer)) {
      console.log(`📦 ${source} is a Git LFS pointer, not a database — falling back to the release`);
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
}

async function downloadFromRelease() {
  const url = `${releaseBase}/${FILENAME}`;
  console.log(`⬇️  Downloading ${FILENAME} from ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${FILENAME}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!isSqlite(buffer)) {
    throw new Error(`Downloaded ${FILENAME} is not a valid SQLite database`);
  }
  return buffer;
}

async function ensureStarterPack() {
  const buffer = (await readLocal()) ?? (await downloadFromRelease());

  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buffer);
  console.log(`✅ Starter pack ready: ${dest} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
}

ensureStarterPack().catch((error) => {
  console.error('\n❌ Could not stage the starter pack — refusing to build.');
  console.error(`   ${error.message}`);
  console.error(`   Upload ${FILENAME} to the release, or run: node scripts/build-starter-pack.mjs\n`);
  process.exit(1);
});
