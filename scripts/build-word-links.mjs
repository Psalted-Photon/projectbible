#!/usr/bin/env node

/**
 * Build the Word Links pack: which English words in a verse translate which
 * Greek or Hebrew word.
 *
 * Each translation is added on its own and merged into the one pack file, so
 * rebuilding one leaves the others as they were:
 *
 *   node scripts/build-word-links.mjs --only kjv
 *
 * KJV comes from eBible's USFX, where every translated word carries the
 * Strong's number it renders (<w s="G0025">loved</w>). BSB (Phase 5) and WEB
 * and NET (Phase 6) are still to come.
 *
 * Offsets are measured on the verse's clean text exactly as the app measures
 * it (scripts/lib/clean-text.mjs), so the tags are read from the source and
 * checked against the shipped pack word for word. Rebuilding the KJV, WEB, BSB
 * or NET pack means running this again, as with align-red-letter.mjs.
 *
 * The pack also carries original_forms: every Greek and Hebrew spelling in the
 * ancient-languages pack, folded the way the Strong's list folds it, with the
 * number it most often stands for. The gloss popup (Phase 11) reads it.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { produceUSFXVerses } from '../packages/packtools/src/parsers/build-usfx-pack.mjs';
import { WORD_OPEN, WORD_SEP, WORD_CLOSE } from '../packages/packtools/src/parsers/usfm-scanner.mjs';
import { cleanWithIndex, locateVerbatim } from './lib/clean-text.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const OUT_DIR = join(repoRoot, 'packs/consolidated');
const OUT_PATH = join(OUT_DIR, 'word-links.sqlite');
const ANCIENT_PATH = join(OUT_DIR, 'ancient-languages.sqlite');

const SOURCES = {
  kjv: {
    pack: join(repoRoot, 'packs/kjv.sqlite'),
    credit: 'KJV word tags: eBible.org King James Version with Strong’s numbers (public domain).',
    read: () =>
      produceUSFXVerses(join(repoRoot, 'data-sources/kjv-usfx/eng-kjv_usfx.xml'), { strongsSentinels: true }).verses,
  },
};

const only = (() => {
  const at = process.argv.indexOf('--only');
  return at >= 0 ? process.argv[at + 1] : null;
})();
if (!only || !SOURCES[only]) {
  console.error(`Usage: node scripts/build-word-links.mjs --only ${Object.keys(SOURCES).join('|')}`);
  console.error('(bsb is Phase 5; web and net are Phase 6.)');
  process.exit(1);
}

// ── Strong's numbers and spellings ──────────────────────────────────────────

/** classicId() in lib/strongs/entry.ts: G25, G0025 and G0025G are all G0025. */
function classicId(id) {
  const m = /^([GH])0*(\d{1,4})[A-Za-z]?$/i.exec(id ?? '');
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : null;
}

// Ported from apps/pwa-polished/src/lib/strongs/collate.ts. Keep identical:
// the app looks words up with its own copies.
const MARKS = /\p{M}/gu;
function greekKey(text) {
  return text
    .normalize('NFKD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/[^α-ω]/g, '');
}
const FINALS = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
function hebrewKey(text) {
  return text
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[^א-ת]/g, '');
}

// ── Reading the tags ────────────────────────────────────────────────────────

/** Take the sentinels out: the stored text, and each tagged word's place in it. */
function unwrap(text) {
  let stored = '';
  const words = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === WORD_OPEN) {
      const sep = text.indexOf(WORD_SEP, i);
      const close = text.indexOf(WORD_CLOSE, sep);
      const ids = text.slice(i + 1, sep);
      const s = stored.length;
      stored += text.slice(sep + 1, close);
      words.push({ s, e: stored.length, ids });
      i = close + 1;
      continue;
    }
    stored += text[i];
    i++;
  }
  return { stored, words };
}

/** Ids for a link: classic numbers, each once, "+"-joined. Null when none parse. */
function linkIds(raw) {
  const ids = [...new Set(raw.split('+').map(classicId).filter(Boolean))];
  return ids.length ? ids.join('+') : null;
}

/** A stored-text range as clean-text offsets, trimmed of edge spaces. */
function toClean(range, at, text) {
  let s = -1;
  let e = -1;
  for (let k = 0; k < at.length; k++) {
    if (at[k] >= range.e) break;
    if (at[k] >= range.s) {
      if (s < 0) s = k;
      e = k + 1;
    }
  }
  if (s < 0) return null;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return e > s ? { s, e } : null;
}

