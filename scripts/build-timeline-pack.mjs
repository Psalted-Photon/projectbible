#!/usr/bin/env node

/**
 * Build Timeline Pack
 *
 * Everything the Timeline window draws, in one table:
 *   metadata         key/value pack info
 *   timeline_items   one row per thing on the strip, whatever lane it is in
 *
 * Lanes: events, eras, kings, prophets, world, lives, books. Every row has a
 * title, a span of signed years (negative = BC, no year 0), a tier for events
 * (1 headline, 2 main, 3 detail), and the passages, people and places it leads
 * to. Passages are verse ranges with a printed label; people are People-pack
 * ids with a display name; places have coordinates, for the map.
 *
 * Two sources:
 *   - Theographic Bible Metadata (Robert Rouse, CC BY-SA 4.0), in
 *     data-sources/theographic/theographic-bible-metadata-master/json/ (gitignored):
 *     its 450 events with their verses, people and places. Its dates are
 *     Ussher's, in astronomical years; they are converted (0 and below lose
 *     one) and re-dated to modern conservative dates by straight-line
 *     interpolation between the anchors in anchors.json and the Judah kings.
 *   - The hand-written files in data-manifests/timeline/ (kept in git): eras,
 *     kings, prophets, world powers, the silent years, the 66 books, lifespans,
 *     the events Theographic lacks, and theographic.json, which says how its
 *     events are tiered, titled, grouped and corrected.
 *
 * Because Theographic is share-alike, this is its own pack rather than being
 * folded into Study Tools.
 *
 * Usage:
 *   node scripts/build-timeline-pack.mjs           build the pack
 *   node scripts/build-timeline-pack.mjs --check   run every check, write nothing
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const THEO = resolve(ROOT, 'data-sources/theographic/theographic-bible-metadata-master/json');
const MAN = resolve(ROOT, 'data-manifests/timeline');
const PACK_OUTPUT = resolve(ROOT, 'packs/consolidated/timeline.sqlite');
const CHECK = process.argv.includes('--check');

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`❌ Missing: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}
const theo = (name) => readJson(resolve(THEO, name));
const man = (name) => readJson(resolve(MAN, name));

/* --------------------------------------------------------------------------- *
 * Books and verses
 * ------------------------------------------------------------------------- */

// OSIS book code -> the app's book name (lib/bibleData.ts). "Psalm", singular,
// is how the app stores the book.
const OSIS_TO_BOOK = {
  Gen: 'Genesis', Exod: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deut: 'Deuteronomy',
  Josh: 'Joshua', Judg: 'Judges', Ruth: 'Ruth', '1Sam': '1 Samuel', '2Sam': '2 Samuel',
  '1Kgs': '1 Kings', '2Kgs': '2 Kings', '1Chr': '1 Chronicles', '2Chr': '2 Chronicles',
  Ezra: 'Ezra', Neh: 'Nehemiah', Esth: 'Esther', Job: 'Job', Ps: 'Psalm', Prov: 'Proverbs',
  Eccl: 'Ecclesiastes', Song: 'Song of Solomon', Isa: 'Isaiah', Jer: 'Jeremiah',
  Lam: 'Lamentations', Ezek: 'Ezekiel', Dan: 'Daniel', Hos: 'Hosea', Joel: 'Joel',
  Amos: 'Amos', Obad: 'Obadiah', Jonah: 'Jonah', Mic: 'Micah', Nah: 'Nahum', Hab: 'Habakkuk',
  Zeph: 'Zephaniah', Hag: 'Haggai', Zech: 'Zechariah', Mal: 'Malachi', Matt: 'Matthew',
  Mark: 'Mark', Luke: 'Luke', John: 'John', Acts: 'Acts', Rom: 'Romans',
  '1Cor': '1 Corinthians', '2Cor': '2 Corinthians', Gal: 'Galatians', Eph: 'Ephesians',
  Phil: 'Philippians', Col: 'Colossians', '1Thess': '1 Thessalonians', '2Thess': '2 Thessalonians',
  '1Tim': '1 Timothy', '2Tim': '2 Timothy', Titus: 'Titus', Phlm: 'Philemon', Heb: 'Hebrews',
  Jas: 'James', '1Pet': '1 Peter', '2Pet': '2 Peter', '1John': '1 John', '2John': '2 John',
  '3John': '3 John', Jude: 'Jude', Rev: 'Revelation',
};
const BOOKS = Object.values(OSIS_TO_BOOK);
const BOOK_INDEX = new Map(BOOKS.map((b, i) => [b, i]));

