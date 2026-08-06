#!/usr/bin/env node

/**
 * Build the Encyclotopical Pack — ISBE Encyclopedia + Nave's Topical Bible
 *
 * One pack holding two reference works. The ISBE half is carried over from
 * isbe.sqlite exactly as it was built, table for table, so anyone who already
 * has the encyclopedia installed keeps working through the changeover. The
 * Nave's half is new.
 *
 * Nave's (Orville J. Nave, 1900s, public domain) is the topical counterpart to
 * ISBE's prose: 5,322 topics that answer "where does Scripture speak about
 * this?" with an outline of points, each carrying its own references.
 *
 * Tables added on top of the seven ISBE ones:
 *   topics        one row per Nave's topic (title, lead, counts)
 *   topic_names   (name_lower, topic_id) title + "Also called" spellings
 *   topic_points  the outline — one row per line, with its refs and links
 *   topic_verses  (topic_id, book, chapter, verse, osis) every verse cited
 *   topic_tokens  (token, topic_id) full-text index over topic text
 *
 * Data sources:
 *   - isbe.sqlite, as produced by build-isbe-pack.mjs (run that first)
 *   - Nave SWORD module (TEI, zLD) — public domain
 *       data-sources/nave/modules/lexdict/zld/nave/dict.zdt
 *
 * Usage:
 *   node scripts/build-encyclotopical-pack.mjs
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { readFileSync, existsSync, copyFileSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ZDT = resolve(ROOT, 'data-sources/nave/modules/lexdict/zld/nave/dict.zdt');
const ISBE_PACK = resolve(ROOT, 'packs/isbe.sqlite');
const OUT_DIR = resolve(ROOT, 'packs/consolidated');
const PACK_OUTPUT = resolve(OUT_DIR, 'encyclotopical.sqlite');

// OSIS book code -> canonical book name (matches build-isbe-pack.mjs / bibleData.ts).
const OSIS_TO_BOOK = {
  Gen: 'Genesis', Exod: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deut: 'Deuteronomy',
  Josh: 'Joshua', Judg: 'Judges', Ruth: 'Ruth', '1Sam': '1 Samuel', '2Sam': '2 Samuel',
  '1Kgs': '1 Kings', '2Kgs': '2 Kings', '1Chr': '1 Chronicles', '2Chr': '2 Chronicles',
  Ezra: 'Ezra', Neh: 'Nehemiah', Esth: 'Esther', Job: 'Job', Ps: 'Psalms', Prov: 'Proverbs',
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

// Same stoplist as the ISBE pack, so a word that is too common to index there
// is too common to index here.
const STOPWORDS = new Set(
  ('the and that was his had not are for but with they him she her you all this from which were'
    + ' have been their has one who its would there when what will him his them then out are also'
    + ' upon into unto him some these such other than more may our can only very any way did now'
    + ' see god lord son men man land city name people israel king').split(/\s+/),
);

/* --------------------------------------------------------------------------- *
 * zLD extraction — identical mechanics to the ISBE module, which is the same
 * driver: zlib members concatenated with padding between them, each holding
 * some number of <entryFree n="KEY">…</entryFree> TEI spans.
 * ------------------------------------------------------------------------- */

function extractEntries() {
  const zdt = readFileSync(ZDT);
  const N = zdt.length;
  const pat = /<entryFree\b[^>]*\bn="([^"]*)"[^>]*>([\s\S]*?)<\/entryFree>/g;
  const isZlibHeader = (i) =>
    zdt[i] === 0x78 && (zdt[i + 1] === 0x9c || zdt[i + 1] === 0x01 || zdt[i + 1] === 0xda);

  const entries = [];
  let pos = 0;
  while (pos < N) {
    while (pos < N && !isZlibHeader(pos)) pos++;
    if (pos >= N) break;
    const eng = zlib.createInflate();
    let raw;
    try {
      raw = eng._processChunk(zdt.subarray(pos), zlib.constants.Z_SYNC_FLUSH);
    } catch {
      pos++;
      continue;
    }
    const consumed = eng.bytesWritten;
    const text = raw.toString('utf8');
    let m;
    while ((m = pat.exec(text)) !== null) entries.push({ key: m[1], body: m[2] });
    pat.lastIndex = 0;
    pos += consumed > 0 ? consumed : 1;
  }
  return entries;
}

