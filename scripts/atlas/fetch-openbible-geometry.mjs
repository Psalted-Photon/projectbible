/**
 * Fetch the region shapes openbible.sqlite references but doesn't carry.
 * Cached on disk, so a re-run only pulls what's missing.
 */
import fs from 'fs';
import path from 'path';

const BASE = 'https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/geometry';
const OUT = 'data-sources/maps/downloads/openbible-geometry';
const CONCURRENCY = 8;

fs.mkdirSync(OUT, { recursive: true });
const wanted = JSON.parse(fs.readFileSync('scripts/atlas/geometry-wanted.json', 'utf8'));

let done = 0;
let fetched = 0;
let failed = [];

async function grab([id, meta]) {
  const dest = path.join(OUT, `${id}.geojson`);
  if (!fs.existsSync(dest)) {
    try {
      const res = await fetch(`${BASE}/${id}.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(dest, await res.text());
      fetched++;
    } catch (err) {
      failed.push(`${id} (${meta.place}): ${err.message}`);
    }
  }
  if (++done % 40 === 0) console.log(`  ${done}/${wanted.length}`);
}

const queue = [...wanted];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await grab(queue.shift());
  })
);

console.log(`\ndone: ${done} wanted, ${fetched} newly fetched, ${failed.length} failed`);
if (failed.length) console.log('failures:\n  ' + failed.slice(0, 10).join('\n  '));