/** Verse records by Theographic record id, and the last verse of every chapter. */
const verseById = new Map();
const lastVerse = new Map(); // "Book|chapter" -> n
const lastChapter = new Map(); // book -> n
for (const v of theo('verses.json')) {
  const [osis, c, n] = v.fields.osisRef.split('.');
  const book = OSIS_TO_BOOK[osis];
  if (!book) continue;
  const chapter = +c;
  const verse = +n;
  verseById.set(v.id, { book, chapter, verse });
  const key = `${book}|${chapter}`;
  if ((lastVerse.get(key) ?? 0) < verse) lastVerse.set(key, verse);
  if ((lastChapter.get(book) ?? 0) < chapter) lastChapter.set(book, chapter);
}

const pos = (b, c, v) => BOOK_INDEX.get(b) * 1e6 + c * 1e3 + v;

/** "Genesis 3", "Genesis 6–9", "John 10:22", "Genesis 22:1–19", "Genesis 46:1–47:12". */
function labelFor(p) {
  const wholeStart = p.v === 1;
  const wholeEnd = p.ev === lastVerse.get(`${p.b}|${p.ec}`);
  if (p.c === 1 && p.v === 1 && p.ec === lastChapter.get(p.b) && wholeEnd && lastChapter.get(p.b) > 1) return p.b;
  if (wholeStart && wholeEnd) return p.c === p.ec ? `${p.b} ${p.c}` : `${p.b} ${p.c}–${p.ec}`;
  if (p.c === p.ec) return p.v === p.ev ? `${p.b} ${p.c}:${p.v}` : `${p.b} ${p.c}:${p.v}–${p.ev}`;
  return `${p.b} ${p.c}:${p.v}–${p.ec}:${p.ev}`;
}

function checkVerse(b, c, v, where) {
  const last = lastVerse.get(`${b}|${c}`);
  if (!last) fail(`${where}: ${b} ${c} does not exist`);
  else if (v < 1 || v > last) fail(`${where}: ${b} ${c}:${v} does not exist (chapter has ${last})`);
}

/**
 * Parse a hand-written passage list: "Genesis 46:1-47:12; 2 Kings 18-20; John 10:22".
 * Book names are the app's; a bare chapter (or chapter range) means the whole of it.
 */
function parsePassages(text, where) {
  if (!text) return [];
  const out = [];
  for (const raw of text.split(';')) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/^(.+?)\s+(\d+)(?::(\d+))?(?:\s*[-–]\s*(?:(\d+):)?(\d+))?$/);
    if (!m) { fail(`${where}: cannot read passage "${s}"`); continue; }
    const [, book, c1, v1, c2, n2] = m;
    if (!BOOK_INDEX.has(book)) { fail(`${where}: unknown book "${book}" in "${s}"`); continue; }
    let p;
    if (v1 === undefined) {
      // "Book C" or "Book C-C2": whole chapters.
      const ec = n2 !== undefined ? +n2 : +c1;
      p = { b: book, c: +c1, v: 1, ec, ev: lastVerse.get(`${book}|${ec}`) ?? 1 };
    } else if (n2 === undefined) {
      p = { b: book, c: +c1, v: +v1, ec: +c1, ev: +v1 };
    } else if (c2 === undefined) {
      p = { b: book, c: +c1, v: +v1, ec: +c1, ev: +n2 };
    } else {
      p = { b: book, c: +c1, v: +v1, ec: +c2, ev: +n2 };
    }
    checkVerse(p.b, p.c, p.v, where);
    checkVerse(p.b, p.ec, p.ev, where);
    if (pos(p.b, p.ec, p.ev) < pos(p.b, p.c, p.v)) fail(`${where}: "${s}" runs backwards`);
    out.push({ ...p, label: labelFor(p) });
  }
  return out;
}

/** A whole book, for the books lane. */
function wholeBook(book) {
  const ec = lastChapter.get(book);
  const p = { b: book, c: 1, v: 1, ec, ev: lastVerse.get(`${book}|${ec}`) };
  return [{ ...p, label: book }];
}

