#!/usr/bin/env node

/**
 * Build ISBE (International Standard Bible Encyclopedia) Pack
 *
 * A self-contained encyclopedia + biblical-geography pack. ISBE (1915, James Orr,
 * public domain) supplies ~9,380 scholarly articles — the depth analogue of the
 * person bios in people.sqlite, but for places, monuments, rivers, plants, coins,
 * customs and doctrine. Place coordinates, verse links and the multi-word phrase
 * gazetteer are joined in from OpenBible.info (CC BY 4.0) so the "More Info" /
 * place feature works with just this pack installed.
 *
 * Tables:
 *   metadata       key/value pack info (id, version, license, attribution, ...)
 *   entries        one row per ISBE article (title, body_html, lead, outline, ...)
 *   entry_names    (name_lower, entry_id) title + alternate-spelling lookup index
 *   entry_tokens   (token, entry_id) full-text index over article bodies
 *   places         one row per OpenBible place (coords, type, modern name, entry_id)
 *   place_names    (name_lower, place_id, is_phrase) every translation spelling
 *   place_verses   (place_id, book, chapter, verse, osis) place appearances
 *
 * Data sources:
 *   - ISBE SWORD module (TEI, zLD) — public domain
 *       data-sources/isbe/modules/lexdict/zld/isbe/isbe.zdt
 *   - OpenBible.info Bible Geocoding (CC BY 4.0) — coords, verses, name spellings
 *       data-sources/openbible/data/ancient.jsonl
 *
 * Usage:
 *   node scripts/build-isbe-pack.mjs
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { readFileSync, existsSync, copyFileSync, mkdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ZDT = resolve(ROOT, 'data-sources/isbe/modules/lexdict/zld/isbe/isbe.zdt');
const ANCIENT = resolve(ROOT, 'data-sources/openbible/data/ancient.jsonl');
const PACK_OUTPUT = resolve(ROOT, 'packs/isbe.sqlite');

// OSIS book code -> canonical book name (matches build-people-pack.mjs / bibleData.ts).
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

// Small English stoplist for the full-text token index. Keeps the index focused on
// content words; ISBE article bodies are large so common words would dominate.
const STOPWORDS = new Set(
  ('the and that was his had not are for but with they him she her you all this from which were'
    + ' have been their has one who its would there when what will him his them then out are also'
    + ' upon into unto him some these such other than more may our can only very any way did now'
    + ' see god lord son men man land city name people israel king').split(/\s+/),
);

/* --------------------------------------------------------------------------- *
 * ISBE zLD extraction
 *
 * The module stores entries as NUL-separated <entryFree n="KEY">...</entryFree>
 * TEI spans inside zlib blocks concatenated in the .zdt file. We walk each zlib
 * member: decompress it, read the compressed byte count consumed, advance, then
 * skip forward to the next zlib header (blocks are padded, not contiguous).
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
    const consumed = eng.bytesWritten; // compressed bytes of this member
    const text = raw.toString('utf8');
    let m;
    while ((m = pat.exec(text)) !== null) entries.push({ key: m[1], body: m[2] });
    pat.lastIndex = 0;
    pos += consumed > 0 ? consumed : 1;
  }
  return entries;
}

/* --------------------------------------------------------------------------- *
 * TEI cleaning
 * ------------------------------------------------------------------------- */

