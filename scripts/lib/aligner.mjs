/**
 * A word aligner for Word Links: which Strong's number each English word of a
 * verse most likely translates, learned from the whole Bible.
 *
 * NET and WEB tag their words by machine, and the build keeps only the tags it
 * can check. This finds links for the words left over. It reads BSB, KJV, NET
 * and WEB beside the Greek and Hebrew each was translated from and learns, by
 * expectation-maximization (IBM Model 1, with a pull toward words in the same
 * place in the verse), which English words go with which numbers. Links we
 * already trust (BSB's tables, KJV's tags, the translation's own checked tags)
 * are held fixed while it learns, so a translation's own habits ("dear friend"
 * for G0027 in NET) come from the verses where it shows them.
 *
 * A word gets a link only when it is likely in both directions (the English
 * word picks the number, and the number picks the word), the number is in the
 * verse, the number hasn't already used up its count there, and the pair is
 * linked often enough across the Bible. A word that picks the number of the
 * link beside it joins that link ("Dear friend", where NET tags only "Dear").
 * Numbers that were too often wrong on the scorecard (small adverbs, idioms,
 * names translators supply) are never aligned: aligner-skip.json.
 *
 * Function words and the article stay in the learning, so "the" soaks up the
 * article and "in" soaks up ἐν, but are never given links.
 *
 * scripts/score-word-links.mjs measures it against BSB's own links.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cleanWithIndex } from './clean-text.mjs';
import { AUXILIARIES, FUNCTION_WORDS, IRREGULAR, NEVER_MARKED, vocabularyOf } from './gloss-match.mjs';
import { fromEnglish, toEnglish } from './versification.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CONSOLIDATED = join(repoRoot, 'packs/consolidated');
const ANCIENT_PATH = join(CONSOLIDATED, 'ancient-languages.sqlite');
const CRITICAL_PATH = join(CONSOLIDATED, 'greek-critical.sqlite');
const LEXICAL_PATH = join(CONSOLIDATED, 'lexical.sqlite');
const LINKS_PATH = join(CONSOLIDATED, 'word-links.sqlite');
const CACHE_DIR = join(repoRoot, '.cache/word-aligner');

/** Each translation's verse numbering and the Greek it is read beside (Hebrew is always OSHB). */
export const TEXTS = {
  bsb: { pack: join(repoRoot, 'packs/bsb.sqlite'), scheme: 'english', greek: { db: CRITICAL_PATH, id: 'sblgnt', scheme: 'english' } },
  kjv: { pack: join(repoRoot, 'packs/kjv.sqlite'), scheme: 'english', greek: { db: ANCIENT_PATH, id: 'tr', scheme: 'english' } },
  web: { pack: join(repoRoot, 'packs/web.sqlite'), scheme: 'web', greek: { db: ANCIENT_PATH, id: 'byz', scheme: 'majority' } },
  net: { pack: join(repoRoot, 'packs/net.sqlite'), scheme: 'english', greek: { db: CRITICAL_PATH, id: 'sblgnt', scheme: 'english' } },
};

/** Numbers the scorecard found too often wrong to link (score-word-links.mjs --write-skip). */
export const SKIP_FILE = join(dirname(fileURLToPath(import.meta.url)), 'aligner-skip.json');

/** The settings the scorecard tuned (scripts/score-word-links.mjs). */
export const SETTINGS = {
  skip: new Set(existsSync(SKIP_FILE) ? JSON.parse(readFileSync(SKIP_FILE, 'utf8')).ids : []),
  iterations: 6,
  // Held links fix only the English side: the number stays free to learn
  // the other words of its rendering ("friend" of NET's "Dear friend", where
  // only "Dear" is tagged).
  fixNumbers: false,
  // How hard each side pulls toward words in the same place in the verse.
  lambda: { ot: 12, nt: 12 },
  // The chance a word has no partner on the other side.
  nullShare: 0.1,
  // How much the number's own choice of word counts beside the word's choice of number.
  beta: 1,
  // Both directions' likelihoods (the second to the power beta) multiplied must clear this.
  threshold: 0.8,
  // How many times across the Bible the word and number must be linked (by
  // the learning's own count) before a link between them is trusted.
  minSupport: 3,
  // The same for a word joining a tagged neighbor's link ("friend" to
  // "Dear"): those were right 96% of the time from 20 up, 89% from 3.
  joinSupport: 20,
};

