#!/usr/bin/env node
/**
 * Add "related words by meaning" to the Greek Strong's pack.
 *
 * OpenGNT tags every Greek NT word with its Louw-Nida semantic domain — the
 * sense it carries in that place — at 100% coverage. Grouping by domain gives
 * words related by *meaning* rather than by etymology, which is what a reader
 * asking "what else is like this word" actually wants. Cognates are a different
 * question and often a misleading one.
 *
 * Three things this deliberately does NOT do:
 *
 * 1. It does not ship Louw-Nida's domain names. Those are UBS's copyrighted
 *    lexicon content. Only the numbers travel, and they stay internal — each
 *    group is described to the reader by its own member words instead.
 *
 * 2. It does not treat every domain a word carries as equally its meaning. A
 *    word picks up rare idiomatic senses: ἀλήθεια appears inside prepositional
 *    idioms, so counting every tagged sense made prepositions its "closest"
 *    relatives. Only domains covering at least a quarter of a word's tagged
 *    occurrences count as what the word means.
 *
 * 3. It does not use the sub-domain alone. Most sub-domains have exactly one
 *    member, so that gave a median of zero related words. Rolling all the way
 *    up to the 93 top-level domains gave a median of 249, which is not a list
 *    anyone reads. Both tiers ship: the exact sense, then the surrounding area.
 *
 * Run after build-strongs-from-stepbible.mjs and before build-lexical-pack-v2.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const OGNT = join(repoRoot, 'packs/opengnt-morphology.sqlite');
const TARGET = join(repoRoot, 'packs/strongs-greek.sqlite');

/** A domain must account for this much of a word's tagged uses to count as
 *  one of its meanings rather than an incidental sense. */
const DOMINANT = 0.25;
const MAX_SENSE = 8;
const MAX_AREA = 10;

for (const p of [OGNT, TARGET]) {
  if (!existsSync(p)) {
    console.error(`❌ Missing ${p}`);
    process.exit(1);
  }
}

/** OpenGNT wraps its fields in 〔〕 delimiters that were never stripped on
 *  import, so 'G0976' arrives as 'G0976〕' and a domain as '33.38〕'. */
const clean = (s) => (s == null ? '' : String(s).replace(/[〔〕]/g, '').trim());

/** The lexicon keys on four-digit ids, keeping any disambiguating letter. */
function normalise(raw) {
  const m = clean(raw).match(/^([GH])(\d+)([A-Za-z]?)$/);
  return m ? m[1] + m[2].padStart(4, '0') + m[3] : null;
}

console.log('🔗 Building semantic-domain relations from OpenGNT\n');

const ognt = new Database(OGNT, { readonly: true });
const perWord = new Map(); // id -> { domains: Map<domain,count>, freq, lemma, gloss }

for (const row of ognt.prepare('SELECT strongs, louw_nida, gloss_en, lemma FROM words').iterate()) {
  const id = normalise(row.strongs);
  if (!id) continue;
  let w = perWord.get(id);
  if (!w) {
    w = { domains: new Map(), freq: 0, lemma: clean(row.lemma), gloss: clean(row.gloss_en) };
    perWord.set(id, w);
  }
  w.freq++;
  for (const raw of clean(row.louw_nida).split(/[，,]/)) {
    const d = raw.trim();
    if (!/^\d+\.\d+$/.test(d)) continue;
    w.domains.set(d, (w.domains.get(d) ?? 0) + 1);
  }
}
ognt.close();
console.log(`   ${perWord.size.toLocaleString()} Strong's numbers carry domains`);

// Keep only each word's dominant domains, and index both tiers.
const bySub = new Map();
const byTop = new Map();
const wordSub = new Map();
const wordTop = new Map();
const add = (map, key, id) => {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(id);
};

for (const [id, w] of perWord) {
  const total = [...w.domains.values()].reduce((a, b) => a + b, 0);
  if (!total) continue;
  const subs = new Set();
  const tops = new Set();
  for (const [d, n] of w.domains) {
    if (n / total < DOMINANT) continue;
    subs.add(d);
    tops.add(d.split('.')[0]);
    add(bySub, d, id);
    add(byTop, d.split('.')[0], id);
  }
  if (subs.size) {
    wordSub.set(id, subs);
    wordTop.set(id, tops);
  }
}
console.log(`   ${wordSub.size.toLocaleString()} have a dominant sense`);
console.log(`   ${bySub.size.toLocaleString()} sub-domains, ${byTop.size} top-level domains`);

const brief = (id) => {
  const w = perWord.get(id);
  return { id, lemma: w?.lemma ?? '', gloss: w?.gloss ?? '' };
};

function relationsFor(id) {
  const shared = new Map();
  for (const d of wordSub.get(id) ?? []) {
    for (const other of bySub.get(d) ?? []) {
      if (other !== id) shared.set(other, (shared.get(other) ?? 0) + 1);
    }
  }
  const area = new Map();
  for (const t of wordTop.get(id) ?? []) {
    for (const other of byTop.get(t) ?? []) {
      if (other !== id && !shared.has(other)) area.set(other, (area.get(other) ?? 0) + 1);
    }
  }
  const rank = (m, limit) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || (perWord.get(b[0])?.freq ?? 0) - (perWord.get(a[0])?.freq ?? 0))
      .slice(0, limit)
      .map(([other]) => brief(other));
  return { sense: rank(shared, MAX_SENSE), area: rank(area, MAX_AREA) };
}

const target = new Database(TARGET);
const cols = target.prepare('PRAGMA table_info(strongs_entries)').all().map((c) => c.name);
if (!cols.includes('related')) {
  target.exec('ALTER TABLE strongs_entries ADD COLUMN related TEXT');
  console.log('\n   added column: related');
}

const update = target.prepare('UPDATE strongs_entries SET related = ? WHERE id = ?');
let written = 0;
let empty = 0;
let inherited = 0;
const writeAll = target.transaction(() => {
  for (const row of target.prepare('SELECT id FROM strongs_entries').all()) {
    let id = row.id;
    let viaBase = false;
    if (!wordSub.has(id)) {
      // TAGNT tags words with disambiguated ids — πίστις is G4102G, not G4102 —
      // but the domain tagging is keyed on the plain number. Without this the
      // ~4,000 disambiguated words in the text get no relations at all.
      const m = id.match(/^([GH])(\d+)[A-Za-z]$/);
      const base = m ? m[1] + m[2] : null;
      if (base && wordSub.has(base)) {
        id = base;
        viaBase = true;
      }
    }
    const rel = wordSub.has(id) ? relationsFor(id) : { sense: [], area: [] };
    if (!rel.sense.length && !rel.area.length) {
      empty++;
      continue;
    }
    update.run(JSON.stringify(rel), row.id);
    written++;
    if (viaBase) inherited++;
  }
});
writeAll();

console.log(`\n   entries with relations: ${written.toLocaleString()}`);
console.log(`   entries without        : ${empty.toLocaleString()} (no NT occurrences tagged)`);

target.close();
console.log(`\n✅ ${TARGET}`);
