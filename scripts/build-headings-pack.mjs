#!/usr/bin/env node

/**
 * Build the section headings pack.
 *
 * Headings are an overlay rather than a column on the verse tables, because the
 * consolidated pack has no room for one. Each translation that writes its own
 * gets its own rows: BSB has 3,097, NET 1,802, KJV 44 and WEB 5. A translation
 * with none -- or a passage where it has none -- falls back to BSB's at read
 * time, which is what the whole app did before this.
 *
 * Levels: 1 and 2 are pericope titles, 3 is the acrostic stanza labels in
 * Psalm 119 (ALEPH, BETH ...) which sit above the verse they open and would
 * otherwise be welded to the end of the previous one.
 *
 * Usage: node scripts/build-headings-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseUSFX } from '../packages/packtools/src/parsers/usfx-parser.mjs';
import { USFM_CODE_TO_BOOK } from '../packages/packtools/src/parsers/books.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const PACKS_DIR = join(repoRoot, 'packs');
// Must be the name the manifest and PacksPane download (`section-headings.sqlite`).
// This script used to write `headings.sqlite`, which nothing distributed -- the
// shipped pack silently stayed three months stale.
const OUTPUT_PATH = join(PACKS_DIR, 'section-headings.sqlite');

const BSB_USFM_DIR = join(repoRoot, 'data-sources', 'bsb_usfm', 'bsb_usfm');
const NET_USFM_DIR = join(repoRoot, 'data-sources/commentaries/raw/net-full-usfm');
const WEB_USFX = join(repoRoot, 'data-sources/web-usfx/eng-web_usfx.xml');
const KJV_USFX = join(repoRoot, 'data-sources/kjv-usfx/eng-kjv_usfx.xml');

if (!existsSync(PACKS_DIR)) mkdirSync(PACKS_DIR, { recursive: true });

// All 66 canonical books with their BSB USFM filenames
const BIBLE_BOOKS = [
  { name: 'Genesis',          file: '01GENBSB.SFM' },
  { name: 'Exodus',           file: '02EXOBSB.SFM' },
  { name: 'Leviticus',        file: '03LEVBSB.SFM' },
  { name: 'Numbers',          file: '04NUMBSB.SFM' },
  { name: 'Deuteronomy',      file: '05DEUBSB.SFM' },
  { name: 'Joshua',           file: '06JOSBSB.SFM' },
  { name: 'Judges',           file: '07JDGBSB.SFM' },
  { name: 'Ruth',             file: '08RUTBSB.SFM' },
  { name: '1 Samuel',         file: '091SABSB.SFM' },
  { name: '2 Samuel',         file: '102SABSB.SFM' },
  { name: '1 Kings',          file: '111KIBSB.SFM' },
  { name: '2 Kings',          file: '122KIBSB.SFM' },
  { name: '1 Chronicles',     file: '131CHBSB.SFM' },
  { name: '2 Chronicles',     file: '142CHBSB.SFM' },
  { name: 'Ezra',             file: '15EZRBSB.SFM' },
  { name: 'Nehemiah',         file: '16NEHBSB.SFM' },
  { name: 'Esther',           file: '17ESTBSB.SFM' },
  { name: 'Job',              file: '18JOBBSB.SFM' },
  { name: 'Psalms',           file: '19PSABSB.SFM' },
  { name: 'Proverbs',         file: '20PROBSB.SFM' },
  { name: 'Ecclesiastes',     file: '21ECCBSB.SFM' },
  { name: 'Song of Solomon',  file: '22SNGBSB.SFM' },
  { name: 'Isaiah',           file: '23ISABSB.SFM' },
  { name: 'Jeremiah',         file: '24JERBSB.SFM' },
  { name: 'Lamentations',     file: '25LAMBSB.SFM' },
  { name: 'Ezekiel',          file: '26EZKBSB.SFM' },
  { name: 'Daniel',           file: '27DANBSB.SFM' },
  { name: 'Hosea',            file: '28HOSBSB.SFM' },
  { name: 'Joel',             file: '29JOLBSB.SFM' },
  { name: 'Amos',             file: '30AMOBSB.SFM' },
  { name: 'Obadiah',          file: '31OBABSB.SFM' },
  { name: 'Jonah',            file: '32JONBSB.SFM' },
  { name: 'Micah',            file: '33MICBSB.SFM' },
  { name: 'Nahum',            file: '34NAMBSB.SFM' },
  { name: 'Habakkuk',         file: '35HABBSB.SFM' },
  { name: 'Zephaniah',        file: '36ZEPBSB.SFM' },
  { name: 'Haggai',           file: '37HAGBSB.SFM' },
  { name: 'Zechariah',        file: '38ZECBSB.SFM' },
  { name: 'Malachi',          file: '39MALBSB.SFM' },
  { name: 'Matthew',          file: '41MATBSB.SFM' },
  { name: 'Mark',             file: '42MRKBSB.SFM' },
  { name: 'Luke',             file: '43LUKBSB.SFM' },
  { name: 'John',             file: '44JHNBSB.SFM' },
  { name: 'Acts',             file: '45ACTBSB.SFM' },
  { name: 'Romans',           file: '46ROMBSB.SFM' },
  { name: '1 Corinthians',    file: '471COBSB.SFM' },
  { name: '2 Corinthians',    file: '482COBSB.SFM' },
  { name: 'Galatians',        file: '49GALBSB.SFM' },
  { name: 'Ephesians',        file: '50EPHBSB.SFM' },
  { name: 'Philippians',      file: '51PHPBSB.SFM' },
  { name: 'Colossians',       file: '52COLBSB.SFM' },
  { name: '1 Thessalonians',  file: '531THBSB.SFM' },
  { name: '2 Thessalonians',  file: '542THBSB.SFM' },
  { name: '1 Timothy',        file: '551TIBSB.SFM' },
  { name: '2 Timothy',        file: '562TIBSB.SFM' },
  { name: 'Titus',            file: '57TITBSB.SFM' },
  { name: 'Philemon',         file: '58PHMBSB.SFM' },
  { name: 'Hebrews',          file: '59HEBBSB.SFM' },
  { name: 'James',            file: '60JASBSB.SFM' },
  { name: '1 Peter',          file: '611PEBSB.SFM' },
  { name: '2 Peter',          file: '622PEBSB.SFM' },
  { name: '1 John',           file: '631JNBSB.SFM' },
  { name: '2 John',           file: '642JNBSB.SFM' },
  { name: '3 John',           file: '653JNBSB.SFM' },
  { name: 'Jude',             file: '66JUDBSB.SFM' },
  { name: 'Revelation',       file: '67REVBSB.SFM' },
];

/**
 * Parse a USFM file and extract section headings with their (chapter, verse).
 * Headings are attached to the next \v verse marker following them.
 */
