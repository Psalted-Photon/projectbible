#!/usr/bin/env node
/**
 * Download GeoNames data files needed to build the modern places pack.
 *
 * Downloads to: data-sources/geonames/
 *   - cities1000.zip  → cities1000.txt  (~130K populated places, pop > 1,000)
 *   - admin1CodesASCII.txt               (~3,800 states/provinces worldwide)
 *   - countryInfo.txt                    (~250 countries with metadata)
 *
 * License: GeoNames data is CC BY 4.0
 * Source:  https://download.geonames.org/export/dump/
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { get as httpsGet } from 'https';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'data-sources', 'geonames');

const BASE_URL = 'https://download.geonames.org/export/dump';

const FILES = [
  { url: `${BASE_URL}/cities1000.zip`,         dest: 'cities1000.zip',         extract: true },
  { url: `${BASE_URL}/admin1CodesASCII.txt`,   dest: 'admin1CodesASCII.txt',   extract: false },
  { url: `${BASE_URL}/countryInfo.txt`,        dest: 'countryInfo.txt',        extract: false },
];

if (!existsSync(OUT_DIR)) {
  mkdirSync(OUT_DIR, { recursive: true });
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    httpsGet(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        return download(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }
      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        process.stdout.write(`\r  ${Math.round(downloaded / 1024)}KB downloaded...`);
      });
      response.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\n'); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function extractZip(zipPath, outDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  for (const entry of entries) {
    if (!entry.isDirectory) {
      zip.extractEntryTo(entry, outDir, false, true);
      console.log(`  Extracted: ${entry.entryName}`);
    }
  }
}

async function main() {
  console.log('📥 Downloading GeoNames data files...\n');

  for (const file of FILES) {
    const destPath = join(OUT_DIR, file.dest);

    if (existsSync(destPath)) {
      console.log(`  ✅ Already exists: ${file.dest}`);
    } else {
      console.log(`  Downloading: ${file.dest}`);
      await download(file.url, destPath);
      console.log(`  ✅ Saved: ${file.dest}`);
    }

    if (file.extract) {
      const txtPath = join(OUT_DIR, file.dest.replace('.zip', '.txt'));
      if (existsSync(txtPath)) {
        console.log(`  ✅ Already extracted: ${file.dest.replace('.zip', '.txt')}`);
      } else {
        console.log(`  Extracting: ${file.dest}`);
        try {
          await extractZip(destPath, OUT_DIR);
        } catch (err) {
          console.error(`  ⚠️  Could not extract zip: ${err.message}`);
          process.exit(1);
        }
      }
    }
  }

  console.log('\n✅ All GeoNames files ready in data-sources/geonames/');
  console.log('   Next: node scripts/build-geonames-pack.mjs');
}

main().catch((err) => { console.error('❌ Error:', err.message); process.exit(1); });
