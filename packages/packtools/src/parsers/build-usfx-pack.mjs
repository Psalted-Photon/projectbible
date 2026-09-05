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
 * @param {object} opts
 * @param {string} opts.sourcePath  the .xml USFX file
 * @param {string} opts.outputPath  the .sqlite pack to write
 * @param {object} opts.metadata    key/value rows for the metadata table
 */
export function buildUSFXPack({ sourcePath, outputPath, metadata }) {
  if (!existsSync(sourcePath)) {
    console.error(`❌ USFX source not found: ${sourcePath}`);
    process.exit(1);
  }

  const { books } = parseUSFX(sourcePath);

  // A USFX file carries the deuterocanon too; these packs are the 66-book
  // canon, and the book map is what the rest of the app keys off.
  const canonical = books.filter((b) => USFM_CODE_TO_BOOK[b.code]);
  const skipped = books.length - canonical.length;

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
    'INSERT OR IGNORE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)'
  );
  let total = 0;
  const insertAll = db.transaction((all) => {
    for (const b of all) {
      const name = USFM_CODE_TO_BOOK[b.code];
      for (const v of b.verses) {
        if (!v.chapter || !v.verse) continue;
        insertVerse.run(name, v.chapter, v.verse, v.text);
        total++;
      }
    }
  });
  insertAll(canonical);

  const structure = db
    .prepare(
      `SELECT
         SUM(text LIKE '%' || char(16) || '%') AS paragraphs,
         SUM(text LIKE '%' || char(17) || '%') AS poetry,
         SUM(text LIKE '%' || char(1) || '%')  AS notes
       FROM verses`
    )
    .get();
  const rows = db.prepare('SELECT COUNT(*) AS n FROM verses').get().n;

  db.close();

  console.log(`\n✓ ${rows.toLocaleString()} verses in ${canonical.length} books` +
    (skipped ? ` (${skipped} non-canonical books skipped)` : ''));
  console.log(`✓ ${Number(structure.paragraphs).toLocaleString()} verses open a paragraph`);
  console.log(`✓ ${Number(structure.poetry).toLocaleString()} verses carry a poetic line`);
  console.log(`✓ ${Number(structure.notes).toLocaleString()} verses carry a note`);
  console.log(`\n✅ Pack built: ${outputPath}`);

  return { rows, total };
}