function parseUSFMHeadings(filePath, bookName) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const headings = [];
  let currentChapter = 0;
  let pendingHeading = null;
  let pendingLevel = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Chapter: \c N
    const chapterMatch = line.match(/^\\c\s+(\d+)/);
    if (chapterMatch) {
      currentChapter = parseInt(chapterMatch[1], 10);
      pendingHeading = null;
      continue;
    }

    // Section headings: \s1  \s2  \s (bare, treated as level 1)
    const sMatch = line.match(/^\\s(1|2)?\s+(.*)/);
    if (sMatch) {
      pendingLevel = sMatch[1] === '2' ? 2 : 1;
      pendingHeading = sMatch[2].trim();
      continue;
    }

    // Acrostic stanza labels (\qa ALEPH, BETH...) in Psalm 119.
    const qaMatch = line.match(/^\\qa\s+(.*)/);
    if (qaMatch && qaMatch[1].trim()) {
      pendingLevel = 3;
      pendingHeading = qaMatch[1].trim();
      continue;
    }

    // Verse: \v N [optional text on same line]
    const verseMatch = line.match(/^\\v\s+(\d+)/);
    if (verseMatch) {
      const verseNum = parseInt(verseMatch[1], 10);
      if (pendingHeading && currentChapter > 0) {
        headings.push({
          book: bookName,
          chapter: currentChapter,
          verse: verseNum,
          heading: pendingHeading,
          level: pendingLevel,
        });
        pendingHeading = null;
      }
      continue;
    }
  }

  return headings;
}