/** Bump when the learning changes, so old scratch files aren't reused. */
const MODEL_VERSION = 4;

const verseKey = (book, chapter, verse) => `${book}|${chapter}|${verse}`;

function classicId(id) {
  const m = /^([GH])0*(\d{1,4})[A-Za-z]?$/i.exec(id ?? '');
  return m ? `${m[1].toUpperCase()}${m[2].padStart(4, '0')}` : null;
}

// ── English words ───────────────────────────────────────────────────────────

const BASE_OF = new Map();
for (const [base, forms] of Object.entries(IRREGULAR)) for (const f of forms) if (!BASE_OF.has(f)) BASE_OF.set(f, base);

/** A rough stem, so "friend" and "friends", "love" and "loved" learn together. */
export function stem(word) {
  let w = BASE_OF.get(word) ?? word;
  if (w.length <= 3) return w;
  if (/ie[sd]$/.test(w) && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (/(?:ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (/[^su]s$/.test(w)) w = w.slice(0, -1);
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (/e(?:th|st)$/.test(w) && w.length > 6) w = w.slice(0, -3);
  if (/([b-df-hj-km-rtv-z])\1$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1);
  return w;
}

/**
 * The words of a verse's clean text: where each is, its stem, and whether it
 * is one that can take a link (not a function word, helping verb or
 * contraction).
 */
export function englishWords(text) {
  const out = [];
  for (const m of text.matchAll(/[\p{L}'’]+/gu)) {
    let s = m.index;
    let e = s + m[0].length;
    while (s < e && /['’]/.test(text[s])) s++;
    while (e > s && /['’]/.test(text[e - 1])) e--;
    if (e <= s) continue;
    const raw = text.slice(s, e).toLowerCase().replace(/’/g, "'");
    const word = raw.replace(/'s$/, '');
    const meaningful =
      word.length >= 2 && !word.includes("'") && !FUNCTION_WORDS.has(word) && !AUXILIARIES.has(word);
    out.push({ s, e, word, stem: word.includes("'") ? word : stem(word), meaningful });
  }
  return out;
}

// ── Records: one per verse, English beside the original ─────────────────────

const originalCache = new Map();

/** Each verse's Strong's numbers in reading order, by that table's numbering. */
function originalWords(path, translationId) {
  const k = `${path}|${translationId}`;
  if (originalCache.has(k)) return originalCache.get(k);
  const db = new Database(path, { readonly: true });
  const out = new Map();
  const rows = db
    .prepare('SELECT book, chapter, verse, strongs FROM words WHERE translation_id = ? ORDER BY book, chapter, verse, word_order')
    .iterate(translationId);
  for (const r of rows) {
    const id = classicId((r.strongs ?? '').split(/[\s,+/]+/)[0]);
    if (!id) continue;
    const vk = verseKey(r.book, r.chapter, r.verse);
    let list = out.get(vk);
    if (!list) out.set(vk, (list = []));
    list.push(id);
  }
  db.close();
  originalCache.set(k, out);
  return out;
}

/** A translation's verses as clean text, keyed book|chapter|verse. */
export function readTexts(name) {
  const db = new Database(TEXTS[name].pack, { readonly: true });
  const out = new Map();
  for (const r of db.prepare('SELECT book, chapter, verse, text FROM verses').iterate()) {
    out.set(verseKey(r.book, r.chapter, r.verse), cleanWithIndex(r.text).text);
  }
  db.close();
  return out;
}

/** A translation's links in the Word Links pack: verseKey → [{ s, e, ids }]. */
export function readLinks(name) {
  const out = new Map();
  if (!existsSync(LINKS_PATH)) return out;
  const db = new Database(LINKS_PATH, { readonly: true });
  for (const r of db.prepare('SELECT book, chapter, verse, links FROM word_links WHERE translation_id = ?').iterate(name)) {
    out.set(
      verseKey(r.book, r.chapter, r.verse),
      r.links.split(';').filter(Boolean).map((part) => {
        const [s, len, ids] = part.split(',');
        return { s: +s, e: +s + +len, ids };
      }),
    );
  }
  db.close();
  return out;
}

/**
 * Every verse of a translation as a record: its clean text, its words, the
 * Strong's numbers of the Greek or Hebrew behind it in order, and the links
 * held fixed (`anchors`, verseKey → links; none for a translation being
 * aligned from scratch).
 */
export function buildRecords(name, { texts = readTexts(name), anchors = new Map() } = {}) {
  const { scheme, greek } = TEXTS[name];
  const hebrew = originalWords(ANCIENT_PATH, 'hebrew-oshb');
  const greekWords = originalWords(greek.db, greek.id);
  const records = [];
  for (const [key, text] of texts) {
    const [book, chapter, verse] = key.split('|');
    const ref = { book, chapter: +chapter, verse: +verse };
    const src = [];
    const seen = new Set();
    for (const e of toEnglish(scheme, ref)) {
      for (const [table, lang, s] of [[hebrew, 'h', 'hebrew'], [greekWords, 'g', greek.scheme]]) {
        for (const o of fromEnglish(s, e)) {
          const k = `${lang}|${verseKey(o.book, o.chapter, o.verse)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          src.push(...(table.get(verseKey(o.book, o.chapter, o.verse)) ?? []));
        }
      }
    }
    const words = englishWords(text);
    if (!src.length || !words.length) continue;
    records.push({ ...ref, key, testament: src[0][0] === 'H' ? 'ot' : 'nt', text, words, src, anchors: anchors.get(key) ?? [] });
  }
  return records;
}

/** The English each number's lexicon entry and interlinear gloss give it, as stems. */
function glossStems() {
  const out = new Map();
  const add = (id, text) => {
    let set = out.get(id);
    if (!set) out.set(id, (set = new Set()));
    for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      if (w.length >= 3 && !FUNCTION_WORDS.has(w)) set.add(stem(w));
    }
  };
  const lex = new Database(LEXICAL_PATH, { readonly: true });
  for (const table of ['greek_strongs_entries', 'hebrew_strongs_entries']) {
    for (const r of lex.prepare(`SELECT id, shortDefinition, kjvUsage FROM ${table}`).iterate()) {
      const id = classicId(r.id);
      if (id) for (const p of vocabularyOf(r)) add(id, p);
    }
  }
  lex.close();
  for (const [path, tid] of [[CRITICAL_PATH, 'sblgnt'], [ANCIENT_PATH, 'hebrew-oshb']]) {
    const db = new Database(path, { readonly: true });
    for (const r of db.prepare('SELECT DISTINCT strongs, gloss_en FROM words WHERE translation_id = ?').iterate(tid)) {
      const id = classicId((r.strongs ?? '').split(/[\s,+/]+/)[0]);
      if (id && r.gloss_en) add(id, r.gloss_en);
    }
    db.close();
  }
  return out;
}

// ── Learning ────────────────────────────────────────────────────────────────

/** Which words of a record an anchor holds fixed: its meaningful words, or all of them if it has none. */
function fixedWords(record) {
  const fixed = new Array(record.words.length).fill(null);
  for (const a of record.anchors) {
    const inside = [];
    record.words.forEach((w, j) => { if (w.s < a.e && a.s < w.e) inside.push(j); });
    const meaningful = inside.filter((j) => record.words[j].meaningful);
    for (const j of meaningful.length ? meaningful : inside) {
      const ids = a.ids.split('+');
      fixed[j] = fixed[j] ? [...new Set([...fixed[j], ...ids])] : ids;
    }
  }
  return fixed;
}

/** exp(-λ·distance) between relative places in the verse. */
const closeness = (lambda, i, I, j, J) => Math.exp(-lambda * Math.abs((i + 0.5) / I - (j + 0.5) / J));

/**
 * Learn how likely each English stem is for each number (and each number for
 * each stem) over every record. A record's fixed words count only toward the
 * numbers they are linked to.
 */
export function train(records, settings = SETTINGS, { log = console.log } = {}) {
  const { iterations, lambda, nullShare } = settings;
  const eIndex = new Map();
  const fIndex = new Map();
  const intern = (map, s) => {
    let x = map.get(s);
    if (x === undefined) map.set(s, (x = map.size));
    return x;
  };

  const R = records.length;
  const eStart = new Int32Array(R + 1);
  const fStart = new Int32Array(R + 1);
  const pStart = new Int32Array(R + 1);
  for (let r = 0; r < R; r++) {
    const { words, src } = records[r];
    eStart[r + 1] = eStart[r] + words.length;
    fStart[r + 1] = fStart[r] + src.length;
    pStart[r + 1] = pStart[r] + words.length * src.length;
  }
  const eTok = new Int32Array(eStart[R]);
  const fTok = new Int32Array(fStart[R]);
  const rowFixed = new Uint8Array(eStart[R]);
  const colFixed = new Uint8Array(fStart[R]);
  const allowed = new Uint8Array(pStart[R]);
  const lam = new Float32Array(R);

  for (let r = 0; r < R; r++) {
    const rec = records[r];
    const I = rec.src.length;
    lam[r] = lambda[rec.testament];
    rec.words.forEach((w, j) => { eTok[eStart[r] + j] = intern(eIndex, w.stem); });
    rec.src.forEach((id, i) => { fTok[fStart[r] + i] = intern(fIndex, id); });
    if (!rec.anchors.length) continue;
    const fixed = fixedWords(rec);
    // How many separate links each number has: a number used twice in the
    // original but linked once leaves its other use free.
    const groups = new Map();
    for (const a of rec.anchors) for (const id of a.ids.split('+')) groups.set(id, (groups.get(id) ?? 0) + 1);
    const uses = new Map();
    for (const id of rec.src) uses.set(id, (uses.get(id) ?? 0) + 1);
    fixed.forEach((ids, j) => {
      if (!ids) return;
      let any = false;
      for (let i = 0; i < I; i++) {
        if (ids.includes(rec.src[i])) { allowed[pStart[r] + j * I + i] = 1; any = true; }
      }
      if (any) rowFixed[eStart[r] + j] = 1;
    });
    if (settings.fixNumbers === false) continue;
    rec.src.forEach((id, i) => {
      if ((groups.get(id) ?? 0) >= uses.get(id) && fixed.some((ids, j) => ids && rowFixed[eStart[r] + j] && ids.includes(id))) {
        colFixed[fStart[r] + i] = 1;
      }
    });
  }
  const NE = eIndex.size;
  const NF = fIndex.size;

  // Every English-number pair that meets in some verse, numbered.
  const pairOf = new Int32Array(pStart[R]);
  for (let r = 0; r < R; r++) {
    const J = eStart[r + 1] - eStart[r];
    const I = fStart[r + 1] - fStart[r];
    for (let j = 0; j < J; j++) {
      const e = eTok[eStart[r] + j];
      for (let i = 0; i < I; i++) pairOf[pStart[r] + j * I + i] = fTok[fStart[r] + i] * NE + e;
    }
  }
  const sorted = pairOf.slice().sort();
  let n = 0;
  for (let k = 0; k < sorted.length; k++) if (k === 0 || sorted[k] !== sorted[k - 1]) sorted[n++] = sorted[k];
  const codes = sorted.slice(0, n);
  for (let k = 0; k < pairOf.length; k++) pairOf[k] = search(codes, pairOf[k]);
  const pairF = new Int32Array(n);
  const pairE = new Int32Array(n);
  for (let p = 0; p < n; p++) { pairF[p] = Math.floor(codes[p] / NE); pairE[p] = codes[p] % NE; }
  log(`  ${R.toLocaleString()} verses, ${NE.toLocaleString()} English stems, ${NF.toLocaleString()} numbers, ${n.toLocaleString()} pairs`);

  // A head start: the gloss, and the links held fixed.
  const gloss = glossStems();
  const seed = new Float64Array(n).fill(1);
  const fList = [...fIndex.keys()];
  const eList = [...eIndex.keys()];
  for (let p = 0; p < n; p++) if (gloss.get(fList[pairF[p]])?.has(eList[pairE[p]])) seed[p] += 4;
  for (let k = 0; k < allowed.length; k++) if (allowed[k]) seed[pairOf[k]] += 2;
  const tEF = normalize(seed, pairF, NF); // P(English | number)
  const tFE = normalize(seed, pairE, NE); // P(number | English)
  let nullE = new Float64Array(NE).fill(1 / NE);
  let nullF = new Float64Array(NF).fill(1 / NF);

  const count = new Float64Array(n);
  const wordSide = new Float64Array(n);
  const d = new Float64Array(512);
  const w = new Float64Array(512);
  for (let it = 0; it < iterations; it++) {
    // English given number: each English word picks a number in its verse, or none.
    count.fill(0);
    let nullCount = new Float64Array(NE);
    for (let r = 0; r < R; r++) {
      const J = eStart[r + 1] - eStart[r];
      const I = fStart[r + 1] - fStart[r];
      for (let j = 0; j < J; j++) {
        const at = eStart[r] + j;
        const e = eTok[at];
        const base = pStart[r] + j * I;
        const fixedRow = rowFixed[at];
        let z = 0;
        for (let i = 0; i < I; i++) z += (d[i] = closeness(lam[r], i, I, j, J));
        let sum = fixedRow ? 0 : nullShare * nullE[e];
        for (let i = 0; i < I; i++) {
          w[i] = fixedRow && !allowed[base + i] ? 0 : ((1 - nullShare) * d[i] / z) * tEF[pairOf[base + i]];
          sum += w[i];
        }
        if (sum <= 0) continue;
        for (let i = 0; i < I; i++) if (w[i]) count[pairOf[base + i]] += w[i] / sum;
        if (!fixedRow) nullCount[e] += (nullShare * nullE[e]) / sum;
      }
    }
    tEF.set(normalize(count, pairF, NF));
    if (it === iterations - 1) wordSide.set(count);
    nullE = scale(nullCount);

    // Number given English: each number picks an English word in its verse, or none.
    count.fill(0);
    nullCount = new Float64Array(NF);
    for (let r = 0; r < R; r++) {
      const J = eStart[r + 1] - eStart[r];
      const I = fStart[r + 1] - fStart[r];
      for (let i = 0; i < I; i++) {
        const at = fStart[r] + i;
        const f = fTok[at];
        const fixedCol = colFixed[at];
        let z = 0;
        for (let j = 0; j < J; j++) z += (d[j] = closeness(lam[r], i, I, j, J));
        let sum = fixedCol ? 0 : nullShare * nullF[f];
        for (let j = 0; j < J; j++) {
          const k = pStart[r] + j * I + i;
          w[j] = fixedCol && !allowed[k] ? 0 : ((1 - nullShare) * d[j] / z) * tFE[pairOf[k]];
          sum += w[j];
        }
        if (sum <= 0) continue;
        for (let j = 0; j < J; j++) if (w[j]) count[pairOf[pStart[r] + j * I + i]] += w[j] / sum;
        if (!fixedCol) nullCount[f] += (nullShare * nullF[f]) / sum;
      }
    }
    tFE.set(normalize(count, pairE, NE));
    nullF = scale(nullCount);
    log(`  learning: pass ${it + 1} of ${iterations}`);
  }

  // Pairs too unlikely in both directions to ever win are left out of the model.
  let kept = 0;
  for (let p = 0; p < n; p++) if (tEF[p] >= 1e-4 || tFE[p] >= 1e-4) kept++;
  const model = {
    eList,
    fList,
    codes: new Int32Array(kept),
    tEF: new Float32Array(kept),
    tFE: new Float32Array(kept),
    // How many times, by the last pass's reckoning, the pair is a link in the
    // corpus: counted as the number's choice, and as the word's.
    support: new Float32Array(kept),
    wordSupport: new Float32Array(kept),
    nullE: Float32Array.from(nullE),
    nullF: Float32Array.from(nullF),
  };
  for (let p = 0, q = 0; p < n; p++) {
    if (tEF[p] < 1e-4 && tFE[p] < 1e-4) continue;
    model.codes[q] = codes[p];
    model.tEF[q] = tEF[p];
    model.tFE[q] = tFE[p];
    model.support[q] = count[p];
    model.wordSupport[q] = wordSide[p];
    q++;
  }
  return model;
}

function search(sorted, x) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else if (sorted[mid] > x) hi = mid - 1;
    else return mid;
  }
  return -1;
}

/** Counts shared out so each group (by `groupOf`) sums to one. */
function normalize(counts, groupOf, groups) {
  const totals = new Float64Array(groups);
  for (let p = 0; p < counts.length; p++) totals[groupOf[p]] += counts[p];
  const out = new Float64Array(counts.length);
  for (let p = 0; p < counts.length; p++) out[p] = totals[groupOf[p]] > 0 ? counts[p] / totals[groupOf[p]] : 0;
  return out;
}

function scale(counts) {
  let total = 0;
  for (const c of counts) total += c;
  return counts.map((c) => (total > 0 ? c / total : 0));
}

// ── Scratch file ────────────────────────────────────────────────────────────

/** A fingerprint of everything the learning reads, so a scratch file is reused only for the same input. */
function fingerprint(records, settings) {
  const h = createHash('sha1');
  h.update(JSON.stringify({ MODEL_VERSION, settings: { ...settings, threshold: undefined, beta: undefined, minSupport: undefined, joinSupport: undefined, skip: undefined } }));
  for (const r of records) {
    h.update(r.key);
    h.update(r.text);
    h.update(r.src.join(' '));
    for (const a of r.anchors) h.update(`${a.s},${a.e},${a.ids};`);
  }
  return h.digest('hex').slice(0, 16);
}

/** train(), or its result from .cache/word-aligner when the input hasn't changed. */
export function trainCached(records, settings = SETTINGS, { log = console.log } = {}) {
  const file = join(CACHE_DIR, `${fingerprint(records, settings)}.bin`);
  if (existsSync(file)) {
    log(`  reusing ${file}`);
    return readModel(file);
  }
  const model = train(records, settings, { log });
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeModel(file, model);
  return model;
}

const ARRAYS = [['codes', Int32Array], ['tEF', Float32Array], ['tFE', Float32Array], ['support', Float32Array], ['wordSupport', Float32Array], ['nullE', Float32Array], ['nullF', Float32Array]];

function writeModel(file, model) {
  const header = Buffer.from(JSON.stringify({
    eList: model.eList,
    fList: model.fList,
    lengths: ARRAYS.map(([k]) => model[k].length),
  }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length);
  writeFileSync(file, Buffer.concat([len, header, ...ARRAYS.map(([k]) => Buffer.from(model[k].buffer, model[k].byteOffset, model[k].byteLength))]));
}

function readModel(file) {
  const buf = readFileSync(file);
  const size = buf.readUInt32LE(0);
  const header = JSON.parse(buf.subarray(4, 4 + size).toString());
  const model = { eList: header.eList, fList: header.fList };
  let at = 4 + size;
  ARRAYS.forEach(([k, Type], n) => {
    const bytes = header.lengths[n] * Type.BYTES_PER_ELEMENT;
    model[k] = new Type(buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + at + bytes));
    at += bytes;
  });
  return model;
}

// ── Placing links ───────────────────────────────────────────────────────────

const FLOOR = 1e-7;

/** Lookups into a learned model, by stem and number. */
function lookups(model) {
  const eIndex = new Map(model.eList.map((s, i) => [s, i]));
  const fIndex = new Map(model.fList.map((s, i) => [s, i]));
  const NE = model.eList.length;
  const pair = (e, f) => (e === undefined || f === undefined ? -1 : search(model.codes, f * NE + e));
  return {
    eIndex,
    fIndex,
    tEF: (e, f) => { const p = pair(e, f); return p < 0 ? FLOOR : Math.max(FLOOR, model.tEF[p]); },
    tFE: (e, f) => { const p = pair(e, f); return p < 0 ? FLOOR : Math.max(FLOOR, model.tFE[p]); },
    support: (e, f) => { const p = pair(e, f); return p < 0 ? 0 : model.support[p]; },
    wordSupport: (e, f) => { const p = pair(e, f); return p < 0 ? 0 : model.wordSupport[p]; },
    nullE: (e) => (e === undefined ? FLOOR : Math.max(FLOOR, model.nullE[e])),
    nullF: (f) => (f === undefined ? FLOOR : Math.max(FLOOR, model.nullF[f])),
  };
}

/**
 * For each word of a record that can take a link but has none: the number it
 * most likely translates and how sure both directions are of it.
 */
function candidates(look, rec, settings) {
  const { lambda, nullShare } = settings;
  const lam = lambda[rec.testament];
  const J = rec.words.length;
  const I = rec.src.length;
  const e = rec.words.map((w) => look.eIndex.get(w.stem));
  const f = rec.src.map((id) => look.fIndex.get(id));

  // Number given English, for every number's choice among the words.
  const byNumber = Array.from({ length: I }, () => new Float64Array(J));
  for (let i = 0; i < I; i++) {
    let z = 0;
    for (let j = 0; j < J; j++) z += closeness(lam, i, I, j, J);
    let sum = nullShare * look.nullF(f[i]);
    const row = byNumber[i];
    for (let j = 0; j < J; j++) sum += (row[j] = ((1 - nullShare) * closeness(lam, i, I, j, J) / z) * look.tFE(e[j], f[i]));
    for (let j = 0; j < J; j++) row[j] /= sum;
  }

  const out = [];
  rec.words.forEach((w, j) => {
    if (!w.meaningful || rec.anchors.some((a) => w.s < a.e && a.s < w.e)) return;
    let z = 0;
    for (let i = 0; i < I; i++) z += closeness(lam, i, I, j, J);
    let sum = nullShare * look.nullE(e[j]);
    const share = new Float64Array(I);
    for (let i = 0; i < I; i++) sum += (share[i] = ((1 - nullShare) * closeness(lam, i, I, j, J) / z) * look.tEF(e[j], f[i]));
    // A number used twice in the verse adds up its two places.
    const byId = new Map();
    for (let i = 0; i < I; i++) {
      const id = rec.src[i];
      const x = byId.get(id) ?? { toNumber: 0, toWord: 0 };
      x.toNumber += share[i] / sum;
      x.toWord = Math.max(x.toWord, byNumber[i][j]);
      byId.set(id, x);
    }
    let best = null;
    for (const [id, x] of byId) {
      const score = x.toNumber * x.toWord ** settings.beta;
      if (!best || score > best.score) best = { j, id, score, toNumber: x.toNumber, toWord: x.toWord, support: look.support(e[j], look.fIndex.get(id)) };
    }
    if (best && !NEVER_MARKED.has(best.id)) out.push(best);
  });

  // A number rendered by several words ("Dear friend", where only "Dear" is
  // tagged) shares its choice among them: a word next to a link to its
  // number counts that link's share too. (Pooling two new words the same way
  // was right only 80% of the time on the scorecard.)
  const toWordAt = (id, k) => {
    let best = 0;
    for (let i = 0; i < I; i++) if (rec.src[i] === id) best = Math.max(best, byNumber[i][k]);
    return best;
  };
  const linkedTo = (id) => rec.words.flatMap((w, k) => (rec.anchors.some((a) => a.ids === id && w.s < a.e && a.s < w.e) ? [k] : []));
  for (const c of out) {
    const phrase = new Set([c.j]);
    const others = isName(rec, c.j) ? [] : linkedTo(c.id);
    for (let grew = true; grew;) {
      grew = false;
      for (const k of others) {
        if (phrase.has(k) || ![...phrase].some((p) => bridgeable(rec, p, k))) continue;
        phrase.add(k);
        grew = true;
      }
    }
    let shared = 0;
    for (const k of phrase) shared += toWordAt(c.id, k);
    c.toWord = Math.min(1, shared);
    // The tagged neighbor took the number's choice, so the word's own counts.
    c.pooled = phrase.size > 1;
    if (c.pooled) c.support = look.wordSupport(look.eIndex.get(rec.words[c.j].stem), look.fIndex.get(c.id));
    c.score = c.toNumber * c.toWord ** settings.beta;
  }
  return out;
}

/**
 * A capitalized word inside a sentence: a name, often one the translator
 * supplied ("Jesus said" for εἶπεν), so never joined to a neighbor's link.
 */
function isName(rec, j) {
  const w = rec.words[j];
  if (!/^\p{Lu}/u.test(rec.text[w.s])) return false;
  const before = rec.text.slice(0, w.s).trimEnd();
  return before.length > 0 && !/[.!?:;“"‘(\x10-\x12]$/u.test(before);
}

/**
 * Text between two words that still lets them be one link: nothing but
 * spaces and at most three function words with no link of their own.
 */
function bridgeable(rec, from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const a = rec.words[lo];
  const b = rec.words[hi];
  if (hi - lo - 1 > 3) return false;
  for (let k = lo + 1; k < hi; k++) {
    const w = rec.words[k];
    if (w.meaningful || rec.anchors.some((x) => w.s < x.e && x.s < w.e)) return false;
  }
  return !/[^\p{L}\s'’-]/u.test(rec.text.slice(a.e, b.s));
}

/**
 * Links for one record: its anchors, plus a link for each leftover word whose
 * number clears the threshold and hasn't used up its count in the verse.
 * Returns the merged links ({ s, e, ids }) and the words added.
 */
function placeRecord(look, rec, settings) {
  const uses = new Map();
  for (const id of rec.src) uses.set(id, (uses.get(id) ?? 0) + 1);
  // Groups of words linked to one number: each anchor is one, with its words.
  const groups = rec.anchors.map((a) => ({
    ids: a.ids,
    anchor: a,
    words: rec.words.flatMap((w, j) => (w.s < a.e && a.s < w.e ? [j] : [])),
  }));
  const groupsOf = (id) => groups.filter((g) => g.ids.split('+').includes(id)).length;
  const added = [];
  const picks = candidates(look, rec, settings)
    .filter((c) => c.score >= settings.threshold && !settings.skip.has(c.id) &&
      c.support >= (c.pooled ? settings.joinSupport : settings.minSupport))
    .sort((x, y) => y.score - x.score);
  for (const c of picks) {
    const join = !isName(rec, c.j) && groups.find((g) => g.ids === c.id && g.words.length && g.words.some((k) => bridgeable(rec, k, c.j)));
    if (join) join.words.push(c.j);
    else if (groupsOf(c.id) < (uses.get(c.id) ?? 0)) groups.push({ ids: c.id, anchor: null, words: [c.j] });
    else continue;
    added.push({ ...c, word: rec.words[c.j].word, joined: join ? (join.anchor ? 'anchor' : 'new') : '' });
  }
  const links = groups.map((g) => {
    if (!g.words.length) return g.anchor;
    const s = Math.min(...g.words.map((k) => rec.words[k].s), g.anchor?.s ?? Infinity);
    const e = Math.max(...g.words.map((k) => rec.words[k].e), g.anchor?.e ?? -Infinity);
    return { s, e, ids: g.ids };
  });
  links.sort((a, b) => a.s - b.s || a.e - b.e);
  return { links, added };
}

/**
 * Place links in every record with a learned model. Returns verseKey →
 * { links, added } for each record.
 */
export function place(model, records, settings = SETTINGS) {
  const look = lookups(model);
  const out = new Map();
  for (const rec of records) out.set(rec.key, placeRecord(look, rec, settings));
  return out;
}

/**
 * The training set for aligning `target`: BSB and KJV with their links fixed,
 * `target` with `targetAnchors` fixed, and the other tagged translations as
 * plain text (their links in the pack may be this aligner's own).
 */
export function corpusFor(target, targetAnchors, { gold = ['bsb', 'kjv'], log = console.log } = {}) {
  const sets = {};
  for (const name of Object.keys(TEXTS)) {
    const anchors = name === target ? targetAnchors : gold.includes(name) ? readLinks(name) : new Map();
    sets[name] = buildRecords(name, { anchors });
    log(`  ${name.toUpperCase()}: ${sets[name].length.toLocaleString()} verses${anchors.size ? `, ${anchors.size.toLocaleString()} with links held fixed` : ''}`);
  }
  return sets;
}

/**
 * Align `target` (net or web) given the links already trusted in it (rows
 * as filterTags() returns them). Returns the rows with aligned links merged
 * in, and every word added.
 */
export function alignRows(target, rows, settings = SETTINGS, { log = console.log } = {}) {
  const anchors = new Map(rows.map((r) => [verseKey(r.book, r.chapter, r.verse), r.links]));
  log('\nAligning the words left over...');
  const sets = corpusFor(target, anchors, { log });
  const model = trainCached(Object.values(sets).flat(), settings, { log });
  const placed = place(model, sets[target], settings);
  const out = [];
  const added = [];
  for (const rec of sets[target]) {
    const p = placed.get(rec.key);
    for (const a of p.added) added.push({ where: `${rec.book} ${rec.chapter}:${rec.verse}`, ...a });
    if (p.links.length) out.push({ book: rec.book, chapter: rec.chapter, verse: rec.verse, links: p.links });
  }
  // A verse with links but no record (no Greek or Hebrew read for it) keeps them.
  const placedKeys = new Set(sets[target].map((r) => r.key));
  for (const r of rows) if (!placedKeys.has(verseKey(r.book, r.chapter, r.verse))) out.push(r);
  return { rows: out, added };
}
