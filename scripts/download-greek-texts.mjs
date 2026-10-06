#!/usr/bin/env node
/**
 * Download the Greek reading texts: Septuagint, Byzantine NT, Textus Receptus.
 *
 * All four sources are public domain and already accented and punctuated:
 *
 *   data-sources/ebible-grcbrent/   Brenton's Greek Septuagint (1851), USFM.
 *                                   The Greek printed opposite the English
 *                                   that LXX2012 modernizes, so the two line
 *                                   up verse for verse.
 *   data-sources/ebible-grctr/      Textus Receptus, USFM, with footnotes
 *                                   naming where Scrivener 1894 differs.
 *   data-sources/byztxt-rp2018/     Robinson-Pierpont Byzantine Textform
 *                                   2018, Unicode CSV, one file per book.
 *   data-sources/byztxt-scrivener/  Robinson's unaccented Scrivener 1894.
 *                                   Not shipped — build-greek-nt-packs.mjs
 *                                   checks the TR against it.
 *
 * Replaces download-lxx.mjs, which never got a Septuagint at all: it joined
 * the OpenScriptures lemma list, so every word was in its dictionary form.
 *
 * Usage: node scripts/download-greek-texts.mjs [--force]
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(__dirname, '..', 'data-sources');
const force = process.argv.includes('--force');

// eBible refuses requests that do not look like a browser.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Hexapla pack builder)' };

const BYZTXT = 'https://raw.githubusercontent.com/byztxt';

// PA.csv (a second copy of John 7:53–8:11) and ACT24.csv (the Acts 24:6b–8a
// variant the edition leaves out of its text) are apparatus, not text.
const RP_BOOKS = [
  'MAT', 'MAR', 'LUK', 'JOH', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAM',
  '1PE', '2PE', '1JO', '2JO', '3JO', 'JUD', 'REV',
];

const SCRIVENER_BOOKS = [
  'MT', 'MR', 'LU', 'JOH', 'AC', 'RO', '1CO', '2CO', 'GA', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS',
  '1PE', '2PE', '1JO', '2JO', '3JO', 'JUDE', 'RE',
];

async function fetchBytes(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function ready(dir) {
  if (force || !existsSync(dir) || readdirSync(dir).length === 0) {
    mkdirSync(dir, { recursive: true });
    return false;
  }
  console.log(`   ✅ Already downloaded: ${dir}`);
  return true;
}

async function ebible(id, dir) {
  console.log(`\n📥 eBible ${id}`);
  if (ready(dir)) return;
  const zip = new AdmZip(await fetchBytes(`https://ebible.org/Scriptures/${id}_usfm.zip`));
  let n = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    // copr.htm carries the license statement; keep it beside the text.
    if (!/\.usfm$/i.test(entry.entryName) && entry.entryName !== 'copr.htm') continue;
    zip.extractEntryTo(entry, dir, false, true);
    n++;
  }
  console.log(`   ${n} files`);
}

async function byztxt(repo, path, names, ext, dir) {
  console.log(`\n📥 byztxt ${repo}`);
  if (ready(dir)) return;
  for (const name of names) {
    writeFileSync(join(dir, `${name}.${ext}`), await fetchBytes(`${BYZTXT}/${repo}/master/${path}/${name}.${ext}`));
  }
  console.log(`   ${names.length} files`);
}

await ebible('grcbrent', join(SOURCES, 'ebible-grcbrent'));
await ebible('grctr', join(SOURCES, 'ebible-grctr'));
await byztxt('byzantine-majority-text', 'csv-unicode/ccat/no-variants', RP_BOOKS, 'csv', join(SOURCES, 'byztxt-rp2018'));
await byztxt('greektext-scrivener', 'textonly', SCRIVENER_BOOKS, 'SCV', join(SOURCES, 'byztxt-scrivener'));

console.log('\n✅ Greek texts downloaded');
