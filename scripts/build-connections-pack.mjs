#!/usr/bin/env node

/**
 * Build Connections Pack
 *
 * Every cross-reference in the Bible as four numbers, so the Connections window
 * can draw all 344,799 of them at once.
 *
 * The source is OpenBible.info's cross-reference set: the Treasury of Scripture
 * Knowledge links with reader votes on top, so each link carries a strength.
 * Downloaded to data-sources/openbible-xrefs/cross_references.txt (gitignored):
 *
 *     From Verse   To Verse                Votes
 *     Gen.1.1      Ps.115.15               83
 *     Gen.1.1      John.1.1-John.1.3       381
 *
 * A link's two ends are stored as one number each, counted from Gen 1:1 = 0
 * straight through to Rev 22:21 = 31101. That is the whole trick: an arc needs
 * a position on a line, not a book name, so the work of deciding which book,
 * chapter and verse a number is happens once here and the window just draws. A
 * target range becomes a start and an end, which is how the eighteen links that
 * span two books survive at all.
 *
 * The four columns ship as gzipped typed-array blobs, one row per column, the
 * same shape as the map's place index (scripts/atlas/build-atlas-packs.mjs):
 *
 *     from      Int32Array   source verse
 *     to_start  Int32Array   first verse of the target
 *     to_end    Int32Array   last verse of the target (== to_start for one verse)
 *     votes     Int16Array   reader votes, negative when downvoted
 *
 * A few megabytes of numbers instead of 340,000 IndexedDB rows, so the window
 * opens in one read rather than a long cursor walk.
 *
 * The pack type is 'connections', which is its own thing: the old
 * 'cross-references' store belongs to the keyword TSK pack the reader's note
 * panel uses, and the two must not meet.
 *
 * Usage:
 *   node scripts/build-connections-pack.mjs           build the pack
 *   node scripts/build-connections-pack.mjs --check   check the source, write nothing
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'data-sources/openbible-xrefs/cross_references.txt');
const PACK_OUTPUT = resolve(ROOT, 'packs/consolidated/connections.sqlite');
const CHECK = process.argv.includes('--check');

const VERSION = '1.0.0';
const DOWNLOAD_URL = 'https://a.openbible.info/data/cross-references.zip';

/* --------------------------------------------------------------------------- *
 * Books and the verse numbering
 * ------------------------------------------------------------------------- */

/**
 * OSIS book code -> the app's book name, the same table
 * scripts/build-timeline-pack.mjs uses. "Psalm" is singular because that is how
 * the app stores the book; the verse-count table spells it "Psalms", which is
 * what verseCountKey() below translates.
 */
const OSIS_TO_BOOK = {
  Gen: 'Genesis', Exod: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deut: 'Deuteronomy',
  Josh: 'Joshua', Judg: 'Judges', Ruth: 'Ruth', '1Sam': '1 Samuel', '2Sam': '2 Samuel',
  '1Kgs': '1 Kings', '2Kgs': '2 Kings', '1Chr': '1 Chronicles', '2Chr': '2 Chronicles',
  Ezra: 'Ezra', Neh: 'Nehemiah', Esth: 'Esther', Job: 'Job', Ps: 'Psalm', Prov: 'Proverbs',
  Eccl: 'Ecclesiastes', Song: 'Song of Solomon', Isa: 'Isaiah', Jer: 'Jeremiah',
  Lam: 'Lamentations', Ezek: 'Ezekiel', Dan: 'Daniel', Hos: 'Hosea', Joel: 'Joel',
  Amos: 'Amos', Obad: 'Obadiah', Jonah: 'Jonah', Mic: 'Micah', Nah: 'Nahum', Hab: 'Habakkuk',
  Zeph: 'Zephaniah', Hag: 'Haggai', Zech: 'Zechariah', Mal: 'Malachi', Matt: 'Matthew',
  Mark: 'Mark', Luke: 'Luke', John: 'John', Acts: 'Acts', Rom: 'Romans',
  '1Cor': '1 Corinthians', '2Cor': '2 Corinthians', Gal: 'Galatians', Eph: 'Ephesians',
  Phil: 'Philippians', Col: 'Colossians', '1Thess': '1 Thessalonians', '2Thess': '2 Thessalonians',
  '1Tim': '1 Timothy', '2Tim': '2 Timothy', Titus: 'Titus', Phlm: 'Philemon', Heb: 'Hebrews',
  Jas: 'James', '1Pet': '1 Peter', '2Pet': '2 Peter', '1John': '1 John', '2John': '2 John',
  '3John': '3 John', Jude: 'Jude', Rev: 'Revelation',
};

/**
 * The spellings OpenBible does not use but a hand-edited source might. Psalm and
 * Psalms both land on the app's "Psalm". Lower-cased keys with the spaces taken
 * out, the same convention as parseRefString.ts's BOOK_MAP.
 */
