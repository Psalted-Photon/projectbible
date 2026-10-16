#!/usr/bin/env node
/**
 * "Related words by meaning" for the Hebrew Strong's entries — the Hebrew
 * counterpart of add-semantic-domains.mjs, which does the Greek.
 *
 * MACULA Hebrew (Clear Bible, CC BY 4.0) tags each Old Testament word with its
 * SDBH lexical domain (a hierarchical code such as 002001002018) and, for many
 * words, an SDBH core domain (a flat code such as 004). Download its word table
 * once into data-sources/macula-hebrew/ — it is source data, never shipped:
 *   https://github.com/Clear-Bible/macula-hebrew  →  WLC/tsv/macula-hebrew.tsv
 *
 * Written into the app as a small JSON file of ids rather than into the lexical
 * pack: a pack change would make every reader re-download 372 MB. The app
 * reads each id's lemma and gloss from the lexicon it already has.
 *
 * What the data forced, beyond the Greek script's rules:
 *
 * 1. SDBH's lexical domains are broad — the exact code alone puts a median of
 *    73 words beside each one. The words sharing both the lexical domain and a
 *    core domain are the same sense; the rest of the lexical domain is nearby.
 *    A word with no core domain has only the one tier to offer, so all of its
 *    lexical domain counts as the same sense.
 *
 * 2. SDBH is unfinished: some common verbs (to be, to come, to give, to hear)
 *    carry no tags at all, and a few function words carry a handful. A domain
 *    has to cover a quarter of *all* a word's uses, not a quarter of its tagged
 *    ones, or אֶל "to" would be grouped on the strength of 3 stray tags in 5,000.
 *
 * 3. MACULA's numbers are not always the lexicon's. Its lettered ids follow a
 *    different scheme (0871a is the prefix בְּ; the lexicon's H0871 is
 *    Atharim), and a few plain ones name a different word. A number is used
 *    only when its lemma's letters agree with the lexicon's.
 *
 * Usage: node scripts/build-hebrew-sense-groups.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const repoRoot = path.resolve('.');
const TSV = path.join(repoRoot, 'data-sources', 'macula-hebrew', 'macula-hebrew.tsv');
const LEXICON = path.join(repoRoot, 'packs', 'strongs-hebrew.sqlite');
const OUT = path.join(repoRoot, 'apps', 'pwa-polished', 'src', 'data', 'strongs-related-hebrew.json');

/** A domain must account for this much of a word's uses to count as one of
 *  its meanings rather than an incidental sense. Same as the Greek. */
const DOMINANT = 0.25;
const MAX_SENSE = 8;
const MAX_AREA = 10;

