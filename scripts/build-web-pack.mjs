#!/usr/bin/env node

/**
 * Build the WEB pack (World English Bible) from USFX.
 *
 * This used to copy a pre-built web-full.sqlite whose text had no structure at
 * all. eBible.org's USFX for WEB has been in the repo the whole time and
 * carries 10,094 first-level poetic lines, 13,237 second-level, and 9,254
 * paragraphs, so the pack is built from that instead.
 *
 * Note this is the Yahweh edition: where the old pack read "the Lord" this
 * reads "Yahweh", in roughly 6,000 verses. That is the WEB as its translators
 * published it.
 *
 * Usage: node scripts/build-web-pack.mjs
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildUSFXPack } from '../packages/packtools/src/parsers/build-usfx-pack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

console.log('📖 Building World English Bible pack from USFX\n');

buildUSFXPack({
  sourcePath: join(repoRoot, 'data-sources/web-usfx/eng-web_usfx.xml'),
  outputPath: join(repoRoot, 'packs/web.sqlite'),
  metadata: {
    pack_id: 'web',
    packId: 'web',
    type: 'text',
    version: '1.0.0',
    translation_id: 'WEB',
    translationId: 'WEB',
    translation_name: 'World English Bible',
    translationName: 'World English Bible',
    license: 'Public Domain',
    attribution: 'World English Bible from eBible.org. Public Domain.',
    description: 'World English Bible - a modern public domain translation',
  },
});
