#!/usr/bin/env node
/**
 * Add parsed commentaries to the existing consolidated pack.
 *
 * Additive on purpose. The shipping pack contains authors that cannot be
 * rebuilt from `data-sources/commentaries/osis` — E.W. Bullinger has 4,229
 * entries and no OSIS file there — so a full rebuild would silently drop them.
 * This inserts new authors alongside what is already in place and refuses to
 * touch an author that already has entries.
 *
 * Usage:
 *   node scripts/parse-commentary-sources.mjs --only=clarke --out=data/processed/x.ndjson
 *   node scripts/add-commentaries.mjs data/processed/x.ndjson
 */

import Database from 'better-sqlite3';
import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const PACK = join(repoRoot, 'packs/consolidated/commentaries.sqlite');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/add-commentaries.mjs <entries.ndjson>');
  process.exit(1);
}
const NDJSON = isAbsolute(arg) ? arg : join(repoRoot, arg);

for (const p of [PACK, NDJSON]) {
  if (!existsSync(p)) {
    console.error(`❌ Missing ${p}`);
    process.exit(1);
  }
}

const db = new Database(PACK);
const before = db.prepare('SELECT COUNT(*) n FROM commentary_entries').get().n;
const existing = new Set(
  db.prepare('SELECT DISTINCT author FROM commentary_entries').all().map((r) => r.author),
);
console.log(`📖 Pack has ${before.toLocaleString()} entries across ${existing.size} authors\n`);

const insert = db.prepare(`
  INSERT INTO commentary_entries (book, chapter, verse_start, verse_end, author, title, text, source, year)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const counts = new Map();
const skipped = new Map();
// The OSIS walker emits each entry exactly eight times, byte for byte — every
// one of Clarke's 21,051 verse slots arrives as eight identical copies. The
// cause is in the recursion and is not fixed here; deduplicating on the way in
// is lossless because the copies are identical, and it keeps the pack from
// growing eightfold.
const seenRows = new Set();
let duplicates = 0;
let batch = [];
const flush = db.transaction((rows) => {
  for (const e of rows) {
    insert.run(
      e.book, e.chapter, e.verse_start, e.verse_end ?? null,
      e.author, e.title ?? null, e.text, e.source ?? null, e.year ?? null,
    );
  }
});

const rl = createInterface({
  input: createReadStream(NDJSON, { encoding: 'utf-8' }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (!line.trim()) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (!e.author || !e.book || !e.text) continue;
  // Refuse to touch an author already present, rather than doubling them.
  if (existing.has(e.author)) {
    skipped.set(e.author, (skipped.get(e.author) ?? 0) + 1);
    continue;
  }
  const rowKey = `${e.author}|${e.book}|${e.chapter}|${e.verse_start}|${e.text.length}|${e.text.slice(0, 80)}`;
  if (seenRows.has(rowKey)) {
    duplicates++;
    continue;
  }
  seenRows.add(rowKey);

  counts.set(e.author, (counts.get(e.author) ?? 0) + 1);
  batch.push(e);
  if (batch.length >= 2000) {
    flush(batch);
    batch = [];
  }
}
if (batch.length) flush(batch);

if (duplicates) console.log(`Collapsed ${duplicates.toLocaleString()} duplicate rows
`);
console.log('Added:');
for (const [a, n] of [...counts].sort((x, y) => y[1] - x[1])) {
  console.log(`   ${a.padEnd(34)} ${n.toLocaleString()}`);
}
if (skipped.size) {
  console.log('\nSkipped (already in the pack):');
  for (const [a, n] of skipped) console.log(`   ${a.padEnd(34)} ${n.toLocaleString()}`);
}

const after = db.prepare('SELECT COUNT(*) n FROM commentary_entries').get().n;
console.log(`\n${before.toLocaleString()} → ${after.toLocaleString()} entries`);
db.exec('VACUUM');
db.close();
console.log(`✅ ${PACK}`);
