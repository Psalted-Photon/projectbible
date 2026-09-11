#!/usr/bin/env node
/**
 * Do the place photographs actually load?
 *
 * The pack carries URLs rather than pictures, so a photograph is only as good
 * as the link. Wikimedia also stopped serving arbitrary thumbnail widths — 400
 * and 800 are refused where 330 and 1280 are served — so a size chosen by
 * eye rather than by test would fail silently on every photograph at once.
 *
 * Samples a few rather than checking all 955, and waits several seconds
 * between requests. Wikimedia rate-limits bursts hard: sixteen HEAD requests
 * back to back earn a 429 on all but the first three, which reads exactly like
 * every link being broken. It is a burst limit and not a block — the same URLs
 * return an image when asked at a human pace — and a reader opening one place
 * panel at a time is nowhere near it. Slow here so the check tests the links
 * rather than the rate limiter.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../../..');
const A = path.join(ROOT, 'apps/pwa-polished/public/atlas');
const UA = 'ProjectBible atlas build check';

const photos = JSON.parse(fs.readFileSync(path.join(A, 'place-photos.json'), 'utf8'));
const places = JSON.parse(fs.readFileSync(path.join(A, 'biblical-places.json'), 'utf8'));
const nameOf = new Map(places.map((p) => [p.id, p.n]));

const ids = Object.keys(photos);
console.log(`${ids.length} places carry a photograph`);

/** The best-known places, plus a spread of others. */
const WANTED = ['Bethlehem 1', 'Capernaum', 'Jerusalem', 'Nazareth', 'Golgotha', 'Jericho 1'];
const sample = [...new Set([...WANTED.filter((id) => photos[id]), ...ids.filter((_, i) => i % 211 === 0)])].slice(0, 5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One retry after a pause, so a shared rate limit is not read as a dead link. */
async function head(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (res.status !== 429) return res;
    await sleep(15000 * attempt);
  }
  return fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
}

let bad = 0;
for (const id of sample) {
  const shot = photos[id];
  const results = [];
  for (const [label, url] of [['thumb', shot.t], ['full', shot.f]]) {
    try {
      const res = await head(url);
      await sleep(6000);
      const type = res.headers.get('content-type') ?? '';
      const ok = res.ok && type.startsWith('image/');
      if (!ok) bad++;
      results.push(`${label} ${ok ? 'ok' : `${res.status} ${type}`}`);
    } catch (err) {
      bad++;
      results.push(`${label} failed`);
    }
  }
  const missing = [!shot.a && 'no author', !shot.l && 'no licence', !shot.u && 'no source link'].filter(Boolean);
  if (missing.length) bad++;
  console.log(`  ${(nameOf.get(id) ?? id).padEnd(18)} ${results.join('  ')}${missing.length ? `  << ${missing.join(', ')}` : ''}`);
}

console.log('');
const noCredit = ids.filter((id) => !photos[id].a || !photos[id].l).length;
const noLink = ids.filter((id) => !photos[id].u).length;
console.log(`credit missing on ${noCredit}, source link missing on ${noLink}, of ${ids.length}`);
console.log(bad ? `${bad} problems in the sample` : `all ${sample.length} sampled photographs load and carry their credit`);
