#!/usr/bin/env node

/**
 * Scorecard for the Word Links aligner (scripts/lib/aligner.mjs).
 *
 *   node scripts/score-word-links.mjs                 align BSB as if it had no links, score against its own
 *   node scripts/score-word-links.mjs --anchored      the same, with the links NET-style checking would keep held fixed
 *   node scripts/score-word-links.mjs --sweep         try several thresholds
 *   node scripts/score-word-links.mjs --coverage      share of meaningful words linked, per translation in the pack
 *   node scripts/score-word-links.mjs --compare <old word-links.sqlite> --only net|web
 *                                                     every link in the old pack is still there (or inside a longer one)
 *
 * Settings can be tried with --lambda-ot, --lambda-nt, --null, --iterations, --beta and --threshold.
 *
 * "Right" means BSB's tables link that word to that number, or give the
 * number's English with that word (" . . . " in the tables: "twelve" is both
 * H8147 two and H6240 ten). Words whose BSB number isn't in our Greek or
 * Hebrew verse at all are left out: the two texts number that word
 * differently (G1492/G3708 "see", H3212/H1980 "go"), so the aligner can't
 * pick BSB's number. Only meaningful
 * words are counted (not function words or helping verbs). "Hard" words are
 * the ones whose BSB number doesn't list the word among its meanings: what is
 * left in NET and WEB once their tags are checked.
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SETTINGS, SKIP_FILE, corpusFor, englishWords, place, readLinks, readTexts, trainCached, TEXTS } from './lib/aligner.mjs';
import { FUNCTION_WORDS, inflect, vocabularyOf } from './lib/gloss-match.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEXICAL_PATH = join(repoRoot, 'packs/consolidated/lexical.sqlite');
const BSB_TABLES = join(repoRoot, 'data-sources/berean-tables/bsb_tables.tsv');

const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : null;
};
const flag = (name) => process.argv.includes(name);
const pct = (a, b) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;

const settings = {
  ...SETTINGS,
  lambda: {
    ot: arg('--lambda-ot') != null ? Number(arg('--lambda-ot')) : SETTINGS.lambda.ot,
    nt: arg('--lambda-nt') != null ? Number(arg('--lambda-nt')) : SETTINGS.lambda.nt,
  },
  nullShare: arg('--null') != null ? Number(arg('--null')) : SETTINGS.nullShare,
  iterations: arg('--iterations') != null ? Number(arg('--iterations')) : SETTINGS.iterations,
  beta: arg('--beta') != null ? Number(arg('--beta')) : SETTINGS.beta,
  ...(flag('--free-numbers') ? { fixNumbers: false } : {}),
  minSupport: arg('--support') != null ? Number(arg('--support')) : SETTINGS.minSupport,
  threshold: arg('--threshold') != null ? Number(arg('--threshold')) : SETTINGS.threshold,
};

/** Each number's meanings as plain words with their endings (wordFormsOf() in build-word-links.mjs). */
function wordForms() {
  const db = new Database(LEXICAL_PATH, { readonly: true });
  const out = new Map();
  for (const table of ['greek_strongs_entries', 'hebrew_strongs_entries']) {
    for (const r of db.prepare(`SELECT id, shortDefinition, kjvUsage FROM ${table}`).iterate()) {
      const m = /^([GH])0*(\d{1,4})/i.exec(r.id ?? '');
      if (!m) continue;
      const id = `${m[1].toUpperCase()}${m[2].padStart(4, '0')}`;
      const set = out.get(id) ?? new Set();
      for (const p of vocabularyOf(r)) {
        for (const w of p.toLowerCase().split(/[ -]/)) {
          if (w.length >= 3 && !FUNCTION_WORDS.has(w)) for (const f of inflect(w)) set.add(f);
        }
      }
      out.set(id, set);
    }
  }
  db.close();
  return out;
}

/**
 * Numbers whose English the tables give with the fragment before them
 * (" . . . "): verseKey → number of that fragment → the numbers folded in.
 */
function foldedNumbers() {
  const out = new Map();
  const lines = readFileSync(BSB_TABLES, 'utf8').split(/\r?\n/);
  const header = lines[0].split('\t').map((h) => h.trim());
  const C = { lang: header.indexOf('Language'), heb: header.indexOf('Str Heb'), grk: header.indexOf('Str Grk'), ref: header.indexOf('VerseId'), english: header.indexOf('BSB version') };
  let key = null;
  let prev = null;
  for (const line of lines.slice(1)) {
    const c = line.split('\t');
    if (c.length <= C.english) continue;
    const m = /^(.+) (\d+):(\d+)$/.exec(c[C.ref] ?? '');
    if (m) { key = `${m[1] === 'Psalm' ? 'Psalms' : m[1]}|${+m[2]}|${+m[3]}`; prev = null; }
    const num = c[C.lang] === 'Greek' ? c[C.grk] : c[C.heb];
    if (!key || !/^\d+$/.test(num ?? '')) continue;
    const id = `${c[C.lang] === 'Greek' ? 'G' : 'H'}${num.padStart(4, '0')}`;
    const english = c[C.english].trim();
    if (english === '. . .' && prev) {
      const byPrev = out.get(key) ?? new Map();
      const set = byPrev.get(prev) ?? new Set();
      set.add(id);
      byPrev.set(prev, set);
      out.set(key, byPrev);
    } else if (/\p{L}/u.test(english)) prev = id;
  }
  return out;
}