/** Theographic verse records -> sorted, collapsed ranges. */
function rangesFromVerses(recIds) {
  const verses = [...new Set(recIds)]
    .map((id) => verseById.get(id))
    .filter(Boolean)
    .sort((a, b) => pos(a.book, a.chapter, a.verse) - pos(b.book, b.chapter, b.verse));
  const out = [];
  let cur = null;
  for (const v of verses) {
    if (cur) {
      const sameChapterNext = v.book === cur.b && v.chapter === cur.ec && v.verse === cur.ev + 1;
      const nextChapter = v.book === cur.b && v.chapter === cur.ec + 1 && v.verse === 1
        && cur.ev === lastVerse.get(`${cur.b}|${cur.ec}`);
      if (sameChapterNext || nextChapter) {
        cur.ec = v.chapter;
        cur.ev = v.verse;
        continue;
      }
      if (v.book === cur.b && v.chapter === cur.ec && v.verse <= cur.ev) continue; // duplicate
      out.push(cur);
    }
    cur = { b: v.book, c: v.chapter, v: v.verse, ec: v.chapter, ev: v.verse };
  }
  if (cur) out.push(cur);
  return out.map((p) => ({ ...p, label: labelFor(p) }));
}

/* --------------------------------------------------------------------------- *
 * People and places
 * ------------------------------------------------------------------------- */

const personByRec = new Map();
const personByLookup = new Map();
for (const p of theo('people.json')) {
  const f = p.fields;
  const person = { id: f.personLookup, name: f.displayTitle || f.name };
  personByRec.set(p.id, person);
  personByLookup.set(f.personLookup, person);
}

const placeByRec = new Map();
const placeByLookup = new Map();
for (const p of theo('places.json')) {
  const f = p.fields;
  const lat = parseFloat(f.latitude);
  const lon = parseFloat(f.longitude);
  const place = Number.isFinite(lat) && Number.isFinite(lon)
    ? { id: f.placeLookup, name: f.displayTitle || f.kjvName, lat: +lat.toFixed(4), lon: +lon.toFixed(4) }
    : null;
  placeByRec.set(p.id, place);
  if (place) placeByLookup.set(f.placeLookup, place);
}

/** God is a participant in a great many events; a chip for him on each says nothing. */
const LEAVE_OUT_PEOPLE = new Set(['god_1324']);

function peopleFromIds(ids, where) {
  const out = [];
  for (const id of ids ?? []) {
    const p = personByLookup.get(id);
    if (!p) { fail(`${where}: unknown person "${id}"`); continue; }
    out.push(p);
  }
  return out;
}

function placesFromIds(ids, where) {
  const out = [];
  for (const id of ids ?? []) {
    const p = placeByLookup.get(id);
    if (!p) { fail(`${where}: unknown place (or one without coordinates) "${id}"`); continue; }
    out.push(p);
  }
  return out;
}

/* --------------------------------------------------------------------------- *
 * Years
 * ------------------------------------------------------------------------- */

/** Astronomical year (0 = 1 BC) -> the app's signed year with no 0. */
const fromAstro = (y) => (y <= 0 ? y - 1 : y);

function parseStart(s) {
  const m = String(s).match(/^(-?)(\d+)(?:-(\d+)(?:-(\d+))?)?$/);
  if (!m) return null;
  const astro = (m[1] ? -1 : 1) * +m[2];
  return { astro, year: fromAstro(astro) };
}

/** "7D", "40Y", "3M10D", "2.5Y" -> years. */
function durationYears(s) {
  let years = 0;
  for (const [, n, unit] of String(s ?? '').matchAll(/(\d+(?:\.\d+)?)([YMWD])/g)) {
    years += +n * ({ Y: 1, M: 1 / 12, W: 7 / 365, D: 1 / 365 })[unit];
  }
  return years;
}

/** Add whole years to a signed year, stepping over the missing year 0. */
function addYears(year, n) {
  let out = year + n;
  if (year < 0 && out >= 0) out += 1;
  return out;
}

/* --------------------------------------------------------------------------- *
 * Load everything
 * ------------------------------------------------------------------------- */

const tgEvents = theo('events.json');
const tgById = new Map(tgEvents.map((e) => [e.fields.eventID, e]));
const tgByRec = new Map(tgEvents.map((e) => [e.id, e]));

const { eras } = man('eras.json');
const anchorsFile = man('anchors.json');
const { kings } = man('kings.json');
const { prophets } = man('prophets.json');
const world = man('world.json');
const silent = man('silent-years.json');
const { books } = man('books.json');
const livesFile = man('lives.json');
const handEvents = man('events.json').events;
const curation = man('theographic.json');

/* --------------------------------------------------------------------------- *
 * Re-dating
 * ------------------------------------------------------------------------- */

