#!/usr/bin/env node
/**
 * Build the Greek Critical Text pack: the SBL Greek New Testament.
 *
 * NET and BSB were translated from a critical Greek text, and the app's other
 * Greek texts (BYZ, TR) are not one. This pack adds SBLGNT so a Strong's word
 * can be read in the Greek those translations actually followed.
 *
 * It ships on its own, not inside ancient-languages.sqlite, because that pack
 * is 111 MB and changing it would make everyone download it again.
 *
 * Text: the official SBLGNT files (CC BY 4.0), downloaded from
 * github.com/LogosBible/SBLGNT into data-sources/sblgnt/. The apparatus signs
 * (⸀ ⸁ ⸂ ⸃ ⸄ ⸅, sometimes with a number) point into an apparatus this pack
 * doesn't carry, so they come out; the edition's own brackets stay.
 *
 * Words: TAGNT's SBL tagging (packs/tagnt-morphology.sqlite, CC BY 4.0). TAGNT
 * keeps its own word order and skips a few passages (Mark 16:9-20, John
 * 7:53-8:11) and the verses SBLGNT numbers differently, so each word of the
 * reading text is matched to its tag rather than copied across:
 *   1. the same verse's SBL tags, each used once;
 *   2. nearby verses of the same chapter, in any edition;
 *   3. the one analysis every TAGNT occurrence of that spelling agrees on.
 * A movable nu doesn't count (μεριμνῶσι is μεριμνῶσιν).
 * A word none of these settle keeps its text with no tag. Rows follow the
 * reading text, so a tapped word's position finds its own row.
 *
 * Usage: node scripts/build-greek-critical-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const TEXT_DIR = join(repoRoot, 'data-sources/sblgnt/SBLGNT-master/data/sblgnt/text');
const TAGNT = join(repoRoot, 'packs/tagnt-morphology.sqlite');
const OUTPUT = join(repoRoot, 'packs/consolidated/greek-critical.sqlite');

const ID = 'sblgnt';
const ATTRIBUTION =
  'SBL Greek New Testament, © 2010 Society of Biblical Literature and Logos Bible Software, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). ' +
  'Word tagging from STEPBible TAGNT, CC BY 4.0.';

/** SBLGNT file abbreviations → the book names the packs use. */
const BOOKS = {
  Matt: 'Matthew', Mark: 'Mark', Luke: 'Luke', John: 'John', Acts: 'Acts',
  Rom: 'Romans', '1Cor': '1 Corinthians', '2Cor': '2 Corinthians',
  Gal: 'Galatians', Eph: 'Ephesians', Phil: 'Philippians', Col: 'Colossians',
  '1Thess': '1 Thessalonians', '2Thess': '2 Thessalonians',
  '1Tim': '1 Timothy', '2Tim': '2 Timothy', Titus: 'Titus', Phlm: 'Philemon',
  Heb: 'Hebrews', Jas: 'James', '1Pet': '1 Peter', '2Pet': '2 Peter',
  '1John': '1 John', '2John': '2 John', '3John': '3 John', Jude: 'Jude',
  Rev: 'Revelation',
};

for (const p of [TEXT_DIR, TAGNT]) {
  if (!existsSync(p)) {
    console.error(`❌ Missing ${p}`);
    if (p === TEXT_DIR) console.error('   Download github.com/LogosBible/SBLGNT and unzip it into data-sources/sblgnt/');
    else console.error('   Run: node scripts/build-tagnt-morphology.mjs');
    process.exit(1);
  }
}

/** A word's letters alone: no accents, breathings, elision marks or punctuation. */
const keyOf = (word) =>
  word.normalize('NFD').replace(/[^\p{L}]|ʼ/gu, '').toLowerCase().replace(/ς/g, 'σ');

/** The same with its accents, so ἀλλά (but) and ἄλλα (others) stay apart. A grave is an acute. */
const formOf = (word) =>
  word.normalize('NFD').replace(/̀/g, '́').replace(/[^\p{L}\p{M}]|ʼ/gu, '').toLowerCase()
    .replace(/ς/g, 'σ').normalize('NFC');

/** Without a movable nu: μεριμνῶσιν and μεριμνῶσι, ἐστὶν and ἐστὶ. */
const nuless = (key) => key.replace(/([ει]\p{M}*)ν$/u, '$1');

// --- The reading text --------------------------------------------------------

