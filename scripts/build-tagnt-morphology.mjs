#!/usr/bin/env node
/**
 * Build per-edition Greek NT morphology from STEPBible's TAGNT.
 *
 * Why this exists: the Greek morphology that shipped was a single OpenGNT
 * dataset served under two labels, so BYZ and TR had byte-identical tagging.
 * OpenGNT is Nestle-Aland family, which means neither label was even correct —
 * someone studying the Byzantine text was reading a critical text's analysis.
 *
 * TAGNT records, for every word, which editions actually contain it:
 *
 *   Mat.1.1#01=NKO  Βίβλος (Biblos)  [The] book  G0976=N-NSF  βίβλος=book
 *                                   NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz
 *   Mat.4.18#03=k   ὁ (ho)           -           G3588=T-NSM  ὁ=the      TR
 *
 * So one row is emitted per word *per edition it appears in*, and the editions
 * finally differ from each other the way the underlying texts do.
 *
 * Source: data-sources/stepbible/… TAGNT, CC BY 4.0.
 * Usage:  node scripts/build-tagnt-morphology.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const TAGNT_DIR = join(
  repoRoot,
  'data-sources/stepbible/STEPBible-Data-master/Translators Amalgamated OT+NT',
);
const TAGNT_FILES = [
  'TAGNT Mat-Jhn - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
  'TAGNT Act-Rev - Translators Amalgamated Greek NT - STEPBible.org CC-BY.txt',
];
const OUTPUT = join(repoRoot, 'packs/tagnt-morphology.sqlite');

/**
 * TAGNT edition name → the translation id the app already uses.
 *
 * Only editions the app knows about are emitted. TAGNT also carries NA27/NA28,
 * Tyndale, Westcott-Hort and Tregelles, which could be added the day the app
 * has reading texts for them.
 */
const EDITIONS = {
  Byz: 'byz',
  TR: 'tr',
  SBL: 'sblgnt',
};

const BOOKS = {
  Mat: 'Matthew', Mrk: 'Mark', Luk: 'Luke', Jhn: 'John', Act: 'Acts',
  Rom: 'Romans', '1Co': '1 Corinthians', '2Co': '2 Corinthians',
  Gal: 'Galatians', Eph: 'Ephesians', Php: 'Philippians', Col: 'Colossians',
  '1Th': '1 Thessalonians', '2Th': '2 Thessalonians',
  '1Ti': '1 Timothy', '2Ti': '2 Timothy', Tit: 'Titus', Phm: 'Philemon',
  Heb: 'Hebrews', Jas: 'James', '1Pe': '1 Peter', '2Pe': '2 Peter',
  '1Jn': '1 John', '2Jn': '2 John', '3Jn': '3 John', Jud: 'Jude',
  Rev: 'Revelation',
};

const REF_RE = /^([A-Z1-3][A-Za-z0-9]{1,3})\.(\d+)\.(\d+)#(\d+)/;

/**
 * The Greek column is "word (transliteration)", and the word may carry the
 * trailing punctuation of its clause.
 */
function splitGreek(cell) {
  const m = cell.match(/^\s*(.*?)\s*\(([^()]*)\)\s*$/);
  if (m) return { text: m[1].trim(), translit: m[2].trim() };
  return { text: cell.trim(), translit: '' };
}

/**
 * "G0976=N-NSF" → { strongs: 'G0976', morph: 'N-NSF' }
 *
 * Two complications. A word can be prefixed with the Hebrew number it renders
 * ("H0085|G0011=N-GSM-P"), and it can be conjoined to a neighbour with «
 * ("G1138«G1138=N-GSM-P"). Only the Greek number of the word itself is wanted.
 */
function splitStrongs(cell) {
  const eq = cell.indexOf('=');
  const left = eq === -1 ? cell : cell.slice(0, eq);
  const morph = eq === -1 ? '' : cell.slice(eq + 1).trim();
  const afterHebrew = left.includes('|') ? left.slice(left.lastIndexOf('|') + 1) : left;
  const own = afterHebrew.split('«')[0].split('»')[0];
  const m = own.match(/G\d+[A-Za-z]?/);
  return { strongs: m ? m[0] : '', morph };
}