function tgYear(eventID) {
  const e = tgById.get(eventID);
  if (!e) { fail(`anchor: no Theographic event ${eventID}`); return null; }
  return parseStart(e.fields.startDate).year;
}

const anchorList = [];
for (const a of anchorsFile.anchors) {
  const t = tgYear(a.tg);
  if (t !== null) anchorList.push({ t, m: a.year, why: a.note });
}
for (const k of kings) {
  if (k.kingdom !== 'judah' || !k.tg) continue;
  const t = tgYear(k.tg);
  if (t !== null) anchorList.push({ t, m: k.start, why: `${k.name} accession` });
}
anchorList.push({ t: anchorsFile.identityFrom, m: anchorsFile.identityFrom, why: 'identity from here' });
anchorList.sort((a, b) => a.t - b.t);

// Duplicates (two kings in one Ussher year) collapse to one; anything that would
// make the mapping run backwards is dropped and reported.
const anchors = [];
for (const a of anchorList) {
  const prev = anchors[anchors.length - 1];
  if (prev && a.t === prev.t) {
    if (a.m !== prev.m) warn(`anchors: ${a.why} (${a.m}) and ${prev.why} (${prev.m}) share Theographic year ${a.t}; kept the first`);
    continue;
  }
  if (prev && a.m <= prev.m) {
    warn(`anchors: ${a.why} (${a.t} -> ${a.m}) would run backwards after ${prev.why}; dropped`);
    continue;
  }
  anchors.push(a);
}

/** A converted Theographic year -> its modern year. */
function redate(t) {
  if (t >= anchorsFile.identityFrom) return t;
  if (t <= anchors[0].t) return t + (anchors[0].m - anchors[0].t);
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (t <= b.t) return Math.round(a.m + ((t - a.t) * (b.m - a.m)) / (b.t - a.t));
  }
  return t;
}

/* --------------------------------------------------------------------------- *
 * Items
 * ------------------------------------------------------------------------- */

/** Every row, keyed by id. */
const items = new Map();

function addItem(item, where) {
  if (items.has(item.id)) fail(`${where}: duplicate id ${item.id}`);
  const row = {
    id: item.id,
    kind: item.kind,
    lane: item.lane,
    sub: item.sub ?? null,
    title: item.title,
    subtitle: item.subtitle ?? null,
    year_start: item.year_start,
    year_end: item.year_end ?? item.year_start,
    approx: item.approx ? 1 : 0,
    tier: item.tier ?? null,
    parent_id: item.parent_id ?? null,
    era_id: null,
    sort_key: null,
    summary: item.summary ?? null,
    verdict: item.verdict ?? null,
    verdict_ref: item.verdict_ref ?? null,
    co_start: item.co_start ?? null,
    covers_start: item.covers_start ?? null,
    covers_end: item.covers_end ?? null,
    book: item.book ?? null,
    passages: item.passages ?? [],
    people: item.people ?? [],
    places: item.places ?? [],
    // Story order inside a year (see below); not written.
    _order: item._order ?? null,
    // An era named outright, for an event in a year where two eras meet.
    _era: item._era ?? null,
  };
  if (row.year_start === 0 || row.year_end === 0) fail(`${where}: year 0 in ${row.id}`);
  if (!Number.isFinite(row.year_start) || !Number.isFinite(row.year_end)) fail(`${where}: no year for ${row.id}`);
  if (row.year_end < row.year_start) fail(`${where}: ${row.id} ends (${row.year_end}) before it starts (${row.year_start})`);
  items.set(row.id, row);
  return row;
}

// ---- Eras
for (const e of eras) {
  addItem({
    id: `era-${e.id}`, kind: 'era', lane: 'eras', title: e.name,
    year_start: e.start, year_end: e.end, approx: e.approx, summary: e.summary, book: e.book,
  }, 'eras.json');
}

// ---- Theographic events
const skip = new Set(curation.skip);
const DROP_TITLE = /^(Lifetime of|Reign of|Prophecies of)\b/;
const tierOf = new Map();
for (const [tier, ids] of Object.entries(curation.tiers)) for (const id of ids) tierOf.set(id, +tier);
const parentOf = new Map();
for (const g of curation.groups) for (const id of g.members) parentOf.set(id, g.id);
for (const [parent, ids] of Object.entries(curation.reparent)) {
  for (const id of ids) parentOf.set(id, parent === 'none' ? null : parent);
}
const kept = (id) => {
  const e = tgById.get(id);
  return e && !skip.has(id) && !DROP_TITLE.test(e.fields.title);
};