// ── Build ───────────────────────────────────────────────────────────────────

const source = SOURCES[only];
console.log(`🔗 Word Links: ${only.toUpperCase()}\n`);

const packDb = new Database(source.pack, { readonly: true });
const packText = new Map();
for (const r of packDb.prepare('SELECT book, chapter, verse, text FROM verses').all()) {
  packText.set(`${r.book}|${r.chapter}|${r.verse}`, r.text);
}
packDb.close();

const verses = source.read();
const rows = [];
let verbatim = 0;
let relocated = 0;
let notInPack = 0;
let wordsRead = 0;
let wordsLinked = 0;
let wordsMissed = 0;
let wordsUntagged = 0;
const drifted = [];

for (const v of verses) {
  const key = `${v.book}|${v.chapter}|${v.verse}`;
  const stored = packText.get(key);
  if (stored === undefined) { notInPack++; continue; }
  const { stored: ours, words } = unwrap(v.text);
  if (!words.length) continue;
  wordsRead += words.length;

  const clean = cleanWithIndex(stored);
  const links = [];
  if (ours === stored) {
    verbatim++;
    for (const w of words) {
      const ids = linkIds(w.ids);
      const span = ids && toClean(w, clean.at, clean.text);
      if (!ids) wordsUntagged++;
      else if (!span) wordsMissed++;
      else { links.push({ ...span, ids }); wordsLinked++; }
    }
  } else {
    // The source and the pack disagree somewhere in this verse: find each word
    // in the pack's own text, in order, and drop the ones that aren't there.
    relocated++;
    if (drifted.length < 10) drifted.push(key);
    let cursor = 0;
    for (const w of words) {
      const ids = linkIds(w.ids);
      if (!ids) { wordsUntagged++; continue; }
      const found = locateVerbatim(ours.slice(w.s, w.e), clean.text, cursor);
      if (!found) { wordsMissed++; continue; }
      cursor = found.e;
      links.push({ ...found, ids });
      wordsLinked++;
    }
  }
  if (!links.length) continue;
  links.sort((a, b) => a.s - b.s);
  rows.push({
    book: v.book,
    chapter: v.chapter,
    verse: v.verse,
    links: links.map((l) => `${l.s},${l.e - l.s},${l.ids}`).join(';'),
  });
}

const tagged = verses.length - notInPack;
console.log(`Verses read:            ${verses.length.toLocaleString()}` + (notInPack ? ` (${notInPack} not in the pack)` : ''));
console.log(`Text matches the pack:  ${verbatim.toLocaleString()} of ${(verbatim + relocated).toLocaleString()} tagged verses (${((verbatim / Math.max(1, verbatim + relocated)) * 100).toFixed(2)}%)`);
if (relocated) console.log(`Found word by word:     ${relocated} verses, e.g. ${drifted.join(', ')}`);
console.log(`Tagged words:           ${wordsRead.toLocaleString()}`);
console.log(`Links written:          ${wordsLinked.toLocaleString()}` +
  (wordsMissed ? `, ${wordsMissed} not found in the pack text` : '') +
  (wordsUntagged ? `, ${wordsUntagged} with no usable number` : ''));
console.log(`Verses with links:      ${rows.length.toLocaleString()} of ${tagged.toLocaleString()}`);

// ── Original forms ──────────────────────────────────────────────────────────

console.log('\nReading Greek and Hebrew spellings from ancient-languages.sqlite...');
const ancient = new Database(ANCIENT_PATH, { readonly: true });
const tally = new Map(); // key -> { lang, counts: Map<id, n> }
for (const r of ancient.prepare("SELECT translation_id, text, strongs FROM words WHERE translation_id IN ('byz', 'tr', 'hebrew-oshb')").iterate()) {
  const id = classicId(r.strongs);
  if (!id) continue;
  const lang = r.translation_id === 'hebrew-oshb' ? 'hebrew' : 'greek';
  const key = lang === 'hebrew' ? hebrewKey(r.text) : greekKey(r.text);
  if (!key) continue;
  let entry = tally.get(key);
  if (!entry) tally.set(key, (entry = { lang, counts: new Map() }));
  entry.counts.set(id, (entry.counts.get(id) ?? 0) + 1);
}
ancient.close();
const forms = [];
for (const [key, { lang, counts }] of tally) {
  let best = null;
  let bestN = 0;
  for (const [id, n] of counts) if (n > bestN) { best = id; bestN = n; }
  forms.push({ key, lang, strongs: best });
}
console.log(`Spellings:              ${forms.filter((f) => f.lang === 'greek').length.toLocaleString()} Greek, ${forms.filter((f) => f.lang === 'hebrew').length.toLocaleString()} Hebrew`);

