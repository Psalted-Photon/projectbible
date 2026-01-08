#!/usr/bin/env node

/**
 * Build All Packs
 * 
 * Master script to build all consolidated packs for ProjectBible.
 * 
 * Usage: node scripts/build-all-packs.mjs
 */

import { execSync } from 'child_process';

const BUILD_SCRIPTS = [
  { script: 'scripts/build-greek-pack.mjs', name: 'Greek' },
  { script: 'scripts/build-hebrew-pack.mjs', name: 'Hebrew' },
  { script: 'scripts/build-web-pack.mjs', name: 'WEB' },
  { script: 'scripts/build-kjv-pack.mjs', name: 'KJV' },
  { script: 'scripts/build-places-pack.mjs', name: 'Places' },
  { script: 'scripts/build-map-pack.mjs', name: 'Maps' }
];

console.log('🔨 Building All ProjectBible Packs\n');
console.log('=' .repeat(50) + '\n');

let successCount = 0;
let failCount = 0;

for (const {script, name} of BUILD_SCRIPTS) {
  try {
    console.log(`\n📦 Building ${name} Pack...`);
    console.log('-'.repeat(50));
    execSync(`node ${script}`, { stdio: 'inherit' });
    successCount++;
  } catch (error) {
    console.error(`\n❌ Failed to build ${name} pack`);
    failCount++;
  }
}

console.log('\n' + '='.repeat(50));
console.log('\n✨ Build Summary:\n');
console.log(`   ✅ Success: ${successCount}`);
console.log(`   ❌ Failed: ${failCount}`);
console.log('\n📦 Final Pack List:\n');
console.log('   Translation Packs:');
console.log('   • greek.sqlite    - Greek original texts (LXX, Byz, TR, OpenGNT)');
console.log('   • hebrew.sqlite   - Hebrew original texts (WLC)');
console.log('   • web.sqlite      - World English Bible');
console.log('   • kjv.sqlite      - King James Version\n');
console.log('   Feature/Data Packs:');
console.log('   • places.sqlite          - Biblical geography');
console.log('   • maps.sqlite            - Historical map layers');
console.log('   • cross-references.sqlite - Cross-references');
console.log('\n');
