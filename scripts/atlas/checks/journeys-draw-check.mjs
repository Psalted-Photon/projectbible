#!/usr/bin/env node
/**
 * Verify the decisions the overlay's draw() makes, against the real geometry.
 *
 * journeys-derive-check.mjs proves every field arrives populated. This proves
 * the drawing is sane once it has them — the questions that only the actual
 * coordinates can answer, and that no amount of reading overlays.js will:
 *
 *   - which stops the drawn line never reaches, and so get a dotted connector
 *   - which legs come out dashed, and whether that matches the sea legs
 *   - whether any journey falls back to straight lines
 *   - whether the label colours are parseable as colours
 *
 * The helpers are reproduced rather than imported, because the real ones live in
 * a Leaflet module that needs a browser. The constants are *read out of*
 * overlays.js rather than copied, so a value changed there is measured here
 * rather than silently diverging.
 *
 * It earned its keep on first run, failing twice on real bugs:
 *
 *   - the end-ring red was #b0463f, which is the Last Journey to Jerusalem's own
 *     colour, so that journey's arrival would have been an invisible ring
 *   - the leg styling took its method from the stop nearest a leg's last point,
 *     and the stored direction is unreliable, so Paul's First Journey credited
 *     the Seleucia → Salamis crossing to Seleucia and drew all three of its sea
 *     legs as roads
 *
 * The second is why methodForLeg matches a stop *pair* in both orientations.
 * Verified by putting the endpoint version back: the coverage check fails at 8
 * dashed legs against 21 sea crossings.
 *
 * Run: node scripts/atlas/checks/journeys-draw-check.mjs
 */

import Database from 'better-sqlite3';
import { gunzipSync } from 'zlib';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PACK = join(ROOT, 'packs', 'consolidated', 'atlas-map.sqlite');
const OVERLAYS = join(ROOT, 'apps', 'pwa-polished', 'src', 'lib', 'atlas', 'overlays.js');

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

// ── The constants, read from the overlay rather than copied ────────────────
//
// A copy would drift. Reading them means the check measures what the app does,
// and a rename fails here loudly instead of quietly measuring the old number.

const source = readFileSync(OVERLAYS, 'utf8');

function constFromSource(name, pattern) {
  const m = new RegExp(`const ${name} = ${pattern};`).exec(source);
  if (!m) {
    console.error(
      `Could not read ${name} from overlays.js. It was renamed or reshaped — ` +
      `update this check to match, rather than hardcoding the value.`
    );
    process.exit(1);
  }
  return m[1];
}

const UNREACHED_KM = Number(constFromSource('UNREACHED_KM', '(\\d+)'));
const START_COLOUR = constFromSource('START_COLOUR', "'(#[0-9a-f]{6})'");
const END_COLOUR = constFromSource('END_COLOUR', "'(#[0-9a-f]{6})'");
const SEA_RE = /ship|sail|sea|boat/i;

console.log(
  `\nRead from overlays.js: UNREACHED_KM=${UNREACHED_KM}, ` +
  `start=${START_COLOUR}, end=${END_COLOUR}`
);

// ── The routes, assembled as buildDerived assembles them ──────────────────

const db = new Database(PACK, { readonly: true });

const journeys = db
  .prepare("SELECT id, name, colour, testament, sort_order FROM atlas_journeys ORDER BY testament = 'new', sort_order, id")
  .all();

const stopsBy = new Map();
for (const r of db.prepare('SELECT * FROM atlas_journey_stops ORDER BY journey_id, seq').all()) {
  if (!stopsBy.has(r.journey_id)) stopsBy.set(r.journey_id, []);
  stopsBy.get(r.journey_id).push(r);
}

const legsBy = new Map(
  db.prepare('SELECT journey_id, data FROM atlas_journey_geometry').all()
    .map((r) => [r.journey_id, JSON.parse(gunzipSync(r.data).toString('utf8'))])
);

// ── The helpers, as overlays.js computes them ─────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** nearestLegKm: how far a point sits from the nearest drawn coordinate. */
function nearestLegKm(legs, lat, lon) {
  let best = Infinity;
  for (const leg of legs) {
    for (const [lon2, lat2] of leg) {
      const km = haversine(lat, lon, lat2, lon2);
      if (km < best) best = km;
    }
  }
  return best;
}

