#!/usr/bin/env node

/**
 * Build Section Headings Pack
 *
 * Parses all 66 BSB USFM (.SFM) files and extracts \s, \s1, \s2 pericope/section
 * headings, keyed by (book, chapter, verse). Outputs packs/section-headings.sqlite.
 *
 * These headings are CC0 / public domain (Berean Standard Bible) and serve as a
 * translation-agnostic overlay — any installed translation can display them.
 *
 * Usage: node scripts/build-headings-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const USFM_DIR = join(repoRoot, 'data-sources', 'bsb_usfm', 'bsb_usfm');
const PACKS_DIR = join(repoRoot, 'packs');
// Must be the name the manifest and PacksPane download (`section-headings.sqlite`).
// This script used to write `headings.sqlite`, which nothing distributed — the
// shipped pack silently stayed three months stale.
const OUTPUT_PATH = join(PACKS_DIR, 'section-headings.sqlite');

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
 * Parse a USFM .SFM file and extract section headings with their (chapter, verse).
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

    // Acrostic stanza labels (\qa ALEPH, BETH…) in Psalm 119. They sit above
    // the verse they open — level 3 so the reader can style them apart from
    // pericope titles. Without this they end up welded to the previous verse.
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

// ── Build ────────────────────────────────────────────────────────────────────

console.log('Building section headings pack from BSB USFM...\n');

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
    book    TEXT    NOT NULL,
    chapter INTEGER NOT NULL,
    verse   INTEGER NOT NULL,
    heading TEXT    NOT NULL,
    level   INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (book, chapter, verse)
  );

  CREATE INDEX idx_headings_book_chapter
    ON section_headings (book, chapter);
`);

const metaInsert = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
metaInsert.run('pack_id',      'section-headings');
metaInsert.run('pack_type',    'headings');
metaInsert.run('pack_version', '1.0');
metaInsert.run('source',       'Berean Standard Bible (BSB)');
metaInsert.run('license',      'CC0 / Public Domain');
metaInsert.run('attribution',  'Berean Standard Bible – https://berean.bible');
metaInsert.run('description',
  'Section headings (pericope titles) for all 66 canonical books, sourced from ' +
  'BSB USFM \\s1/\\s2 markers. Translation-agnostic overlay — works with any installed translation.'
);

const insertHeading = db.prepare(`
  INSERT OR IGNORE INTO section_headings (book, chapter, verse, heading, level)
  VALUES (@book, @chapter, @verse, @heading, @level)
`);
const insertBatch = db.transaction((rows) => {
  for (const row of rows) insertHeading.run(row);
});

let totalHeadings = 0;

for (const book of BIBLE_BOOKS) {
  const filePath = join(USFM_DIR, book.file);
  if (!existsSync(filePath)) {
    console.warn(`  ⚠  Missing: ${book.file} — skipping ${book.name}`);
    continue;
  }
  const headings = parseUSFMHeadings(filePath, book.name);
  insertBatch(headings);
  totalHeadings += headings.length;
  console.log(`  ✓  ${book.name.padEnd(22)} ${headings.length} headings`);
}

db.close();

console.log(`\n✅ section-headings.sqlite built: ${totalHeadings} total headings`);
console.log(`   Output: ${OUTPUT_PATH}`);