for (const id of [...skip, ...tierOf.keys(), ...parentOf.keys()]) {
  if (!tgById.has(id)) fail(`theographic.json: no Theographic event ${id}`);
}
for (const id of Object.keys(curation.overrides)) {
  if (!tgById.has(+id)) fail(`theographic.json overrides: no Theographic event ${id}`);
  else if (!kept(+id)) warn(`theographic.json overrides: event ${id} is skipped, so its override does nothing`);
}

/**
 * Theographic numbers its events in story order, the Gospels following a
 * harmony, except that Acts (304-385) was numbered before the last year of the
 * Gospels; it is moved after them. Its own sortKey is no help inside a year: it
 * is canonical order, so every Matthew passage comes before every John one.
 */
const storyOrder = (id) => (id >= 304 && id <= 385 ? id + 1000 : id);

for (const e of tgEvents) {
  const f = e.fields;
  const id = f.eventID;
  if (!kept(id)) continue;
  const where = `Theographic ${id} "${f.title}"`;
  const o = curation.overrides[id] ?? {};

  const start = parseStart(f.startDate);
  const dur = durationYears(f.duration);
  let yearStart;
  let yearEnd;
  if (o.year !== undefined) {
    yearStart = o.year;
    yearEnd = o.end ?? (dur >= 1 ? addYears(o.year, Math.round(dur)) : o.year);
  } else {
    yearStart = redate(start.year);
    yearEnd = dur >= 1 ? redate(fromAstro(start.astro + Math.round(dur))) : yearStart;
  }
  if (o.end !== undefined) yearEnd = o.end;

  let parent;
  if (parentOf.has(id)) parent = parentOf.get(id);
  else {
    const up = (f.partOf ?? []).map((rec) => tgByRec.get(rec)?.fields.eventID).find((pid) => pid && kept(pid));
    parent = up ? `tg-${up}` : null;
  }

  const people = [];
  const seenPeople = new Set();
  for (const rec of f.participants ?? []) {
    const p = personByRec.get(rec);
    if (!p || LEAVE_OUT_PEOPLE.has(p.id) || seenPeople.has(p.id)) continue;
    seenPeople.add(p.id);
    people.push(p);
  }
  const places = [];
  const seenPlaces = new Set();
  for (const rec of f.locations ?? []) {
    const p = placeByRec.get(rec);
    if (!p || seenPlaces.has(p.id)) continue;
    seenPlaces.add(p.id);
    places.push(p);
  }

  addItem({
    id: `tg-${id}`, kind: 'event', lane: 'events',
    title: o.title ?? f.title,
    year_start: yearStart, year_end: yearEnd,
    approx: true,
    tier: tierOf.get(id) ?? (parent ? 3 : 2),
    parent_id: parent,
    summary: o.summary ?? null,
    passages: o.passages ? parsePassages(o.passages, where) : rangesFromVerses(f.verses ?? []),
    people, places,
    _order: storyOrder(id),
    _era: o.era ? `era-${o.era}` : null,
  }, where);
}

// ---- Groups the Theographic data lacks
for (const g of curation.groups) {
  addItem({
    id: g.id, kind: 'event', lane: 'events', title: g.title,
    year_start: g.year, year_end: g.end ?? g.year, approx: true, tier: g.tier,
    summary: g.summary, passages: parsePassages(g.passages, g.id),
    _order: Math.min(...g.members.map(storyOrder)) - 0.5,
  }, 'theographic.json groups');
}

// ---- Hand-written events
for (const e of [...handEvents, ...silent.events]) {
  const where = `event ${e.id}`;
  addItem({
    id: `ev-${e.id}`, kind: 'event', lane: 'events', title: e.title,
    year_start: e.year, year_end: e.end ?? e.year, approx: e.approx, tier: e.tier,
    parent_id: e.parent ?? null, summary: e.summary,
    passages: parsePassages(e.passages, where),
    people: peopleFromIds(e.people, where),
    places: placesFromIds(e.places, where),
    _era: e.era ? `era-${e.era}` : null,
  }, where);
}

