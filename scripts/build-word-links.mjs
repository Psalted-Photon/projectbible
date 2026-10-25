#!/usr/bin/env node

/**
 * Build the Word Links pack: which English words in a verse translate which
 * Greek or Hebrew word.
 *
 * Each translation is added on its own and merged into the one pack file, so
 * rebuilding one leaves the others as they were. Run kjv first: the WEB and
 * NET filters read its links.
 *
 *   node scripts/build-word-links.mjs --only kjv|bsb|web|net
 *
 * - KJV: eBible's USFX, where every translated word carries the Strong's
 *   number it renders (<w s="G0025">loved</w>). Kept as tagged.
 * - BSB: the Berean translators' own tables (bereanbible.com/bsb_tables.tsv,
 *   public domain), one English fragment per Greek or Hebrew word, found in
 *   the BSB text in reading order.
 * - WEB and NET: their sources tag words too, but by machine and often wrong
 *   (WEB Genesis 1:1 tags "In" as heaven). A tag is kept only when its number
 *   is in that verse's Greek (BYZ for WEB, SBLGNT for NET) or Hebrew, and the
 *   English word is one that number can mean. A number whose tags all fail
 *   gets a link only when its meaning matches exactly one word in the verse,
 *   or as many words as the Greek or Hebrew uses it (3 John 1:3's two
 *   "truth"s for its two G0225s). When its meanings match too many, its
 *   headword alone gets the same test (3 John 1:12: G0225 "truth", G0227
 *   "true").
 * - A tag whose English isn't among the number's meanings still counts when
 *   it is a word built on one (faithful → faithfulness), or a word BSB and KJV
 *   give that number at least 3 times and 3% of the time. Run kjv and bsb
 *   before web and net.
 *
 * Offsets are measured on the verse's clean text exactly as the app measures
 * it (scripts/lib/clean-text.mjs), and each source is checked against the
 * shipped pack. Rebuilding the KJV, WEB, BSB or NET pack means running this
 * again, as with align-red-letter.mjs (and web and net again after kjv or bsb).
 *
 * The pack also carries original_forms: every Greek and Hebrew spelling in the
 * ancient-languages pack, folded the way the Strong's list folds it, with the
 * number it most often stands for. The gloss popup (Phase 11) reads it.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { produceUSFXVerses } from '../packages/packtools/src/parsers/build-usfx-pack.mjs';
import { WORD_OPEN, WORD_SEP, WORD_CLOSE } from '../packages/packtools/src/parsers/usfm-scanner.mjs';
import { readBooks as readNetBooks } from './build-net-pack.mjs';
import { cleanWithIndex, locateVerbatim } from './lib/clean-text.mjs';
import { FUNCTION_WORDS, NEVER_MARKED, derive, headwordsOf, inflect, patternFor, vocabularyOf } from './lib/gloss-match.mjs';
import { fromEnglish, toEnglish } from './lib/versification.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const OUT_DIR = join(repoRoot, 'packs/consolidated');
const OUT_PATH = join(OUT_DIR, 'word-links.sqlite');
const ANCIENT_PATH = join(OUT_DIR, 'ancient-languages.sqlite');
const CRITICAL_PATH = join(OUT_DIR, 'greek-critical.sqlite');
const LEXICAL_PATH = join(OUT_DIR, 'lexical.sqlite');
const BSB_TABLES = join(repoRoot, 'data-sources/berean-tables/bsb_tables.tsv');

const SOURCES = {
  kjv: {
    pack: join(repoRoot, 'packs/kjv.sqlite'),
    credit: 'KJV word tags: eBible.org King James Version with Strong’s numbers (public domain).',
    build: (packText) =>
      fromTags(
        produceUSFXVerses(join(repoRoot, 'data-sources/kjv-usfx/eng-kjv_usfx.xml'), { strongsSentinels: true }).verses,
        packText,
      ).rows,
    checks: [
      { ref: ['John', 3, 16], id: 'G0025', want: 'loved' },
      { ref: ['Genesis', 1, 1], id: 'H1254', want: 'created' },
      { ref: ['Psalms', 23, 1], id: 'H3068', want: 'LORD' },
      { ref: ['Malachi', 4, 5], id: 'H0452', want: 'Elijah' },
    ],
  },
  bsb: {
    pack: join(repoRoot, 'packs/bsb.sqlite'),
    credit: 'BSB word links: Berean Standard Bible translation tables, bereanbible.com (public domain).',
    build: (packText) => fromBereanTables(packText),
    checks: [
      { ref: ['John', 3, 16], id: 'G0025', want: 'loved' },
      { ref: ['Genesis', 1, 1], id: 'H1254', want: 'created' },
      { ref: ['Psalms', 23, 1], id: 'H3068', want: 'LORD' },
      { ref: ['Malachi', 4, 5], id: 'H0452', want: 'Elijah' },
    ],
  },
  web: {
    pack: join(repoRoot, 'packs/web.sqlite'),
    credit: 'WEB word tags: eBible.org World English Bible with Strong’s numbers (public domain), checked against the Greek and Hebrew.',
    build: (packText) =>
      filterTags(
        fromTags(
          produceUSFXVerses(join(repoRoot, 'data-sources/web-usfx/eng-web_usfx.xml'), { strongsSentinels: true }).verses,
          packText,
        ).entries,
        { scheme: 'web', greek: { db: ANCIENT_PATH, id: 'byz', scheme: 'majority' } },
      ),
    checks: [
      { ref: ['Genesis', 1, 1], id: 'H1254', want: 'created' },
      { ref: ['Genesis', 1, 1], id: 'H7225', want: 'beginning' },
      { ref: ['John', 3, 16], id: 'G2889', want: 'world' },
      { ref: ['Psalms', 23, 1], id: 'H3068', want: 'Yahweh' },
    ],
  },
  net: {
    pack: join(repoRoot, 'packs/net.sqlite'),
    credit: 'NET word tags: NET Bible® USFM with Strong’s numbers, checked against the Greek and Hebrew.',
    build: (packText) =>
      filterTags(
        fromTags(
          readNetBooks({ strongsSentinels: true }, { quiet: true }).flatMap((b) =>
            b.verses.map((v) => ({ book: b.name, ...v })),
          ),
          packText,
        ).entries,
        { scheme: 'english', greek: { db: CRITICAL_PATH, id: 'sblgnt', scheme: 'english' } },
      ),
    checks: [
      { ref: ['Genesis', 1, 1], id: 'H1254', want: 'created' },
      { ref: ['John', 3, 16], id: 'G2889', want: 'world' },
      { ref: ['John', 3, 16], id: 'G0025', want: 'loved' },
      { ref: ['Psalms', 23, 1], id: 'H3068', want: 'LORD' },
    ],
  },
};

const only = (() => {
  const at = process.argv.indexOf('--only');
  return at >= 0 ? process.argv[at + 1] : null;
})();
if (!only || !SOURCES[only]) {
  console.error(`Usage: node scripts/build-word-links.mjs --only ${Object.keys(SOURCES).join('|')}`);
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

const verseKey = (book, chapter, verse) => `${book}|${chapter}|${verse}`;

/** Links that share a span become one, with both numbers. */
function mergeSpans(links) {
  const bySpan = new Map();
  for (const l of links) {
    const k = `${l.s},${l.e}`;
    const ids = bySpan.get(k) ?? [];
    for (const id of l.ids.split('+')) if (!ids.includes(id)) ids.push(id);
    bySpan.set(k, ids);
  }
  return [...bySpan]
    .map(([k, ids]) => {
      const [s, e] = k.split(',').map(Number);
      return { s, e, ids: ids.join('+') };
    })
    .sort((a, b) => a.s - b.s || a.e - b.e);
}

