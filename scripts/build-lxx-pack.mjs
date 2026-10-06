#!/usr/bin/env node

/**
 * Build the Greek Septuagint (LXX) pack from Brenton's Greek text.
 *
 * What shipped before this was not the Septuagint. No Greek text had ever
 * been downloaded: every verse was the OpenScriptures lemma list joined word
 * by word, so Gen 1:1 read "ἐν ἀρχή ποιέω ὁ θεός" — dictionary forms — and
 * Joshua came from the Alexandrinus file, which only covers chapters 15, 18
 * and 19 (95 verses).
 *
 * Brenton's 1851 edition printed this Greek opposite his English, and LXX2012
 * is a modernization of that English, so the two line up verse for verse. The
 * build checks that against the shipped LXX2012 and fails if a book's
 * chapters disagree.
 *
 * Source: data-sources/ebible-grcbrent/ (eBible.org grcbrent, USFM).
 * License: Public Domain.
 *
 * Usage:
 *   node scripts/download-greek-texts.mjs
 *   node scripts/build-lxx-pack.mjs
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const SOURCE_DIR = join(repoRoot, 'data-sources/ebible-grcbrent');
const OUTPUT_FILE = join(repoRoot, 'packs/lxx-greek.sqlite');
const LXX2012_PACK = join(repoRoot, 'packs/consolidated/translations.sqlite');

/**
 * USFM book code → the book name the app uses.
 *
 * Only the 39 books the reader can open. Brenton also has the deuterocanon
 * (Tobit, Sirach, Maccabees…), but the reader's book list has nowhere to put
 * them. EZR is 2 Esdras — Ezra and Nehemiah as one book — and is split below.
 */
const BOOKS = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', ESG: 'Esther', JOB: 'Job', PSA: 'Psalms', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZK: 'Ezekiel', DAG: 'Daniel', HOS: 'Hosea', JOL: 'Joel',
  AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah', NAM: 'Nahum',
  HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi',
};

/**
 * Where the Greek chapters differ from the English ones the reader uses.
 *
 * 2 Esdras 11–23 is Nehemiah 1–13, which is how LXX2012 has it. Greek Joel has
 * four chapters (3:1–5 is English 2:28–32, chapter 4 is English 3) and Greek
 * Malachi three (3:19–24 is English 4:1–6). The reader stops at Joel 3, so
 * without this Greek Joel 4 could never be opened.
 */
function placeVerse(book, chapter, verse) {
  if (book === 'Ezra' && chapter >= 11) return { book: 'Nehemiah', chapter: chapter - 10, verse };
  if (book === 'Joel' && chapter === 3) return { book, chapter: 2, verse: verse + 27 };
  if (book === 'Joel' && chapter === 4) return { book, chapter: 3, verse };
  if (book === 'Malachi' && chapter === 3 && verse >= 19) return { book, chapter: 4, verse: verse - 18 };
  return { book, chapter, verse };
}

/** Lamentations' acrostic letters ("ΑΛΕΦ.") are labels and stay in capitals. */
const HEBREW_LETTERS = new Set([
  'ΑΛΕΦ', 'ΒΗΘ', 'ΓΙΜΕΛ', 'ΔΑΛΕΘ', 'ΗΘ', 'ΟΥΑΥ', 'ΖΑΙΝ', 'ΤΗΘ', 'ΙΩΔ', 'ΧΑΦ', 'ΛΑΜΕΔ',
  'ΜΗΜ', 'ΝΟΥΝ', 'ΣΑΜΕΧ', 'ΑΙΝ', 'ΦΗ', 'ΤΣΑΔΗ', 'ΚΩΦ', 'ΡΗΧΣ', 'ΧΣΕΝ', 'ΘΑΥ',
]);

const GREEK_WORD = /[\p{Script=Greek}̀-ͯ]+/gu;

/** Accents, breathings and case stripped, so ΚΑΙ, καὶ and καί share a key. */
function bareKey(word) {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
}

function isAllCaps(word) {
  return word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase();
}