function escapeAmp(s) {
  // Escape bare ampersands but keep existing entities intact.
  return s.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

// A reference written as a bare verse ("31") or a chapter and verse ("4:11"),
// i.e. one that names no book and so must inherit the book before it.
const CONTINUATION = /^(\d+)(?::(\d+))?[a-z]?$/;

/**
 * Correct the book of a continuation reference.
 *
 * The source module resolves references that spell out their book almost
 * perfectly, but mis-resolves continuations: ISBE abbreviates Judges as "Jud",
 * which it reads as Jude. Jude has one chapter, so "Jud 18:31" overflows 17
 * chapters into Revelation and then again through Revelation 17, landing at
 * Rev 18:13. 254 references arrive wrong this way, 245 of them Judges.
 *
 * A reference whose visible text names no book cannot change book, so where
 * the tagged book disagrees with the one before it, the previous book wins.
 * Only that case is touched: a differing *chapter* is usually legitimate —
 * "1Ch 6:3; 24:1" really does mean chapter 24 — so chapters are left alone.
 */
function fixContinuation(osis, txt, prev) {
  if (!prev) return osis;
  const label = txt.replace(/<[^>]+>/g, '').trim();
  const cont = CONTINUATION.exec(label);
  if (!cont) return osis;

  const [book] = osis.split('-')[0].split('.');
  if (book === prev.book) return osis;

  // "4:11" gives its own chapter; a bare "31" continues the previous one.
  const chapter = cont[2] ? cont[1] : prev.chapter;
  const verse = cont[2] ?? cont[1];
  return `${prev.book}.${chapter}.${verse}`;
}

// TEI body -> display HTML. Only <p>, <ref>, <hi>, <lb> occur in the corpus.
function toHtml(body) {
  let h = body;
  // Scripture references: <ref osisRef="Bible:Josh.2.15">Jos 2:15</ref>
  // Replacement runs left to right through the article, so each reference can
  // see the one before it — which is what makes the repair above possible.
  let prevRef = null;
  h = h.replace(
    /<ref\b[^>]*\bosisRef="Bible:([^"]+)"[^>]*>([\s\S]*?)<\/ref>/g,
    (_, osis, txt) => {
      const fixed = fixContinuation(osis, txt, prevRef);
      const [book, chapter] = fixed.split('-')[0].split('.');
      prevRef = { book, chapter };
      return `<a class="isbe-scripture" data-osis="${fixed}">${txt}</a>`;
    },
  );
  // Internal cross-references: <ref target="ISBE:ALEPH">ALEPH</ref>
  h = h.replace(
    /<ref\b[^>]*\btarget="ISBE:([^"]+)"[^>]*>([\s\S]*?)<\/ref>/g,
    (_, key, txt) => `<a class="isbe-link" data-entry="${key}">${txt}</a>`,
  );
  // Any remaining <ref> (rare/malformed): keep inner text only.
  h = h.replace(/<ref\b[^>]*>([\s\S]*?)<\/ref>/g, '$1');
  // Emphasis
  h = h.replace(/<hi\b[^>]*rend="italic"[^>]*>([\s\S]*?)<\/hi>/g, '<em>$1</em>');
  h = h.replace(/<hi\b[^>]*rend="bold"[^>]*>([\s\S]*?)<\/hi>/g, '<strong>$1</strong>');
  h = h.replace(/<hi\b[^>]*rend="underline"[^>]*>([\s\S]*?)<\/hi>/g, '<u>$1</u>');
  h = h.replace(/<hi\b[^>]*>([\s\S]*?)<\/hi>/g, '<em>$1</em>');
  // Line breaks
  h = h.replace(/<lb\s*\/?>/g, '<br>');
  // Anything else unknown -> drop the tag, keep text
  h = h.replace(/<(?!\/?(p|a|em|strong|u|br)\b)[^>]*>/g, '');
  return h.trim();
}

function toText(body) {
  return decodeEntities(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstParagraph(body) {
  const m = body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/);
  const raw = m ? m[1] : body;
  return toText(raw);
}

// Detect the article's own section headings (I., II., 1., 2., ...) so the modal
// can offer jump navigation. Returns [{ i: paragraphIndex, t: title }] or null.
function buildOutline(body) {
  const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => toText(m[1]));
  if (paras.length < 8) return null;
  const out = [];
  paras.forEach((t, i) => {
    const m = t.match(/^((?:[IVXLC]+|\d+)\.)\s+(.{1,70}?)(?:[.:]|$)/);
    if (m && /[A-Za-z]/.test(m[2]) && m[2] === m[2].replace(/\s{2,}/g, ' ')) {
      out.push({ i, t: `${m[1]} ${m[2].trim()}` });
    }
  });
  return out.length >= 3 ? out.slice(0, 120) : null;
}