/* --------------------------------------------------------------------------- *
 * Parsing a topic
 *
 * Nave's markup is small: <lb/> starts a top-level point, <item> is a
 * sub-point under the one above it, <ref osisRef> is scripture and
 * <ref target="Nave:X"> is a link to another topic. Everything else is text.
 * ------------------------------------------------------------------------- */

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function titleCase(s) {
  return s.replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

// Lowercase, punctuation folded to spaces — matches isbeNorm in the app, so a
// clicked word looks up the same way against either work's name index.
function norm(s) {
  return s
    .toLowerCase()
    .replace(/\([0-9]+\)\s*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Every verse an osisRef covers. Ranges are always inside one chapter in this
 *  module (verified across all 82,303 references), so expanding one is just
 *  counting — no book/chapter length table needed. */
function expandOsis(osisRef) {
  const out = [];
  const [startRaw, endRaw] = osisRef.split('-');
  const a = startRaw.split('.');
  if (a.length < 3) return out; // book-or-chapter only: nothing to pin a verse to
  const book = OSIS_TO_BOOK[a[0]];
  if (!book) return out;
  const chapter = parseInt(a[1], 10);
  const first = parseInt(a[2], 10);
  if (!Number.isFinite(chapter) || !Number.isFinite(first)) return out;

  let last = first;
  if (endRaw) {
    const b = endRaw.split('.');
    // Only same-chapter ranges are expanded; anything else contributes its
    // start verse alone rather than a guess at how far it runs.
    if (b.length >= 3 && b[0] === a[0] && b[1] === a[1]) {
      const e = parseInt(b[2], 10);
      if (Number.isFinite(e) && e >= first) last = e;
    }
  }
  for (let v = first; v <= last; v++) {
    out.push({ book, chapter, verse: v, osis: `${a[0]}.${chapter}.${v}` });
  }
  return out;
}

/**
 * Turn one topic body into an ordered list of outline points.
 *
 * Splitting on <lb/> and <item> in document order keeps the printed shape: a
 * line with no references of its own is a heading for the lines under it, and
 * that is exactly how Nave's reads on paper.
 */
function parseTopic(body) {
  // Split on the line breaks, remembering which kind each was. A NUL separator
  // is used because it cannot occur in the source text, so the spacing inside
  // each line survives the split intact.
  const SEP = '\u0000';
  const marked = body
    .replace(/<lb\s*\/?>/g, SEP + 'L')
    .replace(/<item>/g, SEP + 'I')
    .replace(/<\/item>/g, SEP + 'E');

  // The first chunk is whatever preceded the first marker — the <def> opener.
  const [, ...chunks] = marked.split(SEP);

  const out = [];
  for (const chunk of chunks) {
    const marker = chunk[0];
    const raw = chunk.slice(1);
    // The closing tag carries no content of its own; a sub-point sits one
    // level in from the <lb/> line above it.
    if (marker === 'E') continue;
    const depth = marker === 'I' ? 1 : 0;
    if (!raw.trim()) continue;

    const refs = [];
    const verses = [];
    for (const m of raw.matchAll(/<ref\b[^>]*\bosisRef="([^"]+)"[^>]*>([\s\S]*?)<\/ref>/g)) {
      refs.push({ osis: m[1], label: stripTags(m[2]) });
      verses.push(...expandOsis(m[1]));
    }

    const links = [];
    for (const m of raw.matchAll(/<ref\b[^>]*\btarget="Nave:([^"]+)"[^>]*>/g)) {
      links.push(decodeEntities(m[1]));
    }

    // The references are pulled out of the sentence, because the UI shows them
    // as chips of their own — leaving them inline would print every reference
    // twice. The leading arrow is a bullet in the source; the numbered senses
    // ("1.") carry meaning and stay.
    const text = stripTags(raw.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/g, ' '))
      .replace(/^→\s*/, '')
      // What the removed references leave behind: stranded separators, and a
      // dangling "See" whose only content was the link now shown as a chip.
      .replace(/\s*[;,]\s*(?=[;,]|$)/g, '')
      .replace(/[\s;,]+$/, '')
      .trim();
    if (!text && !refs.length && !links.length) continue;

    out.push({ depth, text, refs, links, verses });
  }
  return out;
}

