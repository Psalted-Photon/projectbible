#!/usr/bin/env node
/**
 * Does searching find the places the Bible names?
 *
 * Search knew only the modern gazetteer, so "Capernaum" and "Golgotha" returned
 * nothing and "Bethlehem" led with a town in South Africa. This drives the real
 * search module over the real data and reports what comes first.
 */
import fs from 'fs';
import path from 'path';
import { ScriptureSearch } from '../../../apps/pwa-polished/atlas-search.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../../..');
const A = path.join(ROOT, 'apps/pwa-polished/public/atlas');
const read = (f) => JSON.parse(fs.readFileSync(path.join(A, f), 'utf8'));

const search = new ScriptureSearch(read('biblical-places.json'), read('ancient-names.json'));

/** query -> the name that should come first. */
const EXPECT = [
  ['capernaum', 'Capernaum'],
  ['golgotha', 'Golgotha'],
  ['gethsemane', 'Gethsemane'],
  ['emmaus', 'Emmaus'],
  ['patmos', 'Patmos'],
  ['bethlehem', 'Bethlehem'],
  ['nazareth', 'Nazareth'],
  ['jerusalem', 'Jerusalem'],
  ['babylon', 'Babylon'],
  ['nineveh', 'Nineveh'],
  ['tarshish', 'Tarshish'],
  ['ophir', 'Ophir'],
  // hyphens closed up, spaced, and as written
  ['beth-shemesh', 'Beth-Shemesh'],
  ['beth shemesh', 'Beth-Shemesh'],
  ['bethshemesh', 'Beth-Shemesh'],
  ['kiriath jearim', 'Kiriath-Jearim'],
  // the modern name of an ancient site
  ['khirbet minyeh', 'Capernaum'],
];

let wrong = 0;
for (const [q, want] of EXPECT) {
  const hits = search.search(q, 5);
  const got = hits[0]?.name ?? '(nothing)';
  const ok = got === want;
  if (!ok) wrong++;
  const extra = hits.slice(1, 3).map((h) => h.name).join(', ');
  console.log(`  ${ok ? 'ok   ' : 'WRONG'} ${q.padEnd(16)} -> ${got.padEnd(18)}${extra ? `  (then ${extra})` : ''}${ok ? '' : `   wanted ${want}`}`);
}

console.log('');
console.log(wrong ? `${wrong} of ${EXPECT.length} wrong` : `all ${EXPECT.length} lead with the right place`);
