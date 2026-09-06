/**
 * build-starter-pack.mjs
 *
 * Builds packs/starter.sqlite — the text Hexapla ships with rather than asks
 * for. NET plus every section heading, in the same shape the consolidated
 * translations pack uses, so the existing importer handles it with no changes.
 *
 * Why these two and nothing else: a cold visitor has to be able to read
 * something, and the English translations pack is far too heavy for that job —
 * not for the download (10 MB gzipped) but for the install, which materialises
 * all 152,718 verses in memory before writing. NET alone is 31,102.
 *
 * All four translations' headings go in, not just NET's. Headings fall back to
 * BSB's per chapter at read time, and NET only carries 1,751 of the 4,894 rows —
 * strip the rest and most chapters silently lose their titles.
 *
 * Usage: node scripts/build-starter-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const NET_SOURCE = join(repoRoot, 'packs/net.sqlite');
const HEADINGS_SOURCE = join(repoRoot, 'packs/section-headings.sqlite');
const OUTPUT = join(repoRoot, 'packs/starter.sqlite');

/** Lowercase to match the ids the consolidated pack already uses. */
const TRANSLATION_ID = 'net';

for (const [label, path] of [['NET', NET_SOURCE], ['section headings', HEADINGS_SOURCE]]) {
  if (!existsSync(path)) {
    console.error(`❌ Missing ${label} source: ${path}`);
    console.error('   Git LFS files may not be materialised. Run: git lfs pull');
    process.exit(1);
  }
  // An unmaterialised LFS pointer is a ~130-byte text file that would otherwise
  // sail through and produce a silently empty pack.
  if (statSync(path).size < 100_000) {
    console.error(`❌ ${label} source looks like a Git LFS pointer, not a database: ${path}`);
    process.exit(1);
  }
}

console.log('🏗️  Building starter pack...\n');

if (existsSync(OUTPUT)) unlinkSync(OUTPUT);

const db = new Database(OUTPUT);

db.exec(`
  CREATE TABLE metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE translations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT DEFAULT 'en',
    description TEXT
  );

  CREATE TABLE verses (
    translation_id TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (translation_id, book, chapter, verse)
  );

  CREATE INDEX idx_verses_translation ON verses(translation_id);
  CREATE INDEX idx_verses_book ON verses(book);
  CREATE INDEX idx_verses_chapter ON verses(book, chapter);

  CREATE TABLE section_headings (
    translation TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    heading TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (translation, book, chapter, verse)
  );
`);

// ── Verses ─────────────────────────────────────────────────────────────────
// net.sqlite is a single-translation pack, so its verses table has no
// translation_id column — it is supplied here.
const net = new Database(NET_SOURCE, { readonly: true });
const verseRows = net.prepare('SELECT book, chapter, verse, text FROM verses').all();
net.close();

const insertVerse = db.prepare(
  'INSERT INTO verses (translation_id, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)',
);
db.transaction((rows) => {
  for (const r of rows) insertVerse.run(TRANSLATION_ID, r.book, r.chapter, r.verse, r.text);
})(verseRows);
console.log(`   Verses: ${verseRows.length.toLocaleString()}`);

// ── Headings ───────────────────────────────────────────────────────────────
const headings = new Database(HEADINGS_SOURCE, { readonly: true });
const headingRows = headings
  .prepare('SELECT translation, book, chapter, verse, heading, level FROM section_headings')
  .all();
headings.close();

const insertHeading = db.prepare(
  'INSERT INTO section_headings (translation, book, chapter, verse, heading, level) VALUES (?, ?, ?, ?, ?, ?)',
);
db.transaction((rows) => {
  for (const r of rows) {
    insertHeading.run(r.translation, r.book, r.chapter, r.verse, r.heading, r.level ?? 1);
  }
})(headingRows);
console.log(`   Headings: ${headingRows.length.toLocaleString()}`);

// ── Catalogue rows ─────────────────────────────────────────────────────────
db.prepare('INSERT INTO translations (id, name, language, description) VALUES (?, ?, ?, ?)').run(
  TRANSLATION_ID,
  'New English Translation',
  'en',
  'New English Translation',
);

// pack_type 'translation' is normalised to 'text' on import, which is what puts
// the verses in front of TextStore.
const metadata = {
  pack_id: 'starter',
  pack_type: 'translation',
  pack_version: '1.0.0',
  name: 'Starter Pack',
  description: 'NET Bible and section headings — the text Hexapla ships with.',
  license: 'NET Bible copyright © 1996-2016 Biblical Studies Press, L.L.C. Headings: BSB CC0; WEB and KJV public domain.',
  attribution: 'NET Bible® — https://netbible.com/copyright/',
  createdAt: new Date().toISOString(),
};
const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
db.transaction(() => {
  for (const [k, v] of Object.entries(metadata)) insertMeta.run(k, v);
})();

db.exec('VACUUM');
db.close();

const bytes = statSync(OUTPUT).size;
console.log(`\n✅ ${OUTPUT}`);
console.log(`   ${(bytes / 1024 / 1024).toFixed(2)} MB (${bytes.toLocaleString()} bytes)\n`);