/** "βίβλος=book" → { lemma, gloss } */
function splitLemma(cell) {
  const eq = cell.indexOf('=');
  if (eq === -1) return { lemma: cell.trim(), gloss: '' };
  return { lemma: cell.slice(0, eq).trim(), gloss: cell.slice(eq + 1).trim() };
}

/**
 * "NA28+NA27+Tyn+SBL+WH+Treg+TR«3+Byz«3" → ['NA28','NA27',…,'TR','Byz']
 *
 * The «n / »n suffixes mark that an edition puts the word n places away. Word
 * order is not reproduced here — each edition is renumbered in the amalgamated
 * order — so the marker is stripped and noted as a known limitation.
 */
function splitEditions(cell) {
  return cell
    .split('+')
    .map((e) => e.trim().split(/[«»]/)[0].trim())
    .filter(Boolean);
}


/**
 * Column 6 — a replacement reading, with its own number and grammar:
 *   "Ἀμών (t=Amōn) Amon - G0300=N-ASM-P in: TR+Byz"
 * These editions are absent from the main editions column, so without this the
 * word simply vanishes from TR and Byz — and Matthew 1:10 loses "Amon", which
 * is a different person from "Amos", not a spelling of him.
 * A cell can hold more than one variant; up to three occur.
 */
const VARIANT_RE =
  /(\S+)\s*\([a-z]*=([^)]*)\)\s*([^-]*?)\s*-\s*(G\d+[A-Za-z]?)\s*=\s*(\S+)\s*in:\s*([A-Za-z0-9+«»_]+)/g;

function parseMeaningVariants(cell) {
  const out = [];
  if (!cell || !cell.includes('in:')) return out;
  VARIANT_RE.lastIndex = 0;
  let m;
  while ((m = VARIANT_RE.exec(cell)) !== null) {
    out.push({
      text: m[1].trim(),
      translit: m[2].trim(),
      english: m[3].trim(),
      strongs: m[4],
      morph: m[5],
      editions: splitEditions(m[6]),
    });
  }
  return out;
}

/**
 * Column 7 — the same word spelled differently by some editions:
 *   "Tyn+WH: Δαυεὶδ ; +TR: Δαβὶδ ;"
 * Not a different word, so no extra row: it only replaces the surface form, so
 * an edition's morphology matches the spelling in its own reading text.
 */
function parseSpellingVariants(cell) {
  const map = new Map();
  if (!cell || !cell.includes(':')) return map;
  for (const seg of cell.split(';')) {
    const i = seg.indexOf(':');
    if (i === -1) continue;
    const eds = seg.slice(0, i).replace(/^\s*\+/, '');
    const spelling = seg.slice(i + 1).trim();
    if (!spelling) continue;
    for (const ed of splitEditions(eds)) map.set(ed, spelling);
  }
  return map;
}

function parseFile(path, rows) {
  const text = readFileSync(path, 'utf8');
  let kept = 0;
  for (const line of text.split('\n')) {
    const ref = REF_RE.exec(line);
    if (!ref) continue; // headers, verse summaries (#…), notes

    const parts = line.split('\t');
    if (parts.length < 6) continue;

    const book = BOOKS[ref[1]];
    if (!book) continue;

    const { text: greek, translit } = splitGreek(parts[1] ?? '');
    if (!greek) continue;
    const english = (parts[2] ?? '').trim();
    const { strongs, morph } = splitStrongs(parts[3] ?? '');
    const { lemma, gloss } = splitLemma(parts[4] ?? '');

    const spellings = parseSpellingVariants(parts[7] ?? '');
    const base = {
      book,
      chapter: Number(ref[2]),
      verse: Number(ref[3]),
      // Amalgamated position; renumbered per edition below.
      amalgamated: Number(ref[4]),
      lemma,
      gloss: gloss || english,
    };

    for (const ed of splitEditions(parts[5] ?? '')) {
      const translationId = EDITIONS[ed];
      if (!translationId) continue;
      rows.push({
        ...base,
        translationId,
        text: spellings.get(ed) ?? greek,
        strongs,
        morph,
        translit,
      });
      kept++;
    }

    // Editions carrying a different reading are not in the column above, so
    // they are emitted from the variant column instead.
    for (const v of parseMeaningVariants(parts[6] ?? '')) {
      for (const ed of v.editions) {
        const translationId = EDITIONS[ed];
        if (!translationId) continue;
        rows.push({
          ...base,
          translationId,
          text: v.text,
          strongs: v.strongs,
          morph: v.morph,
          translit: v.translit,
          gloss: v.english || base.gloss,
        });
        kept++;
      }
    }
  }
  return kept;
}