// ── Write, merging into the pack ────────────────────────────────────────────

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const out = new Database(OUT_PATH);
out.exec(`
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS word_links (
    translation_id TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    links TEXT NOT NULL,
    PRIMARY KEY (translation_id, book, chapter, verse)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS original_forms (
    key TEXT PRIMARY KEY,
    lang TEXT NOT NULL,
    strongs TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS credits (translation_id TEXT PRIMARY KEY, credit TEXT NOT NULL);
`);

out.transaction(() => {
  out.prepare('DELETE FROM word_links WHERE translation_id = ?').run(only);
  const insertLink = out.prepare('INSERT INTO word_links (translation_id, book, chapter, verse, links) VALUES (?, ?, ?, ?, ?)');
  for (const r of rows) insertLink.run(only, r.book, r.chapter, r.verse, r.links);

  out.prepare('DELETE FROM original_forms').run();
  const insertForm = out.prepare('INSERT INTO original_forms (key, lang, strongs) VALUES (?, ?, ?)');
  for (const f of forms) insertForm.run(f.key, f.lang, f.strongs);

  out.prepare('INSERT OR REPLACE INTO credits (translation_id, credit) VALUES (?, ?)').run(only, source.credit);
  const covered = out.prepare('SELECT translation_id, credit FROM credits ORDER BY translation_id').all();

  const meta = {
    pack_id: 'word-links',
    pack_type: 'word-links',
    version: '1.0.0',
    name: 'Word Links',
    description: 'Which English words translate which Greek or Hebrew word',
    translations: covered.map((c) => c.translation_id).join(','),
    license: 'Public domain tags; original-language spellings from OSHB (CC BY 4.0)',
    attribution: [
      ...covered.map((c) => c.credit),
      'Greek and Hebrew spellings: Robinson-Pierpont and Scrivener (public domain); Open Scriptures Hebrew Bible (CC BY 4.0).',
    ].join(' '),
    createdAt: new Date().toISOString(),
  };
  const insertMeta = out.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  for (const [k, value] of Object.entries(meta)) insertMeta.run(k, value);
})();

// ── Spot checks ─────────────────────────────────────────────────────────────

const CHECKS = [
  { ref: ['John', 3, 16], id: 'G0025', want: 'loved' },
  { ref: ['Genesis', 1, 1], id: 'H1254', want: 'created' },
  { ref: ['Psalms', 23, 1], id: 'H3068', want: 'LORD' },
  { ref: ['Malachi', 4, 5], id: 'H0452', want: 'Elijah' },
];
console.log('\nSpot checks:');
let failed = 0;
const getLinks = out.prepare('SELECT links FROM word_links WHERE translation_id = ? AND book = ? AND chapter = ? AND verse = ?');
for (const { ref, id, want } of CHECKS) {
  const stored = packText.get(ref.join('|')) ?? '';
  const { text } = cleanWithIndex(stored);
  const row = getLinks.get(only, ...ref);
  const hits = (row?.links ?? '').split(';').filter(Boolean)
    .map((l) => l.split(','))
    .filter(([, , ids]) => ids.split('+').includes(id))
    .map(([s, len]) => text.slice(+s, +s + +len));
  // KJV tags phrases ("you Elijah", "the world"), so the word only has to be in one.
  const ok = hits.some((h) => new RegExp(`\\b${want}\\b`).test(h));
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${ref[0]} ${ref[1]}:${ref[2]} ${id}: ${hits.length ? hits.map((h) => `"${h}"`).join(', ') : '(none)'}`);
}
const allLinks = out.prepare('SELECT translation_id, COUNT(*) AS verses FROM word_links GROUP BY translation_id').all();
out.exec('VACUUM');
out.close();

console.log(`\nIn the pack: ${allLinks.map((r) => `${r.translation_id} ${r.verses.toLocaleString()} verses`).join(', ')}`);
console.log(`✅ ${OUT_PATH} (${(statSync(OUT_PATH).size / 1024 / 1024).toFixed(2)} MB)`);
if (failed) {
  console.error(`\n❌ ${failed} spot check(s) failed`);
  process.exit(1);
}
