// extract-gcide.mjs - Extract GCIDE tar.xz on Windows without external tools
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import lzma from 'lzma-native';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tarPath = path.join(__dirname, '../../data/raw/gcide-0.53.tar.xz');
const tarUncompressed = path.join(__dirname, '../../data/raw/gcide-0.53.tar');
const outputPath = path.join(__dirname, '../../data/processed/gcide.xml');
const tempDir = path.join(__dirname, '../../data/raw/gcide-temp');

console.log('📦 Step 1: Decompressing XZ archive...');

// Decompress .xz file
if (fs.existsSync(tarUncompressed)) {
  console.log('✅ TAR already present, skipping decompression');
} else {
  const input = fs.createReadStream(tarPath);
  const output = fs.createWriteStream(tarUncompressed);
  const decompressor = lzma.createDecompressor();

  await pipeline(input, decompressor, output);

  console.log('✅ Decompressed to TAR');
}
console.log('📦 Step 2: Extracting TAR archive...');

// Create temp directory
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Extract using tar package
await tar.x({
  file: tarUncompressed,
  cwd: tempDir,
  filter: (path) => path.includes('CIDE.')
});

console.log('✅ Extracted GCIDE files');

// Find and concatenate all CIDE.* files
const allFiles = fs.readdirSync(path.join(tempDir, 'gcide-0.53'));
const cideFiles = allFiles
  .filter(f => f.startsWith('CIDE.'))
  .map(f => path.join(tempDir, 'gcide-0.53', f))
  .sort();

console.log(`   Found ${cideFiles.length} CIDE files`);

// Concatenate all CIDE files into one XML file
const writeStream = fs.createWriteStream(outputPath);

writeStream.write('<?xml version="1.0" encoding="UTF-8"?>\n');
writeStream.write('<gcide>\n');

for (const file of cideFiles) {
  const content = fs.readFileSync(file, 'utf8');
  // Keep EVERY paragraph, in document order - not just those holding an <ent>.
  // Webster splits an entry across several <p> blocks: the first carries
  // <ent>/<hw>/<ety>, and the numbered senses follow in their own <p> blocks
  // holding <sn> and <def> but no <ent> of their own. Filtering on <ent> threw
  // all of those away, which is why Beauty and Prophet reached the pack with an
  // etymology and no definition. The parser downstream slices on <ent>, so plain
  // document order re-associates each sense paragraph with its headword.
  const paragraphs = content.split(/<p>/).slice(1);
  for (const para of paragraphs) {
    writeStream.write('<p>' + para.split('</p>')[0] + '</p>\n');
  }
}

writeStream.write('</gcide>\n');
writeStream.end();

console.log(`✅ Created combined XML: ${outputPath}`);

// Cleanup temp directory
fs.rmSync(tempDir, { recursive: true, force: true });
console.log('🧹 Cleaned up temp files');