const EXTRA_ALIASES = {
  psalms: 'Psalm', psalm: 'Psalm', psa: 'Psalm',
  songofsongs: 'Song of Solomon', songofsolomon: 'Song of Solomon', sos: 'Song of Solomon',
};

/** The verse-count table, read out of the core package rather than copied. */
function readVerseCounts() {
  const src = readFileSync(resolve(ROOT, 'packages/core/src/BibleMetadata.ts'), 'utf8');
  const match = src.match(/export const VERSE_COUNTS[^=]*=\s*(\{[\s\S]*?\n\};)/);
  if (!match) {
    console.error('Could not find VERSE_COUNTS in packages/core/src/BibleMetadata.ts');
    process.exit(1);
  }
  // It is a plain object literal with quoted keys, so dropping the trailing
  // semicolon and any trailing commas makes it JSON.
  return JSON.parse(match[1].replace(/;\s*$/, '').replace(/,(\s*[}\]])/g, '$1'));
}

const RAW_COUNTS = readVerseCounts();
/** The generated table says "Psalms"; the app says "Psalm". Translate, don't rename. */
const verseCountKey = (book) => (RAW_COUNTS[book] ? book : book === 'Psalm' ? 'Psalms' : book);

/** The 66 books in canonical order, as the app names them. */
const BOOKS = Object.values(OSIS_TO_BOOK);

/**
 * Where every book and chapter begins on the one long line.
 *
 * Gen 1:1 is 0 and Rev 22:21 is 31101, which is every verse in the Protestant
 * canon as the app counts them. A reference becomes a number with two lookups
 * and an addition.
 */
const bookStart = new Map();
const chapterStart = new Map(); // "Book|chapter" -> absolute verse of its verse 1
const chapterLength = new Map(); // "Book|chapter" -> verses in it
const bookChapters = new Map();
let runningTotal = 0;
for (const book of BOOKS) {
  const counts = RAW_COUNTS[verseCountKey(book)];
  if (!counts) {
    console.error(`No verse counts for ${book}`);
    process.exit(1);
  }
  bookStart.set(book, runningTotal);
  bookChapters.set(book, counts.length);
  counts.forEach((verses, i) => {
    chapterStart.set(`${book}|${i + 1}`, runningTotal);
    chapterLength.set(`${book}|${i + 1}`, verses);
    runningTotal += verses;
  });
}
const TOTAL_VERSES = runningTotal;
const TOTAL_CHAPTERS = [...bookChapters.values()].reduce((a, b) => a + b, 0);

/** A book name for anything the source might write, or null. */
function bookFor(code) {
  return OSIS_TO_BOOK[code] ?? EXTRA_ALIASES[code.toLowerCase().replace(/\s+/g, '')] ?? null;
}

/**
 * "Gen.1.1" -> 0, or null when the book or chapter is unknown.
 *
 * A verse past the end of its chapter is clamped to the last one rather than
 * dropped: OpenBible follows the KJV's verse divisions, which differ from the
 * app's table in a handful of psalm titles and the like, and drawing a real
 * link one verse short beats losing it.
 */
function verseNumber(ref) {
  const parts = ref.split('.');
  if (parts.length < 3) return null;
  const book = bookFor(parts[0]);
  if (!book) return null;
  const chapter = Number(parts[1]);
  const start = chapterStart.get(`${book}|${chapter}`);
  if (start === undefined) return null;
  const length = chapterLength.get(`${book}|${chapter}`);
  const verse = Math.min(Math.max(Number(parts[2]) || 1, 1), length);
  return start + verse - 1;
}

/** An absolute verse number back to its reference, for the printed checks. */
function refFor(n) {
  for (let i = BOOKS.length - 1; i >= 0; i--) {
    const book = BOOKS[i];
    if (bookStart.get(book) > n) continue;
    for (let chapter = bookChapters.get(book); chapter >= 1; chapter--) {
      const start = chapterStart.get(`${book}|${chapter}`);
      if (start <= n) return `${book} ${chapter}:${n - start + 1}`;
    }
  }
  return `#${n}`;
}

/* --------------------------------------------------------------------------- *
 * Read the source
 * ------------------------------------------------------------------------- */

if (!existsSync(SOURCE)) {
  console.error(`Missing: ${SOURCE}`);
  console.error(`Download ${DOWNLOAD_URL} and unzip cross_references.txt into that folder.`);
  process.exit(1);
}

console.log('Building the Connections pack\n');
console.log(`   Source:            ${SOURCE}`);
console.log(`   Verses in canon:   ${TOTAL_VERSES.toLocaleString()} (Gen 1:1 = 0, last = ${TOTAL_VERSES - 1})`);
console.log(`   Chapters:          ${TOTAL_CHAPTERS.toLocaleString()}\n`);