/** A seeded shuffle, so the report's samples are the same run to run. */
function sample(list, n) {
  let seed = 20261015;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

const pct = (a, b) => `${((a / Math.max(1, b)) * 100).toFixed(2)}%`;

// ── Tagged sources: KJV, WEB, NET ───────────────────────────────────────────

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

/**
 * Every tag placed on the pack's clean text: `entries` (one per verse, with
 * its clean text and tag links) and `rows` (the verses with links, ready to
 * write).
 */
function fromTags(verses, packText) {
  const entries = [];
  let verbatim = 0;
  let relocated = 0;
  let notInPack = 0;
  let wordsRead = 0;
  let wordsLinked = 0;
  let wordsMissed = 0;
  let wordsUntagged = 0;
  const drifted = [];

  for (const v of verses) {
    const key = verseKey(v.book, v.chapter, v.verse);
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
    links.sort((a, b) => a.s - b.s);
    entries.push({ book: v.book, chapter: v.chapter, verse: v.verse, text: clean.text, links });
  }

  console.log(`Verses read:            ${verses.length.toLocaleString()}` + (notInPack ? ` (${notInPack} not in the pack)` : ''));
  console.log(`Text matches the pack:  ${verbatim.toLocaleString()} of ${(verbatim + relocated).toLocaleString()} tagged verses (${pct(verbatim, verbatim + relocated)})`);
  if (relocated) console.log(`Found word by word:     ${relocated} verses, e.g. ${drifted.join(', ')}`);
  console.log(`Tagged words:           ${wordsRead.toLocaleString()}`);
  console.log(`Tags placed:            ${wordsLinked.toLocaleString()}` +
    (wordsMissed ? `, ${wordsMissed} not found in the pack text` : '') +
    (wordsUntagged ? `, ${wordsUntagged} with no usable number` : ''));

  const rows = entries.filter((e) => e.links.length).map((e) => ({ ...e }));
  return { entries, rows };
}

// ── BSB: the Berean tables ──────────────────────────────────────────────────

const TABLE_BOOK = { Psalm: 'Psalms' };

/**
 * The tables list each verse's Greek or Hebrew words in BSB order, each with
 * the English fragment it became. Fragments are found in the pack's clean text
 * from a moving cursor. Words the translators supplied are in [brackets] and
 * are trimmed off a fragment's ends, so "[was] good" links "good".
 */
function fromBereanTables(packText) {
  if (!existsSync(BSB_TABLES)) {
    console.error(`❌ Berean tables not found: ${BSB_TABLES}\n   Download https://bereanbible.com/bsb_tables.tsv there.`);
    process.exit(1);
  }
  const lines = readFileSync(BSB_TABLES, 'utf8').split(/\r?\n/);
  const header = lines[0].split('\t').map((h) => h.trim());
  const col = (name) => {
    const at = header.indexOf(name);
    if (at < 0) throw new Error(`Berean tables: no "${name}" column`);
    return at;
  };
  const C = {
    verse: col('Verse'),
    lang: col('Language'),
    heb: col('Str Heb'),
    grk: col('Str Grk'),
    ref: col('VerseId'),
    english: col('BSB version'),
  };

  // Group rows by verse, in file (BSB) order.
  const groups = new Map();
  const refs = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split('\t');
    if (c.length <= C.english) continue;
    const n = c[C.verse];
    if (!n) continue;
    if (c[C.ref]) refs.set(n, c[C.ref]);
    let list = groups.get(n);
    if (!list) groups.set(n, (list = []));
    list.push(c);
  }

  const rows = [];
  const byBook = new Map();
  let fragments = 0;
  let found = 0;
  let supplied = 0;
  let noNumber = 0;
  let notInPack = 0;
  const missed = [];

  for (const [n, list] of groups) {
    const m = /^(.+) (\d+):(\d+)$/.exec(refs.get(n) ?? '');
    if (!m) continue;
    const book = TABLE_BOOK[m[1]] ?? m[1];
    const chapter = Number(m[2]);
    const verse = Number(m[3]);
    const stored = packText.get(verseKey(book, chapter, verse));
    if (stored === undefined) { notInPack++; continue; }
    const { text } = cleanWithIndex(stored);
    const tally = byBook.get(book) ?? { fragments: 0, found: 0 };
    byBook.set(book, tally);

    const links = [];
    let cursor = 0;
    for (const c of list) {
      // "-" (no English of its own), ". . ." and "vvv" (English given with
      // another word) have nothing to find.
      const raw = c[C.english].replace(/<[^>]*>/g, ' ').replace(/\bvvv\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (!/\p{L}/u.test(raw)) continue;
      const lang = c[C.lang];
      const num = lang === 'Greek' ? c[C.grk] : c[C.heb];
      const id = /^\d+$/.test(num ?? '') ? classicId(`${lang === 'Greek' ? 'G' : 'H'}${num}`) : null;
      // Supplied words at the ends come off; a fragment that is all supplied
      // has no word of the original behind it.
      const lead = /^\[([^\]]*)\]\s*/.exec(raw);
      const trail = /\s*\[([^\]]*)\]$/.exec(raw);
      const allSupplied = !!lead && lead[0].length === raw.length;
      const linkable = id && !allSupplied;
      if (linkable) {
        fragments++;
        tally.fragments++;
      }

      // Every fragment is found, linked or not, so the cursor keeps up with
      // the reading.
      const search = raw.replace(/[[\]{}]/g, '');
      let at = locateVerbatim(search, text, cursor);
      // Words of the verse skipped over means the fragment matched too far
      // ahead; trust that only when the fragment can't be anywhere else.
      if (at && /\p{L}/u.test(text.slice(cursor, at.s))) {
        const first = locateVerbatim(search, text, 0);
        const again = first && locateVerbatim(search, text, first.s + 1);
        if (again) at = null;
      }
      if (at) cursor = at.e;
      if (!id) { noNumber++; continue; }
      if (allSupplied) { supplied++; continue; }
      if (!at) {
        if (missed.length < 400) missed.push(`${book} ${chapter}:${verse} "${raw}"`);
        continue;
      }
      let { s, e } = at;
      const skip = (from, count, step) => {
        let k = from;
        for (let left = count; left > 0 && k >= 0 && k <= text.length; k += step) {
          if (!/\s/.test(text[step > 0 ? k : k - 1])) left--;
        }
        return k;
      };
      if (lead) s = skip(s, lead[1].replace(/\s+/g, '').length, 1);
      if (trail && !(lead && trail.index === 0)) e = skip(e, trail[1].replace(/\s+/g, '').length, -1);
      while (s < e && /[\s,;:.!?]/.test(text[s])) s++;
      while (e > s && /[\s,;:]/.test(text[e - 1])) e--;
      if (e <= s) { supplied++; continue; }
      links.push({ s, e, ids: id });
      found++;
      tally.found++;
    }
    if (links.length) rows.push({ book, chapter, verse, links: mergeSpans(links) });
  }

  console.log(`Verses in the tables:   ${groups.size.toLocaleString()}` + (notInPack ? ` (${notInPack} not in the pack)` : ''));
  console.log(`Fragments found:        ${found.toLocaleString()} of ${fragments.toLocaleString()} (${pct(found, fragments)})`);
  console.log(`Left out:               ${supplied.toLocaleString()} supplied words only, ${noNumber.toLocaleString()} with no number`);
  console.log('\nBy book (below 99% shown):');
  let low = 0;
  for (const [book, t] of byBook) {
    if (t.found / Math.max(1, t.fragments) >= 0.99) continue;
    low++;
    console.log(`  ${book.padEnd(16)} ${pct(t.found, t.fragments)} (${t.fragments - t.found} missed)`);
  }
  if (!low) console.log('  every book at 99% or more');
  const worst = Math.min(...[...byBook.values()].map((t) => t.found / Math.max(1, t.fragments)));
  console.log(`Lowest book:            ${(worst * 100).toFixed(2)}%`);
  if (missed.length) {
    console.log(`\nMissed fragments (first ${Math.min(25, missed.length)}):`);
    for (const line of missed.slice(0, 25)) console.log(`  ${line}`);
  }
  if (found / Math.max(1, fragments) < 0.95) {
    console.error('\n❌ Under 95% of fragments found; the tables and the pack have drifted apart.');
    process.exit(1);
  }
  return rows;
}

