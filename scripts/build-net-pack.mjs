#!/usr/bin/env node

/**
 * Build the NET Bible pack (New English Translation) from USFM.
 *
 * This used to pull plain text from a JSON API, which is why the shipped NET
 * pack had no poetry, no paragraphs and no headings -- there was never any
 * structure in what it read. The full NET USFM has been sitting in the repo all
 * along under data-sources/commentaries/raw/net-full-usfm (eBible.org build,
 * 66 books) and carries 22,702 poetic lines and 6,730 paragraph breaks, so the
 * pack is built from that instead and goes through the same scanner as BSB.
 *
 * NET Bible copyright (c) 1996-2016 Biblical Studies Press, L.L.C.
 * See https://netbible.com/copyright/ for permissions.
 *
 * Usage: node scripts/build-net-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseUSFM,
  processVerses,
  cleanUSFMMarkup,
} from '../packages/packtools/src/parsers/usfm-scanner.mjs';
import { USFM_CODE_TO_BOOK } from '../packages/packtools/src/parsers/books.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const USFM_DIR = join(repoRoot, 'data-sources/commentaries/raw/net-full-usfm');
const OUTPUT_PATH = join(repoRoot, 'packs/net.sqlite');
const REPAIRS_PATH = join(repoRoot, 'packages/packtools/src/parsers/net-usfm-repairs.json');

/**
 * The eBible NET USFM drops a span of text from 20 verses, always one carrying
 * place names -- Matthew 2:1 ends at "Bethlehem" and jumps to verse 2. Those
 * verses take their wording from the table instead; see its _note for how it
 * was built and checked. Structure still comes from the USFM either way.
 */
const REPAIRS = JSON.parse(readFileSync(REPAIRS_PATH, 'utf8')).verses;
const LEADING_STRUCTURE = /^[\x10\x11\x12]+/;
let repairsApplied = 0;

function applyRepair(book, verse) {
  const replacement = REPAIRS[`${book} ${verse.chapter}:${verse.verse}`];
  if (!replacement) return verse.text;
  repairsApplied++;
  const structure = verse.text.match(LEADING_STRUCTURE)?.[0] ?? '';
  return structure + replacement;
}

/** File names look like 02-GENengnet.usfm; the middle group is the book code. */
const FILE_PATTERN = /^\d+-([A-Z0-9]+)engnet\.usfm$/i;

/**
 * NET differs from BSB in three ways.
 *
 * Its USFM has no \b at all -- paragraphs are bare \p, so those have to open a
 * paragraph or every one of the 6,730 is lost. It has no shipped byte layout to
 * protect, so markers are spaced only where a space is actually missing. And it
 * marks OT quotations with \qt and emphasis with \bd, both of which the reader
 * already renders from <b>.
 */
const NET_OPTIONS = {
  paragraphFromProseMarker: true,
  legacySpacedMarkers: new Set(),
  italicMarkers: new Set(['it']),
  boldMarkers: new Set(['qt', 'bd']),
  preserveSpaceAfterCharClose: true,
  smallCapsMarkers: new Set(['nd']),
};

function readBooks() {
  if (!existsSync(USFM_DIR)) {
    console.error(`❌ NET USFM not found: ${USFM_DIR}`);
    process.exit(1);
  }

  const books = [];
  const files = readdirSync(USFM_DIR).filter((f) => FILE_PATTERN.test(f)).sort();

  for (const file of files) {
    const code = file.match(FILE_PATTERN)[1].toUpperCase();
    const name = USFM_CODE_TO_BOOK[code];
    if (!name) {
      console.error(`❌ Unknown book code ${code} in ${file}`);
      process.exit(1);
    }

    const content = readFileSync(join(USFM_DIR, file), 'utf8');
    const verses = processVerses(parseUSFM(content, NET_OPTIONS)).map((v) => ({
      chapter: v.chapter,
      verse: v.verse,
      text: applyRepair(name, { ...v, text: cleanUSFMMarkup(v.text) }),
    }));

    books.push({ name, verses });
    process.stdout.write(`  ${name.padEnd(16)} ${String(verses.length).padStart(5)} verses\n`);
  }

  return books;
}

function buildPack(books) {
  if (existsSync(OUTPUT_PATH)) unlinkSync(OUTPUT_PATH);

  const db = new Database(OUTPUT_PATH);

  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE verses (
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (book, chapter, verse)
    );

    CREATE INDEX idx_verses_book_chapter ON verses(book, chapter);
  `);

  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('pack_id', 'net');
  insertMeta.run('packId', 'net');
  insertMeta.run('type', 'text');
  insertMeta.run('version', '1.0.0');
  insertMeta.run('translation_id', 'NET');
  insertMeta.run('translationId', 'NET');
  insertMeta.run('translation_name', 'New English Translation');
  insertMeta.run('translationName', 'New English Translation');
  insertMeta.run('license', 'NET Bible copyright © 1996-2016 Biblical Studies Press, L.L.C.');
  insertMeta.run('attribution', 'NET Bible® — https://netbible.com/copyright/');
  insertMeta.run('description', 'New English Translation (NET Bible) - Modern scholarly translation with extensive translator notes');

  const insertVerse = db.prepare('INSERT INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
  let total = 0;
  const insertAll = db.transaction((all) => {
    for (const book of all) {
      for (const v of book.verses) {
        insertVerse.run(book.name, v.chapter, v.verse, v.text);
        total++;
      }
    }
  });
  insertAll(books);

  const structure = db
    .prepare(
      `SELECT
         SUM(text LIKE '%' || char(16) || '%') AS paragraphs,
         SUM(text LIKE '%' || char(17) || '%') AS poetry
       FROM verses`
    )
    .get();

  db.close();

  console.log(`\n✓ ${total.toLocaleString()} verses`);
  console.log(`✓ ${repairsApplied} verses restored from the source-defect table`);
  console.log(`✓ ${Number(structure.paragraphs).toLocaleString()} verses open a paragraph`);
  console.log(`✓ ${Number(structure.poetry).toLocaleString()} verses carry a poetic line`);
  console.log(`\n✅ NET pack built: ${OUTPUT_PATH}`);
}

console.log('📖 Building NET Bible pack from USFM\n');
buildPack(readBooks());
