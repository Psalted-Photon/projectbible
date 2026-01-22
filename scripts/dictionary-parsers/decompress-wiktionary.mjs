#!/usr/bin/env node

/**
 * decompress-wiktionary.mjs
 * 
 * Decompresses enwiktionary-latest-pages-articles.xml.bz2 to XML
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream, createWriteStream } from 'fs';
import unbzip2 from 'unbzip2-stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('📦 Wiktionary Decompressor\n');

const inputFile = path.join(__dirname, '../../data/raw/enwiktionary-latest-pages-articles.xml.bz2');
const outputFile = path.join(__dirname, '../../data/processed/enwiktionary.xml');

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Error: Input file not found: ${inputFile}\n`);
  process.exit(1);
}

const stats = fs.statSync(inputFile);
console.log(`📂 Input: ${path.basename(inputFile)} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`📂 Output: ${path.basename(outputFile)}`);
console.log(`⏳ Decompressing (this may take several minutes)...\n`);

const startTime = Date.now();

// Stream decompression
const input = createReadStream(inputFile);
const output = createWriteStream(outputFile);
const decompress = unbzip2();

let bytesWritten = 0;
let lastUpdate = Date.now();

decompress.on('data', (chunk) => {
  bytesWritten += chunk.length;
  const now = Date.now();
  if (now - lastUpdate > 5000) {
    console.log(`   Decompressed: ${(bytesWritten / 1024 / 1024).toFixed(0)} MB...`);
    lastUpdate = now;
  }
});

input.pipe(decompress).pipe(output);

output.on('finish', () => {
  const outputStats = fs.statSync(outputFile);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n✅ Decompression complete!`);
  console.log(`   Output size: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Time: ${elapsedSec} seconds`);
  console.log(`   Ratio: ${(stats.size / outputStats.size * 100).toFixed(1)}% compression\n`);
});

output.on('error', (error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

decompress.on('error', (error) => {
  console.error('❌ Decompression error:', error.message);
  process.exit(1);
});
