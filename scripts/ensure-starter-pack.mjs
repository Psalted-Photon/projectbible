/**
 * ensure-starter-pack.mjs
 *
 * Puts starter.sqlite where the app can fetch it from its own origin —
 * apps/pwa-polished/public/, which vite copies into dist.
 *
 * Two sources, because CI and a laptop have different things available. Locally
 * the built pack is sitting in packs/ and is simply copied. On Vercel that file
 * is an unmaterialized Git LFS pointer, so it is downloaded from the release
 * instead — the same trick ensure-bundled-packs.mjs uses.
 *
 * This one is deliberately fatal. Every other pack is optional and downloads on
 * demand; the starter is the text a first-time visitor reads, so a deploy
 * without it ships an app that opens to an empty page.
 *
 * The LFS pointer names the sha256 of the starter this commit was built with,
 * and the download has to match it. Without that check a release copy that was
 * never replaced after a rebuild ships quietly, and every device that is told
 * to fetch the corrected starter fetches the old one again.
 *
 * Usage: node scripts/ensure-starter-pack.mjs
 */

import { createHash } from 'crypto';
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

/** The sha256 an LFS pointer names, or null if this is not one. */
function pointerSha256(buffer) {
  const match = /^oid sha256:([a-f0-9]{64})$/m.exec(buffer.subarray(0, 512).toString('utf8'));
  return match ? match[1] : null;
}

/** The pack itself, or the hash the release copy must have. */
async function readLocal() {
  try {
    const buffer = await readFile(source);
    if (!isSqlite(buffer)) {
      console.log(`📦 ${source} is a Git LFS pointer, not a database — falling back to the release`);
      return { buffer: null, expectedSha256: pointerSha256(buffer) };
    }
    return { buffer, expectedSha256: null };
  } catch {
    return { buffer: null, expectedSha256: null };
  }
}

async function downloadFromRelease(expectedSha256) {
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

  const actual = createHash('sha256').update(buffer).digest('hex');
  if (!expectedSha256) {
    console.warn(`⚠️  No LFS pointer to check against — using the release copy unchecked (${actual})`);
  } else if (actual !== expectedSha256) {
    throw new Error(
      `The release's ${FILENAME} (${actual}) is not the one this commit was built with (${expectedSha256}). ` +
      `Upload packs/${FILENAME} to the release, then deploy again.`
    );
  } else {
    console.log(`🔒 ${FILENAME} matches this commit (${actual})`);
  }
  return buffer;
}

async function ensureStarterPack() {
  const local = await readLocal();
  const buffer = local.buffer ?? (await downloadFromRelease(local.expectedSha256));

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