/** "Also called ABIEL" / "Also called AHIHUD, son of Bela" -> alternate names. */
function alsoCalledNames(points) {
  const names = [];
  for (const p of points) {
    const m = p.text.match(/^(?:\d+\.\s*)?Also called\s+(.+)$/i);
    if (!m) continue;
    for (const part of m[1].split(/\s+and\s+|,(?![^(]*\))/)) {
      // "AHIHUD, son of Bela" — the name is the capitalised run at the front.
      const name = (part.match(/^[A-Z][A-Z'\-’ ]*[A-Z]|^[A-Z]/) || [])[0];
      if (name && name.trim().length >= 2) names.push(name.trim());
    }
  }
  return names;
}

function tokenize(text) {
  const set = new Set();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !/^\d+$/.test(raw) && !STOPWORDS.has(raw)) set.add(raw);
  }
  return set;
}

/* --------------------------------------------------------------------------- *
 * Build
 * ------------------------------------------------------------------------- */

if (!existsSync(ISBE_PACK)) {
  console.error(`❌ Missing ${ISBE_PACK}\n   Run: node scripts/build-isbe-pack.mjs`);
  process.exit(1);
}
if (!existsSync(ZDT)) {
  console.error(`❌ Missing ${ZDT}\n   Download the Nave SWORD module into data-sources/nave/`);
  process.exit(1);
}

console.log('📚 Building Encyclotopical pack (ISBE + Nave\'s)\n');

mkdirSync(OUT_DIR, { recursive: true });
// Start from the encyclopedia pack so its seven tables carry over untouched —
// anyone who already has ISBE installed sees no change on that half.
for (const stale of [PACK_OUTPUT, `${PACK_OUTPUT}-wal`, `${PACK_OUTPUT}-shm`]) {
  if (existsSync(stale)) unlinkSync(stale);
}
copyFileSync(ISBE_PACK, PACK_OUTPUT);
console.log(`✓ Carried over ISBE tables from ${ISBE_PACK}`);

const db = new Database(PACK_OUTPUT);
db.pragma('journal_mode = DELETE');

db.exec(`
  DROP TABLE IF EXISTS topics;
  DROP TABLE IF EXISTS topic_names;
  DROP TABLE IF EXISTS topic_points;
  DROP TABLE IF EXISTS topic_verses;
  DROP TABLE IF EXISTS topic_tokens;

  CREATE TABLE topics (
    topic_id     INTEGER PRIMARY KEY,
    title        TEXT,      -- as printed, e.g. "ABED-NEGO"
    primary_name TEXT,      -- display form, e.g. "Abed-Nego"
    lead         TEXT,      -- first point, for the overview line
    point_count  INTEGER,
    ref_count    INTEGER
  );

  CREATE TABLE topic_names (name_lower TEXT NOT NULL, topic_id INTEGER NOT NULL);
  CREATE INDEX idx_topic_names_lower ON topic_names(name_lower);

  -- One row per outline line. depth 0 is a top-level point, depth 1 a
  -- sub-point under it; refs and links are JSON so a point keeps its own
  -- references rather than the topic pooling them.
  CREATE TABLE topic_points (
    topic_id INTEGER NOT NULL,
    seq      INTEGER NOT NULL,
    depth    INTEGER NOT NULL,
    text     TEXT,
    refs     TEXT,
    links    TEXT
  );
  CREATE INDEX idx_topic_points ON topic_points(topic_id, seq);

  CREATE TABLE topic_verses (
    topic_id INTEGER NOT NULL,
    book     TEXT NOT NULL,
    chapter  INTEGER NOT NULL,
    verse    INTEGER NOT NULL,
    osis     TEXT
  );
  CREATE INDEX idx_topic_verses_ref   ON topic_verses(book, chapter, verse);
  CREATE INDEX idx_topic_verses_topic ON topic_verses(topic_id);

  CREATE TABLE topic_tokens (token TEXT NOT NULL, topic_id INTEGER NOT NULL);
  CREATE INDEX idx_topic_tokens ON topic_tokens(token);
`);

const raw = extractEntries();
console.log(`✓ Extracted ${raw.length} Nave's topics from the SWORD module`);

const insTopic = db.prepare(`
  INSERT INTO topics (topic_id, title, primary_name, lead, point_count, ref_count)
  VALUES (@topic_id, @title, @primary_name, @lead, @point_count, @ref_count)
`);
const insName = db.prepare('INSERT INTO topic_names (name_lower, topic_id) VALUES (?, ?)');
const insPoint = db.prepare(`
  INSERT INTO topic_points (topic_id, seq, depth, text, refs, links)
  VALUES (@topic_id, @seq, @depth, @text, @refs, @links)
`);
const insVerse = db.prepare(`
  INSERT INTO topic_verses (topic_id, book, chapter, verse, osis)
  VALUES (@topic_id, @book, @chapter, @verse, @osis)
`);
const insToken = db.prepare('INSERT INTO topic_tokens (token, topic_id) VALUES (?, ?)');

let topicId = 0;
let totalPoints = 0;
let totalVerses = 0;
let totalTokens = 0;
let totalNames = 0;

const build = db.transaction(() => {
  for (const entry of raw) {
    const title = decodeEntities(entry.key).trim();
    if (!title) continue;
    const points = parseTopic(entry.body);
    if (!points.length) continue;

    topicId++;
    const refCount = points.reduce((n, p) => n + p.refs.length, 0);
    const lead = points.find((p) => p.text)?.text ?? '';

    insTopic.run({
      topic_id: topicId,
      title,
      primary_name: titleCase(title.toLowerCase()),
      lead: lead.slice(0, 300),
      point_count: points.length,
      ref_count: refCount,
    });

    // Name index: the title, its punctuation-folded form, and every spelling
    // an "Also called" line declares — so a clicked word finds the topic under
    // whichever name the translation happened to use.
    const names = new Set([title.toLowerCase(), norm(title)]);
    for (const alt of alsoCalledNames(points)) {
      names.add(alt.toLowerCase());
      names.add(norm(alt));
    }
    for (const n of names) {
      if (!n) continue;
      insName.run(n, topicId);
      totalNames++;
    }

    // Points, and the verses they cite (deduped: a topic listing the same verse
    // under two headings should appear once in the Verses tab).
    const seen = new Set();
    points.forEach((p, seq) => {
      insPoint.run({
        topic_id: topicId,
        seq,
        depth: p.depth,
        text: p.text,
        refs: p.refs.length ? JSON.stringify(p.refs) : null,
        links: p.links.length ? JSON.stringify(p.links) : null,
      });
      totalPoints++;
      for (const v of p.verses) {
        const key = `${v.book}|${v.chapter}|${v.verse}`;
        if (seen.has(key)) continue;
        seen.add(key);
        insVerse.run({ topic_id: topicId, ...v });
        totalVerses++;
      }
    });

    // Full-text index over the topic's own words, same rules as ISBE's.
    const text = `${title} ${points.map((p) => p.text).join(' ')}`;
    for (const token of tokenize(text)) {
      insToken.run(token, topicId);
      totalTokens++;
    }
  }
});
build();

console.log(`✓ ${topicId} topics`);
console.log(`✓ ${totalNames} name-index rows`);
console.log(`✓ ${totalPoints} outline points`);
console.log(`✓ ${totalVerses} verse references`);
console.log(`✓ ${totalTokens} search tokens`);

// Metadata: the pack is a new id, but the version stays where it was — this is
// the same content plus Nave's, not a new generation of it.
const insMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
db.transaction(() => {
  insMeta.run('pack_id', 'encyclotopical');
  insMeta.run('pack_version', '1.0.0');
  insMeta.run('pack_type', 'encyclotopical');
  insMeta.run('schema_version', '1');
  insMeta.run(
    'license',
    "Public Domain (ISBE 1915; Nave's Topical Bible 1900s); place data CC BY 4.0 (OpenBible.info)",
  );
  insMeta.run(
    'attribution',
    "International Standard Bible Encyclopedia (James Orr, 1915); Nave's Topical Bible (Orville J. Nave); "
      + 'place data © OpenBible.info (CC BY 4.0)',
  );
  insMeta.run(
    'description',
    "ISBE Encyclopedia and Nave's Topical Bible — 9,380 scholarly articles and 5,322 topics",
  );
  insMeta.run('source_url', 'https://www.crosswire.org/sword/modules/');
  insMeta.run('created_at', new Date().toISOString());
})();

db.exec('VACUUM');
db.close();

const size = statSync(PACK_OUTPUT).size;
const sha = createHash('sha256').update(readFileSync(PACK_OUTPUT)).digest('hex');
console.log(`\n📦 ${PACK_OUTPUT}`);
console.log(`   ${(size / 1048576).toFixed(2)} MB`);
console.log(`   sha256 ${sha}`);
console.log('\nNext: node scripts/generate-manifest.mjs');