const verses = [];
for (const file of readdirSync(TEXT_DIR).filter((f) => f.endsWith('.txt'))) {
  for (const line of readFileSync(join(TEXT_DIR, file), 'utf8').split(/\r?\n/)) {
    const m = /^(\S+) (\d+):(\d+)\t(.*)$/.exec(line);
    if (!m) continue; // the book's title line
    const book = BOOKS[m[1]];
    if (!book) throw new Error(`Unknown book ${m[1]} in ${file}`);
    const text = m[4].replace(/[⸀-⸅]\d*/g, '').replace(/\s+/g, ' ').trim();
    if (text) verses.push({ book, chapter: Number(m[2]), verse: Number(m[3]), text });
  }
}

// --- TAGNT's tags ------------------------------------------------------------

const tagnt = new Database(TAGNT, { readonly: true });
const refKey = (book, chapter, verse) => `${book} ${chapter}:${verse}`;
const tagged = new Map(); // ref → { sblgnt: rows, byz: rows, tr: rows }
const analyses = new Map(); // spelling, with or without accents and nu → Map(strongs|morph → { row, n })
for (const r of tagnt
  .prepare('SELECT translation_id, book, chapter, verse, word_order, text, lemma, strongs, morph_code, gloss_en, transliteration FROM words ORDER BY book, chapter, verse, word_order')
  .iterate()) {
  const ref = refKey(r.book, r.chapter, r.verse);
  const editions = tagged.get(ref) ?? tagged.set(ref, {}).get(ref);
  (editions[r.translation_id] ??= []).push(r);
  for (const key of new Set([formOf(r.text), nuless(formOf(r.text)), keyOf(r.text), nuless(keyOf(r.text))])) {
    const forms = analyses.get(key) ?? analyses.set(key, new Map()).get(key);
    const a = `${r.strongs}|${r.morph_code}`;
    const seen = forms.get(a) ?? forms.set(a, { row: r, n: 0 }).get(a);
    seen.n++;
  }
}
tagnt.close();

/** The analysis every TAGNT occurrence of a spelling agrees on, or null. */
function agreedAnalysis(token) {
  for (const key of [formOf(token), nuless(formOf(token)), keyOf(token), nuless(keyOf(token))]) {
    const found = agreedFor(key);
    if (found !== undefined) return found;
  }
  return null;
}

/** undefined when the spelling never occurs, so a less exact spelling is tried next. */
function agreedFor(key) {
  const forms = analyses.get(key);
  if (!forms) return undefined;
  const all = [...forms.values()];
  if (new Set(all.map((f) => f.row.strongs)).size !== 1) return null;
  const top = all.sort((a, b) => b.n - a.n)[0].row;
  // One number but several parsings ("λόγου" is always G3056, but a form can
  // be read two ways): keep the number, leave the parsing blank.
  return all.length === 1 ? top : { ...top, morph_code: null };
}

/** Nearby verses' tags, nearest first: same chapter, two verses either side, then the next chapter's first. */
function nearbyRows(book, chapter, verse) {
  const out = [];
  for (const d of [0, -1, 1, -2, 2]) {
    const editions = tagged.get(refKey(book, chapter, verse + d));
    if (!editions) continue;
    for (const ed of d === 0 ? ['byz', 'tr'] : ['sblgnt', 'byz', 'tr']) out.push(...(editions[ed] ?? []));
  }
  out.push(...Object.values(tagged.get(refKey(book, chapter + 1, 1)) ?? {}).flat());
  return out;
}

// --- Matching each word to its tag -------------------------------------------

const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
const stats = { words: 0, sameVerse: 0, nearby: 0, agreed: 0, untagged: 0, segmenterMismatch: 0 };
const untaggedSamples = [];
const words = [];

for (const v of verses) {
  const own = (tagged.get(refKey(v.book, v.chapter, v.verse))?.sblgnt ?? []).map((row) => ({ row, used: false }));
  let near = null;
  let order = 0;
  for (const token of v.text.split(' ')) {
    const key = keyOf(token);
    if (!key) continue; // a dash or bracket standing alone
    // The reader counts words with Intl.Segmenter; a token it splits in two
    // would shift every later word's position.
    const parts = [...segmenter.segment(token)].filter((s) => s.isWordLike).length;
    if (parts !== 1) stats.segmenterMismatch++;
    stats.words++;
    let tag = null;
    const bare = nuless(key);
    const mine =
      own.find((o) => !o.used && keyOf(o.row.text) === key) ??
      own.find((o) => !o.used && nuless(keyOf(o.row.text)) === bare);
    if (mine) {
      mine.used = true;
      tag = mine.row;
      stats.sameVerse++;
    } else {
      near ??= nearbyRows(v.book, v.chapter, v.verse);
      tag = near.find((r) => keyOf(r.text) === key) ?? near.find((r) => nuless(keyOf(r.text)) === bare) ?? null;
      if (tag) stats.nearby++;
      else {
        tag = agreedAnalysis(token);
        if (tag) stats.agreed++;
        else {
          stats.untagged++;
          if (untaggedSamples.length < 25) untaggedSamples.push(`${refKey(v.book, v.chapter, v.verse)} ${token}`);
        }
      }
    }
    words.push({
      book: v.book, chapter: v.chapter, verse: v.verse, word_order: ++order, text: token,
      lemma: tag?.lemma ?? null, strongs: tag?.strongs ?? null, morph_code: tag?.morph_code ?? null,
      gloss_en: tag?.gloss_en ?? null, transliteration: tag?.transliteration ?? null,
    });
  }
}

