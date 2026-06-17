#!/usr/bin/env node

/**
 * Build People (Biblical Characters) Pack
 *
 * Creates an SQLite pack with biographical data for every named person in the
 * Bible, plus a name index and a per-person verse list used to recognise when a
 * clicked word is a character (and to disambiguate homonyms by the verse the
 * reader is currently in).
 *
 * Tables:
 *   metadata       key/value pack info (id, version, license, attribution, ...)
 *   people         one row per person (bio, dates, places, relationships, dictText)
 *   person_names   (name_lower, person_id) lookup index incl. alternate names
 *   person_verses  (person_id, book, chapter, verse, osis) for verse-context match
 *
 * Data sources:
 *   - Theographic Bible Metadata by Robert Rouse (CC BY-SA 4.0)
 *       data-sources/theographic/theographic-bible-metadata-master/json
 *   - Hitchcock's Bible Names Dictionary (public domain) — name meanings
 *       data-sources/hitchcock/hitchcock.csv
 *
 * Usage:
 *   node scripts/build-people-pack.mjs
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, copyFileSync, mkdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const THEO = resolve(ROOT, 'data-sources/theographic/theographic-bible-metadata-master/json');
const HITCHCOCK = resolve(ROOT, 'data-sources/hitchcock/hitchcock.csv');
const PACK_OUTPUT = resolve(ROOT, 'packs/people.sqlite');

// OSIS book code (as used in Theographic verses.json) -> canonical book name
// matching apps/pwa-polished/src/lib/bibleData.ts and parseRefString.ts BOOK_MAP.
const OSIS_TO_BOOK = {
  Gen: 'Genesis', Exod: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deut: 'Deuteronomy',
  Josh: 'Joshua', Judg: 'Judges', Ruth: 'Ruth', '1Sam': '1 Samuel', '2Sam': '2 Samuel',
  '1Kgs': '1 Kings', '2Kgs': '2 Kings', '1Chr': '1 Chronicles', '2Chr': '2 Chronicles',
  Ezra: 'Ezra', Neh: 'Nehemiah', Esth: 'Esther', Job: 'Job', Ps: 'Psalms', Prov: 'Proverbs',
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

// Generic role/connector words that should not become clickable character names
// when they appear inside a multi-word display title.
const NAME_STOPWORDS = new Set([
  'the', 'of', 'and', 'son', 'sons', 'daughter', 'daughters', 'wife', 'wives',
  'husband', 'mother', 'father', 'brother', 'sister', 'child', 'children',
  'king', 'queen', 'prince', 'princess', 'man', 'men', 'woman', 'women',
  'people', 'family', 'house', 'tribe', 'priest', 'prophet', 'servant', 'elder',
  'first', 'second', 'third', 'older', 'younger', 'her', 'his', 'their',
]);

function loadJson(name) {
  const p = resolve(THEO, name);
  if (!existsSync(p)) throw new Error(`Missing Theographic file: ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Minimal CSV parser for the simple two-column Hitchcock file (handles quoted commas).
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (field.length || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadHitchcock() {
  const map = new Map();
  if (!existsSync(HITCHCOCK)) {
    console.warn('⚠️  Hitchcock CSV not found — name meanings will be empty');
    return map;
  }
  const rows = parseCsv(readFileSync(HITCHCOCK, 'utf8').replace(/^﻿/, ''));
  for (let i = 1; i < rows.length; i++) {
    const [name, meaning] = rows[i];
    if (name && meaning && !map.has(name.toLowerCase())) {
      map.set(name.trim().toLowerCase(), meaning.trim());
    }
  }
  return map;
}

console.log('📖 Building People (Biblical Characters) pack...\n');

const people = loadJson('people.json');
const versesRaw = loadJson('verses.json');
const placesRaw = loadJson('places.json');
const groupsRaw = loadJson('peopleGroups.json');
const hitchcock = loadHitchcock();

// Resolve maps: Airtable record id -> readable info
const verseById = new Map();
for (const r of versesRaw) {
  if (r.fields.osisRef) verseById.set(r.id, r.fields.osisRef);
}
const placeById = new Map();
for (const r of placesRaw) {
  const f = r.fields;
  placeById.set(r.id, {
    name: f.displayTitle || f.kjvName || f.esvName || f.placeLookup,
    slug: f.slug || f.placeLookup,
    lat: f.latitude ? Number(f.latitude) : null,
    lon: f.longitude ? Number(f.longitude) : null,
  });
}
const personById = new Map();
for (const r of people) {
  personById.set(r.id, { name: r.fields.name, slug: r.fields.personLookup });
}
const groupById = new Map();
for (const r of groupsRaw) {
  groupById.set(r.id, r.fields.groupName || r.fields.name || r.fields.slug);
}

function resolvePlace(ids) {
  if (!Array.isArray(ids) || !ids.length) return null;
  return placeById.get(ids[0]) || null;
}
function resolvePersons(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => personById.get(id)).filter(Boolean);
}
function resolveGroups(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => groupById.get(id)).filter(Boolean);
}

// --- Build SQLite ---
const db = new Database(PACK_OUTPUT);
db.pragma('journal_mode = WAL');

db.exec(`
  DROP TABLE IF EXISTS metadata;
  DROP TABLE IF EXISTS people;
  DROP TABLE IF EXISTS person_names;
  DROP TABLE IF EXISTS person_verses;

  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE people (
    person_id     TEXT PRIMARY KEY,
    name          TEXT,
    display_title TEXT,
    also_called   TEXT,
    surname       TEXT,
    gender        TEXT,
    status        TEXT,
    is_proper_name INTEGER,
    name_meaning  TEXT,
    birth_year    INTEGER,
    death_year    INTEGER,
    min_year      INTEGER,
    max_year      INTEGER,
    birth_place   TEXT,   -- JSON {name,slug,lat,lon}
    death_place   TEXT,   -- JSON {name,slug,lat,lon}
    member_of     TEXT,   -- JSON [groupName]
    father        TEXT,   -- JSON [{id,name}]
    mother        TEXT,
    partners      TEXT,
    children      TEXT,
    siblings      TEXT,
    dict_text     TEXT,
    dict_link     TEXT,
    verse_count   INTEGER
  );

  CREATE TABLE person_names (
    name_lower TEXT NOT NULL,
    person_id  TEXT NOT NULL
  );
  CREATE INDEX idx_person_names_lower ON person_names(name_lower);

  CREATE TABLE person_verses (
    person_id TEXT NOT NULL,
    book      TEXT NOT NULL,
    chapter   INTEGER NOT NULL,
    verse     INTEGER NOT NULL,
    osis      TEXT
  );
  CREATE INDEX idx_person_verses_ref ON person_verses(book, chapter, verse);
  CREATE INDEX idx_person_verses_person ON person_verses(person_id);
`);

const insMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
insMeta.run('pack_id', 'people-biblical-v1');
insMeta.run('pack_version', '1.0.0');
insMeta.run('pack_type', 'people');
insMeta.run('license', 'CC BY-SA 4.0');
insMeta.run('attribution', "Theographic Bible Metadata by Robert Rouse (CC BY-SA 4.0); name meanings from Hitchcock's Bible Names Dictionary (public domain)");
insMeta.run('description', 'Biblical characters: biography, dates, places, relationships, and verse appearances');
insMeta.run('source_url', 'https://github.com/robertrouse/theographic-bible-metadata');
insMeta.run('created_at', new Date().toISOString());

const insPerson = db.prepare(`
  INSERT OR REPLACE INTO people
  (person_id, name, display_title, also_called, surname, gender, status, is_proper_name,
   name_meaning, birth_year, death_year, min_year, max_year, birth_place, death_place,
   member_of, father, mother, partners, children, siblings, dict_text, dict_link, verse_count)
  VALUES (@person_id, @name, @display_title, @also_called, @surname, @gender, @status, @is_proper_name,
   @name_meaning, @birth_year, @death_year, @min_year, @max_year, @birth_place, @death_place,
   @member_of, @father, @mother, @partners, @children, @siblings, @dict_text, @dict_link, @verse_count)
`);
const insName = db.prepare('INSERT INTO person_names (name_lower, person_id) VALUES (?, ?)');
const insVerse = db.prepare('INSERT INTO person_verses (person_id, book, chapter, verse, osis) VALUES (?, ?, ?, ?, ?)');

const toInt = (v) => (v === undefined || v === null || v === '' ? null : parseInt(v, 10));

let nVerses = 0, nNames = 0, unresolvedBooks = new Set();

const run = db.transaction(() => {
  for (const r of people) {
    const f = r.fields;
    const pid = f.personLookup;
    if (!pid) continue;

    const bp = resolvePlace(f.birthPlace);
    const dp = resolvePlace(f.deathPlace);
    const meaning = hitchcock.get((f.name || '').trim().toLowerCase()) || null;
    const dict = Array.isArray(f.dictText) ? f.dictText[0] : (f.dictionaryText || null);

    insPerson.run({
      person_id: pid,
      name: f.name || f.displayTitle || pid,
      display_title: f.displayTitle || f.name || pid,
      also_called: f.alsoCalled || null,
      surname: f.surname || null,
      gender: f.gender || null,
      status: f.status || null,
      is_proper_name: f.isProperName ? 1 : 0,
      name_meaning: meaning,
      birth_year: toInt(f.birthYear),
      death_year: toInt(f.deathYear),
      min_year: toInt(f.minYear),
      max_year: toInt(f.maxYear),
      birth_place: bp ? JSON.stringify(bp) : null,
      death_place: dp ? JSON.stringify(dp) : null,
      member_of: JSON.stringify(resolveGroups(f.memberOf)),
      father: JSON.stringify(resolvePersons(f.father)),
      mother: JSON.stringify(resolvePersons(f.mother)),
      partners: JSON.stringify(resolvePersons(f.partners)),
      children: JSON.stringify(resolvePersons(f.children)),
      siblings: JSON.stringify(resolvePersons(f.siblings)),
      dict_text: dict,
      dict_link: f.dictionaryLink || null,
      verse_count: f.verseCount || (Array.isArray(f.verses) ? f.verses.length : 0),
    });

    // Name index: full names + meaningful individual tokens so a single clicked
    // word resolves (e.g. "Peter" from displayTitle "Simon Peter", "Magdalene"
    // from "Mary Magdalene"). A stoplist keeps generic role/connector words out.
    const names = new Set();
    if (f.name) names.add(f.name);
    if (f.displayTitle) names.add(f.displayTitle);
    if (f.alsoCalled) f.alsoCalled.split(/[,;]/).forEach((n) => names.add(n.trim()));

    const keys = new Set();
    for (const n of names) {
      const full = n.trim().toLowerCase();
      if (full) keys.add(full);
      // Split multi-word names into individual name tokens.
      const tokens = n.trim().split(/\s+/);
      if (tokens.length > 1) {
        for (const t of tokens) {
          const tl = t.toLowerCase().replace(/[^a-z'-]/g, '');
          if (tl.length >= 3 && /^[A-Z]/.test(t) && !NAME_STOPWORDS.has(tl)) keys.add(tl);
        }
      }
    }
    for (const nl of keys) { insName.run(nl, pid); nNames++; }

    // Verse list -> resolved (book, chapter, verse)
    if (Array.isArray(f.verses)) {
      for (const vid of f.verses) {
        const osis = verseById.get(vid);
        if (!osis) continue;
        const [bk, ch, vs] = osis.split('.');
        const book = OSIS_TO_BOOK[bk];
        if (!book) { unresolvedBooks.add(bk); continue; }
        insVerse.run(pid, book, parseInt(ch, 10), parseInt(vs, 10), osis);
        nVerses++;
      }
    }
  }
});
run();

if (unresolvedBooks.size) {
  console.warn('⚠️  Unresolved OSIS book codes:', [...unresolvedBooks].join(', '));
}

const cPeople = db.prepare('SELECT COUNT(*) c FROM people').get().c;
const cNames = db.prepare('SELECT COUNT(*) c FROM person_names').get().c;
const cVerses = db.prepare('SELECT COUNT(*) c FROM person_verses').get().c;
const cMeaning = db.prepare('SELECT COUNT(*) c FROM people WHERE name_meaning IS NOT NULL').get().c;
const cBio = db.prepare('SELECT COUNT(*) c FROM people WHERE dict_text IS NOT NULL').get().c;

db.exec('VACUUM;');
db.close();

// Copy to packs/consolidated/ so the dev server (vite copyPolishedPacks) serves it
// at /packs/consolidated/people.sqlite for the Packs pane installer.
const consolidatedDir = resolve(ROOT, 'packs/consolidated');
if (!existsSync(consolidatedDir)) mkdirSync(consolidatedDir, { recursive: true });
copyFileSync(PACK_OUTPUT, resolve(consolidatedDir, 'people.sqlite'));

const buf = readFileSync(PACK_OUTPUT);
const sha256 = createHash('sha256').update(buf).digest('hex');
const sizeBytes = statSync(PACK_OUTPUT).size;

console.log('📊 People pack summary:');
console.log(`   People:        ${cPeople}`);
console.log(`   Name index:    ${cNames}`);
console.log(`   Verse links:   ${cVerses}`);
console.log(`   With meaning:  ${cMeaning}`);
console.log(`   With bio text: ${cBio}`);
console.log(`   Output:        ${PACK_OUTPUT}`);
console.log(`   Copied to:     packs/consolidated/people.sqlite`);
console.log(`   Size:          ${(sizeBytes / 1048576).toFixed(2)} MB`);
console.log(`   sha256:        ${sha256}`);
console.log('\n✅ People pack built successfully!');
