#!/usr/bin/env node
/**
 * Build Greek New Testament packs (Byzantine and Textus Receptus)
 *
 * Both used to come from data-sources/Byz.json and TR.json, unaccented copies
 * with their apparatus left in: the Byzantine printed both readings wherever
 * the manuscripts split ("το θηριον ουδε τω θηριω", "μετωπον μετωπον"), with
 * OMIT/OR/END markers and stray Strong's numbers among the words, and the TR
 * carried "(15:6)" verse markers, "{N-GSM}" codes and the epistle
 * subscriptions. These sources are the clean, accented editions:
 *
 *   data-sources/byztxt-rp2018/     Robinson-Pierpont Byzantine Textform 2018,
 *                                   the no-variants CSVs. ¶ marks dropped.
 *   data-sources/ebible-grctr/      eBible's Textus Receptus (USFM). Only the
 *                                   main text: the footnotes naming where
 *                                   Stephanus, Elzevir and Scrivener differ,
 *                                   the Strong's tags and the subscriptions
 *                                   (\d) are dropped.
 *   data-sources/byztxt-scrivener/  Robinson's Scrivener 1894. Not shipped;
 *                                   the TR is checked against it word by word.
 *
 * Usage:
 *   node scripts/download-greek-texts.mjs
 *   node scripts/build-greek-nt-packs.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const NT_BOOKS = [
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation'
];

// File codes in NT order, one list per source.
const RP_CODES = [
  'MAT', 'MAR', 'LUK', 'JOH', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAM',
  '1PE', '2PE', '1JO', '2JO', '3JO', 'JUD', 'REV',
];
const USFM_CODES = [
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS',
  '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];
const SCRIVENER_CODES = [
  'MT', 'MR', 'LU', 'JOH', 'AC', 'RO', '1CO', '2CO', 'GA', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS',
  '1PE', '2PE', '1JO', '2JO', '3JO', 'JUDE', 'RE',
];

/** One RP 2018 CSV ("chapter,verse,text", text quoted when it has a comma). */
function readRpBook(code, book) {
  const path = join(repoRoot, 'data-sources/byztxt-rp2018', `${code}.csv`);
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter(Boolean);
  if (lines.shift() !== 'chapter,verse,text') throw new Error(`${code}.csv: unexpected header`);
  return lines.map((line) => {
    const m = line.match(/^(\d+),(\d+),(?:"(.*)"|([^"]*))$/);
    if (!m) throw new Error(`${code}.csv: can't read line: ${line.slice(0, 80)}`);
    const text = (m[3] ?? m[4]).replace(/""/g, '"').replace(/¶/g, '');
    return { book, chapter: Number(m[1]), verse: Number(m[2]), text };
  });
}

/**
 * One eBible USFM book. Footnotes go first, with their text; then each
 * \w word|strong="…"\w* becomes the bare word, and every other marker is
 * paragraphing and goes. \d is a subscription after the last verse, not text.
 */
function readUsfmBook(code, book) {
  const dir = join(repoRoot, 'data-sources/ebible-grctr');
  const file = readdirSync(dir).find((f) => f.endsWith(`-${code}grctr.usfm`));
  if (!file) throw new Error(`ebible-grctr: no file for ${code}`);
  const body = readFileSync(join(dir, file), 'utf-8')
    .replace(/\\f .*?\\f\*/gs, ' ')
    .replace(/\\w ([^|\\]*)\|[^\\]*\\w\*/g, '$1')
    .replace(/^\\(id|h|toc\d|mt\d?|d)\b[^\n]*/gm, '');

  const verses = [];
  let chapter = 0;
  for (const piece of body.split(/(?=\\c |\\v )/)) {
    const c = piece.match(/^\\c (\d+)/);
    if (c) {
      chapter = Number(c[1]);
      continue;
    }
    const v = piece.match(/^\\v (\d+)\s*([\s\S]*)$/);
    if (!v) continue;
    const text = v[2].replace(/\\[a-z]+\d?\*?/g, ' ');
    verses.push({ book, chapter, verse: Number(v[1]), text });
  }
  return verses;
}

const tidy = (text) => text.replace(/\s+/g, ' ').replace(/\s+([,.;·])/g, '$1').trim();

/** Accents, breathings, punctuation and case gone, final sigma folded. */
const bareWords = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);

/** Robinson's ASCII transliteration (v is final sigma) → bare Greek. */
const SCV_LETTERS = {
  a: 'α', b: 'β', g: 'γ', d: 'δ', e: 'ε', z: 'ζ', h: 'η', y: 'θ', i: 'ι', k: 'κ', l: 'λ',
  m: 'μ', n: 'ν', x: 'ξ', o: 'ο', p: 'π', r: 'ρ', s: 'σ', v: 'σ', t: 'τ', u: 'υ', f: 'φ',
  c: 'χ', q: 'ψ', w: 'ω',
};

/** Scrivener 1894 by "chapter:verse" → bare words, headings in [ ] dropped. */
function readScrivenerBook(code) {
  const text = readFileSync(join(repoRoot, 'data-sources/byztxt-scrivener', `${code}.SCV`), 'latin1')
    .replace(/\[[^\]]*\]/g, ' ');
  const out = new Map();
  for (const piece of text.split(/(?=\b\d+:\d+\b)/)) {
    const m = piece.match(/^(\d+):(\d+)([\s\S]*)$/);
    if (!m) continue;
    const words = m[3].toLowerCase().split(/[^a-z]+/).filter(Boolean)
      .map((w) => [...w].map((ch) => SCV_LETTERS[ch] ?? '').join(''));
    out.set(`${Number(m[1])}:${Number(m[2])}`, words);
  }
  return out;
}

/**
 * Fatal on anything that isn't Greek running text: the old sources shipped
 * OMIT, Strong's numbers and morphology codes in the verses for months.
 */
function checkClean(name, verses) {
  const bad = verses.filter((v) => /[A-Za-z0-9{}[\]|\\]/.test(v.text) || !v.text);
  if (bad.length) {
    for (const v of bad.slice(0, 10)) console.error(`   ${v.book} ${v.chapter}:${v.verse}  ${v.text.slice(0, 120)}`);
    throw new Error(`${name}: ${bad.length} verses still carry markup or are empty`);
  }
}

/** The TR against Scrivener 1894: where they differ there should be a footnote. */
function compareWithScrivener(verses) {
  const byBook = new Map(NT_BOOKS.map((b, i) => [b, readScrivenerBook(SCRIVENER_CODES[i])]));
  let differ = 0;
  let missing = 0;
  const samples = [];
  for (const v of verses) {
    const scv = byBook.get(v.book).get(`${v.chapter}:${v.verse}`);
    if (!scv) {
      missing++;
      continue;
    }
    // Spelling, not readings: Robinson prints the movable nu and sigma
    // (ἐγέννησεν, οὕτως) where eBible doesn't, and divides some words
    // differently (ἄραγε, ἐκ περισσοῦ).
    const key = (words) => words.map((w) => w.replace(/ν$/, '').replace(/^ουτωσ$/, 'ουτω')).join('');
    if (key(bareWords(v.text)) !== key(scv)) {
      differ++;
      if (samples.length < 5) samples.push(`${v.book} ${v.chapter}:${v.verse}`);
    }
  }
  console.log(`   Against Scrivener 1894: ${differ} verses differ, ${missing} not in Scrivener` +
    (samples.length ? ` (e.g. ${samples.join(', ')})` : ''));
  return { differ, missing };
}

function buildPack({ packId, translationId, translationName, license, attribution, verses, outputPath }) {
  console.log(`\n📖 Building ${translationName}...`);

  for (const v of verses) v.text = tidy(v.text);
  const books = new Set(verses.map((v) => v.book));
  // Deliberately fatal: a short New Testament is what shipped unnoticed for
  // months when book names didn't match.
  if (books.size !== NT_BOOKS.length) {
    throw new Error(`${translationName}: found ${books.size} of ${NT_BOOKS.length} NT books`);
  }
  checkClean(translationName, verses);

  // Always build from scratch — re-inserting into a previous build collides
  // with the verses already there.
  if (existsSync(outputPath)) rmSync(outputPath);
  const db = new Database(outputPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS verses (
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (book, chapter, verse)
      );

      CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
      CREATE INDEX IF NOT EXISTS idx_verses_book_chapter ON verses(book, chapter);
    `);

    const metadata = {
      id: packId,
      translationId,
      translationName,
      version: '1.0',
      type: 'text',
      language: 'grc',
      languageName: 'Ancient Greek',
      license,
      attribution,
      bookCount: String(books.size),
      verseCount: String(verses.length),
    };
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    const insertVerse = db.prepare('INSERT INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (const [key, value] of Object.entries(metadata)) insertMeta.run(key, value);
      for (const v of verses) insertVerse.run(v.book, v.chapter, v.verse, v.text);
    })();
  } finally {
    db.close();
  }

  const size = (statSync(outputPath).size / (1024 * 1024)).toFixed(2);
  console.log(`   ${books.size} books, ${verses.length} verses`);
  console.log(`   ✅ Pack built: ${size} MB`);
}

console.log('📦 Building Greek New Testament Packs');
console.log('='.repeat(50));

buildPack({
  packId: 'byz-full',
  translationId: 'BYZ',
  translationName: 'Byzantine Greek New Testament (2018)',
  license: 'Public Domain',
  attribution: 'The New Testament in the Original Greek: Byzantine Textform 2018. Edited by Maurice A. Robinson and William G. Pierpont.',
  verses: NT_BOOKS.flatMap((book, i) => readRpBook(RP_CODES[i], book)),
  outputPath: resolve(repoRoot, 'packs/byz-full.sqlite'),
});

const trVerses = NT_BOOKS.flatMap((book, i) => readUsfmBook(USFM_CODES[i], book));
buildPack({
  packId: 'tr-full',
  translationId: 'TR',
  translationName: 'Textus Receptus (1550/1894)',
  license: 'Public Domain',
  attribution: 'The Greek Textus Receptus New Testament (Stephanus 1550, Elzevir 1624, Scrivener), eBible.org edition with manuscript annotations by Adam Boyd. Public Domain.',
  verses: trVerses,
  outputPath: resolve(repoRoot, 'packs/tr-full.sqlite'),
});
compareWithScrivener(trVerses);

console.log('\n' + '='.repeat(50));
console.log('✅ Greek New Testament packs built successfully!');
