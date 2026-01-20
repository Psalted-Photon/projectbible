#!/usr/bin/env node
/**
 * Publish Packs to GitHub Releases
 * 
 * Automates the creation of GitHub Releases with consolidated packs.
 * Generates manifest.json with pack metadata, SHA-256 hashes, and download URLs.
 * 
 * Prerequisites:
 * - GitHub CLI (`gh`) installed and authenticated
 * - Consolidated packs built in packs/consolidated/
 * 
 * Usage:
 *   node scripts/publish-packs-release.mjs <version>
 * 
 * Example:
 *   node scripts/publish-packs-release.mjs 1.0.0
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs/consolidated');
const MANIFEST_OUTPUT = join(repoRoot, 'packs/manifest.json');

// Get version from command line
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('❌ Usage: node scripts/publish-packs-release.mjs <version>');
  console.error('   Example: node scripts/publish-packs-release.mjs 1.0.0');
  process.exit(1);
}

const RELEASE_TAG = `packs-v${version}`;

console.log(`📦 Publishing Packs Release: ${RELEASE_TAG}\n`);

// Check prerequisites
console.log('🔍 Checking prerequisites...');

// Check if packs directory exists
if (!existsSync(PACKS_DIR)) {
  console.error(`❌ Packs directory not found: ${PACKS_DIR}`);
  console.error('   Run: node scripts/build-consolidated-packs.mjs');
  process.exit(1);
}

// Check if gh CLI is installed
try {
  execSync('gh --version', { stdio: 'ignore' });
  console.log('   ✓ GitHub CLI installed');
} catch (e) {
  console.error('❌ GitHub CLI not found');
  console.error('   Install: https://cli.github.com/');
  process.exit(1);
}

// Check if authenticated
try {
  execSync('gh auth status', { stdio: 'ignore' });
  console.log('   ✓ GitHub CLI authenticated');
} catch (e) {
  console.error('❌ GitHub CLI not authenticated');
  console.error('   Run: gh auth login');
  process.exit(1);
}

/**
 * Calculate SHA-256 hash of a file
 */
function calculateSHA256(filePath) {
  const fileBuffer = readFileSync(filePath);
  const hash = createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}

/**
 * Get pack metadata from filename
 */
function getPackMetadata(filename) {
  const metadata = {
    'translations.sqlite': {
      id: 'translations',
      type: 'translation',
      name: 'English Translations',
      description: 'KJV, WEB, BSB, NET, LXX2012 English translations',
      schemaVersion: '1',
      minAppVersion: '1.0.0'
    },
    'ancient-languages.sqlite': {
      id: 'ancient-languages',
      type: 'translation',
      name: 'Ancient Languages',
      description: 'Hebrew, Greek NT (Byzantine, TR), LXX with morphology',
      schemaVersion: '1',
      minAppVersion: '1.0.0'
    },
    'lexical.sqlite': {
      id: 'lexical',
      type: 'lexicon',
      name: 'Lexical Resources',
      description: "Strong's dictionaries + English wordlist/thesaurus/grammar",
      schemaVersion: '1',
      minAppVersion: '1.0.0'
    },
    'study-tools.sqlite': {
      id: 'study-tools',
      type: 'study',
      name: 'Study Tools',
      description: 'Maps, places, chronological ordering, cross-references',
      schemaVersion: '1',
      minAppVersion: '1.0.0'
    },
    'bsb-audio-pt1.sqlite': {
      id: 'bsb-audio-pt1',
      type: 'audio',
      name: 'BSB Audio Part 1',
      description: 'Genesis through Psalms audio (BSB narration)',
      schemaVersion: '1',
      minAppVersion: '1.0.0'
    },
    'bsb-audio-pt2.sqlite': {
      id: 'bsb-audio-pt2',
      type: 'audio',
      name: 'BSB Audio Part 2',
      description: 'Proverbs through Revelation audio (BSB narration)',
      schemaVersion: '1',
      minAppVersion: '1.0.0'
    }
  };
  
  return metadata[filename] || null;
}

// Scan packs directory
console.log('\n📂 Scanning packs directory...');
const packFiles = readdirSync(PACKS_DIR)
  .filter(f => f.endsWith('.sqlite'))
  .sort();

if (packFiles.length === 0) {
  console.error('❌ No .sqlite files found in packs directory');
  process.exit(1);
}

console.log(`   Found ${packFiles.length} packs:`);
packFiles.forEach(f => console.log(`   • ${f}`));

// Generate pack entries
console.log('\n🔐 Generating pack entries with SHA-256 hashes...');
const packEntries = [];

