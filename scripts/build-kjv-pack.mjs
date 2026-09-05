#!/usr/bin/env node

/**
 * Build the KJV pack (King James Version) from USFX.
 *
 * This used to read a pre-parsed KJV.json whose only structure was the
 * traditional pilcrow, carried inline as a bare ¶ at the head of 2,984 verses.
 * eBible.org's USFX has been in the repo the whole time and carries 10,343
 * real paragraphs and 2,461 poetic lines, so the pack is built from that and
 * stores them the way every other translation does.
 *
 * Usage: node scripts/build-kjv-pack.mjs
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildUSFXPack } from '../packages/packtools/src/parsers/build-usfx-pack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

console.log('📖 Building King James Version pack from USFX\n');

buildUSFXPack({
  sourcePath: join(repoRoot, 'data-sources/kjv-usfx/eng-kjv_usfx.xml'),
  outputPath: join(repoRoot, 'packs/kjv.sqlite'),
  metadata: {
    pack_id: 'kjv',
    packId: 'kjv',
    type: 'text',
    version: '1.0.0',
    translation_id: 'KJV',
    translationId: 'KJV',
    translation_name: 'King James Version',
    translationName: 'King James Version',
    license: 'Public Domain',
    attribution: 'King James Version from eBible.org. Public Domain.',
    description: 'King James Version (1611) - the classic English translation',
  },
});