// Normalize a name/title for matching: uppercase, strip " (1)" disambiguation and
// punctuation. "AB (1)" -> "AB"; "Abel-beth-maacah" -> "ABEL BETH MAACAH".
function norm(s) {
  return s
    .toUpperCase()
    .replace(/\s*\([0-9]+\)\s*$/, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Title-case a translation spelling for display ("red sea" -> "Red Sea").
function titleCase(s) {
  return s.replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

function tokenize(text) {
  const set = new Set();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !/^\d+$/.test(raw) && !STOPWORDS.has(raw)) set.add(raw);
  }
  return set;
}

/* --------------------------------------------------------------------------- *
 * OpenBible places
 * ------------------------------------------------------------------------- */

function loadPlaces() {
  const places = [];
  const lines = readFileSync(ANCIENT, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    const names = Object.entries(rec.translation_name_counts || {});
    if (!names.length) continue;

    // Best point coordinate + feature type from the highest-scoring identification.
    let lat = null, lon = null, type = null;
    for (const idn of rec.identifications || []) {
      for (const r of idn.resolutions || []) {
        if (r.lonlat) {
          const [lo, la] = r.lonlat.split(',').map(Number);
          if (Number.isFinite(la) && Number.isFinite(lo)) { lat = la; lon = lo; type = r.type || null; break; }
        }
      }
      if (lat != null) break;
    }
    if (!type && Array.isArray(rec.types) && rec.types.length) type = rec.types[0];

    const modern = Object.values(rec.modern_associations || {}).map((v) => v.name).filter(Boolean);
    // Primary display name = most common translation spelling.
    names.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const primary = titleCase(names[0][0]);

    const verses = (rec.verses || [])
      .map((v) => {
        const [bk, ch, vs] = (v.osis || '').split('.');
        const book = OSIS_TO_BOOK[bk];
        if (!book) return null;
        return { book, chapter: parseInt(ch, 10), verse: parseInt(vs, 10), osis: v.osis };
      })
      .filter(Boolean);

    places.push({
      place_id: rec.friendly_id,
      primary_name: primary,
      names: names.map(([n]) => n),
      type,
      latitude: lat,
      longitude: lon,
      modern_name: modern[0] || null,
      preceding_article: rec.preceding_article || null,
      verses,
    });
  }
  return places;
}

/* --------------------------------------------------------------------------- *
 * Build
 * ------------------------------------------------------------------------- */

console.log('📖 Building ISBE encyclopedia + places pack...\n');

if (!existsSync(ZDT)) throw new Error(`Missing ISBE module: ${ZDT}`);
if (!existsSync(ANCIENT)) throw new Error(`Missing OpenBible source: ${ANCIENT}`);

console.log('  Extracting ISBE entries...');
const rawEntries = extractEntries();
console.log(`    ${rawEntries.length} entries`);

console.log('  Loading OpenBible places...');
const places = loadPlaces();
console.log(`    ${places.length} places`);

// Map normalized ISBE title (incl. ';'-separated alternates) -> entry index (row id).
// entry_id is 1-based, assigned in extraction order.
const titleToEntryId = new Map();
rawEntries.forEach((e, idx) => {
  const entryId = idx + 1;
  for (const part of e.key.split(';')) {
    const nk = norm(part);
    if (nk && !titleToEntryId.has(nk)) titleToEntryId.set(nk, entryId);
  }
});

// Resolve each place to an ISBE entry by any of its name spellings.
const placeEntryIds = new Set();
for (const p of places) {
  p.entry_id = null;
  for (const nm of p.names) {
    const id = titleToEntryId.get(norm(nm));
    if (id) { p.entry_id = id; break; }
  }
  if (p.entry_id) placeEntryIds.add(p.entry_id);
}

// --- SQLite ---
const db = new Database(PACK_OUTPUT);
db.pragma('journal_mode = DELETE');

db.exec(`
  DROP TABLE IF EXISTS metadata;
  DROP TABLE IF EXISTS entries;
  DROP TABLE IF EXISTS entry_names;
  DROP TABLE IF EXISTS entry_tokens;
  DROP TABLE IF EXISTS places;
  DROP TABLE IF EXISTS place_names;
  DROP TABLE IF EXISTS place_verses;

  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE entries (
    entry_id     INTEGER PRIMARY KEY,
    title        TEXT,          -- original ISBE key, e.g. "RED SEA", "ABIA; ABIAH"
    primary_name TEXT,          -- display form of the first title, e.g. "Red Sea"
    body_html    TEXT,
    lead         TEXT,          -- first paragraph, plaintext
    outline      TEXT,          -- JSON [{i,t}] section headings, or NULL
    char_count   INTEGER,
    is_place     INTEGER        -- 1 if any OpenBible place resolves to this entry
  );

  CREATE TABLE entry_names (name_lower TEXT NOT NULL, entry_id INTEGER NOT NULL);
  CREATE INDEX idx_entry_names_lower ON entry_names(name_lower);

  CREATE TABLE entry_tokens (token TEXT NOT NULL, entry_id INTEGER NOT NULL);
  CREATE INDEX idx_entry_tokens ON entry_tokens(token);

  CREATE TABLE places (
    place_id          TEXT PRIMARY KEY,
    primary_name      TEXT,
    entry_id          INTEGER,   -- FK to entries, nullable
    type              TEXT,
    latitude          REAL,
    longitude         REAL,
    modern_name       TEXT,
    preceding_article TEXT,
    verse_count       INTEGER
  );

  CREATE TABLE place_names (
    name_lower TEXT NOT NULL,
    place_id   TEXT NOT NULL,
    is_phrase  INTEGER NOT NULL   -- 1 when the name is multi-word ("red sea")
  );
  CREATE INDEX idx_place_names_lower ON place_names(name_lower);

  CREATE TABLE place_verses (
    place_id TEXT NOT NULL,
    book     TEXT NOT NULL,
    chapter  INTEGER NOT NULL,
    verse    INTEGER NOT NULL,
    osis     TEXT
  );
  CREATE INDEX idx_place_verses_ref ON place_verses(book, chapter, verse);
  CREATE INDEX idx_place_verses_place ON place_verses(place_id);
`);

const insMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
insMeta.run('pack_id', 'isbe');
insMeta.run('pack_version', '1.0.0');
insMeta.run('pack_type', 'isbe');
insMeta.run('license', 'Public Domain (ISBE 1915); place data CC BY 4.0 (OpenBible.info)');
insMeta.run('attribution',
  'International Standard Bible Encyclopedia (1915, ed. James Orr) — public domain. '
  + 'Place coordinates, verse links and name spellings from OpenBible.info Bible Geocoding, licensed CC BY 4.0.');
insMeta.run('description', 'Bible encyclopedia (~9,380 ISBE articles) with geolocated places, verse links, and a multi-word place-name gazetteer');
insMeta.run('source_url', 'https://www.internationalstandardbible.com/ ; https://www.openbible.info/geo/');
insMeta.run('created_at', new Date().toISOString());

const insEntry = db.prepare(`
  INSERT INTO entries (entry_id, title, primary_name, body_html, lead, outline, char_count, is_place)
  VALUES (@entry_id, @title, @primary_name, @body_html, @lead, @outline, @char_count, @is_place)
`);
const insEntryName = db.prepare('INSERT INTO entry_names (name_lower, entry_id) VALUES (?, ?)');
const insToken = db.prepare('INSERT INTO entry_tokens (token, entry_id) VALUES (?, ?)');
const insPlace = db.prepare(`
  INSERT OR REPLACE INTO places
  (place_id, primary_name, entry_id, type, latitude, longitude, modern_name, preceding_article, verse_count)
  VALUES (@place_id, @primary_name, @entry_id, @type, @latitude, @longitude, @modern_name, @preceding_article, @verse_count)
`);
const insPlaceName = db.prepare('INSERT INTO place_names (name_lower, place_id, is_phrase) VALUES (?, ?, ?)');
const insPlaceVerse = db.prepare('INSERT INTO place_verses (place_id, book, chapter, verse, osis) VALUES (?, ?, ?, ?, ?)');

// Token postings collected across all entries, then filtered by a per-token cap so
// hyper-common words don't bloat the index.
const tokenPostings = new Map(); // token -> Set(entry_id)
const TOKEN_ENTRY_CAP = 600;

let nEntryNames = 0;
const buildEntries = db.transaction(() => {
  rawEntries.forEach((e, idx) => {
    const entryId = idx + 1;
    const html = toHtml(e.body);
    const text = toText(e.body);
    const outline = buildOutline(e.body);
    const firstAlt = e.key.split(';')[0].replace(/\s*\([0-9]+\)\s*$/, '').trim();

    insEntry.run({
      entry_id: entryId,
      title: e.key,
      primary_name: titleCase(firstAlt.toLowerCase()),
      body_html: escapeAmp(html),
      lead: firstParagraph(e.body).slice(0, 600),
      outline: outline ? JSON.stringify(outline) : null,
      char_count: text.length,
      is_place: placeEntryIds.has(entryId) ? 1 : 0,
    });

    // Name index — each ';'-separated alternate, normalized + a lowercase display form.
    const seen = new Set();
    for (const part of e.key.split(';')) {
      const cleaned = part.replace(/\s*\([0-9]+\)\s*$/, '').trim().toLowerCase();
      for (const variant of [cleaned, norm(part).toLowerCase()]) {
        if (variant && !seen.has(variant)) { seen.add(variant); insEntryName.run(variant, entryId); nEntryNames++; }
      }
    }

    // Collect tokens (deduped per entry).
    for (const tok of tokenize(text)) {
      let s = tokenPostings.get(tok);
      if (!s) { s = new Set(); tokenPostings.set(tok, s); }
      s.add(entryId);
    }
  });
});
buildEntries();

// Write token index, skipping tokens that appear in too many entries to be useful.
let nTokens = 0, nSkippedTokens = 0;
const buildTokens = db.transaction(() => {
  for (const [tok, ids] of tokenPostings) {
    if (ids.size > TOKEN_ENTRY_CAP) { nSkippedTokens++; continue; }
    for (const id of ids) { insToken.run(tok, id); nTokens++; }
  }
});
buildTokens();

let nPlaceNames = 0, nPlaceVerses = 0;
const buildPlaces = db.transaction(() => {
  for (const p of places) {
    insPlace.run({
      place_id: p.place_id,
      primary_name: p.primary_name,
      entry_id: p.entry_id,
      type: p.type,
      latitude: p.latitude,
      longitude: p.longitude,
      modern_name: p.modern_name,
      preceding_article: p.preceding_article,
      verse_count: p.verses.length,
    });
    // Store a normalized name (lowercase, punctuation -> space, collapsed) so a
    // clicked span rejoins to it regardless of hyphens/apostrophes in the text
    // ("Abel-beth-maacah" -> tokens "abel"/"beth"/"maacah" -> "abel beth maacah").
    // is_phrase marks multi-word names for the phrase-expansion lookup.
    const seen = new Set();
    for (const nm of p.names) {
      const nl = norm(nm).toLowerCase();
      if (!nl || seen.has(nl)) continue;
      seen.add(nl);
      insPlaceName.run(nl, p.place_id, nl.includes(' ') ? 1 : 0);
      nPlaceNames++;
    }
    for (const v of p.verses) { insPlaceVerse.run(p.place_id, v.book, v.chapter, v.verse, v.osis); nPlaceVerses++; }
  }
});
buildPlaces();

// --- Stats ---
const cEntries = db.prepare('SELECT COUNT(*) c FROM entries').get().c;
const cPlaces = db.prepare('SELECT COUNT(*) c FROM places').get().c;
const cPlacesMatched = db.prepare('SELECT COUNT(*) c FROM places WHERE entry_id IS NOT NULL').get().c;
const cPhrases = db.prepare('SELECT COUNT(DISTINCT name_lower) c FROM place_names WHERE is_phrase = 1').get().c;
const cBig = db.prepare('SELECT COUNT(*) c FROM entries WHERE char_count > 3000').get().c;

db.exec('VACUUM;');
db.close();

// Copy to packs/consolidated/ so the dev server serves it for the Packs installer.
const consolidatedDir = resolve(ROOT, 'packs/consolidated');
if (!existsSync(consolidatedDir)) mkdirSync(consolidatedDir, { recursive: true });
copyFileSync(PACK_OUTPUT, resolve(consolidatedDir, 'isbe.sqlite'));

const buf = readFileSync(PACK_OUTPUT);
const sha256 = createHash('sha256').update(buf).digest('hex');
const sizeBytes = statSync(PACK_OUTPUT).size;

console.log('\n📊 ISBE pack summary:');
console.log(`   Entries:          ${cEntries}`);
console.log(`   Entry names:      ${nEntryNames}`);
console.log(`   Token postings:   ${nTokens} (skipped ${nSkippedTokens} over-common tokens)`);
console.log(`   Big articles(>3k): ${cBig}`);
console.log(`   Places:           ${cPlaces} (${cPlacesMatched} linked to an ISBE article)`);
console.log(`   Place names:      ${nPlaceNames}`);
console.log(`   Multi-word phrases: ${cPhrases}`);
console.log(`   Place verses:     ${nPlaceVerses}`);
console.log(`   Output:           ${PACK_OUTPUT}`);
console.log(`   Copied to:        packs/consolidated/isbe.sqlite`);
console.log(`   Size:             ${(sizeBytes / 1048576).toFixed(2)} MB`);
console.log(`   sha256:           ${sha256}`);
console.log('\n✅ ISBE pack built successfully!');
