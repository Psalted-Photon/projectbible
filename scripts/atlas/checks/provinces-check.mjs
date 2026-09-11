#!/usr/bin/env node
/**
 * Do the Roman provinces put known cities in the right province?
 *
 * The Barrington province shapes carry no names at all — the columns exist and
 * every row holds a zero — so the era drew eighty-one anonymous shapes and every
 * tap answered "Rome". These come from the Digital Atlas of the Roman Empire
 * instead. This checks them after simplification, which is the version the map
 * actually draws, because a shape can be right in the source and wrong once
 * generalised.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../../..');
const FILE = path.join(ROOT, 'apps/pwa-polished/public/atlas/ov-terr-rome-provinces-1.json');

/** Cities whose province at AD 200 is not in doubt. */
const EXPECT = [
  ['Jerusalem', 35.2342, 31.7767, 'Iudaea'],
  ['Caesarea Maritima', 34.8922, 32.5000, 'Iudaea'],
  ['Antioch', 36.1600, 36.2000, 'Syria'],
  ['Damascus', 36.3064, 33.5111, 'Syria'],
  ['Ephesus', 27.3407, 37.9391, 'Asia'],
  ['Smyrna', 27.1428, 38.4189, 'Asia'],
  ['Athens', 23.7267, 37.9841, 'Achaia'],
  ['Corinth', 22.8790, 37.9060, 'Achaia'],
  ['Thessalonica', 22.9444, 40.6403, 'Macedonia'],
  ['Philippi', 24.2871, 41.0131, 'Macedonia'],
  ['Tarsus', 34.8950, 36.9170, 'Cilicia'],
  ['Alexandria', 29.9200, 31.2000, 'Aegyptus'],
  ['Carthage', 10.3233, 36.8528, 'Africa Proconsularis'],
  ['Syracuse', 15.2866, 37.0755, 'Sicilia'],
  ['Salamis (Cyprus)', 33.9000, 35.1800, 'Cyprus'],
  ['Ancyra', 32.8597, 39.9334, 'Galatia et Cappadocia'],
  ['Nicomedia', 29.9200, 40.7650, 'Bithynia et Pontus'],
  ['Petra', 35.4444, 30.3285, 'Arabia'],
  ['Londinium', -0.0900, 51.5100, 'Britannia'],
  ['Lugdunum', 4.8320, 45.7600, 'Lugdunensis'],
  ['Gortyn (Crete)', 24.9500, 35.0600, 'Creta et Cyrene'],
  ['Naples', 14.2680, 40.8510, 'Latium et Campania'],
  ['Mediolanum', 9.1900, 45.4640, 'Transpadana'],
  ['Bononia', 11.3430, 44.4940, 'Aemilia'],
];

function inRing(pt, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

function hit(pt, f) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    if (!inRing(pt, poly[0])) continue;
    let hole = false;
    for (let k = 1; k < poly.length; k++) if (inRing(pt, poly[k])) hole = true;
    if (!hole) return true;
  }
  return false;
}

const fc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const named = fc.features.filter((f) => f.properties?.name);
console.log(`${fc.features.length} provinces, ${named.length} named`);
console.log('');

let wrong = 0;
for (const [city, lon, lat, want] of EXPECT) {
  const got = fc.features.filter((f) => hit([lon, lat], f)).map((f) => f.properties?.name ?? '(unnamed)');
  const ok = got.includes(want);
  if (!ok) wrong++;
  console.log(`  ${ok ? 'ok  ' : 'WRONG'} ${city.padEnd(19)} ${want.padEnd(24)} ${ok ? '' : `got ${got.length ? got.join(', ') : '(outside every province)'}`}`);
}
console.log('');
console.log(wrong ? `${wrong} of ${EXPECT.length} wrong` : `all ${EXPECT.length} land in the right province`);
