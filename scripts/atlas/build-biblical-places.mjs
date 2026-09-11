#!/usr/bin/env node
/**
 * Build the file behind tapping a place on the map.
 *
 * The reader already hands off to the map; this closes the loop the other way.
 * Tapping Bethlehem should answer with its Scripture, and with what the app
 * already knows about it — so each place carries its verse references and its
 * ISBE encyclopedia entry.
 *
 * All of it already ships in packs. Nothing here is new data, only joined up.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const OUT = path.join(ROOT, 'apps/pwa-polished/public/atlas');
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

const isbe = new Database(path.join(ROOT, 'packs/isbe.sqlite'), { readonly: true });
const ob = new Database(path.join(ROOT, 'packs/openbible.sqlite'), { readonly: true });

/** ISBE already resolves places to coordinates and to an encyclopedia entry. */
const places = isbe.prepare(`
  SELECT place_id, primary_name, entry_id, type, latitude, longitude,
         modern_name, verse_count
  FROM places
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL
`).all();

/** The first paragraph is enough for a tap; the full article opens elsewhere. */
const leadFor = isbe.prepare('SELECT primary_name, lead FROM entries WHERE entry_id = ?');

/**
 * Verses per place, in canonical order.
 *
 * `sort_key` is a zero-padded book/chapter/verse string, so ordering by it
 * gives Genesis before Revelation without parsing anything.
 */
const versesFor = ob.prepare(`
  SELECT v.readable, v.osis
  FROM place_verses v
  JOIN ancient_places a ON a.id = v.place_id
  WHERE a.friendly_id = ?
  ORDER BY v.sort_key
`);

/** OpenBible disambiguates with a trailing number; ISBE doesn't. */
const candidates = (name) => [name, `${name} 1`, `${name} 2`];

const out = [];
let withVerses = 0;
let withArticle = 0;

for (const p of places) {
  let verses = [];
  for (const key of candidates(p.place_id)) {
    verses = versesFor.all(key);
    if (verses.length) break;
  }

  const entry = p.entry_id ? leadFor.get(p.entry_id) : null;
  if (verses.length) withVerses++;
  if (entry?.lead) withArticle++;

  out.push({
    id: p.place_id,
    n: p.primary_name || p.place_id,
    y: Math.round(p.latitude * 10000) / 10000,
    x: Math.round(p.longitude * 10000) / 10000,
    t: p.type || '',
    m: p.modern_name || '',
    // [readable reference, osis id] — osis is what the reader navigates by.
    v: verses.map((r) => [r.readable, r.osis]),
    e: p.entry_id || null,
    lead: entry?.lead ? entry.lead.slice(0, 420) : '',
  });
}

out.sort((a, b) => b.v.length - a.v.length);

const json = JSON.stringify(out);
fs.writeFileSync(path.join(OUT, 'biblical-places.json'), json);

const indexPath = path.join(OUT, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
index.biblicalPlaces = { file: 'biblical-places.json', count: out.length };
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));

isbe.close();
ob.close();

console.log(`places        ${out.length}`);
console.log(`with verses   ${withVerses}`);
console.log(`with article  ${withArticle}`);
console.log(`size          ${mb(json.length)}`);
console.log('top:', out.slice(0, 6).map((p) => `${p.n} (${p.v.length})`).join(', '));
