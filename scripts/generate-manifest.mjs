#!/usr/bin/env node
/**
 * Generate Pack Manifest
 * 
 * Creates manifest.json with SHA-256 hashes and metadata for all consolidated packs.
 * This manifest is used by the app to:
 * - Discover available packs
 * - Verify download integrity
 * - Check version compatibility
 * - Resolve dependencies
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs/consolidated');
const OUTPUT_PATH = join(PACKS_DIR, 'manifest.json');

// GitHub Release URL pattern
const GITHUB_RELEASE_BASE = 'https://github.com/Psalted-Photon/projectbible/releases/download/packs-v1.0.0';

const PACK_CONFIGS = {
  'translations.sqlite': {
    id: 'translations',
    type: 'translation',
    name: 'English Translations Pack',
    description: 'KJV, WEB, BSB, NET, LXX2012 English translations',
    dependencies: []
  },
  'ancient-languages.sqlite': {
    id: 'ancient-languages',
    type: 'translation',
    name: 'Ancient Languages Pack',
    description: 'Hebrew, Greek NT (Byzantine, TR), LXX with morphology',
    dependencies: []
  },
  'lexical.sqlite': {
    id: 'lexical',
    type: 'lexicon',
    name: 'Lexical Resources Pack',
    description: "Strong's dictionaries + English wordlist/thesaurus/grammar",
    dependencies: []
  },
  'study-tools.sqlite': {
    id: 'study-tools',
    type: 'study',
    name: 'Study Tools Pack',
    description: 'Maps, places, chronological ordering, cross-references',
    dependencies: []
  },
  'bsb-audio-pt1.sqlite': {
    id: 'bsb-audio-pt1',
    type: 'audio',
    name: 'BSB Audio Part 1',
    description: 'Genesis through Psalms audio narration',
    dependencies: []
  },
  'bsb-audio-pt2.sqlite': {
    id: 'bsb-audio-pt2',
    type: 'audio',
    name: 'BSB Audio Part 2',
    description: 'Proverbs through Revelation audio narration',
    dependencies: []
  },
  'dictionary-en.sqlite': {
    id: 'dictionary-en',
    type: 'dictionary',
    name: 'English Dictionary Pack',
    description: 'English dictionary definitions and word data',
    dependencies: []
  },
  'commentaries.sqlite': {
    id: 'commentaries',
    type: 'commentary',
    name: 'Multi-Author Commentaries',
    description: 'Verse-by-verse Bible commentaries from multiple sources',
    dependencies: []
  }
};

console.log('📝 Generating Pack Manifest...\n');

/**
 * Compute SHA-256 hash of a file
 */
function computeHash(filePath) {
  const buffer = readFileSync(filePath);
  const hash = createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
}

/**
 * Get metadata from pack database
 */
function getPackMetadata(packPath) {
  const db = new Database(packPath, { readonly: true });
  
  try {
    const rows = db.prepare('SELECT key, value FROM metadata').all();
    const metadata = {};
    
    for (const { key, value } of rows) {
      metadata[key] = value;
    }
    
    return metadata;
  } catch (error) {
    console.warn(`⚠️  Could not read metadata from ${packPath}:`, error.message);
    return {};
  } finally {
    db.close();
  }
}

const manifest = {
  manifestVersion: '1.0.0',
  releaseTag: 'packs-v1.0.0',
  createdAt: new Date().toISOString(),
  packs: []
};

for (const [filename, config] of Object.entries(PACK_CONFIGS)) {
  const packPath = join(PACKS_DIR, filename);
  
  if (!existsSync(packPath)) {
    console.warn(`⚠️  Pack not found: ${filename}`);
    continue;
  }
  
  console.log(`Processing ${filename}...`);
  
  // Get file stats
  const stats = statSync(packPath);
  const sizeBytes = stats.size;
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  
  // Compute SHA-256 hash
  console.log(`   Computing SHA-256...`);
  const sha256 = computeHash(packPath);
  
  // Get metadata from database
  const dbMetadata = getPackMetadata(packPath);
  
  // Build pack entry
  const packEntry = {
    id: config.id,
    type: config.type,
    name: config.name,
    description: config.description,
    version: dbMetadata.version || '1.0.0',
    schemaVersion: dbMetadata.schemaVersion || '1',
    minAppVersion: dbMetadata.minAppVersion || '1.0.0',
    
    size: sizeBytes,
    sizeMB: parseFloat(sizeMB),
    
    sha256: sha256,
    
    dependencies: config.dependencies,
    
    downloadUrl: `${GITHUB_RELEASE_BASE}/${filename}`,
    
    createdAt: dbMetadata.createdAt || new Date().toISOString()
  };
  
  manifest.packs.push(packEntry);
  
  console.log(`   ✅ ${sizeMB} MB, SHA-256: ${sha256.substring(0, 16)}...`);
}

// Sort packs by ID for consistency
manifest.packs.sort((a, b) => a.id.localeCompare(b.id));

// Write manifest
console.log(`\n📄 Writing manifest to ${OUTPUT_PATH}...`);
writeFileSync(OUTPUT_PATH, JSON.stringify(manifest, null, 2), 'utf8');

// Print summary
console.log('\n✅ Manifest generated successfully!\n');
console.log('📊 Summary:');
console.log(`   Packs: ${manifest.packs.length}`);
console.log(`   Total size: ${(manifest.packs.reduce((sum, p) => sum + p.size, 0) / (1024 * 1024 * 1024)).toFixed(2)} GB`);
console.log(`   Output: ${OUTPUT_PATH}`);

console.log('\n📋 Pack List:');
for (const pack of manifest.packs) {
  console.log(`   ${pack.id.padEnd(25)} ${pack.sizeMB.toFixed(2).padStart(10)} MB`);
}

console.log('\n💡 Next Steps:');
console.log('   1. Create GitHub Release: gh release create v1.0.0 --title "v1.0.0" --notes "Initial release"');
console.log('   2. Upload packs: gh release upload v1.0.0 packs/consolidated/*.sqlite');
console.log('   3. Verify download URLs are accessible');
console.log('   4. Update PACK_MANIFEST_URL in app config');
console.log('   5. Test pack downloads in production build');