const overlapsWord = (l, w) => w.s < l.e && l.s < w.e;

// ── Coverage ────────────────────────────────────────────────────────────────

function coverage(name, links = readLinks(name), texts = readTexts(name)) {
  let words = 0;
  let linked = 0;
  for (const [key, text] of texts) {
    const ls = links.get(key) ?? [];
    for (const w of englishWords(text)) {
      if (!w.meaningful) continue;
      words++;
      if (ls.some((l) => overlapsWord(l, w))) linked++;
    }
  }
  return { words, linked };
}

if (flag('--coverage')) {
  console.log('Meaningful words with a link:');
  for (const name of Object.keys(TEXTS)) {
    const c = coverage(name);
    console.log(`  ${name.toUpperCase().padEnd(4)} ${pct(c.linked, c.words).padStart(6)}  (${c.linked.toLocaleString()} of ${c.words.toLocaleString()})`);
  }
  process.exit(0);
}

// ── Nothing lost ────────────────────────────────────────────────────────────

if (arg('--compare')) {
  const name = arg('--only');
  const oldPath = arg('--compare');
  if (!TEXTS[name] || !existsSync(oldPath)) {
    console.error('Usage: node scripts/score-word-links.mjs --compare <old word-links.sqlite> --only net|web');
    process.exit(1);
  }
  const db = new Database(oldPath, { readonly: true });
  const before = new Map();
  for (const r of db.prepare('SELECT book, chapter, verse, links FROM word_links WHERE translation_id = ?').iterate(name)) {
    before.set(`${r.book}|${r.chapter}|${r.verse}`, r.links.split(';').map((p) => p.split(',')).map(([s, len, ids]) => ({ s: +s, e: +s + +len, ids })));
  }
  db.close();
  const after = readLinks(name);
  let total = 0;
  const lost = [];
  for (const [key, ls] of before) {
    const now = after.get(key) ?? [];
    for (const l of ls) {
      total++;
      if (!now.some((n) => n.s <= l.s && l.e <= n.e && n.ids === l.ids)) lost.push(`${key.replace(/\|/g, ' ')} ${l.s},${l.e - l.s},${l.ids}`);
    }
  }
  const was = coverage(name, before);
  const is = coverage(name);
  console.log(`${name.toUpperCase()}: ${total.toLocaleString()} links before, ${lost.length} lost`);
  for (const l of lost.slice(0, 20)) console.log(`  lost: ${l}`);
  console.log(`Meaningful words linked: ${pct(was.linked, was.words)} → ${pct(is.linked, is.words)} (+${(is.linked - was.linked).toLocaleString()})`);
  process.exit(lost.length ? 1 : 0);
}

// ── BSB test ────────────────────────────────────────────────────────────────

const anchoredTest = flag('--anchored');
console.log(`Aligning BSB ${anchoredTest ? 'with the links NET-style checking would keep held fixed' : 'as if it had no links'}; KJV's links held fixed.\n`);
const gold = readLinks('bsb');
const folded = foldedNumbers();
const forms = wordForms();
/**
 * What a NET-style tag check would keep of a BSB link: the one word of it
 * that is among its number's meanings, as NET tags single words ("Dear" of
 * "Dear friend"). Null when no word is.
 */
const easyWord = (text, l) => {
  const w = englishWords(text.slice(l.s, l.e)).find((x) => x.meaningful && l.ids.split('+').some((id) => forms.get(id)?.has(x.word)));
  return w ? { s: l.s + w.s, e: l.s + w.e, ids: l.ids } : null;
};

const bsbAnchors = new Map();
if (anchoredTest) {
  const texts = readTexts('bsb');
  for (const [key, ls] of gold) bsbAnchors.set(key, ls.map((l) => easyWord(texts.get(key) ?? '', l)).filter(Boolean));
}
const sets = corpusFor('bsb', bsbAnchors, { gold: ['kjv'] });
const model = trainCached(Object.values(sets).flat(), settings);

