#!/usr/bin/env node
/**
 * Fetch real water outlines for the biblical world from OpenStreetMap.
 *
 * Why this exists: Natural Earth draws the Sea of Galilee as a twenty-five
 * point blob whose northern edge runs about 1.5 km too far north, so Capernaum
 * — correctly placed to within metres — sits in the lake. The Barrington
 * linework is no better there, at twenty-seven points. OpenStreetMap has the
 * same lake as a single closed ring of two thousand points, and against that
 * one every town on the shore is on the shore.
 *
 * Where to fetch is decided by the data rather than by a box drawn by hand:
 * every one-degree cell holding a place Scripture names, merged into runs so
 * the server is asked a few dozen times instead of a hundred and twenty-six.
 * Detail arrives exactly where a reader zooms in and nowhere else.
 *
 * Responses are cached, so a re-run costs nothing and a failed run resumes.
 * Nothing here runs at build time for the app; it is a one-off harvest.
 *
 * OpenStreetMap is ODbL — the same terms as the Barrington data already in use.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const PLACES = path.join(ROOT, 'apps/pwa-polished/public/atlas/biblical-places.json');
const CACHE = path.join(ROOT, 'data-sources/maps/downloads/osm-water');
/**
 * Several instances of the same free service. The main one started refusing
 * connections part way through a run — a burst of requests is exactly what it
 * is entitled to shed — so the fetcher moves down the list rather than failing,
 * and remembers which one last worked.
 */
const ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
let endpoint = 0;

/** A public service doing us a favour. One request at a time, with a breath between. */
const PAUSE_MS = 4000;
const RETRIES = 3;
const TIMEOUT_MS = 180000;

/** Bleed past the edge so a lake straddling two boxes arrives whole in both. */
const PAD = 0.25;

fs.mkdirSync(CACHE, { recursive: true });

// ------------------------------------------------------------------ boxes

/**
 * One-degree cells holding a biblical place, merged along each row of latitude
 * into the longest runs they will make.
 */
function boxesFromPlaces() {
  const places = JSON.parse(fs.readFileSync(PLACES, 'utf8'));
  const rows = new Map();
  for (const p of places) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const lat = Math.floor(p.y);
    const lon = Math.floor(p.x);
    if (!rows.has(lat)) rows.set(lat, new Set());
    rows.get(lat).add(lon);
  }

  const boxes = [];
  for (const [lat, lonSet] of [...rows].sort((a, b) => a[0] - b[0])) {
    const lons = [...lonSet].sort((a, b) => a - b);
    let start = lons[0];
    let prev = lons[0];
    for (let i = 1; i <= lons.length; i++) {
      const lon = lons[i];
      if (lon === prev + 1) { prev = lon; continue; }
      boxes.push({ south: lat, north: lat + 1, west: start, east: prev + 1 });
      start = lon; prev = lon;
    }
  }
  return boxes;
}

const boxes = boxesFromPlaces();
const cells = boxes.reduce((a, b) => a + (b.east - b.west), 0);
console.log(`${cells} cells of one degree, merged into ${boxes.length} requests`);

// ----------------------------------------------------------------- fetching

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nameOf = (b) => `osm_${b.south}_${b.west}_${b.north}_${b.east}.json`;

/**
 * Named ways and every relation, which is where the real lakes live. Unnamed
 * ways are farm ponds and settling tanks by the thousand; the map is not
 * improved by them and neither is the pack.
 */
/**
 * Water and shoreline in one request rather than two, which halves how often
 * the server is asked. Unnamed ways are farm ponds and settling tanks by the
 * thousand; the map is not improved by them and neither is the pack.
 */
function query(b) {
  const s = b.south - PAD, w = b.west - PAD, n = b.north + PAD, e = b.east + PAD;
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:180];(
  relation["natural"="water"](${bbox});
  way["natural"="water"]["name"](${bbox});
  way["natural"="coastline"](${bbox});
);out geom;`;
}

async function ask(b) {
  let last = '';
  for (let attempt = 1; attempt <= RETRIES * ENDPOINTS.length; attempt++) {
    const url = ENDPOINTS[endpoint];
    try {
      const res = await fetch(url, {
        method: 'POST', body: query(b), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      JSON.parse(text);                       // fail here rather than at build time
      return { text };
    } catch (err) {
      last = String(err.message ?? err);
      // Move to the next instance before trying again, so one that has stopped
      // answering does not cost the whole run.
      endpoint = (endpoint + 1) % ENDPOINTS.length;
      await sleep(PAUSE_MS * Math.min(attempt, 5));
    }
  }
  return { failed: last };
}

/** Split a box into its one-degree cells. */
function cellsOf(b) {
  const out = [];
  for (let w = b.west; w < b.east; w++) out.push({ south: b.south, north: b.north, west: w, east: w + 1 });
  return out;
}

/**
 * A wide box over a long coastline can be more than a busy server will do in
 * the time it allows itself. When one refuses repeatedly, ask for its cells one
 * at a time instead — same ground, smaller bites.
 */
async function fetchBox(b) {
  const file = path.join(CACHE, nameOf(b));
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return { cached: true, bytes: fs.statSync(file).size };

  const whole = await ask(b);
  if (whole.text) {
    fs.writeFileSync(file, whole.text);
    return { cached: false, bytes: whole.text.length };
  }

  const cells = cellsOf(b);
  if (cells.length < 2) return { failed: whole.failed };

  let bytes = 0;
  const stubborn = [];
  for (const cell of cells) {
    const cellFile = path.join(CACHE, nameOf(cell));
    if (fs.existsSync(cellFile) && fs.statSync(cellFile).size > 0) { bytes += fs.statSync(cellFile).size; continue; }
    const one = await ask(cell);
    if (one.text) { fs.writeFileSync(cellFile, one.text); bytes += one.text.length; await sleep(PAUSE_MS); }
    else stubborn.push(nameOf(cell));
  }
  if (stubborn.length === cells.length) return { failed: whole.failed };
  return { cached: false, bytes, split: cells.length, stubborn };
}

let done = 0, fetched = 0, bytes = 0;
const failures = [];

for (const b of boxes) {
  const r = await fetchBox(b);
  done++;
  if (r.failed) {
    failures.push(`${nameOf(b)}: ${r.failed}`);
    console.log(`  ${done}/${boxes.length} FAILED ${nameOf(b)} — ${r.failed}`);
  } else {
    bytes += r.bytes;
    if (!r.cached) { fetched++; await sleep(PAUSE_MS); }
    if (r.split) console.log(`  ${done}/${boxes.length} split into ${r.split} cells${r.stubborn?.length ? `, ${r.stubborn.length} still refused` : ''}`);
    else if (done % 5 === 0 || done === boxes.length) {
      console.log(`  ${done}/${boxes.length} boxes, ${fetched} fetched, ${(bytes / 1e6).toFixed(1)} MB cached`);
    }
  }
}

console.log('');
console.log(`${(bytes / 1e6).toFixed(1)} MB in ${CACHE}`);
if (failures.length) {
  console.log(`${failures.length} failed — re-run to retry just these:`);
  for (const f of failures.slice(0, 10)) console.log('  ' + f);
}
