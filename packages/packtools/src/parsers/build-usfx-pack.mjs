/**
 * Build a translation pack from a USFX file.
 *
 * WEB and KJV are both published by eBible.org as a single USFX document
 * covering the whole Bible, so they share everything but their paths and
 * metadata.
 */

import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';
import { parseUSFX } from './usfx-parser.mjs';
import { USFM_CODE_TO_BOOK } from './books.mjs';

/**
 * The verses a pack built from this file holds, in pack order: { book, chapter,
 * verse, text } with the app's book names. A verse id the file repeats keeps
 * its first text, as the pack does. `parseOptions` goes to parseUSFX
 * (scripts/build-word-links.mjs asks for `strongsSentinels`).
 */
export function produceUSFXVerses(sourcePath, parseOptions = {}) {
  if (!existsSync(sourcePath)) {
    console.error(`❌ USFX source not found: ${sourcePath}`);
    process.exit(1);
  }

  const { books } = parseUSFX(sourcePath, parseOptions);

  // A USFX file carries the deuterocanon too; these packs are the 66-book
  // canon, and the book map is what the rest of the app keys off.
  const canonical = books.filter((b) => USFM_CODE_TO_BOOK[b.code]);
  const verses = [];
  const seen = new Set();
  for (const b of canonical) {
    const name = USFM_CODE_TO_BOOK[b.code];
    for (const v of b.verses) {
      if (!v.chapter || !v.verse) continue;
      const key = `${name}|${v.chapter}|${v.verse}`;
      if (seen.has(key)) continue;
      seen.add(key);
      verses.push({ book: name, chapter: v.chapter, verse: v.verse, text: v.text });
    }
  }
  return { verses, books: canonical.length, skipped: books.length - canonical.length };
}

/**
 * @param {object} opts
 * @param {string} opts.sourcePath  the .xml USFX file
 * @param {string} opts.outputPath  the .sqlite pack to write
 * @param {object} opts.metadata    key/value rows for the metadata table
 */
export function buildUSFXPack({ sourcePath, outputPath, metadata }) {
  const { verses, books, skipped } = produceUSFXVerses(sourcePath);

  if (existsSync(outputPath)) unlinkSync(outputPath);
  const db = new Database(outputPath);

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
  for (const [key, value] of Object.entries(metadata)) insertMeta.run(key, String(value));

  const insertVerse = db.prepare(
    'INSERT INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)'
  );
  const insertAll = db.transaction((all) => {
    for (const v of all) insertVerse.run(v.book, v.chapter, v.verse, v.text);
  });
  insertAll(verses);
  const total = verses.length;

  const structure = db
    .prepare(
      `SELECT
         SUM(text LIKE '%' || char(16) || '%') AS paragraphs,
         SUM(text LIKE '%' || char(17) || '%') AS poetry,
         SUM(text LIKE '%' || char(1) || '%')  AS footnotes,
         SUM(text LIKE '%' || char(20) || '%') AS crossrefs
       FROM verses`
    )
    .get();
  const rows = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;

  db.close();

  console.log(`\n✓ ${rows.toLocaleString()} verses in ${books} books` +
    (skipped ? ` (${skipped} non-canonical books skipped)` : ''));
  console.log(`✓ ${Number(structure.paragraphs).toLocaleString()} verses open a paragraph`);
  console.log(`✓ ${Number(structure.poetry).toLocaleString()} verses carry a poetic line`);
  console.log(`✓ ${Number(structure.footnotes).toLocaleString()} verses carry a footnote`);
  console.log(`✓ ${Number(structure.crossrefs).toLocaleString()} verses carry a cross-reference`);
  console.log(`\n✅ Pack built: ${outputPath}`);

  return { rows, total };
}
