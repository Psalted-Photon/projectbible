#!/usr/bin/env node
/**
 * Does the map put biblical places on the right side of the water?
 *
 * Natural Earth's shoreline is right to about a kilometre, which reads fine at
 * country scale and badly close in: it put Capernaum in the Sea of Galilee and
 * fourteen harbour towns out at sea. This reports, for every place Scripture
 * names, whether the map has it on land or in water, at both the coarse level
 * and the fine one — so a claim that the water is fixed can be checked rather
 * than believed.
 *
 * Some places are meant to be wet. The Dead Sea is a sea; Sodom and Gomorrah
 * are under it by tradition; the Nile is a river. Those are listed apart so
 * they cannot be mistaken for damage.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../../..');
const A = path.join(ROOT, 'apps/pwa-polished/public/atlas');

const read = (f) => {
  const p = path.join(A, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

/** Places that belong in water, and are not evidence of anything wrong. */
const WET_BY_NATURE = new Set([
  'Dead Sea', 'Sea Of Galilee', 'Mediterranean Sea', 'Red Sea', 'Adriatic Sea',
  'Sea Of Egypt', 'Nile', 'Jordan', 'Syrtis', 'Gihon', 'Pishon', 'Suph',
  'India', 'Sodom', 'Gomorrah', 'Admah', 'Zeboiim', 'Valley Of Siddim',
  'Lasha', 'Valley Of Acacias', 'Zereth-Shahar', 'Tiphsah',
]);

function inRing(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

function hits(pt, fc) {
  if (!fc) return null;
  for (const ft of fc.features) {
    const g = ft.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      if (!inRing(pt, poly[0])) continue;
      let hole = false;
      for (let k = 1; k < poly.length; k++) if (inRing(pt, poly[k])) hole = true;
      if (!hole) return ft.properties?.name ?? 'unnamed water';
    }
  }
  return null;
}

const places = read('biblical-places.json');
const coarseLakes = read('base-lakes-10.json');
const coarseLand = read('base-land-10.json');
const fineLakes = read('base-lakes-1.json');
const fineSea = read('base-ocean-1.json');
const coverage = read('base-detail1-coverage.json')?.boxes ?? [];

const covers = (x, y) => coverage.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);

const wrong = [];
const fixed = [];
const expected = [];

for (const p of places) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
  const pt = [p.x, p.y];

  const coarseWet = hits(pt, coarseLakes) ?? (hits(pt, coarseLand) ? null : 'the sea');
  if (!coarseWet) continue;

  if (WET_BY_NATURE.has(p.n)) { expected.push(p.n); continue; }

  if (!covers(p.x, p.y)) { wrong.push(`${p.n} — in ${coarseWet}, no fine water here yet`); continue; }

  // Where the fine level has no sea of its own the map falls back to the coarse
  // one, so that is what has to be tested. Testing against a layer that is not
  // there would report every coastal town as fixed the moment the file is
  // missing, which is the opposite of the truth.
  const fineWet = hits(pt, fineLakes)
    ?? (fineSea ? hits(pt, fineSea) : (hits(pt, coarseLand) ? null : 'the sea (still coarse here)'));
  if (fineWet) wrong.push(`${p.n} — still in ${fineWet}`);
  else fixed.push(`${p.n} — was in ${coarseWet}, now on land`);
}

const say = (title, rows) => {
  console.log('');
  console.log(`${title}: ${rows.length}`);
  for (const r of rows.slice(0, 20)) console.log('   ' + r);
  if (rows.length > 20) console.log(`   … and ${rows.length - 20} more`);
};

console.log(`${places.length} biblical places, ${coverage.length} boxes of fine water`);
say('FIXED by the fine water', fixed);
say('STILL WRONG', wrong);
console.log('');
console.log(`in water and meant to be: ${expected.length}`);
console.log(expected.length ? '   ' + expected.join(', ') : '');
