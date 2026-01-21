#!/usr/bin/env node

/**
 * Download Wiktionary and GCIDE source dumps
 * 
 * Downloads:
 * - Wiktionary: enwiktionary-latest-pages-articles.xml.bz2 (~500 MB)
 * - GCIDE: gcide XML from official source (~30 MB)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { createBrotliDecompress, createGunzip } from 'zlib';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.join(__dirname, '../../data/raw');
const OUTPUT_DIR = path.join(__dirname, '../../data/processed');

// Create directories
for (const dir of [RAW_DIR, OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const SOURCES = {
  wiktionary: {
    url: 'https://dumps.wikimedia.org/enwiktionary/latest/enwiktionary-latest-pages-articles.xml.bz2',
    filename: 'enwiktionary-latest-pages-articles.xml.bz2',
    output: 'enwiktionary.xml'
  },
  gcide: {
    url: 'https://ftp.gnu.org/gnu/gcide/gcide-0.53.tar.xz',
    filename: 'gcide-0.53.tar.xz',
    output: 'gcide.xml'
  }
};

/**
 * Download a file with progress tracking
 */
async function downloadFile(url, destPath) {
  console.log(`📥 Downloading: ${url}`);
  console.log(`   Destination: ${destPath}`);
  
  const protocol = url.startsWith('https') ? https : http;
  
  return new Promise((resolve, reject) => {
    protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const totalBytes = parseInt(response.headers['content-length'] || '0');
      let downloadedBytes = 0;
      let lastProgress = 0;
      
      const fileStream = createWriteStream(destPath);
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const progress = Math.floor((downloadedBytes / totalBytes) * 100);
          if (progress >= lastProgress + 5) {
            console.log(`   Progress: ${progress}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB / ${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
            lastProgress = progress;
          }
        }
      });
      
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`✅ Download complete: ${destPath}`);
        resolve(destPath);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

/**
 * Decompress bz2 file
 */
async function decompressBz2(inputPath, outputPath) {
  console.log(`📦 Decompressing bz2: ${path.basename(inputPath)}`);
  
  // Use system bunzip2 for better performance
  try {
    await execAsync(`bunzip2 -k -c "${inputPath}" > "${outputPath}"`);
    console.log(`✅ Decompressed: ${outputPath}`);
  } catch (err) {
    console.error('❌ bunzip2 not available, trying manual decompression...');
    // Fallback to manual if bunzip2 not available
    const { spawn } = await import('child_process');
    await new Promise((resolve, reject) => {
      const bzip2 = spawn('bzip2', ['-d', '-c', inputPath]);
      const output = createWriteStream(outputPath);
      bzip2.stdout.pipe(output);
      bzip2.on('close', resolve);
      bzip2.on('error', reject);
    });
  }
}

/**
 * Extract and process GCIDE tar.xz
 */
async function extractGCIDE(tarPath, outputPath) {
  console.log(`📦 Extracting GCIDE archive...`);
  
  const tempDir = path.join(RAW_DIR, 'gcide-temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Extract tar.xz
  await execAsync(`tar -xJf "${tarPath}" -C "${tempDir}"`);
  
  // Find all XML files and concatenate them
  const files = fs.readdirSync(tempDir);
  const xmlFiles = files
    .filter(f => f.endsWith('.xml'))
    .sort();
  
  console.log(`   Found ${xmlFiles.length} XML files`);
  
  // Create combined XML
  const outputStream = createWriteStream(outputPath);
  outputStream.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  outputStream.write('<gcide>\n');
  
  for (const file of xmlFiles) {
    const content = fs.readFileSync(path.join(tempDir, file), 'utf-8');
    // Remove XML declaration and root tags, keep entries
    const entries = content
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<\/?gcide>/g, '')
      .trim();
    outputStream.write(entries + '\n');
  }
  
  outputStream.write('</gcide>\n');
  outputStream.end();
  
  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
  
  console.log(`✅ GCIDE combined: ${outputPath}`);
}

/**
 * Main download and prepare flow
 */
async function main() {
  console.log('🌾 Dictionary Source Download & Preparation\n');
  
  const skipWiktionary = process.argv.includes('--skip-wiktionary');
  const skipGCIDE = process.argv.includes('--skip-gcide');
  
  // Download Wiktionary
  if (!skipWiktionary) {
    console.log('\n📖 Step 1: Wiktionary\n');
    const wiktPath = path.join(RAW_DIR, SOURCES.wiktionary.filename);
    const wiktOutput = path.join(OUTPUT_DIR, SOURCES.wiktionary.output);
    
    if (!fs.existsSync(wiktPath)) {
      await downloadFile(SOURCES.wiktionary.url, wiktPath);
    } else {
      console.log(`⏭️  Skipping download (file exists): ${wiktPath}`);
    }
    
    if (!fs.existsSync(wiktOutput)) {
      await decompressBz2(wiktPath, wiktOutput);
    } else {
      console.log(`⏭️  Skipping decompression (file exists): ${wiktOutput}`);
    }
  }
  
  // Download GCIDE
  if (!skipGCIDE) {
    console.log('\n📚 Step 2: GCIDE\n');
    const gcidePath = path.join(RAW_DIR, SOURCES.gcide.filename);
    const gcideOutput = path.join(OUTPUT_DIR, SOURCES.gcide.output);
    
    if (!fs.existsSync(gcidePath)) {
      await downloadFile(SOURCES.gcide.url, gcidePath);
    } else {
      console.log(`⏭️  Skipping download (file exists): ${gcidePath}`);
    }
    
    if (!fs.existsSync(gcideOutput)) {
      await extractGCIDE(gcidePath, gcideOutput);
    } else {
      console.log(`⏭️  Skipping extraction (file exists): ${gcideOutput}`);
    }
  }
  
  console.log('\n✅ All sources ready!\n');
  console.log('📁 Output location: ' + OUTPUT_DIR);
  console.log('\n📝 Next steps:');
  console.log('   1. Run: node parse-wiktionary.mjs ../../data/processed/enwiktionary.xml');
  console.log('   2. Run: node parse-gcide.mjs ../../data/processed/gcide.xml');
  console.log('   3. Run: node seed-english-words.mjs');
  console.log('   4. Run: node build-pack.mjs\n');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
