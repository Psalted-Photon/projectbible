import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const releaseBase = process.env.PACK_RELEASE_BASE;
const lfsRepo =
  process.env.PACK_LFS_REPO ||
  'https://github.com/Psalted-Photon/projectbible.git';

const packDir = resolve(__dirname, '../apps/pwa-polished/public/packs/consolidated');

const packs = [
  'translations.sqlite',
  'dictionary-en.sqlite',
  'ancient-languages.sqlite',
  'lexical.sqlite',
  'study-tools.sqlite'
];

async function readPointerOrSignature(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    if (content.startsWith('version https://git-lfs.github.com/spec/v1')) {
      const oidMatch = content.match(/oid sha256:([a-f0-9]{64})/i);
      const sizeMatch = content.match(/size (\d+)/);
      if (!oidMatch || !sizeMatch) {
        throw new Error(`Invalid LFS pointer format in ${filePath}`);
      }
      return { type: 'lfs', oid: oidMatch[1], size: Number(sizeMatch[1]) };
    }

    if (content.startsWith('SQLite format 3')) {
      return { type: 'sqlite' };
    }

    return { type: 'unknown' };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { type: 'missing' };
    }
    throw error;
  }
}

function assertSqlite(buffer, filename) {
  const signature = buffer.subarray(0, 15).toString('utf8');
  if (!signature.startsWith('SQLite format 3')) {
    throw new Error(`Downloaded ${filename} is not a valid SQLite database (signature: ${signature})`);
  }
}

async function downloadFromRelease(filename) {
  if (!releaseBase) {
    return null;
  }

  const url = `${releaseBase}/${filename}`;
  console.log(`⬇️  Downloading ${filename} from ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${filename}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  assertSqlite(buffer, filename);
  return buffer;
}

async function downloadFromLfs(oid, size, filename) {
  const batchUrl = `${lfsRepo.replace(/\.git$/, '')}.git/info/lfs/objects/batch`;

  console.log(`⬇️  Downloading ${filename} from LFS (${oid})`);

  const authHeader = process.env.GIT_LFS_TOKEN
    ? { Authorization: `Bearer ${process.env.GIT_LFS_TOKEN}` }
    : {};

  const batchResponse = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.git-lfs+json',
      'Content-Type': 'application/vnd.git-lfs+json',
      ...authHeader
    },
    body: JSON.stringify({
      operation: 'download',
      transfers: ['basic'],
      objects: [{ oid, size }]
    })
  });

  if (!batchResponse.ok) {
    throw new Error(`LFS batch request failed: ${batchResponse.status} ${batchResponse.statusText}`);
  }

  const batch = await batchResponse.json();
  const objectInfo = batch.objects?.[0];
  const href = objectInfo?.actions?.download?.href;
  if (!href) {
    throw new Error(`LFS batch response missing download URL for ${filename}`);
  }

  const downloadResponse = await fetch(href);
  if (!downloadResponse.ok) {
    throw new Error(`LFS download failed: ${downloadResponse.status} ${downloadResponse.statusText}`);
  }

  const buffer = Buffer.from(await downloadResponse.arrayBuffer());
  assertSqlite(buffer, filename);
  return buffer;
}

async function ensurePack(filename) {
  const dest = resolve(packDir, filename);
  const status = await readPointerOrSignature(dest);

  if (status.type === 'sqlite') {
    console.log(`✓ Using existing pack ${filename}`);
    return;
  }

  let buffer = null;

  if (status.type === 'lfs') {
    buffer = await downloadFromLfs(status.oid, status.size, filename);
  } else if (status.type === 'missing') {
    buffer = await downloadFromRelease(filename);
  } else if (status.type === 'unknown') {
    buffer = await downloadFromRelease(filename);
  }

  if (!buffer) {
    throw new Error(`Unable to fetch ${filename}. Set PACK_RELEASE_BASE or ensure LFS access.`);
  }

  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buffer);
  console.log(`✅ Saved ${filename} to ${dest}`);
}

async function ensurePacks() {
  // Skip bundling in production - packs are downloaded from GitHub Releases
  if (process.env.NODE_ENV === 'production') {
    console.log('📦 Skipping pack bundling in production mode (packs will be downloaded from GitHub Releases)');
    return;
  }

  await mkdir(packDir, { recursive: true });

  for (const filename of packs) {
    await ensurePack(filename);
  }
}

ensurePacks().catch((error) => {
  console.error('Failed to ensure bundled packs:', error);
  process.exit(1);
});