// ---- Kings
const KINGDOM_LABEL = { united: 'King of Israel', judah: 'King of Judah', israel: 'King of Israel (north)' };
for (const k of kings) {
  const where = `king ${k.id}`;
  if (!k.personId) fail(`${where}: no personId`);
  addItem({
    id: `king-${k.id}`, kind: 'reign', lane: 'kings', sub: k.kingdom, title: k.name,
    subtitle: k.id === 'athaliah' ? 'Queen of Judah' : KINGDOM_LABEL[k.kingdom],
    year_start: k.coStart ?? k.start, year_end: k.end, co_start: k.coStart ? k.start : null,
    verdict: k.verdict, verdict_ref: k.verdictRef, summary: k.summary,
    passages: parsePassages(k.passages, where),
    people: peopleFromIds(k.personId ? [k.personId] : [], where),
  }, where);
  if (k.verdictRef) parsePassages(k.verdictRef, `${where} verdictRef`);
}

// ---- Prophets
for (const p of prophets) {
  const where = `prophet ${p.id}`;
  addItem({
    id: `prophet-${p.id}`, kind: 'prophet', lane: 'prophets', title: p.name,
    subtitle: `Prophet to ${p.served}`,
    year_start: p.start, year_end: p.end, approx: p.approx, book: p.book, summary: p.summary,
    passages: parsePassages(p.passages, where),
    people: peopleFromIds([p.personId], where),
  }, where);
}

// ---- World
for (const e of world.empires) {
  const where = `empire ${e.id}`;
  addItem({
    id: `empire-${e.id}`, kind: 'empire', lane: 'world', sub: 'empire', title: e.name,
    year_start: e.start, year_end: e.end, approx: e.approx, summary: e.summary,
    passages: parsePassages(e.passages, where),
  }, where);
}
for (const r of world.rulers) {
  const where = `ruler ${r.id}`;
  addItem({
    id: `ruler-${r.id}`, kind: 'ruler', lane: 'world', sub: 'ruler', title: r.name, subtitle: r.title,
    year_start: r.start, year_end: r.end, approx: r.approx, summary: r.summary,
    passages: parsePassages(r.passages, where),
    people: peopleFromIds(r.personId ? [r.personId] : [], where),
  }, where);
}

// ---- Lives
{
  const byId = new Map(livesFile.lives.map((l) => [l.id, l]));
  const born = new Map([[livesFile.anchor.id, livesFile.anchor.born]]);
  // Down the line from the anchor, then up it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of livesFile.lives) {
      if (l.born !== undefined && !born.has(l.id)) { born.set(l.id, l.born); changed = true; }
      if (!l.father) continue;
      if (born.has(l.father) && !born.has(l.id)) {
        born.set(l.id, born.get(l.father) + l.fatherAge); changed = true;
      } else if (born.has(l.id) && !born.has(l.father)) {
        born.set(l.father, born.get(l.id) - byId.get(l.id).fatherAge); changed = true;
      }
    }
  }
  for (const l of livesFile.lives) {
    const where = `life ${l.id}`;
    const b = born.get(l.id);
    if (b === undefined) { fail(`${where}: birth year cannot be worked out`); continue; }
    const d = l.died ?? b + l.age;
    // There is no year 0, so a life from 4 BC to AD 30 is 33 years, not 34.
    const age = d - b - (b < 0 && d > 0 ? 1 : 0);
    const primeval = b < -2166 || l.approx;
    addItem({
      id: `life-${l.id}`, kind: 'life', lane: 'lives', title: l.name,
      // "About" where the dates are estimates and the text never gives the age.
      subtitle: l.approx && l.age === undefined && !l.ageGiven ? `Lived about ${age} years` : `Lived ${age} years`,
      year_start: b, year_end: d, approx: primeval,
      summary: l.note ?? null,
      passages: parsePassages(l.passages, where),
      people: peopleFromIds([l.personId], where),
    }, where);
  }
}

// ---- Books
if (books.length !== 66) fail(`books.json: ${books.length} books, expected 66`);
for (const b of books) {
  const where = `book ${b.book}`;
  if (!BOOK_INDEX.has(b.book)) { fail(`${where}: unknown book`); continue; }
  const [ws, we] = b.written ?? b.covers;
  addItem({
    id: `book-${b.book.toLowerCase().replace(/\s+/g, '-')}`, kind: 'book', lane: 'books', title: b.book,
    subtitle: b.written ? `Written by ${b.author}` : `Author and date unknown`,
    year_start: ws, year_end: we, approx: true, book: b.book,
    covers_start: b.covers[0], covers_end: b.covers[1],
    passages: wholeBook(b.book),
  }, where);
}

/* --------------------------------------------------------------------------- *
 * Derived columns
 * ------------------------------------------------------------------------- */