/**
 * Parse one USFM file into [{ chapter, verse, text }].
 *
 * Only \c and \v carry structure; every other marker is paragraphing or a
 * title and is dropped. Lettered verses (1 Kings 2:35a–o, the additions in
 * Esther) are LXX material with no number of their own, and LXX2012 has none,
 * so each is folded into the verse it follows. Text before a chapter's first
 * verse — Lamentations' prologue — opens that verse, as it does in LXX2012.
 */
function parseUsfm(source) {
  const verses = [];
  let chapter = 0;
  let pending = '';
  let current = null;

  const body = source.replace(/\\(id|h|toc\d|mt\d?)\b[^\n]*/g, '');
  for (const piece of body.split(/(?=\\c |\\v )/)) {
    const c = piece.match(/^\\c (\d+)/);
    if (c) {
      chapter = Number(c[1]);
      current = null;
      continue;
    }
    const v = piece.match(/^\\v (\d+)([a-z]?)\s*([\s\S]*)$/);
    const text = (v ? v[3] : piece).replace(/\\[a-z]+\d?\*?/g, ' ').replace(/\s+/g, ' ').trim();
    if (!v) {
      // Before any \v: the \ip prologue, or a heading line.
      if (text) pending = `${pending} ${text}`.trim();
      continue;
    }
    if (v[2] && current) {
      current.text = `${current.text} ${text}`.trim();
      continue;
    }
    current = { chapter, verse: Number(v[1]), text: `${pending} ${text}`.trim() };
    pending = '';
    verses.push(current);
  }
  return verses;
}

/**
 * Brenton prints a book's opening words, and some oracle headings, in
 * capitals — and Greek capitals carry no accents, so lowercasing "ΚΑΙ" would
 * give an unaccented "και". Each capitalized word takes the spelling it most
 * often has elsewhere in Brenton ("ΚΑΙ" → "καὶ", "ἩΣΑΙΑΣ" → "Ἡσαΐας"), and
 * the first word of each run of capitals keeps an initial capital.
 */
function makeDecapitaliser(allTexts) {
  const forms = new Map();
  for (const text of allTexts) {
    for (const [word] of text.matchAll(GREEK_WORD)) {
      if (isAllCaps(word)) continue;
      const key = bareKey(word);
      const counts = forms.get(key) ?? new Map();
      counts.set(word, (counts.get(word) ?? 0) + 1);
      forms.set(key, counts);
    }
  }
  const best = (word) => {
    const counts = forms.get(bareKey(word));
    if (!counts) return null;
    // Prefer the lower-case form when a word is both (καὶ over Καὶ).
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0][0];
  };
  const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

  const changes = new Map();
  const fix = (text) => {
    let previousWasCaps = false;
    return text.replace(GREEK_WORD, (word) => {
      if (!isAllCaps(word) || HEBREW_LETTERS.has(word)) {
        previousWasCaps = false;
        return word;
      }
      const found = best(word) ?? word.toLowerCase();
      const out = previousWasCaps ? found : capitalise(found);
      previousWasCaps = true;
      changes.set(word, out);
      return out;
    });
  };
  return { fix, changes };
}

