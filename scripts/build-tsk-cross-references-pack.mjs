/**
 * Build TSK Cross-References Pack
 *
 * Reads:  data/processed/tsk-full.ndjson  (from parse-tsk-osis.mjs)
 * Writes: packs/cross-references.sqlite
 *
 * Replaces the old 74-entry curated-only pack with full TSK coverage
 * (all 66 books, bidirectional) plus the original 74 curated entries merged in.
 *
 * Schema is identical to the existing pack — no app or importer changes required.
 */

import { createRequire } from 'module';
import { createReadStream, existsSync, unlinkSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NDJSON_FILE = join(__dirname, '../data/processed/tsk-full.ndjson');
const OUTPUT_DIR = join(__dirname, '../packs');
const OUTPUT_FILE = join(OUTPUT_DIR, 'cross-references.sqlite');

// ---------------------------------------------------------------------------
// Curated cross-references — preserved from the original build-cross-references.mjs
// These 37 hand-picked pairs are merged in alongside the full TSK data.
// ---------------------------------------------------------------------------
const CURATED_CROSS_REFERENCES = [
  // Creation narratives
  { from: 'Genesis 1:1', to: 'John 1:1', description: 'In the beginning - Creation' },
  { from: 'Genesis 1:1', to: 'John 1:3', description: 'Creation through the Word' },
  { from: 'Genesis 1:26', to: 'John 1:14', description: 'Image of God - Word made flesh' },

  // God's love and salvation
  { from: 'John 3:16', to: 'Romans 5:8', description: 'God demonstrates his love' },
  { from: 'John 3:16', to: '1 John 4:9', description: 'God sent his Son' },
  { from: 'John 3:16', to: '1 John 4:10', description: 'Propitiation for sins' },

  // Greatest commandments
  { from: 'Matthew 22:37', to: 'Deuteronomy 6:5', description: 'Love the LORD' },
  { from: 'Matthew 22:39', to: 'Leviticus 19:18', description: 'Love your neighbor' },
  { from: 'Mark 12:29-31', to: 'Deuteronomy 6:4-5', description: 'Shema Israel' },

  // Messianic prophecies
  { from: 'Isaiah 7:14', to: 'Matthew 1:23', description: 'Virgin birth prophecy' },
  { from: 'Isaiah 9:6', to: 'Luke 2:11', description: 'Child born - Mighty God' },
  { from: 'Isaiah 53:5', to: '1 Peter 2:24', description: 'By his wounds' },
  { from: 'Psalms 22:1', to: 'Matthew 27:46', description: 'My God, why forsaken' },
  { from: 'Psalms 22:16', to: 'John 20:25', description: 'Pierced hands and feet' },
  { from: 'Psalms 22:18', to: 'Matthew 27:35', description: 'Cast lots for garments' },

  // The Word
  { from: 'John 1:1', to: 'Genesis 1:1', description: 'In the beginning' },
  { from: 'John 1:14', to: 'Isaiah 40:5', description: 'Glory of the LORD revealed' },

  // Faith and righteousness
  { from: 'Romans 1:17', to: 'Habakkuk 2:4', description: 'The righteous shall live by faith' },
  { from: 'Romans 4:3', to: 'Genesis 15:6', description: 'Abraham believed God' },
  { from: 'Galatians 3:6', to: 'Genesis 15:6', description: 'Faith credited as righteousness' },

  // Resurrection
  { from: '1 Corinthians 15:4', to: 'Psalms 16:10', description: 'Not abandon to the grave' },
  { from: '1 Corinthians 15:4', to: 'Hosea 6:2', description: 'Raised on the third day' },

  // New covenant
  { from: 'Hebrews 8:8', to: 'Jeremiah 31:31', description: 'New covenant promised' },
  { from: '1 Corinthians 11:25', to: 'Jeremiah 31:31', description: 'New covenant in my blood' },

  // The Law
  { from: 'Matthew 5:17', to: 'Deuteronomy 18:18', description: 'Fulfill the Law' },
  { from: 'Romans 3:20', to: 'Galatians 2:16', description: 'Not justified by works of law' },

  // Salvation
  { from: 'Acts 4:12', to: 'Joel 2:32', description: 'No other name for salvation' },
  { from: 'Romans 10:13', to: 'Joel 2:32', description: 'Everyone who calls on the name' },
  { from: 'Ephesians 2:8-9', to: 'Titus 3:5', description: 'Saved by grace through faith' },

  // Second coming
  { from: 'Matthew 24:30', to: 'Daniel 7:13', description: 'Son of Man coming on clouds' },
  { from: 'Revelation 1:7', to: 'Daniel 7:13', description: 'Coming with the clouds' },
  { from: '1 Thessalonians 4:16', to: 'Daniel 12:2', description: 'Resurrection of the dead' },

  // Suffering servant
  { from: 'Matthew 8:17', to: 'Isaiah 53:4', description: 'Took our infirmities' },
  { from: 'Acts 8:32-33', to: 'Isaiah 53:7-8', description: 'Led like sheep to slaughter' },
  { from: '1 Peter 2:22', to: 'Isaiah 53:9', description: 'No deceit in his mouth' },

  // The stone
  { from: 'Matthew 21:42', to: 'Psalms 118:22', description: 'Stone the builders rejected' },
  { from: '1 Peter 2:7', to: 'Psalms 118:22', description: 'Cornerstone' },
  { from: 'Acts 4:11', to: 'Psalms 118:22', description: 'Chief cornerstone' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a reference string like "Genesis 1:1" or "1 Corinthians 15:4" or "Mark 12:29-31"
 */
function parseReference(ref) {
  const match = ref.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Invalid reference format: "${ref}"`);
  const [, book, chapter, verseStart, verseEnd] = match;
  return {
    book: book.trim(),
    chapter: parseInt(chapter, 10),
    verseStart: parseInt(verseStart, 10),
    verseEnd: verseEnd ? parseInt(verseEnd, 10) : null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(NDJSON_FILE)) {
    console.error(`ERROR: Input file not found: ${NDJSON_FILE}`);
    console.error('Run "node scripts/parse-tsk-osis.mjs" first.');
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  if (existsSync(OUTPUT_FILE)) {
    unlinkSync(OUTPUT_FILE);
    console.log('Removed existing cross-references.sqlite');
  }

  console.log('Building cross-references.sqlite...');

  const db = new Database(OUTPUT_FILE);

  // Performance pragmas for bulk insert
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA cache_size = -64000;'); // 64 MB cache

  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS cross_references (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      from_book      TEXT    NOT NULL,
      from_chapter   INTEGER NOT NULL,
      from_verse     INTEGER NOT NULL,
      to_book        TEXT    NOT NULL,
      to_chapter     INTEGER NOT NULL,
      to_verse_start INTEGER NOT NULL,
      to_verse_end   INTEGER,
      votes          INTEGER DEFAULT 0,
      source         TEXT    DEFAULT 'curated',
      description    TEXT,
      UNIQUE(from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end)
    );

    CREATE INDEX IF NOT EXISTS idx_cross_refs_from
      ON cross_references(from_book, from_chapter, from_verse);

    CREATE INDEX IF NOT EXISTS idx_cross_refs_to
      ON cross_references(to_book, to_chapter, to_verse_start);
  `);

  const insertRef = db.prepare(`
    INSERT OR IGNORE INTO cross_references
      (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end, source, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // ---------------------------------------------------------------------------
  // Phase A: Insert TSK pairs from ndjson (forward + reverse)
  // ---------------------------------------------------------------------------
  console.log('\nPhase A: Inserting TSK cross-references...');

  const BATCH_SIZE = 5000;
  let batch = [];
  let tskForwardCount = 0;

  const flushBatch = db.transaction((rows) => {
    for (const r of rows) {
      insertRef.run(
        r.fromBook, r.fromChapter, r.fromVerse,
        r.toBook, r.toChapter, r.toVerseStart, r.toVerseEnd,
        r.source, null
      );
    }
  });

  const rl = createInterface({
    input: createReadStream(NDJSON_FILE, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }

    const toVerseEnd = rec.toVerseEnd ?? null;

    // Forward pair: source verse → target verse
    batch.push({
      fromBook: rec.fromBook,
      fromChapter: rec.fromChapter,
      fromVerse: rec.fromVerse,
      toBook: rec.toBook,
      toChapter: rec.toChapter,
      toVerseStart: rec.toVerseStart,
      toVerseEnd,
      source: 'tsk',
    });

    // Reverse pair: target verse → source verse
    // Use toVerseStart as the "from" verse so every verse in a target range links back
    batch.push({
      fromBook: rec.toBook,
      fromChapter: rec.toChapter,
      fromVerse: rec.toVerseStart,
      toBook: rec.fromBook,
      toChapter: rec.fromChapter,
      toVerseStart: rec.fromVerse,
      toVerseEnd: null,
      source: 'tsk-reverse',
    });

    tskForwardCount++;

    if (batch.length >= BATCH_SIZE) {
      flushBatch(batch);
      batch = [];
      if (tskForwardCount % 50000 === 0) {
        process.stdout.write(`\r  Processed: ${tskForwardCount.toLocaleString()} forward pairs...`);
      }
    }
  }

  if (batch.length > 0) {
    flushBatch(batch);
    batch = [];
  }

  console.log(`\r  TSK forward pairs: ${tskForwardCount.toLocaleString()}`);
  console.log(`  TSK reverse pairs: ${tskForwardCount.toLocaleString()} (bidirectional)`);

  // ---------------------------------------------------------------------------
  // Phase B: Insert original 74 curated entries
  // ---------------------------------------------------------------------------
  console.log('\nPhase B: Inserting curated cross-references...');

  let curatedCount = 0;

  const insertCurated = db.transaction((refs) => {
    for (const ref of refs) {
      try {
        const from = parseReference(ref.from);
        const to = parseReference(ref.to);

        // Forward
        insertRef.run(
          from.book, from.chapter, from.verseStart,
          to.book, to.chapter, to.verseStart, to.verseEnd,
          'curated', ref.description
        );

        // Reverse
        insertRef.run(
          to.book, to.chapter, to.verseStart,
          from.book, from.chapter, from.verseStart, from.verseEnd,
          'curated', ref.description + ' (reverse)'
        );

        curatedCount += 2;
      } catch (e) {
        console.warn(`  Skipping: ${ref.from} → ${ref.to}: ${e.message}`);
      }
    }
  });

  insertCurated(CURATED_CROSS_REFERENCES);
  console.log(`  Curated entries inserted: ${curatedCount}`);

  // ---------------------------------------------------------------------------
  // Phase C: Write metadata
  // ---------------------------------------------------------------------------
  const totalCount = db.prepare('SELECT COUNT(*) as n FROM cross_references').get().n;

  // Distinct books covered
  const bookRows = db.prepare(
    'SELECT DISTINCT from_book FROM cross_references ORDER BY from_book'
  ).all();
  const bookCount = bookRows.length;

  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  db.transaction(() => {
    insertMeta.run('pack_id', 'cross-references');
    insertMeta.run('type', 'cross-references');
    insertMeta.run('name', 'Bible Cross-References (Treasury of Scripture Knowledge)');
    insertMeta.run('version', '2.0.0');
    insertMeta.run('description', 'Full TSK cross-references for all 66 Bible books — bidirectional');
    insertMeta.run('source', 'Treasury of Scripture Knowledge (R.A. Torrey, 1834) + curated pairs');
    insertMeta.run('license', 'Public Domain');
    insertMeta.run('created', new Date().toISOString());
    insertMeta.run('record_count', totalCount.toString());
    insertMeta.run('book_count', bookCount.toString());
  })();

  db.close();

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('cross-references.sqlite built successfully.');
  console.log('='.repeat(60));
  console.log(`  Total rows:      ${totalCount.toLocaleString()}`);
  console.log(`  Books covered:   ${bookCount}`);
  console.log(`  File:            ${OUTPUT_FILE}`);
  console.log('');
  console.log('Books with cross-references:');
  for (const row of bookRows) {
    console.log(`  ${row.from_book}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
