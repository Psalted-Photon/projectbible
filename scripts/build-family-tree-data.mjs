#!/usr/bin/env node

/**
 * Build Family Tree Data (roadmap #25)
 *
 * Read-only. Reads packs/people.sqlite and emits one JSON for the in-app
 * family tree. The pack is never modified.
 *
 * Source: Theographic Bible Metadata by Robert Rouse, CC BY-SA 4.0.
 * The licence is viral — the attribution emitted here must stay on screen.
 *
 * Output: apps/pwa-polished/src/data/family-tree.json
 *
 * It lands under src/data, not public/, because the app loads it as a lazy
 * chunk (src/lib/familyTree/data.ts) so the service worker precaches it and
 * it stops counting against the main bundle. `prose`, `verses`, `birthYear`,
 * `deathYear` and `marriedIn` are dropped before the write: the People bio
 * sheet shows the prose, the tree never drew the rest, and cutting them takes
 * the file from 485 KB to about 133 KB.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const PACK = path.join(ROOT, 'packs/people.sqlite');
const OUT = path.join(ROOT, 'apps/pwa-polished/src/data/family-tree.json');

// The patriarch. Distinct from jacob_683, who is Joseph's father in Matthew's
// line — conflating the two slugs silently grafts the whole Matthean genealogy
// onto the twelve tribes.
const JACOB = 'israel_682';

console.log('🌳 Building family tree data');
console.log(`   Source: ${path.relative(ROOT, PACK)}`);

if (!fs.existsSync(PACK)) {
  throw new Error(`people.sqlite not found at ${PACK}`);
}

const db = new Database(PACK, { readonly: true });

const people = new Map();
for (const r of db
  .prepare(
    `SELECT person_id, name, display_title, gender, father, mother, children,
            partners, member_of, name_meaning, dict_text,
            birth_year, death_year, verse_count
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

// ── The roots: God down to Jacob, as a tree ───────────────────────────────
// The old version climbed `father` from Abraham and kept one man per
// generation, which threw away every brother, every sister and every wife —
// 172 people the pack already holds, the whole Table of Nations among them.
// This descends through `children` instead, so a branch is a branch.

const ADAM = 'adam_78';
const GOD = 'god_1324';

// The descent has to stop somewhere, and "stop at Jacob" is not enough: Leah
// and Rachel are Laban's daughters, so walking their children walks straight
// into Judah's line and out through Luke's genealogy — 802 nodes instead of
// 187. Anyone the canopy already draws is a stopping point.
const inCanopy = (id) => tribeOf.has(id);

const rootSeen = new Set();
const rootParent = new Map(); // person_id -> the node it hangs from here
const rootOrder = [];

function descend(id, from) {
  if (!id || !people.has(id) || rootSeen.has(id) || inCanopy(id)) return;
  rootSeen.add(id);
  rootParent.set(id, from);
  rootOrder.push(id);
  // Jacob is the trunk. His children are the twelve boughs, drawn above.
  if (id === JACOB) return;
  for (const c of parseLinks(people.get(id).children)) descend(c.slug, id);
}

// God's `children` are Adam and Eve, so starting there seats the taproot and
// picks up Eve without a special case.
descend(people.has(GOD) ? GOD : ADAM, null);

// Wives who are nobody's daughter in this window — Hagar, Keturah, Zillah,
// Bilhah — are reached only through their partner. `rootSpouse` records that
// they arrived that way: setting rootParent alone made them their husband's
// CHILDREN, which drew Bilhah and Zilpah as a fourteenth and fifteenth bough
// of Jacob, standing next to Reuben.
const rootSpouse = new Map(); // person_id -> the partner they were reached by
for (const id of [...rootOrder]) {
  for (const p of parseLinks(people.get(id).partners)) {
    if (!people.has(p.slug) || rootSeen.has(p.slug) || inCanopy(p.slug)) continue;
    rootSeen.add(p.slug);
    rootParent.set(p.slug, id);
    rootSpouse.set(p.slug, id);
    rootOrder.push(p.slug);
  }
}

// A son is listed under his mother as well as his father, and whichever the
// walk met first became his parent here — which hung Isaac off Sarah and Jacob
// off Rebekah, breaking the father-spine the roots are drawn along. Reseat
// anyone whose real father is also in this window.
for (const id of rootOrder) {
  if (rootSpouse.has(id)) continue; // reached as a wife, not as a child
  const f = fatherOf(id);
  if (f && rootSeen.has(f) && f !== id) rootParent.set(id, f);
}

// ── Branch keys ───────────────────────────────────────────────────────────
// The hand-placed directions in the lab are keyed by branch, exactly as the
// twelve boughs are. Everything on the Adam -> Jacob trunk is 'Trunk'; each
// head below owns its whole subtree and gets its own dials.
//
// These are every off-trunk subtree of three or more, in the order they fork
// on the way up, so the panel reads down the trunk. The tree is badly lopsided
// — from Noah, Shem carries 781 people and Ham 31 — so leaf-count weighting
// alone would squash Ham and Japheth to slivers. That is exactly why the twelve
// are placed by hand, and these eleven need it for the same reason.

const ROOT_BRANCH_HEADS = [
  ['cain_533', 'Cain'],          // forks at Adam
  ['ham_1359', 'Ham'],           // at Noah
  ['japheth_726', 'Japheth'],    // at Noah
  ['aram_285', 'Aram'],          // at Shem — the son of Shem, not aram_286
  ['joktan_1686', 'Joktan'],     // at Eber
  ['nahor_2143', 'Nahor'],       // at Terah
  ['haran_1407', 'Haran'],       // at Terah — carries Lot
  ['ishmael_630', 'Ishmael'],    // at Abraham
  ['midian_2075', 'Midian'],     // at Abraham
  ['jokshan_1685', 'Jokshan'],   // at Abraham
  ['esau_1216', 'Esau'],         // at Isaac — Jacob's brother
];

// The trunk itself, so everyone else can be told apart from it. Climbing
// `rootParent` from Jacob is what the old code did, minus the discarding.
const trunk = new Set();
{
  let cur = JACOB;
  while (cur && rootSeen.has(cur) && !trunk.has(cur)) {
    trunk.add(cur);
    cur = rootParent.get(cur);
  }
}

const rootBranch = new Map();
for (const [head, name] of ROOT_BRANCH_HEADS) {
  if (!rootSeen.has(head)) continue;
  const stack = [head];
  while (stack.length) {
    const id = stack.pop();
    if (rootBranch.has(id) || trunk.has(id)) continue;
    rootBranch.set(id, name);
    for (const c of parseLinks(people.get(id).children)) {
      if (rootSeen.has(c.slug) && rootParent.get(c.slug) === id) stack.push(c.slug);
    }
    for (const p of parseLinks(people.get(id).partners)) {
      if (rootSeen.has(p.slug) && rootParent.get(p.slug) === id) stack.push(p.slug);
    }
  }
}

// Depth from Adam, which is what the card prints and what the layout rings on.
// Computed by climbing rather than in walk order, because reseating people on
// their father above means a node can now precede its parent in `rootOrder`.
const rootDepth = new Map();
function depthOfRoot(id, guard) {
  if (rootDepth.has(id)) return rootDepth.get(id);
  const f = rootParent.get(id);
  if (f == null || !rootSeen.has(f) || guard.has(id)) {
    rootDepth.set(id, 0);
    return 0;
  }
  guard.add(id);
  const d = depthOfRoot(f, guard) + 1;
  rootDepth.set(id, d);
  return d;
}
for (const id of rootOrder) depthOfRoot(id, new Set());

// Marriage crosses generations, and descent alone gets it wrong in both
// directions. Leah and Rachel are Laban's daughters, so climbing fathers put
// them a ring BELOW Jacob — on the same ring as his children. A wife reached
// through her husband landed a ring below him for the opposite reason. Either
// way a couple must share a ring, so every marriage inside this window is
// levelled to the shallower of the two.
const marriedTo = new Map(); // person_id -> partner in this window
for (const id of rootOrder) {
  for (const pl of parseLinks(people.get(id).partners)) {
    if (rootSeen.has(pl.slug)) marriedTo.set(id, pl.slug);
  }
}

// The same relation as seen from the wife's side, and emitted. A woman may be
// on the tree as a daughter and still be someone's wife; both facts are true
// and the page needs the marriage to seat her beside him.
const partnerIn = new Map();
for (const id of rootOrder) {
  if (id === GOD) continue;
  for (const pl of parseLinks(people.get(id).partners)) {
    if (!rootSeen.has(pl.slug) || pl.slug === GOD) continue;
    // Women are seated beside men, so the relation is recorded on the wife.
    if (people.get(id).gender === 'Female') partnerIn.set(id, pl.slug);
  }
}
// Two passes, because levelling one couple can change what "shallower" means
// for the next — Rebekah moves to Isaac, and Isaac is already settled.
for (let pass = 0; pass < 2; pass++) {
  for (const [id, via] of marriedTo) {
    if (!rootDepth.has(id) || !rootDepth.has(via)) continue;
    const d = Math.min(rootDepth.get(id), rootDepth.get(via));
    rootDepth.set(id, d);
    rootDepth.set(via, d);
  }
}

// God sits at the base of the trunk, below Adam, with everything he is in the
// pack — his 8,587 verses and his prose. An earlier pass drew him as a band of
// soil instead and dropped the node; it read worse than simply being the foot
// of the tree, so he is a node again. He has no father, and the page's trunk
// walk stops on a missing father, so he lands at the end of the trunk with no
// layout special case at all.
const emitted = rootOrder;

// Labels: the same collision handling the canopy gets, over the root set.
const rootByName = new Map();
for (const id of emitted) {
  const n = people.get(id).name;
  if (!rootByName.has(n)) rootByName.set(n, []);
  rootByName.get(n).push(id);
}

function rootLabelFor(id) {
  const r = people.get(id);
  if (r.display_title && r.display_title !== r.name) return r.display_title;
  const dupes = rootByName.get(r.name);
  if (!dupes || dupes.length === 1) return r.name;
  const f = rootParent.get(id);
  const fname = f && people.get(f) ? people.get(f).name : null;
  return fname ? `${r.name} (of ${fname})` : r.name;
}

// Verse refs for root people too, on the same 12-ref budget as the canopy.
const rootVerses = new Map();
for (const v of db
  .prepare('SELECT person_id, book, chapter, verse FROM person_verses')
  .all()) {
  if (!rootSeen.has(v.person_id)) continue;
  if (!rootVerses.has(v.person_id)) rootVerses.set(v.person_id, []);
  const list = rootVerses.get(v.person_id);
  if (list.length < 12) list.push(`${v.book} ${v.chapter}:${v.verse}`);
}

const roots = emitted.map((id) => {
  const r = people.get(id);
  // Years are negative (BC). A lifespan needs both ends; God has neither, and
  // Cainan son of Arphaxad has neither, so `lived` stays null rather than NaN.
  const lived =
    typeof r.birth_year === 'number' && typeof r.death_year === 'number'
      ? r.death_year - r.birth_year
      : null;
  return {
    id,
    label: rootLabelFor(id),
    father: rootSpouse.has(id) ? null : rootParent.get(id) ?? null,
    // Whom this person is married to, where both are on the tree. Set for
    // everyone married in this window, not only for the wives who were REACHED
    // through a husband — Leah and Rachel are Laban's daughters, so the walk
    // met them as children, and without this they would draw as descendants of
    // Laban's bough instead of standing beside Jacob.
    spouseOf: partnerIn.get(id) ?? null,
    // True only for those who are on the tree solely as someone's wife, and so
    // have no parent here to hang from.
    marriedIn: rootSpouse.has(id),
    depth: rootDepth.get(id) ?? 0,
    branch: rootBranch.get(id) || 'Trunk',
    female: r.gender === 'Female',
    meaning: r.name_meaning || null,
    prose: r.dict_text || null,
    birthYear: typeof r.birth_year === 'number' ? r.birth_year : null,
    deathYear: typeof r.death_year === 'number' ? r.death_year : null,
    lived: lived != null && lived > 0 ? lived : null,
    verses: rootVerses.get(id) || [],
    verseCount: r.verse_count ?? 0,
  };
});

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

// The app draws the tree from this file but shows the prose in the People bio
// sheet instead, which reads it from the people pack directly — so `prose`
// and `verses` are dead weight here. `birthYear`, `deathYear` and `marriedIn`
// were lab-only readout fields the tree itself never drew.
function slimNode({ prose, verses, ...rest }) {
  return rest;
}
function slimRoot({ prose, verses, birthYear, deathYear, marriedIn, ...rest }) {
  return rest;
}

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
  // The order the lab lists the root dials in; 'Trunk' is Adam -> Jacob.
  rootBranchOrder: ['Trunk', ...ROOT_BRANCH_HEADS.map(([, n]) => n)],
  rootCounts: roots.reduce((a, r) => ((a[r.branch] = (a[r.branch] || 0) + 1), a), {}),
  rootMaxDepth: roots.reduce((m, r) => Math.max(m, r.depth), 0),
  roots: roots.map(slimRoot),
  crown,
  nodes: nodes.map(slimNode),
};

fs.writeFileSync(OUT, JSON.stringify(out));

const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log(`   ${nodes.length} traced, max depth ${out.maxDepth}`);
console.log(`   ${sorted.map(([t, n]) => `${t} ${n}`).join(', ')}`);
console.log(
  `   roots: ${roots.length} nodes, depth ${out.rootMaxDepth}, ` +
    `${roots.filter((r) => r.female).length} women, ` +
    Object.entries(out.rootCounts).map(([b, n]) => `${b} ${n}`).join(', ')
);
console.log(
  `   crown: Matthew ${crown.matthew.length}, Luke ${crown.luke.length}, ` +
    `shared ${crown.shared.length} (fork at ${people.get(crown.divergeAt)?.name ?? '?'})`
);
console.log(`✅ ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);

db.close();