// ── WEB and NET: tags checked against the Greek and Hebrew ──────────────────

/** Every number in each verse of a words table, by that table's numbering. */
function originalNumbers(path, translationId) {
  const db = new Database(path, { readonly: true });
  const out = new Map();
  for (const r of db.prepare('SELECT book, chapter, verse, strongs FROM words WHERE translation_id = ?').iterate(translationId)) {
    const k = verseKey(r.book, r.chapter, r.verse);
    let counts = out.get(k);
    if (!counts) out.set(k, (counts = new Map()));
    const ids = new Set((r.strongs ?? '').split(/[\s,+/]+/).map(classicId).filter(Boolean));
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  db.close();
  return out;
}

/**
 * Each number's vocabulary as a pattern, with its split meanings' renderings;
 * its headword alone as a pattern; and the words built on its one-word
 * meanings (derive()).
 */
function lexiconPatterns() {
  const db = new Database(LEXICAL_PATH, { readonly: true });
  const phrases = new Map();
  const headwords = new Map();
  const add = (map, id, list) => map.set(id, [...(map.get(id) ?? []), ...list]);
  for (const table of ['greek_strongs_entries', 'hebrew_strongs_entries']) {
    for (const r of db.prepare(`SELECT id, shortDefinition, kjvUsage FROM ${table}`).iterate()) {
      const id = classicId(r.id);
      if (!id) continue;
      add(phrases, id, vocabularyOf(r));
      add(headwords, id, headwordsOf(r));
    }
  }
  db.close();
  const cached = (map) => {
    const patterns = new Map();
    return (id) => {
      if (!patterns.has(id)) patterns.set(id, patternFor([...new Set(map.get(id) ?? [])]));
      return patterns.get(id);
    };
  };
  const oneWord = (id) => (phrases.get(id) ?? []).filter((p) => !/[ -]/.test(p));
  const derived = new Map();
  const forms = new Map();
  return {
    patternOf: cached(phrases),
    headwordPatternOf: cached(headwords),
    derivedOf: (id) => {
      if (!derived.has(id)) derived.set(id, new Set(oneWord(id).flatMap(derive)));
      return derived.get(id);
    },
    // A plain list, not a pattern: a pattern compiled for every number in
    // every verse runs V8 out of room for compiled code.
    wordFormsOf: (id) => {
      if (!forms.has(id)) {
        const words = (phrases.get(id) ?? []).flatMap((p) => p.toLowerCase().split(/[ -]/));
        forms.set(id, new Set(words.filter((w) => w.length >= 3 && !FUNCTION_WORDS.has(w)).flatMap(inflect)));
      }
      return forms.get(id);
    },
  };
}

/** Helping verbs in KJV phrases ("shall fall", "have fallen"): never a number's own word. */
const AUXILIARIES = new Set(
  ('have has had hath hast having shall shalt will wilt would wouldest should shouldest ' +
    'may mayest might must let being can could cannot did doth dost does')
    .split(' '),
);

/** The words KJV links to each number in each verse, with their endings. */
function kjvVocabulary() {
  const out = new Map();
  if (!existsSync(OUT_PATH)) return out;
  const db = new Database(OUT_PATH, { readonly: true });
  const has = db.prepare("SELECT 1 FROM word_links WHERE translation_id = 'kjv' LIMIT 1").get();
  if (!has) {
    db.close();
    return out;
  }
  const kjv = new Database(SOURCES.kjv.pack, { readonly: true });
  const getText = kjv.prepare('SELECT text FROM verses WHERE book = ? AND chapter = ? AND verse = ?');
  for (const r of db.prepare("SELECT book, chapter, verse, links FROM word_links WHERE translation_id = 'kjv'").iterate()) {
    const { text } = cleanWithIndex(getText.get(r.book, r.chapter, r.verse)?.text ?? '');
    const byId = new Map();
    for (const part of r.links.split(';')) {
      const [s, len, ids] = part.split(',');
      const words = text.slice(+s, +s + +len).toLowerCase().match(/[\p{L}']+/gu) ?? [];
      for (const w of words) {
        if (w.length < 3 || FUNCTION_WORDS.has(w) || AUXILIARIES.has(w)) continue;
        for (const id of ids.split('+')) {
          const set = byId.get(id) ?? new Set();
          for (const form of inflect(w)) set.add(form);
          byId.set(id, set);
        }
      }
    }
    out.set(verseKey(r.book, r.chapter, r.verse), byId);
  }
  kjv.close();
  db.close();
  return out;
}

/**
 * The words BSB and KJV give each number across the Bible, kept when they
 * give it as a one-word link at least 3 times and 3% of the time, with their
 * endings.
 */
function commonRenderings() {
  const out = new Map();
  if (!existsSync(OUT_PATH)) return out;
  const db = new Database(OUT_PATH, { readonly: true });
  const counts = new Map();
  const totals = new Map();
  for (const t of ['bsb', 'kjv']) {
    const pack = new Database(SOURCES[t].pack, { readonly: true });
    const getText = pack.prepare('SELECT text FROM verses WHERE book = ? AND chapter = ? AND verse = ?');
    for (const r of db.prepare('SELECT book, chapter, verse, links FROM word_links WHERE translation_id = ?').iterate(t)) {
      const { text } = cleanWithIndex(getText.get(r.book, r.chapter, r.verse)?.text ?? '');
      for (const part of r.links.split(';')) {
        const [s, len, ids] = part.split(',');
        const words = (text.slice(+s, +s + +len).toLowerCase().match(/[\p{L}']+/gu) ?? []).filter(
          (w) => w.length >= 3 && !FUNCTION_WORDS.has(w) && !AUXILIARIES.has(w),
        );
        for (const id of ids.split('+')) {
          totals.set(id, (totals.get(id) ?? 0) + 1);
          // Only a link that is one word: "gave ... to drink" doesn't make
          // "gave" a word for "water".
          if (words.length !== 1) continue;
          const byWord = counts.get(id) ?? new Map();
          byWord.set(words[0], (byWord.get(words[0]) ?? 0) + 1);
          counts.set(id, byWord);
        }
      }
    }
    pack.close();
  }
  db.close();
  for (const [id, byWord] of counts) {
    const set = new Set();
    for (const [w, n] of byWord) {
      if (n >= 3 && n / totals.get(id) >= 0.03) for (const form of inflect(w)) set.add(form);
    }
    if (set.size) out.set(id, set);
  }
  return out;
}

/** Where a number's English sits in `text`: its vocabulary, then KJV's words for it here. */
function meaningSpans(text, pattern, kjvWords) {
  const spans = [];
  if (pattern) {
    for (const m of text.matchAll(pattern)) spans.push({ s: m.index, e: m.index + m[0].length });
  }
  if (kjvWords) {
    for (const m of text.matchAll(/[\p{L}']+/gu)) {
      if (!kjvWords.has(m[0].toLowerCase())) continue;
      const span = { s: m.index, e: m.index + m[0].length };
      if (!spans.some((x) => x.s <= span.s && span.e <= x.e)) spans.push(span);
    }
  }
  return spans;
}

const overlaps = (a, b) => a.s < b.e && b.s < a.e;

function filterTags(entries, { scheme, greek }) {
  console.log('\nReading the Greek and Hebrew words...');
  const hebrew = originalNumbers(ANCIENT_PATH, 'hebrew-oshb');
  const greekWords = originalNumbers(greek.db, greek.id);
  const { patternOf, headwordPatternOf, derivedOf, wordFormsOf } = lexiconPatterns();
  const kjv = kjvVocabulary();
  if (!kjv.size) console.warn('⚠️  No KJV links in the pack yet; run --only kjv first for the fullest check.');
  const common = commonRenderings();
  if (!common.size) console.warn('⚠️  No BSB or KJV links in the pack yet; run --only kjv and --only bsb first.');
  // A word built on a meaning, or one BSB and KJV commonly give the number.
  const widerCache = new Map();
  const widerWords = (id) => {
    if (!widerCache.has(id)) widerCache.set(id, new Set([...derivedOf(id), ...(common.get(id) ?? [])]));
    return widerCache.get(id);
  };

  const dropped = { stop: [], notInVerse: [], meaning: [] };
  const kept = [];
  const keptWider = [];
  const added = [];
  const addedByHeadword = [];
  let tagsRead = 0;
  const rows = [];

  for (const v of entries) {
    const ref = { book: v.book, chapter: v.chapter, verse: v.verse };
    const english = toEnglish(scheme, ref);
    // Each number in the Greek or Hebrew, with how many words use it.
    const inVerse = new Map();
    const seen = new Set();
    const tally = (words, lang, r) => {
      const k = verseKey(r.book, r.chapter, r.verse);
      if (seen.has(`${lang}|${k}`)) return;
      seen.add(`${lang}|${k}`);
      for (const [id, n] of words.get(k) ?? []) inVerse.set(id, (inVerse.get(id) ?? 0) + n);
    };
    for (const e of english) {
      for (const h of fromEnglish('hebrew', e)) tally(hebrew, 'hebrew', h);
      for (const g of fromEnglish(greek.scheme, e)) tally(greekWords, 'greek', g);
    }
    const kjvHere = new Map();
    for (const e of english) {
      for (const [id, words] of kjv.get(verseKey(e.book, e.chapter, e.verse)) ?? []) {
        const set = kjvHere.get(id) ?? new Set();
        for (const w of words) set.add(w);
        kjvHere.set(id, set);
      }
    }
    const where = `${v.book} ${v.chapter}:${v.verse}`;

    const links = [];
    for (const tag of v.links) {
      const word = v.text.slice(tag.s, tag.e);
      for (const id of tag.ids.split('+')) {
        tagsRead++;
        const note = { where, id, word };
        if (NEVER_MARKED.has(id)) { dropped.stop.push(note); continue; }
        if (!inVerse.has(id)) { dropped.notInVerse.push(note); continue; }
        let hit = meaningSpans(word, patternOf(id), kjvHere.get(id))[0];
        const wider = !hit;
        if (wider) hit = meaningSpans(word, null, widerWords(id))[0];
        // A looser match gives way to a number in the verse that means the
        // word outright (1 Chronicles 2:17 "father": H0001, not H3205 beget).
        if (hit && wider) {
          const found = word.slice(hit.s, hit.e).toLowerCase();
          const outright = [...inVerse.keys()].some((other) =>
            other !== id && !NEVER_MARKED.has(other) && (wordFormsOf(other).has(found) || !!kjvHere.get(other)?.has(found)));
          if (outright) hit = undefined;
        }
        if (!hit) { dropped.meaning.push(note); continue; }
        links.push({ s: tag.s + hit.s, e: tag.s + hit.e, ids: id });
        kept.push({ ...note, word: word.slice(hit.s, hit.e) });
        if (wider) keptWider.push(kept[kept.length - 1]);
      }
    }

    // Numbers with no link left: one only when its meaning matches exactly
    // one word in the verse, or exactly as many words as the original uses
    // the number, and no other number claims those words. Two one-word
    // claims on the same word both lose; a several-word claim gives way to
    // any other claim it touches, all its words together.
    const linked = new Set(links.flatMap((l) => l.ids.split('+')));
    const claims = [];
    for (const [id, count] of inVerse) {
      if (linked.has(id) || NEVER_MARKED.has(id)) continue;
      let spans = meaningSpans(v.text, patternOf(id), kjvHere.get(id));
      let byHeadword = false;
      if (spans.length > count) {
        spans = meaningSpans(v.text, headwordPatternOf(id), null);
        byHeadword = true;
      }
      if (spans.length !== 1 && spans.length !== count) continue;
      if (spans.some((sp) => links.some((l) => overlaps(l, sp)))) continue;
      claims.push({ id, spans, byHeadword });
    }
    const contested = (c, others) =>
      others.some((o) => o !== c && o.spans.some((a) => c.spans.some((b) => overlaps(a, b))));
    // A claim by headword gives way to any claim it touches, as a several-word
    // one does, and never knocks out a claim by full meaning.
    const regular = claims.filter((c) => !c.byHeadword);
    const singles = regular.filter((c) => c.spans.length === 1);
    for (const c of claims) {
      const lost = c.byHeadword ? contested(c, claims) : c.spans.length === 1 ? contested(c, singles) : contested(c, regular);
      if (lost) continue;
      for (const sp of c.spans) {
        links.push({ ...sp, ids: c.id });
        added.push({ where, id: c.id, word: v.text.slice(sp.s, sp.e) });
        if (c.byHeadword) addedByHeadword.push(added[added.length - 1]);
      }
    }

    if (links.length) rows.push({ book: v.book, chapter: v.chapter, verse: v.verse, links: mergeSpans(links) });
  }

  const droppedCount = dropped.stop.length + dropped.notInVerse.length + dropped.meaning.length;
  console.log(`Tags checked:           ${tagsRead.toLocaleString()}`);
  console.log(`Kept:                   ${kept.length.toLocaleString()} (${pct(kept.length, tagsRead)})`);
  console.log(`  by wider meaning:     ${keptWider.length.toLocaleString()} (a word built on a meaning, or one BSB and KJV give it)`);
  console.log(`Dropped:                ${droppedCount.toLocaleString()}`);
  console.log(`  never marked:         ${dropped.stop.length.toLocaleString()} (the article, "and", the object marker)`);
  console.log(`  not in the verse:     ${dropped.notInVerse.length.toLocaleString()} (number missing from the Greek or Hebrew)`);
  console.log(`  wrong meaning:        ${dropped.meaning.length.toLocaleString()} (English word isn't one the number means)`);
  console.log(`Added by meaning:       ${added.length.toLocaleString()} (one clear match in the verse, or one per use in the original)`);
  console.log(`  by headword:          ${addedByHeadword.length.toLocaleString()} (its meanings matched too many words; its headword alone didn't)`);
  const show = (title, list) => {
    console.log(`\n${title}:`);
    for (const x of sample(list, 20)) console.log(`  ${x.where.padEnd(22)} ${x.id}  "${x.word}"`);
  };
  show('20 kept', kept);
  show('20 kept by wider meaning', keptWider);
  show('20 dropped for meaning', dropped.meaning);
  show('20 dropped as not in the verse', dropped.notInVerse);
  show('20 added by meaning', added);
  show('20 added by headword', addedByHeadword);
  return rows;
}

// ── Build ───────────────────────────────────────────────────────────────────

const source = SOURCES[only];
console.log(`🔗 Word Links: ${only.toUpperCase()}\n`);

const packDb = new Database(source.pack, { readonly: true });
const packText = new Map();
for (const r of packDb.prepare('SELECT book, chapter, verse, text FROM verses').all()) {
  packText.set(verseKey(r.book, r.chapter, r.verse), r.text);
}
packDb.close();

const rows = source.build(packText).map((r) => ({
  book: r.book,
  chapter: r.chapter,
  verse: r.verse,
  links: r.links.map((l) => `${l.s},${l.e - l.s},${l.ids}`).join(';'),
}));
const linkCount = rows.reduce((n, r) => n + r.links.split(';').length, 0);
console.log(`\nLinks written:          ${linkCount.toLocaleString()} in ${rows.length.toLocaleString()} verses`);

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

console.log('\nSpot checks:');
let failed = 0;
const getLinks = out.prepare('SELECT links FROM word_links WHERE translation_id = ? AND book = ? AND chapter = ? AND verse = ?');
for (const { ref, id, want } of source.checks) {
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