const lines = readFileSync(SOURCE, 'utf8').split('\n');

const from = [];
const toStart = [];
const toEnd = [];
const votes = [];

let skippedBook = 0;
let skippedShape = 0;
let reversed = 0;
const unknownCodes = new Set();

// The file's first line is its header, which carries the licence note in the
// third field.
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;

  const [fromRef, toRef, voteText] = line.split('\t');
  if (!fromRef || !toRef) {
    skippedShape++;
    continue;
  }

  const source = verseNumber(fromRef);
  if (source === null) {
    unknownCodes.add(fromRef.split('.')[0]);
    skippedBook++;
    continue;
  }

  // "John.1.1-John.1.3" — both halves are full references, and the range can
  // cross a chapter (650 of them) or even a book (18).
  const dash = toRef.indexOf('-');
  const startRef = dash === -1 ? toRef : toRef.slice(0, dash);
  const endRef = dash === -1 ? toRef : toRef.slice(dash + 1);

  const start = verseNumber(startRef);
  const end = verseNumber(endRef);
  if (start === null || end === null) {
    unknownCodes.add((start === null ? startRef : endRef).split('.')[0]);
    skippedBook++;
    continue;
  }

  // A range written backwards would draw an arc to nowhere.
  let lo = start;
  let hi = end;
  if (hi < lo) {
    reversed++;
    lo = end;
    hi = start;
  }

  from.push(source);
  toStart.push(lo);
  toEnd.push(hi);
  votes.push(Math.round(Number(voteText) || 0));
}

const rows = from.length;
if (!rows) {
  console.error('No links read — is the source file the right one?');
  process.exit(1);
}

/* --------------------------------------------------------------------------- *
 * Totals and the spot-checks
 * ------------------------------------------------------------------------- */

const NT_START = bookStart.get('Matthew');
let minVote = votes[0];
let maxVote = votes[0];
let ranges = 0;
let negative = 0;
let acrossTestaments = 0;
for (let i = 0; i < rows; i++) {
  if (votes[i] < minVote) minVote = votes[i];
  if (votes[i] > maxVote) maxVote = votes[i];
  if (votes[i] < 0) negative++;
  if (toEnd[i] !== toStart[i]) ranges++;
  if ((from[i] < NT_START) !== (toStart[i] < NT_START)) acrossTestaments++;
}

console.log(`   Links:             ${rows.toLocaleString()}`);
console.log(`   Source verses:     ${new Set(from).size.toLocaleString()} of ${TOTAL_VERSES.toLocaleString()}`);
console.log(`   Targets a range:   ${ranges.toLocaleString()}`);
console.log(`   Across Testaments: ${acrossTestaments.toLocaleString()}`);
console.log(`   Votes:             ${minVote} to ${maxVote} (${negative.toLocaleString()} downvoted)`);
if (reversed) console.log(`   Ranges reversed:   ${reversed.toLocaleString()}`);
if (skippedShape) console.log(`   Malformed lines:   ${skippedShape.toLocaleString()}`);
if (skippedBook) {
  console.log(`   Skipped (book):    ${skippedBook.toLocaleString()} — ${[...unknownCodes].join(', ')}`);
}

// Int16 holds the votes, so a set that outgrew it has to be caught here rather
// than wrap silently into a negative strength.
if (minVote < -32768 || maxVote > 32767) {
  console.error(`Votes ${minVote}..${maxVote} do not fit Int16 — widen the votes column.`);
  process.exit(1);
}

console.log('\n   Spot-checks');

// The numbering has to round-trip, or every arc in the window lands in the
// wrong place and nothing downstream can tell.
const gen11 = verseNumber('Gen.1.1');
const john11 = verseNumber('John.1.1');
const last = TOTAL_VERSES - 1;
for (const [n, expected] of [
  [gen11, 'Genesis 1:1'],
  [john11, 'John 1:1'],
  [last, 'Revelation 22:21'],
]) {
  const got = refFor(n);
  console.log(`     ${String(n).padStart(5)} -> ${got}`);
  if (got !== expected) {
    console.error(`Expected ${expected} — the numbering is off.`);
    process.exit(1);
  }
}

let genToJohn = -1;
for (let i = 0; i < rows; i++) {
  if (from[i] === gen11 && toStart[i] === john11) {
    genToJohn = i;
    break;
  }
}
if (genToJohn === -1) {
  console.error('Gen 1:1 -> John 1:1 is missing — the numbering or the source is wrong.');
  process.exit(1);
}
console.log(
  `     Gen 1:1 -> John 1:1:  ${refFor(from[genToJohn])} -> ${refFor(toStart[genToJohn])}` +
    `${toEnd[genToJohn] === toStart[genToJohn] ? '' : `-${refFor(toEnd[genToJohn])}`}` +
    `, ${votes[genToJohn]} votes`,
);