for (const p of [TSV, LEXICON]) {
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing ${p}`);
    process.exit(1);
  }
}

// --- The lexicon ------------------------------------------------------------

const lexDb = new Database(LEXICON, { readonly: true });
const lexicon = new Map(
  lexDb
    .prepare("SELECT id, lemma, shortDefinition, partOfSpeech FROM strongs_entries WHERE id GLOB 'H[0-9][0-9][0-9][0-9]*'")
    .all()
    .map((r) => [r.id, r]),
);
lexDb.close();

/** Each classic number's rows: the number itself first, then its splits. */
const rowsByNumber = new Map();
for (const id of [...lexicon.keys()].sort()) {
  const n = id.slice(0, 5);
  if (!rowsByNumber.has(n)) rowsByNumber.set(n, []);
  rowsByNumber.get(n).push(id);
}

/** A lemma's bare letters: points, matres (ו י) and final forms set aside, so
 *  מַיִם and מַי, or שׂים and שׂוּם, read as the same word. */
const FINALS = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
function letters(lemma) {
  return String(lemma ?? '')
    .normalize('NFD')
    .replace(/[^\u05D0-\u05EA]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[וי]/g, '');
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Near enough to be the same word spelled another way. Short words are held
 *  to an exact match: עָנָה and עוּן are one letter apart and unrelated. */
function sameWord(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 3) return false;
  return editDistanceAtMostOne(a, b) || a.includes(b) || b.includes(a);
}

/**
 * The lexicon row for a word MACULA files under a number, or null when the
 * lexicon has no such word there. A number STEPBible split may keep the wrong
 * word on its plain row — H6030 reads "to dwell", the rare sense, while
 * H6030B is "to answer" — so a split whose letters match exactly wins over a
 * plain row that only nearly matches.
 */
const matchCache = new Map();
function lexiconId(raw, lemma) {
  const key = `${raw}|${lemma}`;
  if (matchCache.has(key)) return matchCache.get(key);
  const m = /^(\d{1,4})[a-z]?$/.exec(raw ?? '');
  const rows = m ? (rowsByNumber.get(`H${m[1].padStart(4, '0')}`) ?? []) : [];
  const a = letters(lemma);
  let found = null;
  if (a) {
    found =
      rows.find((id) => letters(lexicon.get(id).lemma) === a) ??
      rows.find((id) => sameWord(a, letters(lexicon.get(id).lemma))) ??
      null;
  }
  matchCache.set(key, found);
  return found;
}

// --- MACULA -----------------------------------------------------------------

console.log('🔗 Building Hebrew sense groups from MACULA Hebrew\n');

const lines = fs.readFileSync(TSV, 'utf8').split('\n');
const header = lines[0].split('\t');
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`MACULA table has no ${name} column`);
  return i;
};
const C = {
  strong: col('strongnumberx'),
  lemma: col('lemma'),
  lexdomain: col('lexdomain'),
  coredomain: col('coredomain'),
  lang: col('lang'),
};

const perWord = new Map(); // id -> { uses, lex: Map, core: Map, aramaic }
let unmatched = 0;
for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split('\t');
  if (f.length < header.length - 4) continue;
  const id = lexiconId(f[C.strong], f[C.lemma]);
  if (!id) {
    unmatched++;
    continue;
  }
  let w = perWord.get(id);
  if (!w) perWord.set(id, (w = { uses: 0, lex: new Map(), core: new Map(), aramaic: false }));
  w.uses++;
  if (f[C.lang] === 'A') w.aramaic = true;
  for (const [field, map] of [
    [C.lexdomain, w.lex],
    [C.coredomain, w.core],
  ]) {
    for (const d of (f[field] ?? '').split(/\s+/)) {
      if (/^\d+$/.test(d)) map.set(d, (map.get(d) ?? 0) + 1);
    }
  }
}
console.log(`   ${perWord.size.toLocaleString()} lexicon numbers found in the text`);
console.log(`   ${unmatched.toLocaleString()} words skipped (number names a different word, or none)`);

// Each word's dominant domains, measured against all its uses.
const dominant = (map, uses) => new Set([...map].filter(([, n]) => n / uses >= DOMINANT).map(([d]) => d));
const words = new Map(); // id -> { lex: Set, core: Set, uses }
const byLex = new Map();
const byCore = new Map();
const index = (map, key, id) => {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(id);
};
for (const [id, w] of perWord) {
  const lex = dominant(w.lex, w.uses);
  if (!lex.size) continue;
  const core = dominant(w.core, w.uses);
  words.set(id, { lex, core, uses: w.uses });
  for (const d of lex) index(byLex, d, id);
  for (const d of core) index(byCore, d, id);
}
console.log(`   ${words.size.toLocaleString()} have a dominant sense`);

/** Names sit beside other names only: Immanuel is not a synonym for God. */
const isName = (id) => /^N:/.test(lexicon.get(id)?.partOfSpeech ?? '');

/** How a row reads in the list. Two rows reading alike look like one word
 *  twice — the Aramaic מֶ֫לֶךְ "king" beside the Hebrew — so only one shows. */
const reads = (id) => `${letters(lexicon.get(id)?.lemma)}|${lexicon.get(id)?.shortDefinition ?? ''}`;

/** The file's key for a row: H0157 → "157", H6030B → "6030B". */
const short = (id) => id.slice(1).replace(/^0+(?=\d)/, '');

function relationsFor(id) {
  const me = words.get(id);
  const shared = new Map(); // other -> { lex, core }
  for (const d of me.lex) {
    for (const other of byLex.get(d)) {
      if (other === id || isName(other) !== isName(id)) continue;
      const s = shared.get(other) ?? { lex: 0, core: 0 };
      s.lex++;
      shared.set(other, s);
    }
  }
  for (const d of me.core) {
    for (const other of byCore.get(d)) {
      const s = shared.get(other);
      if (s) s.core++;
    }
  }
  const sense = [];
  const area = [];
  for (const [other, s] of shared) {
    const sameSense = s.core > 0 || !me.core.size || !words.get(other).core.size;
    (sameSense ? sense : area).push([other, s.lex + s.core]);
  }
  const seen = new Set([reads(id)]);
  const rank = (list, limit) =>
    list
      .sort((a, b) => b[1] - a[1] || words.get(b[0]).uses - words.get(a[0]).uses)
      .filter(([other]) => !seen.has(reads(other)) && seen.add(reads(other)))
      .slice(0, limit)
      .map(([other]) => short(other));
  return [rank(sense, MAX_SENSE), rank(area, MAX_AREA)];
}

// --- Write ------------------------------------------------------------------

const out = {};
let aramaic = 0;
const senseSizes = [];
for (const id of [...words.keys()].sort()) {
  const [sense, area] = relationsFor(id);
  if (!sense.length && !area.length) continue;
  out[short(id)] = area.length ? [sense, area] : [sense];
  senseSizes.push(sense.length);
  if (perWord.get(id).aramaic) aramaic++;
}
fs.writeFileSync(OUT, JSON.stringify(out));

senseSizes.sort((a, b) => a - b);
const total = Object.keys(out).length;
console.log(`\n   entries with relations: ${total.toLocaleString()} (${aramaic} of them Aramaic)`);
console.log(`   median same-sense list: ${senseSizes[senseSizes.length >> 1]}`);
console.log(`   ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB → ${path.relative(repoRoot, OUT)}`);

const show = (key) => {
  const m = /^(\d+)([A-Z]?)$/.exec(key);
  const e = lexicon.get(`H${m[1].padStart(4, '0')}${m[2]}`);
  return `${e?.lemma} ${e?.shortDefinition}`;
};
console.log('\n   Spot checks:');
for (const key of ['157', '2403', '539', '4428', '1696', '6030B', '8085', '426', '4430']) {
  const rel = out[key];
  console.log(`   ${key} ${show(key)}`);
  if (!rel) console.log('      (none)');
  else {
    console.log(`      same:   ${rel[0].map(show).join(' · ') || '—'}`);
    if (rel[1]) console.log(`      nearby: ${rel[1].map(show).join(' · ')}`);
  }
}
console.log(`\n✅ ${OUT}`);