function buildLXXPack() {
  console.log('📖 Building Greek Septuagint (Brenton) pack...\n');

  if (!existsSync(SOURCE_DIR)) {
    console.error('❌ Source not found:', SOURCE_DIR);
    console.error('   Run: node scripts/download-greek-texts.mjs');
    process.exit(1);
  }

  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.usfm'));
  const sources = new Map();
  for (const f of files) {
    const code = f.match(/^\d+-([0-9A-Z]{3})/)?.[1];
    if (code) sources.set(code, readFileSync(join(SOURCE_DIR, f), 'utf-8'));
  }

  const parsed = new Map();
  for (const code of Object.keys(BOOKS)) {
    if (!sources.has(code)) throw new Error(`Missing ${code} in ${SOURCE_DIR}`);
    parsed.set(code, parseUsfm(sources.get(code)));
  }

  // The accent lookup reads every book Brenton has, deuterocanon included —
  // more text means more words with a known spelling.
  const everyText = [...sources.values()].flatMap((s) => parseUsfm(s).map((v) => v.text));
  const { fix, changes } = makeDecapitaliser(everyText);

  const rows = [];
  for (const [code, verses] of parsed) {
    for (const v of verses) {
      const placed = placeVerse(BOOKS[code], v.chapter, v.verse);
      rows.push({ ...placed, text: fix(v.text) });
    }
  }

  // Two verses landing on one reference would mean the renumbering is wrong.
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.book} ${r.chapter}:${r.verse}`;
    if (seen.has(key)) throw new Error(`Two verses at ${key}`);
    seen.add(key);
  }

  if (!existsSync(join(repoRoot, 'packs'))) mkdirSync(join(repoRoot, 'packs'), { recursive: true });
  // Always build from scratch — re-inserting into a previous build collides.
  if (existsSync(OUTPUT_FILE)) rmSync(OUTPUT_FILE);
  const db = new Database(OUTPUT_FILE);

  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE verses (
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (book, chapter, verse)
    );

    CREATE INDEX idx_verses_book ON verses(book);
    CREATE INDEX idx_verses_chapter ON verses(book, chapter);
  `);

  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('pack_id', 'lxx-greek');
  insertMeta.run('version', '1.0.0');
  insertMeta.run('type', 'original-language');
  insertMeta.run('translation_id', 'LXX');
  insertMeta.run('translation_name', 'Septuagint (Greek)');
  insertMeta.run('language', 'grc');
  insertMeta.run('testament', 'OT');
  insertMeta.run('source', "Brenton's Greek Septuagint (1851), eBible.org grcbrent");
  insertMeta.run('license', 'Public Domain');
  insertMeta.run('createdAt', new Date().toISOString());

  const insertVerse = db.prepare('INSERT INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of rows) insertVerse.run(r.book, r.chapter, r.verse, r.text);
  })();

  // ── Checks ────────────────────────────────────────────────────────────
  console.log('🔤 Capitalized words restored:');
  for (const [from, to] of changes) console.log(`   ${from} → ${to}`);

  const shape = (d, where, args) =>
    new Map(
      d.prepare(`SELECT book, COUNT(DISTINCT chapter) ch, COUNT(*) v FROM verses ${where} GROUP BY book`)
        .all(...args)
        .map((r) => [r.book, r]),
    );
  const ours = shape(db, '', []);
  const lxx2012 = new Database(LXX2012_PACK, { readonly: true });
  const theirs = shape(lxx2012, 'WHERE translation_id = ?', ['lxx2012']);
  lxx2012.close();

  console.log('\n📊 Book            chapters      verses (Greek / LXX2012)');
  const problems = [];
  for (const name of [...Object.values(BOOKS), 'Nehemiah']) {
    const o = ours.get(name);
    const t = theirs.get(name);
    if (!o) {
      problems.push(`${name}: no verses`);
      continue;
    }
    const mark = o.v === t?.v ? '' : `  (${o.v - (t?.v ?? 0) > 0 ? '+' : ''}${o.v - (t?.v ?? 0)})`;
    console.log(`   ${name.padEnd(16)} ${String(o.ch).padStart(3)} / ${String(t?.ch ?? '-').padEnd(3)}   ${String(o.v).padStart(5)} / ${t?.v ?? '-'}${mark}`);
    if (o.ch !== t?.ch) problems.push(`${name}: ${o.ch} chapters, LXX2012 has ${t?.ch}`);
  }

  const total = db.prepare('SELECT COUNT(*) n FROM verses').get().n;
  const sample = db.prepare("SELECT text FROM verses WHERE book = 'Genesis' AND chapter = 1 AND verse = 1").get();
  console.log(`\n📖 ${total.toLocaleString()} verses. Genesis 1:1: ${sample.text}`);

  db.exec('VACUUM');
  db.close();

  if (problems.length) {
    console.error('\n❌ Chapters do not match LXX2012:');
    for (const p of problems) console.error(`   ${p}`);
    process.exit(1);
  }
  console.log(`\n✅ ${OUTPUT_FILE}`);
}

buildLXXPack();