for (const filename of packFiles) {
  const filePath = join(PACKS_DIR, filename);
  const stats = statSync(filePath);
  const sha256 = calculateSHA256(filePath);
  const metadata = getPackMetadata(filename);
  
  if (!metadata) {
    console.warn(`   ⚠️  No metadata for ${filename}, skipping`);
    continue;
  }
  
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`   ${metadata.id.padEnd(20)} ${sizeMB.padStart(8)} MB  ${sha256}`);
  
  // Get GitHub repo info
  const repoInfo = execSync('gh repo view --json nameWithOwner --jq .nameWithOwner', { encoding: 'utf-8' }).trim();
  
  packEntries.push({
    id: metadata.id,
    type: metadata.type,
    version: version,
    size: stats.size,
    sha256: sha256,
    schemaVersion: metadata.schemaVersion,
    minAppVersion: metadata.minAppVersion,
    downloadUrl: `https://github.com/${repoInfo}/releases/download/${RELEASE_TAG}/${filename}`,
    name: metadata.name,
    description: metadata.description
  });
}

// Create manifest
console.log('\n📝 Creating manifest.json...');
const manifest = {
  manifestVersion: '1.0',
  releaseTag: RELEASE_TAG,
  createdAt: new Date().toISOString(),
  packs: packEntries
};

writeFileSync(MANIFEST_OUTPUT, JSON.stringify(manifest, null, 2));
console.log(`   ✓ Manifest written to: ${MANIFEST_OUTPUT}`);

// Create release notes
const releaseNotes = `# ProjectBible Data Packs v${version}

## Pack Contents

${packEntries.map(p => `### ${p.name}
- **Size:** ${(p.size / (1024 * 1024)).toFixed(2)} MB
- **Type:** ${p.type}
- **SHA-256:** \`${p.sha256}\`
- **Description:** ${p.description}
`).join('\n')}

## Installation

Download the manifest and desired packs:

\`\`\`bash
# Download manifest
curl -L -O https://github.com/${execSync('gh repo view --json nameWithOwner --jq .nameWithOwner', { encoding: 'utf-8' }).trim()}/releases/download/${RELEASE_TAG}/manifest.json

# Download individual packs
${packEntries.map(p => `curl -L -O "${p.downloadUrl}"`).join('\n')}
\`\`\`

## Verification

Verify pack integrity using SHA-256:

\`\`\`bash
${packEntries.map(p => `echo "${p.sha256}  ${p.id}.sqlite" | sha256sum -c`).join('\n')}
\`\`\`
`;

const releaseNotesPath = join(repoRoot, 'packs/RELEASE_NOTES.md');
writeFileSync(releaseNotesPath, releaseNotes);
console.log(`   ✓ Release notes written to: ${releaseNotesPath}`);

// Ask for confirmation
console.log(`\n🚀 Ready to create GitHub Release: ${RELEASE_TAG}`);
console.log(`   Packs: ${packEntries.length}`);
console.log(`   Total size: ${(packEntries.reduce((sum, p) => sum + p.size, 0) / (1024 * 1024 * 1024)).toFixed(2)} GB`);
console.log('\n📋 Release will include:');
packFiles.forEach(f => console.log(`   • ${f}`));
console.log(`   • manifest.json`);

// Create release (draft mode)
console.log('\n📤 Creating draft release...');
try {
  // Create release
  execSync(`gh release create "${RELEASE_TAG}" --title "Data Packs v${version}" --notes-file "${releaseNotesPath}" --draft`, {
    stdio: 'inherit',
    cwd: repoRoot
  });
  
  // Upload manifest
  console.log('\n📤 Uploading manifest.json...');
  execSync(`gh release upload "${RELEASE_TAG}" "${MANIFEST_OUTPUT}"`, {
    stdio: 'inherit',
    cwd: repoRoot
  });
  
  // Upload packs
  console.log('\n📤 Uploading pack files...');
  for (const filename of packFiles) {
    const filePath = join(PACKS_DIR, filename);
    console.log(`   Uploading ${filename}...`);
    execSync(`gh release upload "${RELEASE_TAG}" "${filePath}"`, {
      stdio: 'inherit',
      cwd: repoRoot
    });
  }
  
  console.log('\n✅ Release created successfully (draft mode)!');
  console.log('\n📍 Next steps:');
  console.log('   1. Review the draft release on GitHub');
  console.log(`   2. Publish the release: gh release edit "${RELEASE_TAG}" --draft=false`);
  console.log('   3. Update app to fetch from this release');
  
} catch (error) {
  console.error('\n❌ Error creating release:', error.message);
  process.exit(1);
}