// --- Writing the pack --------------------------------------------------------

mkdirSync(dirname(OUTPUT), { recursive: true });
if (existsSync(OUTPUT)) rmSync(OUTPUT);
const out = new Database(OUTPUT);
out.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE translations (id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT, description TEXT);
  CREATE TABLE verses (
    translation_id TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (translation_id, book, chapter, verse)
  );
  CREATE TABLE words (
    translation_id TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
    word_order INTEGER NOT NULL, text TEXT NOT NULL,
    lemma TEXT, strongs TEXT, morph_code TEXT, gloss_en TEXT, transliteration TEXT,
    PRIMARY KEY (translation_id, book, chapter, verse, word_order)
  );
`);
const meta = out.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
for (const [k, val] of Object.entries({
  id: 'greek-critical',
  version: '1.0.0',
  type: 'translation',
  schemaVersion: '1',
  minAppVersion: '1.0.0',
  name: 'Greek Critical Text',
  description: 'SBL Greek New Testament (SBLGNT) with morphology',
  license: 'CC BY 4.0',
  attribution: ATTRIBUTION,
  createdAt: new Date().toISOString(),
})) meta.run(k, val);
out.prepare('INSERT INTO translations VALUES (?, ?, ?, ?)').run(
  ID, 'SBL Greek New Testament (SBLGNT)', 'grc', 'SBL Greek New Testament, a critical text (Michael W. Holmes, ed., 2010)',
);
const insVerse = out.prepare('INSERT INTO verses VALUES (?, ?, ?, ?, ?)');
const insWord = out.prepare('INSERT INTO words VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
out.transaction(() => {
  for (const v of verses) insVerse.run(ID, v.book, v.chapter, v.verse, v.text);
  for (const w of words) {
    insWord.run(ID, w.book, w.chapter, w.verse, w.word_order, w.text, w.lemma, w.strongs, w.morph_code, w.gloss_en, w.transliteration);
  }
})();
out.exec('VACUUM');

// --- Report ------------------------------------------------------------------

const withWords = new Set(words.map((w) => refKey(w.book, w.chapter, w.verse)));
const noWords = verses.filter((v) => !withWords.has(refKey(v.book, v.chapter, v.verse)));
const pct = (n) => ((100 * n) / stats.words).toFixed(2) + '%';
console.log(`SBLGNT: ${verses.length.toLocaleString()} verses, ${stats.words.toLocaleString()} words`);
console.log(`  tagged from the same verse   ${stats.sameVerse.toLocaleString()} (${pct(stats.sameVerse)})`);
console.log(`  tagged from nearby verses    ${stats.nearby.toLocaleString()} (${pct(stats.nearby)})`);
console.log(`  tagged by agreed spelling    ${stats.agreed.toLocaleString()} (${pct(stats.agreed)})`);
console.log(`  left untagged                ${stats.untagged.toLocaleString()} (${pct(stats.untagged)})`);
if (untaggedSamples.length) console.log(`    e.g. ${untaggedSamples.join(' · ')}`);
console.log(`  words the reader would split ${stats.segmenterMismatch}`);
console.log(`  verses with text but no words ${noWords.length}${noWords.length ? ': ' + noWords.map((v) => refKey(v.book, v.chapter, v.verse)).join(', ') : ''}`);
for (const ref of ['Matthew 17:21', 'Acts 8:37', 'John 5:4', 'Romans 16:25']) {
  console.log(`  ${ref.padEnd(14)} ${verses.some((v) => refKey(v.book, v.chapter, v.verse) === ref) ? 'present' : 'absent'}`);
}
const john316 = words.filter((w) => w.book === 'John' && w.chapter === 3 && w.verse === 16);
console.log(`  John 3:16: ${john316.map((w) => `${w.text}=${w.strongs ?? '?'}`).join(' ')}`);
console.log(`📍 ${OUTPUT} (${(statSync(OUTPUT).size / 1048576).toFixed(2)} MB)`);