/** BSB ships one .SFM per book, named in the table above. */
function bsbHeadings() {
  const rows = [];
  for (const book of BIBLE_BOOKS) {
    const filePath = join(BSB_USFM_DIR, book.file);
    if (!existsSync(filePath)) {
      console.warn(`  !  Missing: ${book.file} -- skipping ${book.name}`);
      continue;
    }
    rows.push(...parseUSFMHeadings(filePath, book.name));
  }
  return rows;
}

/** NET ships one .usfm per book, named 02-GENengnet.usfm. */
function netHeadings() {
  const pattern = /^\d+-([A-Z0-9]+)engnet\.usfm$/i;
  const rows = [];
  if (!existsSync(NET_USFM_DIR)) return rows;
  for (const file of readdirSync(NET_USFM_DIR).filter((f) => pattern.test(f)).sort()) {
    const name = USFM_CODE_TO_BOOK[file.match(pattern)[1].toUpperCase()];
    if (name) rows.push(...parseUSFMHeadings(join(NET_USFM_DIR, file), name));
  }
  return rows;
}

/** WEB and KJV are one USFX document each; the parser returns their headings. */
function usfxHeadings(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const book of parseUSFX(path).books) {
    const name = USFM_CODE_TO_BOOK[book.code];
    if (!name) continue;
    for (const h of book.headings) {
      rows.push({ book: name, chapter: h.chapter, verse: h.verse, heading: h.heading, level: h.level });
    }
  }
  return rows;
}

const SOURCES = [
  { id: 'bsb', label: 'Berean Standard Bible', read: bsbHeadings },
  { id: 'net', label: 'New English Translation', read: netHeadings },
  { id: 'web', label: 'World English Bible', read: () => usfxHeadings(WEB_USFX) },
  { id: 'kjv', label: 'King James Version', read: () => usfxHeadings(KJV_USFX) },
];

// -- Build --------------------------------------------------------------------

console.log('Building section headings pack\n');

if (existsSync(OUTPUT_PATH)) {
  unlinkSync(OUTPUT_PATH);
  console.log('Removed existing section-headings.sqlite\n');
}

const db = new Database(OUTPUT_PATH);

db.exec(`
  CREATE TABLE metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE section_headings (
    translation TEXT    NOT NULL,
    book        TEXT    NOT NULL,
    chapter     INTEGER NOT NULL,
    verse       INTEGER NOT NULL,
    heading     TEXT    NOT NULL,
    level       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (translation, book, chapter, verse)
  );

  CREATE INDEX idx_headings_lookup
    ON section_headings (translation, book, chapter);
`);

const metaInsert = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
metaInsert.run('pack_id',      'section-headings');
metaInsert.run('pack_type',    'headings');
metaInsert.run('pack_version', '1.0');
metaInsert.run('source',       'BSB, NET, WEB, KJV');
metaInsert.run('license',      'BSB CC0; NET (c) Biblical Studies Press; WEB and KJV public domain');
metaInsert.run('attribution',  'Berean Standard Bible - https://berean.bible; NET Bible - https://netbible.com; WEB and KJV via eBible.org');
metaInsert.run('description',
  'Section headings (pericope titles) per translation. A translation without ' +
  'its own heading for a passage falls back to the BSB heading at read time.'
);

const insertHeading = db.prepare(`
  INSERT OR IGNORE INTO section_headings (translation, book, chapter, verse, heading, level)
  VALUES (@translation, @book, @chapter, @verse, @heading, @level)
`);
const insertBatch = db.transaction((rows) => {
  for (const row of rows) insertHeading.run(row);
});

let total = 0;
for (const source of SOURCES) {
  const rows = source.read().map((r) => ({ ...r, translation: source.id }));
  insertBatch(rows);
  total += rows.length;
  console.log(`  ${source.id.padEnd(4)} ${String(rows.length).padStart(5)} headings  ${source.label}`);
}

db.close();

console.log(`\n section-headings.sqlite built: ${total} headings across ${SOURCES.length} translations`);
console.log(`   Output: ${OUTPUT_PATH}`);
