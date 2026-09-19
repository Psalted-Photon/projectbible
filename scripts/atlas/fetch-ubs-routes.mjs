#!/usr/bin/env node
/**
 * Fetch the UBS Bible Routes geometry.
 *
 * 179 GeoJSON files, CC BY-SA 4.0, © United Bible Societies 2023, drawn by
 * Dr. Leen Ritmeyer. They are gitignored like every other source download, so
 * this script is how a fresh clone gets them back — see
 * data-sources/maps/journeys/LICENSE.md for what the licence obliges.
 *
 * Cached on disk, so a re-run only pulls what is missing.
 */
import fs from 'fs';
import path from 'path';

const REPO = 'ubsicap/ubs-open-license';
const DIR = 'ubs-bible-routes/GeoJsonRoutes';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const OUT = 'data-sources/maps/journeys/ubs-routes';
const CONCURRENCY = 8;

fs.mkdirSync(OUT, { recursive: true });

// The tree API rather than a hardcoded list: UBS names the files with numeric
// prefixes and inconsistent spacing ("107a.", "112.Zerah"), so anything we
// typed out by hand would rot the first time they touched one.
const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`, {
  headers: { Accept: 'application/vnd.github+json' },
});
if (!res.ok) throw new Error(`tree listing failed: HTTP ${res.status}`);
const tree = await res.json();
const files = tree.tree.filter((t) => t.path.startsWith(DIR) && t.path.endsWith('.geojson')).map((t) => t.path);
if (!files.length) throw new Error('tree listing returned no .geojson files — has the repo moved?');

let done = 0;
let fetched = 0;
const failed = [];

async function grab(p) {
  const dest = path.join(OUT, path.basename(p));
  if (!fs.existsSync(dest)) {
    try {
      // Names carry spaces and apostrophes, so each path element is encoded
      // separately — encoding the whole path would eat the slashes.
      const r = await fetch(RAW + p.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.writeFileSync(dest, await r.text());
      fetched++;
    } catch (err) {
      failed.push(`${path.basename(p)}: ${err.message}`);
    }
  }
  if (++done % 40 === 0) console.log(`  ${done}/${files.length}`);
}

const queue = [...files];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await grab(queue.shift());
  })
);

console.log(`${files.length} routes, ${fetched} newly fetched, ${files.length - fetched - failed.length} cached`);
if (failed.length) {
  console.error(`${failed.length} failed:`);
  failed.forEach((f) => console.error(`  ${f}`));
  process.exit(1);
}
