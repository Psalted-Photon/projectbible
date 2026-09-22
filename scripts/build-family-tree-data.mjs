#!/usr/bin/env node

/**
 * Build Family Tree Lab Data (roadmap #25)
 *
 * Read-only. Reads packs/people.sqlite and emits one JSON for the family tree
 * lab. The pack is never modified.
 *
 * Source: Theographic Bible Metadata by Robert Rouse, CC BY-SA 4.0.
 * The licence is viral — the attribution emitted here must stay on screen.
 *
 * Output: apps/pwa-polished/public/family-tree-data.json
 *
 * It lands in public/ because the lab page ships with the app (so it can be
 * opened on a phone) rather than being dev-server only.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PACK = path.join(ROOT, 'packs/people.sqlite');
const OUT = path.join(ROOT, 'apps/pwa-polished/public/family-tree-data.json');

// The patriarch. Distinct from jacob_683, who is Joseph's father in Matthew's
// line — conflating the two slugs silently grafts the whole Matthean genealogy
// onto the twelve tribes.
const JACOB = 'israel_682';
const ABRAHAM = 'abraham_58';

console.log('🌳 Building family tree lab data');
console.log(`   Source: ${path.relative(ROOT, PACK)}`);

if (!fs.existsSync(PACK)) {
  throw new Error(`people.sqlite not found at ${PACK}`);
}

const db = new Database(PACK, { readonly: true });

const people = new Map();
for (const r of db
  .prepare(
    `SELECT person_id, name, display_title, father, mother, children,
            member_of, name_meaning, dict_text, birth_year, verse_count
     FROM people`
  )
  .all()) {
  people.set(r.person_id, r);
}
console.log(`   ${people.size} people`);

/** father/children/member_of are JSON arrays of {name, slug}; [] when absent. */
function parseLinks(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function fatherOf(id) {
  const r = people.get(id);
  if (!r) return null;
  const f = parseLinks(r.father);
  return f.length ? f[0].slug : null;
}

// ── Tribe, derived ────────────────────────────────────────────────────────
// Walk the father chain to one of Jacob's children. Derivation is preferred
// over the member_of tag (23% coverage) because it is traceable — that is the
// claim the prettier charts cannot make.

const sons = new Map(); // slug -> tribe name
for (const s of parseLinks(people.get(JACOB)?.children)) {
  sons.set(s.slug, s.name);
}
if (sons.size === 0) throw new Error(`No children found for ${JACOB}`);

const tribeOf = new Map(); // person_id -> tribe name
const depthOf = new Map(); // person_id -> generations below the son of Jacob

for (const id of people.keys()) {
  const path = [];
  const seen = new Set();
  let cur = id;
  // `seen` guards against a cycle in the data, which would otherwise hang here.
  while (cur && people.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    if (sons.has(cur)) break;
    cur = fatherOf(cur);
  }
  if (cur && sons.has(cur)) {
    tribeOf.set(id, sons.get(cur));
    depthOf.set(id, path.length - 1);
  }
}

// ── Labels, disambiguated here rather than at draw time ───────────────────
// Duplicate names are everywhere (four Judahs, five by some counts). Resolving
// once at build time keeps the lab's draw loop from doing string work per node.

const byName = new Map();
for (const id of tribeOf.keys()) {
  const n = people.get(id).name;
  if (!byName.has(n)) byName.set(n, []);
  byName.get(n).push(id);
}

function labelFor(id) {
  const r = people.get(id);
  const dupes = byName.get(r.name);
  if (!dupes || dupes.length === 1) return r.name;
  // display_title already disambiguates most collisions ("Judah (patriarch)").
  if (r.display_title && r.display_title !== r.name) return r.display_title;
  const f = fatherOf(id);
  const fname = f && people.get(f) ? people.get(f).name : null;
  return fname ? `${r.name} (son of ${fname})` : r.name;
}

// ── Verse refs ────────────────────────────────────────────────────────────

const versesBy = new Map();
for (const v of db
  .prepare('SELECT person_id, book, chapter, verse FROM person_verses')
  .all()) {
  if (!tribeOf.has(v.person_id)) continue;
  if (!versesBy.has(v.person_id)) versesBy.set(v.person_id, []);
  const list = versesBy.get(v.person_id);
  // The lab shows a handful under a traced node, not all 28,240.
  if (list.length < 12) list.push(`${v.book} ${v.chapter}:${v.verse}`);
}

// ── Nodes ─────────────────────────────────────────────────────────────────

const nodes = [];
for (const [id, tribe] of tribeOf) {
  const r = people.get(id);
  nodes.push({
    id,
    label: labelFor(id),
    father: fatherOf(id),
    tribe,
    depth: depthOf.get(id),
    meaning: r.name_meaning || null,
    prose: r.dict_text || null,
    verses: versesBy.get(id) || [],
    verseCount: r.verse_count ?? 0,
  });
}

// ── Root chain: Abraham back to God ───────────────────────────────────────

const roots = [];
{
  const seen = new Set();
  let cur = ABRAHAM;
  while (cur && people.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const r = people.get(cur);
    roots.push({
      id: cur,
      label: r.display_title || r.name,
      meaning: r.name_meaning || null,
      prose: r.dict_text || null,
    });
    cur = fatherOf(cur);
  }
}

// ── The crown: Matthew's and Luke's lines to Jesus ────────────────────────
// They diverge at David (Solomon vs. Nathan), touch at Shealtiel/Zerubbabel,
// and disagree on Joseph's father. Both are drawn so neither is silently
// chosen; each is labelled.

function chainUp(fromId, stopId) {
  const out = [];
  const seen = new Set();
  let cur = fromId;
  while (cur && people.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    if (cur === stopId) break;
    cur = fatherOf(cur);
  }
  return out.reverse();
}

// jesus_905 is the one with a genealogy; jesus_904 is an unrelated namesake
// with no links at all, so a startsWith('jesus_') match picks the wrong man.
const JESUS = 'jesus_905';
// Luke names Heli as Joseph's father where Matthew names Jacob, so Luke's line
// is reached through Heli rather than through Jesus.
const HELI = 'heli_1484';

function crownLine(fromId) {
  return chainUp(fromId, JACOB).map((id) => ({
    id,
    label: people.get(id)?.display_title || labelFor(id),
  }));
}

const matthew = crownLine(JESUS);
const luke = people.has(HELI) ? [...crownLine(HELI), { id: JESUS, label: 'Jesus Christ' }] : [];

// Where the two lines run together they must draw as one bough, or the shared
// stretch from Judah to David renders twice and reads as two trunks.
const lukeIds = new Set(luke.map((n) => n.id));
const shared = matthew.filter((n) => lukeIds.has(n.id)).map((n) => n.id);

// Both chains run Jacob -> ... -> Jesus, so they share a common stretch at the
// start and meet again at Jesus himself. The fork is the last node the two
// agree on walking forward — David — not the last entry in `shared`, which is
// the rejoin. Comparing position by position is what separates the two.
let forkAt = 0;
while (forkAt < matthew.length && forkAt < luke.length && matthew[forkAt].id === luke[forkAt].id) {
  forkAt++;
}

const crown = {
  jesus: JESUS,
  matthew,
  luke,
  shared,
  // Named so the lab can label the fork rather than asserting one line is right.
  divergeAt: forkAt > 0 ? matthew[forkAt - 1].id : null,
};

// ── Emit ──────────────────────────────────────────────────────────────────

const counts = {};
for (const t of tribeOf.values()) counts[t] = (counts[t] || 0) + 1;

const out = {
  attribution:
    'Theographic Bible Metadata by Robert Rouse, licensed CC BY-SA 4.0. ' +
    'Name meanings from Hitchcock’s Bible Names Dictionary (public domain).',
  generated: new Date().toISOString().slice(0, 10),
  jacob: JACOB,
  // Birth order, which is also the order of the breastpiece stones.
  tribeOrder: [
    'Reuben', 'Simeon', 'Levi', 'Judah', 'Dan', 'Naphtali',
    'Gad', 'Asher', 'Issachar', 'Zebulun', 'Joseph', 'Benjamin',
  ],
  counts,
  maxDepth: Math.max(...depthOf.values()),
  roots,
  crown,
  nodes,
};

fs.writeFileSync(OUT, JSON.stringify(out));

const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log(`   ${nodes.length} traced, max depth ${out.maxDepth}`);
console.log(`   ${sorted.map(([t, n]) => `${t} ${n}`).join(', ')}`);
console.log(`   roots: ${roots.length} nodes, ending at ${roots[roots.length - 1]?.label}`);
console.log(
  `   crown: Matthew ${crown.matthew.length}, Luke ${crown.luke.length}, ` +
    `shared ${crown.shared.length} (fork at ${people.get(crown.divergeAt)?.name ?? '?'})`
);
console.log(`✅ ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);

db.close();