/**
 * methodForLeg: the leg matched to the consecutive stop pair it runs between,
 * scored in both orientations, taking the arriving stop's method.
 */
function methodForLeg(stops, leg) {
  const a = leg[0];
  const b = leg[leg.length - 1];
  let best = null;
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1];
    const to = stops[i];
    const fwd = haversine(a[1], a[0], from.lat, from.lon) + haversine(b[1], b[0], to.lat, to.lon);
    const rev = haversine(a[1], a[0], to.lat, to.lon) + haversine(b[1], b[0], from.lat, from.lon);
    const cost = Math.min(fwd, rev);
    if (!best || cost < best.cost) best = { cost, by: to.travel_method, pair: `${from.name} → ${to.name}` };
  }
  return best ?? { by: '', pair: '—' };
}

function withAlpha(hex, alpha) {
  if (alpha >= 1) return hex;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${Math.max(0, alpha).toFixed(2)})`;
}

// ── What the overlay would draw ──────────────────────────────────────────

console.log('\nWhat draw() would produce');
console.log('─'.repeat(78));

const drawn = journeys.map((j) => {
  const stops = stopsBy.get(j.id) ?? [];
  const legs = legsBy.get(j.id) ?? [];

  // drawGeometry matches each leg to the stop pair it runs between.
  const legStyles = legs
    .filter((leg) => leg.length >= 2)
    .map((leg) => {
      const { by, pair } = methodForLeg(stops, leg);
      return { by, pair, dashed: SEA_RE.test(by ?? ''), points: leg.length };
    });

  // The dotted connectors: stops the line never reaches.
  const unreached = stops
    .slice(1)
    .map((s) => ({ name: s.name, km: nearestLegKm(legs, s.lat, s.lon) }))
    .filter((s) => s.km > UNREACHED_KM);

  return {
    ...j,
    stops,
    legs,
    legStyles,
    unreached,
    mode: legs.length ? 'geometry' : 'straight',
    seaStops: stops.filter((s) => SEA_RE.test(s.travel_method ?? '')).length,
  };
});

for (const r of drawn) {
  const dashed = r.legStyles.filter((l) => l.dashed).length;
  console.log(
    `  ${r.name.padEnd(34)} ${r.mode.padEnd(8)} ` +
    `${String(r.legStyles.length).padStart(2)} legs (${dashed} dashed)  ` +
    `${String(r.seaStops).padStart(2)} sea stops  ` +
    `${r.unreached.length ? `${r.unreached.length} dotted` : '—'}`
  );
  // The pair each leg matched to, which is the thing to read when a journey's
  // dashing looks wrong. Only where there is a sea leg to explain.
  if (dashed) {
    for (const l of r.legStyles) {
      console.log(`      ${l.dashed ? '~~' : '——'} ${l.pair.padEnd(30)} ${l.by}`);
    }
  }
}

console.log('\nChecks');
console.log('─'.repeat(78));

// Every journey draws the surveyed line, not the fallback. The fallback is kept
// for a journey without geometry, and right now there is none — so if this ever
// fails, a journey lost its geometry rather than the fallback being wrong.
expect(
  drawn.every((r) => r.mode === 'geometry'),
  'every journey draws its surveyed geometry',
  `straight-line fallback: ${drawn.filter((r) => r.mode === 'straight').map((r) => r.id).join(', ')}`
);
expect(
  drawn.every((r) => r.legStyles.length > 0),
  'every journey has at least one drawable leg',
  'a leg of one point draws nothing'
);
expect(
  drawn.every((r) => r.legStyles.every((l) => l.by && l.by.length > 0)),
  'every leg resolved a travel method from its nearest stop',
  'an empty method tests false against the sea regex and silently draws solid'
);

// The dotted connectors. Phase 2 and 3 named exactly two stops as permanently
// off their line — Joseph's Egypt and Jonah's Tarshish — and the builder fails
// on any other over 120 km. So this is the number, and a third appearing means
// either a new exemption was added or a journey was mapped to the wrong file.
const dotted = drawn.flatMap((r) => r.unreached.map((u) => `${r.id}/${u.name}`));
expect(
  dotted.length === 2,
  `exactly 2 stops get a dotted connector — ${dotted.join(', ')}`,
  `found ${dotted.length}: ${dotted.join(', ')}`
);
expect(
  dotted.some((d) => d.startsWith('joseph-to-dothan/')) &&
  dotted.some((d) => d.startsWith('jonah-to-tarshish/')),
  'the two dotted stops are the two the index exempts on purpose',
  `got ${dotted.join(', ')} — these are Joseph's Egypt and Jonah's Tarshish`
);

// The sea/land distinction is the reason legs are styled at all, so at least one
// journey has to actually show it. Paul's voyages are the ones that do.
const withDashed = drawn.filter((r) => r.legStyles.some((l) => l.dashed));
expect(
  withDashed.length >= 3,
  `${withDashed.length} journeys draw at least one dashed sea leg`,
  'the sea/land distinction is carried by too few journeys to be worth the code'
);
// A journey with sea stops whose legs all came out solid means the matching
// picked the wrong pair every time — the distinction lost exactly where it
// exists. This is the check that caught the endpoint heuristic: Paul's First
// Journey had three sea stops and drew every leg as a road.
//
// The test is per sea stop, not per journey, and it asks the only question that
// distinguishes a bug from a thin source: did any leg match the pair that arrives
// at this stop? If one did and it is not dashed, the method was read off the
// wrong stop. If none did, no drawn line covers that crossing at all and there is
// nothing here to dash.
//
// Leg count is the wrong discriminator and was the first thing tried: both
// journeys below have more legs than sea stops and would have passed it.
const seaStops = drawn.flatMap((r) =>
  r.stops.slice(1)
    .map((s, i) => ({ route: r, arriveSeq: i + 1, name: s.name, by: s.travel_method }))
    .filter((s) => SEA_RE.test(s.by ?? ''))
    .map((s) => {
      const pair = `${r.stops[s.arriveSeq - 1].name} → ${s.name}`;
      const matched = r.legStyles.filter((l) => l.pair === pair);
      return { ...s, pair, matched };
    })
);

const wrongMethod = seaStops.filter((s) => s.matched.length && !s.matched.every((l) => l.dashed));
expect(
  wrongMethod.length === 0,
  `every sea crossing that a leg matched is drawn dashed (${seaStops.filter((s) => s.matched.length).length} of ${seaStops.length})`,
  wrongMethod.map((s) => `${s.route.id}: ${s.pair} matched a leg but drew solid`).join('; ')
);

// Most sea crossings have no leg of their own, and that is the source rather
// than the matching: the Voyage to Rome has 13 stops and 4 legs, because
// Ritmeyer drew one stroke past a string of ports instead of one per call. So
// there is no list of expected exceptions to keep — 12 of 21 crossings are
// covered by a leg that also covers their neighbours.
//
// What can be asserted is that the dashing tracks how much of a journey was
// sailed. The Voyage to Rome is 9 crossings out of 12 and must come out mostly
// dashed; the Exodus is none and must come out fully solid. Checked as a
// proportion per journey rather than as a named list, so it keeps meaning if the
// index gains a journey.
const uncovered = seaStops.filter((s) => !s.matched.length);
console.log(
  `\n  note: ${uncovered.length} of ${seaStops.length} sea crossings have no leg of ` +
  `their own — the source draws one stroke past several ports`
);

const mismatched = drawn
  .filter((r) => r.stops.length > 1 && r.legStyles.length > 0)
  .map((r) => {
    const seaShare = r.seaStops / (r.stops.length - 1);
    const dashShare = r.legStyles.filter((l) => l.dashed).length / r.legStyles.length;
    return { id: r.id, seaShare, dashShare };
  })
  // A journey mostly sailed should be mostly dashed, and one never sailed should
  // never be. The middle is left alone: a source stroke genuinely covers both a
  // road and a crossing, and there is no right proportion to demand there.
  .filter(({ seaShare, dashShare }) =>
    (seaShare > 0.6 && dashShare < 0.5) || (seaShare === 0 && dashShare > 0)
  );
expect(
  mismatched.length === 0,
  'a mostly-sailed journey draws mostly dashed, and a never-sailed one never does',
  mismatched
    .map((m) => `${m.id}: ${Math.round(m.seaShare * 100)}% by sea but ${Math.round(m.dashShare * 100)}% dashed`)
    .join('; ')
);

// The dotted connectors and the dashed legs must not both claim the same
// crossing: a stop off the end of the line gets the dotted line *instead* of a
// leg, and drawing both would be two answers to where the traveller went.
const doubleDrawn = seaStops.filter(
  (s) => s.matched.length && s.route.unreached.some((u) => u.name === s.name)
);
expect(
  doubleDrawn.length === 0,
  'no stop gets both a dotted connector and a matched leg',
  doubleDrawn.map((s) => `${s.route.id}/${s.name}`).join(', ')
);

// Per sea stop rather than per journey. A journey with four sea crossings and one
// dashed leg passes the check above while drawing three voyages as roads, which
// is most of the way back to the bug. Not every sea stop can be expected to have
// a leg of its own — legs are fewer than stops — but the share that do should be
// most of them, and a collapse here means the matching has gone wrong again.
const seaStopTotal = drawn.reduce((n, r) => n + r.seaStops, 0);
const dashedTotal = drawn.reduce((n, r) => n + r.legStyles.filter((l) => l.dashed).length, 0);
expect(
  dashedTotal >= seaStopTotal * 0.5,
  `${dashedTotal} dashed legs cover ${seaStopTotal} sea stops (at least half)`,
  'most sea crossings are being drawn as roads'
);
// And the converse: a dashed leg on a journey with no sea travel at all would be
// methodNear inventing a voyage.
const inventedSea = drawn.filter((r) => r.seaStops === 0 && r.legStyles.some((l) => l.dashed));
expect(
  inventedSea.length === 0,
  'no journey without sea stops draws a dashed leg',
  `${inventedSea.map((r) => r.id).join(', ')}`
);

// The ends have to be distinguishable from every route colour, or a ring the
// colour of the line it sits on marks nothing.
//
// Equality is the wrong test and was the first one written here: #b0463f was
// caught by it, being the Last Journey's exact colour, but it also sat 15 from
// Elijah's #b5543d, which equality would have passed while the ring stayed just
// as invisible. So this measures distance, and the floor is well above the 15
// that hid it and below the 65 the current pair actually achieve.
const MIN_RING_DISTANCE = 45;

function rgbDistance(a, b) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [A, B] = [p(a), p(b)];
  return Math.sqrt(A.reduce((s, v, i) => s + (v - B[i]) ** 2, 0));
}

expect(
  /^#[0-9a-f]{6}$/i.test(START_COLOUR) && /^#[0-9a-f]{6}$/i.test(END_COLOUR),
  'the start and end colours are #rrggbb'
);

for (const [what, ring] of [['start', START_COLOUR], ['end', END_COLOUR]]) {
  const nearest = journeys
    .map((j) => ({ id: j.id, colour: j.colour, d: rgbDistance(ring, j.colour) }))
    .sort((a, b) => a.d - b.d)[0];
  expect(
    nearest.d >= MIN_RING_DISTANCE,
    `the ${what} ring is distinguishable from every route colour ` +
      `(nearest ${nearest.id} at ${Math.round(nearest.d)})`,
    `${ring} sits ${Math.round(nearest.d)} from ${nearest.id}'s ${nearest.colour} — ` +
      `that journey's ${what} would be invisible on its own line`
  );
}

expect(
  rgbDistance(START_COLOUR, END_COLOUR) >= MIN_RING_DISTANCE * 2,
  'the start and end rings are unmistakable for each other',
  'the two ends of a journey are the one thing its single colour cannot say'
);

// The lettering fades through its colour, so every route colour has to survive
// withAlpha as something a browser will accept.
const faded = journeys.map((j) => withAlpha(j.colour, 0.4));
expect(
  faded.every((c) => /^rgba\(\d{1,3},\d{1,3},\d{1,3},0\.\d\d\)$/.test(c)),
  'every route colour fades to a valid rgba()',
  `first failure: ${faded.find((c) => !/^rgba\(/.test(c))}`
);
expect(
  journeys.every((j) => withAlpha(j.colour, 1) === j.colour),
  'a full-strength fade returns the hex unchanged',
  'the common case must not become an rgba() string for no reason'
);

console.log('\n' + '─'.repeat(78));
console.log(`${checks} checks, ${failures} failed`);
db.close();
process.exit(failures ? 1 : 0);