// Parents must exist and be events.
for (const row of items.values()) {
  if (row.parent_id && !items.has(row.parent_id)) fail(`${row.id}: parent ${row.parent_id} does not exist`);
}

// Era: one named outright, else the parent's, else the latest-starting era
// that has begun by the item's start. The parent matters where eras meet:
// Holy Week is in AD 30, the year the Early Church begins.
const eraRows = [...items.values()].filter((r) => r.kind === 'era').sort((a, b) => a.year_start - b.year_start);
function eraOf(row) {
  if (row.era_id) return row.era_id;
  if (row.kind === 'era') return (row.era_id = row.id);
  if (row._era) {
    if (!items.has(row._era)) fail(`${row.id}: unknown era ${row._era}`);
    return (row.era_id = row._era);
  }
  if (row.parent_id && items.has(row.parent_id)) return (row.era_id = eraOf(items.get(row.parent_id)));
  let era = null;
  for (const e of eraRows) if (e.year_start <= row.year_start) era = e;
  if (row.lane === 'events' && era && row.year_start > era.year_end) warn(`${row.id} (${row.year_start}) falls after its era ${era.id} ends`);
  return (row.era_id = (era ?? eraRows[0]).id);
}
for (const row of items.values()) eraOf(row);

// Colour book: the first passage's, where nothing more specific was given.
for (const row of items.values()) if (!row.book && row.passages.length) row.book = row.passages[0].b;

// Order inside a year. Where a year holds only Theographic events and groups,
// their story order decides; where hand-written events are mixed in, canonical
// order of the first passage does, which keeps Exodus 12, 14, 16, 19 and 32 in
// their story order. Either way a span opens before what happens inside it.
{
  for (const row of items.values()) {
    if (row.lane !== 'events' || !row.parent_id) continue;
    const parent = items.get(row.parent_id);
    if (parent?._order != null && row._order != null && row._order <= parent._order) parent._order = row._order - 0.5;
  }
  const byYear = new Map();
  for (const row of items.values()) {
    if (row.lane !== 'events') continue;
    if (!byYear.has(row.year_start)) byYear.set(row.year_start, []);
    byYear.get(row.year_start).push(row);
  }
  const first = (r) => (r.passages[0] ? pos(r.passages[0].b, r.passages[0].c, r.passages[0].v) : Infinity);
  for (const [year, rows] of byYear) {
    const ordered = rows.every((r) => r._order !== null);
    rows.sort((a, b) => (ordered
      ? a._order - b._order
      : first(a) - first(b) || (a._order ?? 0) - (b._order ?? 0) || a.title.localeCompare(b.title)));
    rows.forEach((r, i) => { r.sort_key = +(year + (i + 1) / (rows.length + 1) * 0.9).toFixed(5); });
  }
  for (const row of items.values()) if (row.sort_key === null) row.sort_key = row.year_start + 0.5;
}

/* --------------------------------------------------------------------------- *
 * Checks
 * ------------------------------------------------------------------------- */

const rows = [...items.values()].sort((a, b) => a.sort_key - b.sort_key);
const count = (pred) => rows.filter(pred).length;

console.log('\n🧭 Timeline pack');
console.log(`   Anchors used:     ${anchors.length}`);
for (const lane of ['events', 'eras', 'kings', 'prophets', 'world', 'lives', 'books']) {
  console.log(`   ${lane.padEnd(16)}  ${count((r) => r.lane === lane)}`);
}
for (const t of [1, 2, 3]) console.log(`   events tier ${t}     ${count((r) => r.lane === 'events' && r.tier === t)}`);
const noPassage = rows.filter((r) => !r.passages.length);
console.log(`   No passage:       ${noPassage.length}${noPassage.length ? ` (${noPassage.map((r) => r.id).join(', ')})` : ''}`);
const kingsNoPerson = rows.filter((r) => r.kind === 'reign' && !r.people.length);
if (kingsNoPerson.length) fail(`kings without a person: ${kingsNoPerson.map((r) => r.id).join(', ')}`);

if (process.argv.includes('--list')) {
  for (const r of rows.filter((x) => x.lane === 'events')) {
    console.log(`   ${String(r.year_start).padStart(6)} t${r.tier} ${r.id.padEnd(24)} ${r.title}${r.parent_id ? `  ⊂ ${r.parent_id}` : ''}`);
  }
}

