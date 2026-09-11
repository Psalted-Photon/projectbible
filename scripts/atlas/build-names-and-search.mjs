#!/usr/bin/env node
/**
 * Two things the map was missing.
 *
 * 1. Ancient place names with dates. AWMC's regional-name linework carries 2,618
 *    titles — Phrygia, Bithynia, Mysia — most with the period they belong to.
 *    Without these, eras that have no biblical books attached to them (Alexander,
 *    the Hasmoneans, the Roman centuries) drew a border and nothing else.
 *
 * 2. A real search index. Natural Earth ships 7,342 notable cities, which is
 *    nowhere near "find any town". GeoNames has 172,119 with their state and
 *    country, which is what lets Saint Cloud in Minnesota and Saint Cloud in
 *    Florida both turn up.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const AWMC = path.join(ROOT, 'data-sources/maps/downloads/awmc/geodata');
const OUT = path.join(ROOT, 'apps/pwa-polished/public/atlas');
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;

// ---------------------------------------------------- ancient names, by date

const raw = JSON.parse(fs.readFileSync(
  path.join(AWMC, 'Cultural-Data/regional_name_linework/regional_names_linework.geojson'), 'utf8'));

/** Midpoint of the linework — these are label guides, not shapes to draw. */
function midpoint(geom) {
  const lines = geom.type === 'LineString' ? [geom.coordinates]
              : geom.type === 'MultiLineString' ? geom.coordinates : [];
  let best = null, bestLen = -1;
  for (const line of lines) {
    if (line.length < 2) continue;
    let len = 0;
    for (let i = 1; i < line.length; i++) {
      len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    if (len > bestLen) { bestLen = len; best = line[Math.floor(line.length / 2)]; }
  }
  return best;
}

/** Which of these deserve room on the map, and how they should be lettered. */
const KIND = {
  region: 'region', 'mining region': 'region', 'mine, region': 'region',
  'region, people': 'region', province: 'region',
  people: 'people', 'people, tribe': 'people',
  mountain: 'mountain', 'mountain, cape': 'mountain',
  plain: 'region',
  island: 'island', 'island-group': 'island', 'archipelago, island group': 'island',
  'archipelago, island group, island': 'island',
  'water, open': 'water',
};

const names = [];
for (const f of raw.features) {
  const p = f.properties ?? {};
  const title = (p.TITLE ?? '').trim();
  if (!title || title === '?') continue;

  const kind = KIND[(p.P_TYPE ?? p.TYPE ?? '').toLowerCase()];
  if (!kind) continue;                       // skip bridges, temples, unknowns

  const mid = midpoint(f.geometry);
  if (!mid) continue;

  const min = Number.isFinite(p.P_MIN_DATE) ? p.P_MIN_DATE : null;
  const max = Number.isFinite(p.P_MAX_DATE) ? p.P_MAX_DATE : null;

  names.push({
    n: title,
    k: kind,
    y: Math.round(mid[1] * 1000) / 1000,
    x: Math.round(mid[0] * 1000) / 1000,
    // AWMC's own period bounds. Null means "no date given", which the map treats
    // as always applicable rather than never.
    a: min, b: max,
  });
}

fs.writeFileSync(path.join(OUT, 'ancient-names.json'), JSON.stringify(names));
const dated = names.filter((n) => n.a != null || n.b != null).length;
console.log(`ancient names : ${names.length} (${dated} dated)  ${mb(JSON.stringify(names).length)}`);

// -------------------------------------------------------------- search index

const db = new Database(path.join(ROOT, 'packs/geonames.sqlite'), { readonly: true });
const rows = db.prepare(`
  SELECT name, ascii_name, admin1_name, country_name, latitude, longitude, population
  FROM modern_places
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  ORDER BY population DESC
`).all();
db.close();

/**
 * Packed as arrays rather than objects — at this many rows the key names would
 * cost more than the data.
 *   [name, asciiName|0, admin1, country, lat, lon, population]
 */
const packed = rows.map((r) => [
  r.name,
  r.ascii_name && r.ascii_name !== r.name ? r.ascii_name : 0,
  r.admin1_name ?? '',
  r.country_name ?? '',
  Math.round(r.latitude * 10000) / 10000,
  Math.round(r.longitude * 10000) / 10000,
  r.population ?? 0,
]);

const json = JSON.stringify(packed);
fs.writeFileSync(path.join(OUT, 'search-places.json'), json);
console.log(`search places : ${packed.length}  ${mb(json.length)}`);

// Fold the new files into the index the lab reads.
const indexPath = path.join(OUT, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
index.ancientNames = { file: 'ancient-names.json', count: names.length };
index.searchPlaces = { file: 'search-places.json', count: packed.length };
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
console.log('index updated');