console.log("📖 Building per-edition Greek NT morphology from TAGNT\n");

const rows = [];
for (const f of TAGNT_FILES) {
  const p = join(TAGNT_DIR, f);
  if (!existsSync(p)) {
    console.error(`❌ Missing TAGNT file: ${p}`);
    process.exit(1);
  }
  const n = parseFile(p, rows);
  console.log(`   ${f.split(' - ')[0]}: ${n.toLocaleString()} edition-words`);
}

/**
 * Renumber within each edition's verse.
 *
 * The amalgamated position counts every word any edition has, so an edition
 * missing a word would otherwise show gaps and its indices would not line up
 * with its own reading text.
 */
rows.sort(
  (a, b) =>
    a.translationId.localeCompare(b.translationId) ||
    a.book.localeCompare(b.book) ||
    a.chapter - b.chapter ||
    a.verse - b.verse ||
    a.amalgamated - b.amalgamated,
);
let key = '';
let order = 0;
for (const r of rows) {
  const k = `${r.translationId}|${r.book}|${r.chapter}|${r.verse}`;
  if (k !== key) {
    key = k;
    order = 0;
  }
  r.wordOrder = ++order; // 1-based, matching the pack schema
}

mkdirSync(dirname(OUTPUT), { recursive: true });
if (existsSync(OUTPUT)) unlinkSync(OUTPUT);
const db = new Database(OUTPUT);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE words (
    translation_id TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    word_order INTEGER NOT NULL,
    text TEXT NOT NULL,
    lemma TEXT,
    strongs TEXT,
    morph_code TEXT,
    gloss_en TEXT,
    transliteration TEXT,
    PRIMARY KEY (translation_id, book, chapter, verse, word_order)
  );
  CREATE INDEX idx_words_translation ON words(translation_id);
  CREATE INDEX idx_words_book ON words(book);
  CREATE INDEX idx_words_strongs ON words(strongs);
`);

const meta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
meta.run('id', 'tagnt-morphology');
meta.run('name', 'Greek NT morphology per edition (TAGNT)');
meta.run('source', 'STEPBible Translators Amalgamated Greek NT');
meta.run('license', 'CC BY 4.0 — STEPBible.org / Tyndale House Cambridge');
meta.run('editions', Object.values(EDITIONS).join(','));
meta.run('createdAt', new Date().toISOString());

const insert = db.prepare(`
  INSERT OR REPLACE INTO words
    (translation_id, book, chapter, verse, word_order, text, lemma, strongs, morph_code, gloss_en, transliteration)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertAll = db.transaction((all) => {
  for (const r of all) {
    insert.run(
      r.translationId, r.book, r.chapter, r.verse, r.wordOrder,
      r.text, r.lemma, r.strongs, r.morph, r.gloss, r.translit,
    );
  }
});
insertAll(rows);

console.log('\n📊 Words per edition:');
for (const row of db
  .prepare('SELECT translation_id, COUNT(*) n FROM words GROUP BY translation_id ORDER BY 1')
  .all()) {
  console.log(`   ${row.translation_id.padEnd(8)} ${row.n.toLocaleString()}`);
}

db.exec('VACUUM');
db.close();
console.log(`\n✅ ${OUTPUT}`);