for (const w of warnings) console.warn(`⚠️  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`❌ ${e}`);
  console.error(`\n❌ ${errors.length} problem(s); nothing written.`);
  process.exit(1);
}
if (CHECK) {
  console.log('\n✅ Checks passed (--check: nothing written).');
  process.exit(0);
}

/* --------------------------------------------------------------------------- *
 * Write
 * ------------------------------------------------------------------------- */

if (existsSync(PACK_OUTPUT)) unlinkSync(PACK_OUTPUT);
mkdirSync(dirname(PACK_OUTPUT), { recursive: true });
const db = new Database(PACK_OUTPUT);
db.pragma('journal_mode = DELETE');
db.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE timeline_items (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,  -- event | era | reign | prophet | empire | ruler | life | book
    lane          TEXT NOT NULL,  -- events | eras | kings | prophets | world | lives | books
    sub           TEXT,           -- kings: united | judah | israel; world: empire | ruler
    title         TEXT NOT NULL,
    subtitle      TEXT,           -- the kind line: "King of Judah", "Lived 930 years"
    year_start    INTEGER NOT NULL, -- signed, negative = BC, no year 0
    year_end      INTEGER NOT NULL,
    approx        INTEGER NOT NULL, -- 1 = print "c."
    tier          INTEGER,        -- events only: 1 headline, 2 main, 3 detail
    parent_id     TEXT,
    era_id        TEXT,
    sort_key      REAL NOT NULL,  -- year plus a fraction for the order inside it
    summary       TEXT,
    verdict       TEXT,           -- kings: right | evil | mixed
    verdict_ref   TEXT,
    co_start      INTEGER,        -- kings: where the sole reign began, after a co-regency from year_start
    covers_start  INTEGER,        -- books: the span the book's events take up
    covers_end    INTEGER,
    book          TEXT,           -- the book that colours it
    first_book    TEXT,
    first_chapter INTEGER,
    first_verse   INTEGER,
    passages      TEXT NOT NULL,  -- JSON [{b, c, v, ec, ev, label}]
    people        TEXT NOT NULL,  -- JSON [{id, name}], People-pack ids
    places        TEXT NOT NULL,  -- JSON [{id, name, lat, lon}]
    search        TEXT NOT NULL   -- lowercased title, people and places
  );
`);

const meta = {
  pack_id: 'timeline',
  pack_type: 'timeline',
  pack_version: '1.0.0',
  name: 'Timeline',
  license: 'CC BY-SA 4.0',
  attribution: 'Theographic Bible Metadata by Robert Rouse (CC BY-SA 4.0), re-dated to modern conservative chronology (Exodus 1446 BC; Thiele for the kings), with kings, prophets, world powers, the intertestamental period, books and lifespans added for ProjectBible',
  description: 'The whole biblical story on one strip: events, eras, kings of Judah and Israel, prophets, world powers, lifespans and when each book was written.',
  created_at: new Date().toISOString(),
};
const insMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);

const ins = db.prepare(`
  INSERT INTO timeline_items VALUES (
    @id, @kind, @lane, @sub, @title, @subtitle, @year_start, @year_end, @approx, @tier, @parent_id,
    @era_id, @sort_key, @summary, @verdict, @verdict_ref, @co_start, @covers_start, @covers_end, @book,
    @first_book, @first_chapter, @first_verse, @passages, @people, @places, @search
  )`);
db.transaction(() => {
  for (const r of rows) {
    const first = r.passages[0];
    const search = [r.title, r.subtitle, ...r.people.map((p) => p.name), ...r.places.map((p) => p.name)]
      .filter(Boolean).join(' ').toLowerCase();
    ins.run({
      ...r,
      _order: undefined,
      _era: undefined,
      first_book: first?.b ?? null,
      first_chapter: first?.c ?? null,
      first_verse: first?.v ?? null,
      passages: JSON.stringify(r.passages),
      people: JSON.stringify(r.people),
      places: JSON.stringify(r.places),
      search,
    });
  }
})();
db.exec('VACUUM;');
db.close();

const buf = readFileSync(PACK_OUTPUT);
const sha256 = createHash('sha256').update(buf).digest('hex');
const sizeBytes = statSync(PACK_OUTPUT).size;
console.log(`\n   Rows:             ${rows.length}`);
console.log(`   Output:           ${PACK_OUTPUT}`);
console.log(`   Size:             ${(sizeBytes / 1048576).toFixed(2)} MB (${sizeBytes} bytes)`);
console.log(`   sha256:           ${sha256}`);
console.log('\n✅ Timeline pack built.');
