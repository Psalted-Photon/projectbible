#!/usr/bin/env node
/**
 * Verify the journeys survive the trip from pack to overlay.
 *
 * journeys-check.mjs validates the three tables as built. This validates the
 * two hops after that: the SELECT that pack-import.ts runs, and the assembly
 * buildDerived does on the other side. Both are reproduced here rather than
 * imported, because the real ones need IndexedDB and a browser — so what this
 * asserts is that the column names line up and every field the overlay reads
 * arrives populated. A rename on either side breaks this before it breaks a
 * silent NULL in a popup.
 *
 * The field-name trap is the point. Phase 1 of this feature was spent on five
 * wrong field names that each wrote NULL and failed nothing; `traveller` in the
 * table against `traveler` in the overlay is exactly that shape of mistake,
 * deliberately kept, so it needs a check rather than care.
 *
 * Run: node scripts/atlas/checks/journeys-derive-check.mjs
 */

import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PACK = join(ROOT, 'packs', 'consolidated', 'atlas-map.sqlite');

let failures = 0;
let checks = 0;

function expect(condition, label, detail) {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`);
    if (detail) console.log(`       ${detail}`);
  }
}

if (!existsSync(PACK)) {
  console.error(`No pack at ${PACK} — run the atlas build first.`);
  process.exit(1);
}

const db = new Database(PACK, { readonly: true });

// ── Hop one: the SELECTs pack-import.ts runs, column for column ────────────
//
// Written out in full rather than SELECT *, so a column dropped from the
// builder fails here the same way it would fail the import.

const journeyRows = db
  .prepare(
    'SELECT id, name, traveller, dates, description, colour, testament, sort_order, km FROM atlas_journeys'
  )
  .all()
  .map((r) => ({
    id: r.id,
    name: r.name,
    traveller: r.traveller,
    dates: r.dates,
    description: r.description ?? null,
    colour: r.colour,
    testament: r.testament,
    sortOrder: r.sort_order ?? 0,
    km: r.km ?? 0,
  }));

const stopRows = db
  .prepare(
    'SELECT journey_id, seq, place_id, name, lat, lon, travel_method, km_from_previous, note FROM atlas_journey_stops'
  )
  .all()
  .map((r) => ({
    id: `${r.journey_id}|${r.seq}`,
    journeyId: r.journey_id,
    seq: r.seq,
    placeId: r.place_id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    travelMethod: r.travel_method,
    kmFromPrevious: r.km_from_previous ?? null,
    note: r.note ?? null,
  }));

const geometryRows = db
  .prepare('SELECT journey_id, encoding, raw_bytes, data FROM atlas_journey_geometry')
  .all()
  .map((r) => ({ id: r.journey_id, encoding: r.encoding, rawBytes: r.raw_bytes, data: r.data }));

const placeRows = db.prepare('SELECT id, name, lat, lon, kind, modern, verses FROM atlas_biblical_places').all();
const places = new Map(placeRows.map((p) => [p.id, { ...p, verses: p.verses ?? '[]' }]));

console.log(`\nStores as imported: ${journeyRows.length} journeys, ${stopRows.length} stops, ${geometryRows.length} geometry rows`);

expect(stopRows.every((s) => s.id === `${s.journeyId}|${s.seq}`), 'every stop key is journeyId|seq');
expect(
  new Set(stopRows.map((s) => s.id)).size === stopRows.length,
  'no two stops share a key',
  'a collision would silently drop a stop on import'
);

// ── Hop two: buildDerived, the same way data.ts assembles it ───────────────

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const legs = new Map(
  geometryRows.map((r) => [r.id, safeParse(gunzipSync(r.data).toString('utf8'), [])])
);

const byJourney = new Map();
for (const stop of stopRows) {
  if (!byJourney.has(stop.journeyId)) byJourney.set(stop.journeyId, []);
  byJourney.get(stop.journeyId).push(stop);
}

const routes = journeyRows
  .sort((a, b) =>
    (a.testament === b.testament ? 0 : a.testament === 'old' ? -1 : 1) ||
    a.sortOrder - b.sortOrder ||
    a.id.localeCompare(b.id)
  )
  .map((j) => ({
    id: j.id,
    name: j.name,
    traveler: j.traveller,
    dates: j.dates,
    description: j.description ?? null,
    km: j.km,
    colour: j.colour,
    testament: j.testament,
    legs: legs.get(j.id) ?? [],
    stops: (byJourney.get(j.id) ?? [])
      .sort((a, b) => a.seq - b.seq)
      .map((s) => {
        const place = places.get(s.placeId);
        const verses = place ? safeParse(place.verses, []) : [];
        return {
          n: s.name,
          y: s.lat,
          x: s.lon,
          by: s.travelMethod,
          km: s.kmFromPrevious ?? 0,
          placeId: s.placeId,
          note: s.note ?? null,
          events: verses.map(([what, ref]) => ({ what, ref })),
        };
      }),
  }));

console.log('\nWhat the overlay would receive');
console.log('─'.repeat(78));

// ── What the overlay actually reads ───────────────────────────────────────
//
// overlays.js:596-672 reads route.stops, route.name, stop.y, stop.x, stop.by,
// stop.km, stop.n and stop.events[].what/.ref. Each is asserted, because the
// overlay does not check — an undefined `by` reaches the regex as "undefined"
// and simply draws a solid line.

expect(routes.length > 0, `${routes.length} routes assembled`);
expect(
  routes.every((r) => typeof r.traveler === 'string' && r.traveler.length > 0),
  'every route has a traveler (the one-L spelling the overlay reads)',
  'the table column is `traveller`; a missed rename here is a blank popup'
);
expect(
  routes.every((r) => r.name && r.dates && r.colour && r.id),
  'every route has an id, name, dates and colour'
);
expect(
  routes.every((r) => /^#[0-9a-f]{6}$/i.test(r.colour)),
  'every colour is #rrggbb',
  'phase 5 hands these straight to Leaflet'
);
expect(
  new Set(routes.map((r) => r.colour)).size === routes.length,
  'colours are unique across journeys',
  'two journeys the same colour is two journeys a reader cannot tell apart'
);
expect(
  routes.every((r) => Number.isFinite(r.km) && r.km > 0),
  'every route has a distance'
);
expect(
  routes.every((r) => ['old', 'new'].includes(r.testament)),
  'every route is grouped old or new',
  'phase 6 groups the sub-list by this'
);
// sort_order restarts at 1 per testament, so sorting on it alone interleaves
// the two halves. This is what catches that.
const testamentOrder = routes.map((r) => r.testament);
expect(
  testamentOrder.indexOf('new') === testamentOrder.lastIndexOf('old') + 1,
  'the old journeys all come before the new ones',
  `order: ${testamentOrder.join(' ')}`
);
// The derived shape carries no sortOrder — the array order *is* the order, and
// a field nobody reads is a field that can go stale. So the check compares the
// assembled order against the table's, rather than against a copy of it.
const expectedOrder = db
  .prepare("SELECT id FROM atlas_journeys ORDER BY testament = 'new', sort_order, id")
  .all()
  .map((r) => r.id);
expect(
  routes.map((r) => r.id).join(',') === expectedOrder.join(','),
  'each testament runs in its own sort order',
  `assembled: ${routes.map((r) => r.id).join(' ')}`
);

const allStops = routes.flatMap((r) => r.stops);
expect(
  routes.every((r) => r.stops.length >= 2),
  'every route has at least two stops',
  'one stop draws no line'
);
expect(
  allStops.every((s) => typeof s.n === 'string' && s.n.length > 0),
  `all ${allStops.length} stops have a name`
);
expect(
  allStops.every((s) => !/\s\d+$/.test(s.n)),
  'no stop name carries its id\'s disambiguating number',
  'the gazetteer ids Antioch 1 and Antioch 2; a reader must see "Antioch"'
);
expect(
  allStops.every((s) => Number.isFinite(s.y) && Number.isFinite(s.x)),
  'every stop has finite coordinates'
);
expect(
  allStops.every((s) => s.y !== 0 || s.x !== 0),
  'no stop sits at 0,0',
  'an unresolved place lands in the Gulf of Guinea'
);
expect(
  allStops.every((s) => typeof s.by === 'string' && s.by.length > 0),
  'every stop has a travel method',
  'overlays.js tests this with a regex; undefined would draw solid and say so'
);
expect(
  allStops.every((s) => Number.isFinite(s.km)),
  'every stop has a numeric km'
);

// Verses are the whole reason for the place_id join, and the stated gate.
const withVerses = allStops.filter((s) => s.events.length > 0);
expect(
  withVerses.length === allStops.length,
  `all ${allStops.length} stops carry verses`,
  `${allStops.length - withVerses.length} stops reached no verses through their place_id`
);
expect(
  allStops.every((s) => s.events.every((e) => e.what && e.ref)),
  'every event has both a label and a ref'
);
expect(
  allStops.every((s) => s.events.every((e) => /^[\w\d]+\.\d+/.test(e.ref))),
  'every ref is OSIS',
  'the open question about linking a stop into the reader depends on this'
);
expect(
  allStops.every((s) => places.has(s.placeId)),
  'every stop still resolves to a gazetteer row'
);

// Geometry: phase 5 draws these, so they have to survive the inflate.
expect(
  routes.every((r) => r.legs.length > 0),
  'every route inflated at least one leg'
);
const points = routes.flatMap((r) => r.legs.flat());
expect(
  points.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])),
  `all ${points.length} geometry points are [lon, lat] pairs`
);
expect(
  points.every((p) => p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90),
  'every point is in range',
  'lon/lat swapped would put the routes in the ocean'
);

console.log('\nPer journey');
console.log('─'.repeat(78));
for (const r of routes) {
  const verseCount = r.stops.reduce((n, s) => n + s.events.length, 0);
  console.log(
    `  ${r.testament === 'old' ? 'OT' : 'NT'} ${r.name.padEnd(34)} ` +
      `${String(r.stops.length).padStart(3)} stops  ` +
      `${String(verseCount).padStart(4)} verses  ` +
      `${String(r.legs.length).padStart(2)} legs  ${r.colour}  ${r.traveler}`
  );
}

// Not a pass/fail — a number phase 5 needs. The gazetteer knows where a place
// is named, not which of those mentions belong to this journey, so a stop's
// verse list is as long as its place is famous. A popup that bullets every one
// would be 955 lines deep at Jerusalem.
const spread = allStops.map((s) => s.events.length).sort((a, b) => a - b);
console.log('\nVerses per stop — the popup has to cut these down');
console.log('─'.repeat(78));
console.log(
  `  min ${spread[0]}  median ${spread[Math.floor(spread.length / 2)]}  ` +
    `max ${spread[spread.length - 1]}  ` +
    `over 50: ${spread.filter((n) => n > 50).length} of ${spread.length} stops`
);

console.log('\n' + '─'.repeat(78));
console.log(`${checks} checks, ${failures} failed`);
db.close();
process.exit(failures ? 1 : 0);
