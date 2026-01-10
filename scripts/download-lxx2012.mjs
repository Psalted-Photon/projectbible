#!/usr/bin/env node

/**
 * Download LXX 2012 (Brenton's Septuagint in Modern English)
 * 
 * Downloads the LXX 2012 translation from eBible.org
 * This is a modernization of Sir Lancelot Charles Lee Brenton's 1884
 * English translation of the Greek Septuagint.
 * 
 * Source: https://ebible.org/eng-lxx2012/
 * License: Public Domain
 * 
 * Usage:
 *   node scripts/download-lxx2012.mjs
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const DOWNLOAD_DIR = join(repoRoot, 'data-sources/osis');
const OUTPUT_FILE = join(DOWNLOAD_DIR, 'eng-lxx2012.osis.xml');

// eBible.org provides multiple formats - try OSIS first, fall back to USFX
const EBIBLE_OSIS_URL = 'https://ebible.org/Scriptures/details.php?id=eng-lxx2012';
// Direct download URLs from eBible
const DOWNLOAD_URLS = [
  'https://ebible.org/Scriptures/eng-lxx2012.zip',  // Main archive
  'https://ebible.org/find/show.php?id=eng-lxx2012' // Info page
];

async function downloadFile(url, outputPath) {
  console.log(`📥 Downloading from ${url}...`);
  
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      const fileStream = createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`✅ Downloaded to ${outputPath}`);
        resolve();
      });
      
      fileStream.on('error', (err) => {
        fileStream.close();
        reject(err);
      });
    }).on('error', reject);
  });
}

async function downloadFromEbible() {
  console.log('📖 Downloading LXX 2012 (Brenton\'s Septuagint)\n');
  
  // Ensure download directory exists
  if (!existsSync(DOWNLOAD_DIR)) {
    mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
  
  // Check if already downloaded
  if (existsSync(OUTPUT_FILE)) {
    console.log('⚠️  File already exists:', OUTPUT_FILE);
    console.log('   Delete it first if you want to re-download.\n');
    return OUTPUT_FILE;
  }
  
  try {
    // Download directly from eBible - they have HTML files which include OSIS-like markup
    const htmlUrl = 'https://ebible.org/eng-lxx2012/GEN01.htm';
    console.log('📝 eBible.org provides LXX 2012 in HTML format.');
    console.log('   For full OSIS support, we should:');
    console.log('   1. Use Crosswire SWORD module instead, OR');
    console.log('   2. Parse eBible HTML files directly\n');
    
    console.log('📦 Suggested approach:');
    console.log('   Download SWORD module instead:');
    console.log('   https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Brenton\n');
    console.log('   Then convert with: mod2osis Brenton > eng-lxx2012.osis.xml\n');
    
    console.log('Alternative: Use existing LXX Greek + translation tool');
    console.log('   (Your lxx-greek.sqlite already has the Greek text)\n');
    
    throw new Error('Manual download required - see instructions above');
    
  } catch (error) {
    console.error('❌ Download failed:', error.message);
    throw error;
  }
}

// Main execution
downloadFromEbible()
  .then((file) => {
    console.log('\n✅ Download complete!');
    console.log(`   File: ${file}`);
    console.log('\nNext steps:');
    console.log('   node scripts/build-lxx2012-pack.mjs');
  })
  .catch((error) => {
    console.error('\n❌ Failed to download LXX 2012');
    process.exit(1);
  });