function score(threshold, skip = settings.skip) {
  const placed = place(model, sets.bsb, { ...settings, threshold, skip });
  const tally = {};
  const blank = () => ({ predicted: 0, right: 0, gold: 0, found: 0 });
  const wrong = [];
  let unscorable = 0;
  const features = [];
  const picks = [];
  for (const rec of sets.bsb) {
    const g = gold.get(rec.key) ?? [];
    const { added } = placed.get(rec.key);
    const picked = new Map(added.map((a) => [a.j, a.id]));
    const pickedAt = new Map(added.map((a) => [a.j, a]));
    rec.words.forEach((w, j) => {
      if (!w.meaningful || rec.anchors.some((a) => overlapsWord(a, w))) return;
      const ids = new Set(g.filter((l) => overlapsWord(l, w)).flatMap((l) => l.ids.split('+')));
      const reachable = !ids.size || [...ids].some((id) => rec.src.includes(id));
      if (!reachable) { unscorable++; return; }
      const hard = ids.size > 0 && ![...ids].some((id) => forms.get(id)?.has(w.word));
      for (const bucket of [rec.testament, `${rec.testament} hard`, 'all']) {
        if (bucket.endsWith('hard') && !hard) continue;
        const t = (tally[bucket] ??= blank());
        if (ids.size) t.gold++;
        const id = picked.get(j);
        if (!id) continue;
        t.predicted++;
        const foldedHere = [...ids].some((x) => folded.get(rec.key)?.get(x)?.has(id));
        if (bucket === 'all' && arg('--features')) {
          const a = pickedAt.get(j);
          features.push([ids.has(id) || foldedHere ? 1 : 0, a.score, a.toNumber, a.toWord, a.support, hard ? 1 : 0, rec.testament, w.word, id, a.joined || '-', rec.key].join('\t'));
        }
        if (bucket === 'all') picks.push({ id, ok: ids.has(id) || foldedHere, odd: rec.verse % 2 === 1 });
        if (ids.has(id) || foldedHere) { t.right++; t.found++; }
        else if (bucket === 'all') wrong.push(`${rec.book} ${rec.chapter}:${rec.verse} "${w.word}" → ${id} (BSB: ${[...ids].join('+') || 'none'})${hard ? ' hard' : ''}`);
      }
    });
  }
  if (arg('--features')) writeFileSync(arg('--features'), features.join('\n'));
  return { tally, wrong, unscorable, picks };
}

/** Numbers whose links in `picks` are right less often than `cutoff` (at least `min` of them). */
function weakNumbers(picks, cutoff, min) {
  const byId = new Map();
  for (const p of picks) {
    const t = byId.get(p.id) ?? { n: 0, ok: 0 };
    t.n++;
    if (p.ok) t.ok++;
    byId.set(p.id, t);
  }
  return new Set([...byId].filter(([, t]) => t.n >= min && t.ok / t.n < cutoff).map(([id]) => id));
}

const rate = (list) => pct(list.filter((p) => p.ok).length, list.length);

if (flag('--write-skip')) {
  // Learn the list on even verses and test it on odd ones, then write the
  // list learned from all of them.
  const cutoff = Number(arg('--cutoff') ?? 0.8);
  const min = Number(arg('--min') ?? 5);
  const { picks } = score(settings.threshold, new Set());
  const learned = weakNumbers(picks.filter((p) => !p.odd), cutoff, min);
  const odd = picks.filter((p) => p.odd);
  const kept = odd.filter((p) => !learned.has(p.id));
  console.log(`\nOdd verses, list learned on even ones (${learned.size} numbers):`);
  console.log(`  before: ${rate(odd)} right of ${odd.length.toLocaleString()} linked`);
  console.log(`  after:  ${rate(kept)} right of ${kept.length.toLocaleString()} linked`);
  const skip = weakNumbers(picks, cutoff, min);
  writeFileSync(SKIP_FILE, `${JSON.stringify({
    note: 'Numbers the aligner never links: under the cutoff on the BSB scorecard. Written by node scripts/score-word-links.mjs --anchored --write-skip.',
    cutoff,
    min,
    ids: [...skip].sort(),
  }, null, 2)}\n`);
  console.log(`\nWrote ${skip.size} numbers to ${SKIP_FILE}`);
  process.exit(0);
}

const report = ({ tally, unscorable }) => {
  console.log(`  (${unscorable.toLocaleString()} words left out: BSB's number for them isn't in our verse)`);
  for (const bucket of ['nt', 'nt hard', 'ot', 'ot hard', 'all']) {
    const t = tally[bucket];
    if (!t) continue;
    console.log(`  ${bucket.toUpperCase().padEnd(8)} right ${pct(t.right, t.predicted).padStart(6)} of ${t.predicted.toLocaleString().padStart(7)} linked · found ${pct(t.found, t.gold).padStart(6)} of ${t.gold.toLocaleString()} BSB links`);
  }
};

if (flag('--sweep')) {
  for (const th of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    const r = score(th);
    const line = (b) => `${b} ${pct(r.tally[b].right, r.tally[b].predicted)} right, ${r.tally[b].predicted.toLocaleString()} linked`;
    console.log(`  threshold ${th}: ${['nt', 'ot', 'all'].map(line).join(' · ')}`);
  }
} else {
  const result = score(settings.threshold);
  console.log(`\nThreshold ${settings.threshold}:`);
  report(result);
  console.log('\n20 wrong:');
  let seed = 7;
  const pick = [...result.wrong].sort(() => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5).slice(0, 20);
  for (const w of pick) console.log(`  ${w}`);
  if (arg('--dump')) writeFileSync(arg('--dump'), result.wrong.join('\n'));
  const all = result.tally.all;
  if (all.right / Math.max(1, all.predicted) < 0.95) {
    console.error(`\n❌ Under 95% right (${pct(all.right, all.predicted)})`);
    process.exit(1);
  }
}
