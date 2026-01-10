#!/usr/bin/env node

/**
 * Build LXX 2012 Pack
 * 
 * Builds a SQLite pack from the LXX 2012 OSIS file
 * (Brenton's Septuagint in modern English)
 * 
 * Usage:
 *   node scripts/build-lxx2012-pack.mjs
 */

import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildPackFromUSFM } from '../packages/packtools/src/parsers/usfm-parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const SOURCE_DIR = join(repoRoot, 'data-sources/osis/eng-lxx2012_usfm');
const OUTPUT_FILE = join(repoRoot, 'packs/lxx2012-english.sqlite');

async function buildLXX2012Pack() {
  console.log('📖 Building LXX 2012 (English Septuagint) Pack\n');
  
  // Check source directory
  if (!existsSync(SOURCE_DIR)) {
    console.error('❌ Source directory not found:', SOURCE_DIR);
    console.error('   The USFM files should have been downloaded.');
    console.error('   Check data-sources/osis/eng-lxx2012_usfm/');
    process.exit(1);
  }
  
  // Ensure output directory exists
  const packsDir = join(repoRoot, 'packs');
  if (!existsSync(packsDir)) {
    mkdirSync(packsDir, { recursive: true });
  }
  
  try {
    // Build pack with metadata (using snake_case for pack-import.ts compatibility)
    const packMetadata = {
      packId: 'lxx2012-english-v1',
      packVersion: '1.0.0',
      packType: 'text',
      translationId: 'LXX2012',
      translationName: 'LXX 2012 (Brenton English)',
      language: 'en',
      languageName: 'English',
      translation: 'LXX 2012',
      translationFull: 'Septuagint in English (Brenton 2012 Revision)',
      testament: 'OT+Apocrypha',
      note: 'Modernized version of Sir Lancelot Charles Lee Brenton\'s 1884 English translation of the Greek Septuagint',
      license: 'Public Domain',
      publisher: 'eBible.org',
      attribution: 'LXX 2012 English Septuagint from eBible.org. Public Domain.'
    };
    
    buildPackFromUSFM(SOURCE_DIR, OUTPUT_FILE, packMetadata);
    
    console.log('\n✅ Pack build complete!');
    console.log(`   Output: ${OUTPUT_FILE}`);
    console.log('\nPack details:');
    console.log(`   - Translation: ${packMetadata.translation}`);
    console.log(`   - Language: English`);
    console.log(`   - Testament: OT + Deuterocanonical books`);
    console.log(`   - License: Public Domain`);
    
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

buildLXX2012Pack();
