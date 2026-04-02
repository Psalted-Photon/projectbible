#!/usr/bin/env node
/**
 * TSK References Pack Builder
 *
 * Reads data/processed/tsk-references.ndjson (produced by parse-imp-commentaries.mjs)
 * and writes packs/consolidated/tsk-references.sqlite.
 *
 * Schema:
 *   tsk_references(id INTEGER PK, book TEXT, chapter INTEGER, verse INTEGER,
 *                  keyword TEXT, references_json TEXT)
 *   INDEX on (book, chapter, verse)
 *
 * Usage:
 *   node scripts/build-tsk-references-pack.mjs
 */

import Database from 'better-sqlite3';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INPUT_FILE  = join(__dirname, '../data/processed/tsk-references.ndjson');
const OUTPUT_DIR  = join(__dirname, '../packs/consolidated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'tsk-references.sqlite');

async function build() {
  if (!existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    console.log('Run first: node scripts/parse-imp-commentaries.mjs');
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  // Remove old DB
  if (existsSync(OUTPUT_FILE)) unlinkSync(OUTPUT_FILE);
  const db = new Database(OUTPUT_FILE);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tsk_references (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      book            TEXT    NOT NULL,
      chapter         INTEGER NOT NULL,
      verse           INTEGER NOT NULL,
      keyword         TEXT,
      references_json TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tsk_verse ON tsk_references(book, chapter, verse);
  `);

  // Metadata
  const metaRows = [
    ['pack_id',       'tsk-references'],
    ['type',          'references'],
    ['version',       '1.0.1'],
    ['schemaVersion', '1.0'],
    ['name',          'Treasury of Scripture Knowledge — Cross-References'],
    ['language',      'en'],
    ['license',       'Public Domain'],
    ['attribution',   'R.A. Torrey, Treasury of Scripture Knowledge (1834)'],
    ['description',   'Keyword-anchored cross-reference chains from the Treasury of Scripture Knowledge'],
  ];

  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)');
  for (const [k, v] of metaRows) insertMeta.run(k, v);

  // Stream NDJSON and insert
  const insertRef = db.prepare(
    'INSERT INTO tsk_references(book, chapter, verse, keyword, references_json) VALUES (?, ?, ?, ?, ?)'
  );

  const rl = createInterface({
    input: createReadStream(INPUT_FILE, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  });

  let count = 0;
  const BATCH = 1000;
  let batch = [];

  const insertBatch = db.transaction((rows) => {
    for (const row of rows) insertRef.run(row.book, row.chapter, row.verse, row.keyword ?? null, JSON.stringify(row.references));
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    count++;
    if (batch.length >= BATCH) {
      insertBatch(batch);
      batch = [];
      process.stdout.write(`\r  Inserted ${count.toLocaleString()} rows...`);
    }
  }
  if (batch.length > 0) insertBatch(batch);

  console.log(`\r  Inserted ${count.toLocaleString()} rows total.   `);

  db.close();

  console.log(`\n✅ TSK references pack written to:\n   ${OUTPUT_FILE}`);
  console.log(`   ${count.toLocaleString()} keyword-reference groups`);
}

build().catch(e => { console.error(e); process.exit(1); });
