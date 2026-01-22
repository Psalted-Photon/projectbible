import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const releaseBase =
  process.env.PACK_RELEASE_BASE ||
  'https://github.com/Psalted-Photon/ProjectBible/releases/download/packs-v1.0.0';

const packDir = resolve(__dirname, '../apps/pwa-polished/public/packs/consolidated');

const packs = [
  'translations.sqlite',
  'dictionary-en.sqlite',
  'ancient-languages.sqlite',
  'lexical.sqlite',
  'study-tools.sqlite'
];

async function isLfsPointer(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return content.startsWith('version https://git-lfs.github.com/spec/v1');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

async function downloadPack(filename) {
  const url = `${releaseBase}/${filename}`;
  const dest = resolve(packDir, filename);

  console.log(`⬇️  Downloading ${filename} from ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${filename}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  // Basic SQLite signature check
  const signature = buffer.subarray(0, 15).toString('utf8');
  if (!signature.startsWith('SQLite format 3')) {
    throw new Error(`Downloaded ${filename} is not a valid SQLite database (signature: ${signature})`);
  }

  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buffer);
  console.log(`✅ Saved ${filename} to ${dest}`);
}

async function ensurePacks() {
  await mkdir(packDir, { recursive: true });

  for (const filename of packs) {
    const dest = resolve(packDir, filename);
    const needsDownload = await isLfsPointer(dest);
    if (needsDownload) {
      await downloadPack(filename);
    } else {
      console.log(`✓ Using existing pack ${filename}`);
    }
  }
}

ensurePacks().catch((error) => {
  console.error('Failed to ensure bundled packs:', error);
  process.exit(1);
});