// The tallest arc the window can draw, which is what the height curve is tuned
// against.
let widest = 0;
for (let i = 1; i < rows; i++) {
  if (Math.abs(toStart[i] - from[i]) > Math.abs(toStart[widest] - from[widest])) widest = i;
}
console.log(
  `     Longest reach:        ${refFor(from[widest])} -> ${refFor(toStart[widest])}` +
    ` (${Math.abs(toStart[widest] - from[widest]).toLocaleString()} verses apart)`,
);

const strongest = votes.indexOf(maxVote);
console.log(
  `     Most votes:           ${refFor(from[strongest])} -> ${refFor(toStart[strongest])}, ${votes[strongest]} votes`,
);

if (CHECK) {
  console.log('\nSource checks out. Nothing written (--check).');
  process.exit(0);
}

/* --------------------------------------------------------------------------- *
 * Write the pack
 * ------------------------------------------------------------------------- */

// Sorted by source verse, so the window can slice "everything this chapter
// reaches" with a binary search instead of a pass over all 344,000. Strongest
// link first within a verse, which is also the order a filtered draw wants.
const order = Array.from({ length: rows }, (_, i) => i).sort(
  (a, b) => from[a] - from[b] || toStart[a] - toStart[b] || votes[b] - votes[a],
);

const fromCol = new Int32Array(rows);
const toStartCol = new Int32Array(rows);
const toEndCol = new Int32Array(rows);
const votesCol = new Int16Array(rows);
order.forEach((src, i) => {
  fromCol[i] = from[src];
  toStartCol[i] = toStart[src];
  toEndCol[i] = toEnd[src];
  votesCol[i] = votes[src];
});

mkdirSync(dirname(PACK_OUTPUT), { recursive: true });
if (existsSync(PACK_OUTPUT)) unlinkSync(PACK_OUTPUT);

const db = new Database(PACK_OUTPUT);
// Not WAL: a pack is shipped as one file, and WAL leaves its writes in a
// sidecar the download would not carry.
db.pragma('journal_mode = DELETE');

db.exec(`
  CREATE TABLE metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- The four columns, gzipped typed arrays, one row each. The same shape as the
  -- map's atlas_place_columns: 'kind' says which typed array to rebuild and
  -- 'raw_bytes' is the length before gzip, so a short inflate is caught.
  CREATE TABLE connection_columns (
    name      TEXT PRIMARY KEY,
    kind      TEXT NOT NULL,     -- int32 | int16
    encoding  TEXT NOT NULL,     -- always 'gzip'
    raw_bytes INTEGER NOT NULL,
    data      BLOB NOT NULL
  );
`);

const meta = {
  pack_id: 'connections',
  pack_type: 'connections',
  pack_version: VERSION,
  name: 'Connections',
  description:
    'Every cross-reference in Scripture with its reader votes, as one picture of how the whole Bible ties to itself.',
  license: 'CC BY 4.0',
  attribution: 'Cross references: OpenBible.info (CC BY)',
  data_source: DOWNLOAD_URL,
  // What the window checks a finished install against, and what it needs to
  // turn a number back into a verse without guessing.
  links: String(rows),
  total_verses: String(TOTAL_VERSES),
  created_at: new Date().toISOString(),
};
const insMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);

const insCol = db.prepare(
  'INSERT INTO connection_columns (name, kind, encoding, raw_bytes, data) VALUES (?, ?, ?, ?, ?)',
);
let resident = 0;
let packed = 0;
db.transaction(() => {
  for (const [name, kind, arr] of [
    ['from', 'int32', fromCol],
    ['to_start', 'int32', toStartCol],
    ['to_end', 'int32', toEndCol],
    ['votes', 'int16', votesCol],
  ]) {
    const raw = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const blob = gzipSync(raw, { level: 9 });
    insCol.run(name, kind, 'gzip', raw.length, blob);
    resident += raw.length;
    packed += blob.length;
  }
})();

db.exec('VACUUM;');
db.close();

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const sha256 = createHash('sha256').update(readFileSync(PACK_OUTPUT)).digest('hex');
const sizeBytes = statSync(PACK_OUTPUT).size;

console.log('\n   Columns');
console.log(`     resident:           ${mb(resident)} once loaded`);
console.log(`     gzipped:            ${mb(packed)}`);
console.log(`\n   Output:            ${PACK_OUTPUT}`);
console.log(`   Size:              ${mb(sizeBytes)} (${sizeBytes.toLocaleString()} bytes)`);
console.log(`   sha256:            ${sha256}`);
console.log('\nConnections pack built.');
