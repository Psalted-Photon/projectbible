#!/usr/bin/env node
/**
 * Verify what the per-journey sub-list in AtlasPane assumes about the data.
 *
 * The other three journey checks prove the pack is right, the derived shape is
 * populated and the drawing is sane. This one asks a different question: given
 * those seventeen routes, is the *list of switches* usable? A panel is data
 * rendered, and every way this list can be wrong is a property of the routes
 * rather than of the markup:
 *
 *   - a route whose testament falls in neither group vanishes from the panel
 *     entirely, while still drawing on the map — a journey you can see and
 *     cannot switch off
 *   - two rows with indistinguishable swatches are two rows a reader cannot
 *     match to the two lines crossing each other on the map
 *   - a name too long for the row is a row that says the same thing as its
 *     neighbour, because the part that differs is the part that got clipped
 *
 * The grouping rule is read out of AtlasPane.svelte rather than copied, for the
 * same reason journeys-draw-check.mjs reads its constants out of overlays.js: a
 * copy drifts, and a drifted copy passes while the app is wrong.
 *
 * Run: node scripts/atlas/checks/journeys-panel-check.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PACK = join(ROOT, 'packs', 'consolidated', 'atlas-map.sqlite');
const PANE = join(ROOT, 'apps', 'pwa-polished', 'src', 'components', 'AtlasPane.svelte');
const OVERLAYS = join(ROOT, 'apps', 'pwa-polished', 'src', 'lib', 'atlas', 'overlays.js');
const MAP = join(ROOT, 'apps', 'pwa-polished', 'src', 'lib', 'atlas', 'map.js');

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

const paneSource = readFileSync(PANE, 'utf8');
const overlaySource = readFileSync(OVERLAYS, 'utf8');
const mapSource = readFileSync(MAP, 'utf8');

// ── The grouping rule, read from the panel ────────────────────────────────
//
// routeGroups splits on one value. Reading which one means a change to that
// line is measured here rather than leaving this check asserting a rule the
// app stopped following.

const splitMatch = /r\.testament !== '(\w+)'/.exec(paneSource);
if (!splitMatch) {
  console.error(
    'Could not read the grouping rule from AtlasPane.svelte. routeGroups was ' +
    'reshaped — update this check to match, rather than assuming two groups.'
  );
  process.exit(1);
}
const NEW_TESTAMENT = splitMatch[1];

console.log(`\nRead from AtlasPane.svelte: routes group on testament === '${NEW_TESTAMENT}'`);

const db = new Database(PACK, { readonly: true });
const journeys = db
  .prepare("SELECT id, name, traveller, dates, colour, testament FROM atlas_journeys ORDER BY testament = 'new', sort_order, id")
  .all();

console.log(`${journeys.length} journeys\n`);

// ── Every journey reaches a group ─────────────────────────────────────────

console.log('Grouping');

// The panel's two groups are "is the new testament value" and "is not". That
// second arm is a catch-all, so nothing can fall out — but only while there are
// exactly two meaningful values. A third would land silently in the old
// testament pile and be wrong rather than missing, which is harder to notice.
const testaments = [...new Set(journeys.map((j) => j.testament))].sort();
expect(
  testaments.length === 2 && testaments.includes(NEW_TESTAMENT),
  'testament has exactly two values, one of them the panel\'s split value',
  `found: ${testaments.join(', ')} — a third value joins the old testament group silently`
);

const inNew = journeys.filter((j) => j.testament === NEW_TESTAMENT);
const inOld = journeys.filter((j) => j.testament !== NEW_TESTAMENT);
expect(
  inNew.length + inOld.length === journeys.length,
  'every journey lands in exactly one group',
  `${inOld.length} old + ${inNew.length} new against ${journeys.length} journeys`
);
expect(
  inOld.length > 0 && inNew.length > 0,
  'both groups have journeys in them',
  `old ${inOld.length}, new ${inNew.length} — an empty group renders a heading over nothing`
);
console.log(`       old ${inOld.length}, new ${inNew.length}`);

// ── Swatches a reader can tell apart ──────────────────────────────────────

console.log('\nSwatches');

function rgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : null;
}

function rgbDistance(a, b) {
  const [x, y] = [rgb(a), rgb(b)];
  if (!x || !y) return 0;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

expect(
  journeys.every((j) => rgb(j.colour)),
  'every swatch is a colour the style attribute will accept',
  `first failure: ${journeys.find((j) => !rgb(j.colour))?.colour}`
);

// A 10px swatch is a much smaller sample than a drawn line, so two colours that
// are distinguishable as routes can still be one colour as squares. The
// threshold is deliberately lower than the ring check's 65: these are compared
// side by side in a list, where a small difference still reads, rather than
// across a map. What this rules out is a genuine near-duplicate.
const MIN_SWATCH_DISTANCE = 25;
let closest = null;
for (let i = 0; i < journeys.length; i++) {
  for (let k = i + 1; k < journeys.length; k++) {
    const d = rgbDistance(journeys[i].colour, journeys[k].colour);
    if (!closest || d < closest.d) closest = { d, a: journeys[i], b: journeys[k] };
  }
}
expect(
  closest && closest.d >= MIN_SWATCH_DISTANCE,
  `no two swatches are within ${MIN_SWATCH_DISTANCE} of each other`,
  closest
    ? `closest: ${closest.a.name} ${closest.a.colour} and ${closest.b.name} ${closest.b.colour}, distance ${closest.d.toFixed(1)}`
    : 'fewer than two journeys'
);
if (closest) {
  console.log(`       closest pair ${closest.d.toFixed(1)}: ${closest.a.name} / ${closest.b.name}`);
}

// ── Names that fit the row ────────────────────────────────────────────────

console.log('\nRow labels');

// The row is a swatch, a name and a switch inside a 210px panel indented by 18.
// The name gets roughly 130px, and the panel font at 12px averages near 6px a
// character, so about 22 characters show before the ellipsis. Beyond that is
// not a failure — the name is clipped, not lost, and the title attribute
// carries the full text — but two names that are identical for their first 22
// characters are two rows a reader cannot tell apart, and that is a failure.
const VISIBLE_CHARS = 22;
const prefixes = new Map();
for (const j of journeys) {
  const key = j.name.slice(0, VISIBLE_CHARS);
  if (!prefixes.has(key)) prefixes.set(key, []);
  prefixes.get(key).push(j.name);
}
const collisions = [...prefixes.values()].filter((names) => names.length > 1);
expect(
  collisions.length === 0,
  `no two names are identical for their first ${VISIBLE_CHARS} characters`,
  collisions.map((names) => names.join(' / ')).join('; ')
);

const long = journeys.filter((j) => j.name.length > VISIBLE_CHARS);
console.log(`       ${long.length} of ${journeys.length} names clip; longest ${Math.max(...journeys.map((j) => j.name.length))} chars`);

// The row's tooltip is the traveller and the dates, which is the thing a
// clipped name most needs backing up. Both have to be there or the tooltip
// reads "undefined · undefined".
expect(
  journeys.every((j) => j.traveller && j.dates),
  'every row has a traveller and dates for its tooltip',
  `first failure: ${journeys.find((j) => !j.traveller || !j.dates)?.id}`
);

// ── The overlay offers what the panel calls ───────────────────────────────

console.log('\nThe panel\'s contract with the overlay');

// routeGroups gates on these two by name rather than on the overlay's id, so a
// rename in overlays.js does not fail the build — it silently renders no
// sub-list at all, with the layer still drawing. The gate is here instead.
expect(
  /\broutes\b/.test(overlaySource) && /^\s*toggleRoute\(/m.test(overlaySource),
  'JourneysOverlay still exposes routes and toggleRoute()',
  'routeGroups tests for both by name; a rename hides the sub-list rather than failing'
);
expect(
  /^\s*setRoutes\(/m.test(overlaySource),
  'JourneysOverlay still exposes setRoutes()',
  'All / None call it — a loop of toggles would redraw the layer once per journey'
);
expect(
  /setRoutes\([\s\S]{0,600}?onLabelsChanged/.test(overlaySource),
  'setRoutes asks for a label pass',
  'without it a journey switched off keeps its numbered names until the next pan'
);
expect(
  /routeGroups\(ov\)/.test(paneSource) && /ov\.selected\.includes\(route\.id\)/.test(paneSource),
  'the panel reads its switch state from the overlay, not a copy',
  'a local mirror of `selected` drifts the moment anything else toggles a route'
);

// ── A stop tap reaches the real panel ────────────────────────────────────
//
// This path is three hops — overlay callback, host lookup, panel block — and
// none of them fails the build when broken. A stop whose click handler is gone
// silently does nothing; a payload field the panel reads under a different name
// silently renders blank. Both are asserted by name here instead.

console.log('\nA stop tap opens the place panel');

expect(
  /this\.onOpenStop\s*=/.test(overlaySource) && /onOpenStop\(stop, route, i\)/.test(overlaySource),
  'the overlay declares onOpenStop and calls it from the stop marker',
  'without the call a stop tap does nothing at all'
);
expect(
  !/versesForPopup|bindPopup/.test(overlaySource),
  'the hand-rolled verse popup is gone',
  'it rendered grey text where the panel renders tappable colour-coded links'
);
expect(
  /journeys\.onOpenStop\s*=/.test(mapSource) && /openPlaceWith\(place, journeyContext/.test(mapSource),
  'the host wires onOpenStop to the place panel',
  'an unwired callback leaves every stop tap silent'
);
expect(
  /openJourneyStop\(routeId, i\)/.test(mapSource),
  'the api exposes openJourneyStop for the panel arrows',
  'the previous/next buttons call it by name'
);

// The arrows are the reader's way along a journey, and each is a separate
// field the panel destructures. A rename in journeyContext renders an arrow
// that is always absent rather than failing anything.
for (const field of ['prev', 'next', 'stop', 'total', 'colour']) {
  expect(
    new RegExp(`\\b${field}:`).test(mapSource) &&
      new RegExp(`info\\.journey\\.${field}`).test(paneSource),
    `journey context carries ${field}, and the panel reads it`,
    'built in map.js journeyContext(), read in the AtlasPane journey block'
  );
}

expect(
  /openJourneyStop\(info\.journey\.id, info\.journey\.prev\.i\)/.test(paneSource) &&
    /openJourneyStop\(info\.journey\.id, info\.journey\.next\.i\)/.test(paneSource),
  'both arrows are wired to openJourneyStop',
  'a stop is a position in a sequence; the arrows are how a reader walks it'
);

// The place's verse count is not the journey's, and saying "955 references"
// under a journey heading implies it is.
expect(
  /Where Scripture names this place/.test(paneSource),
  'the subtitle is reworded when the panel is showing a journey stop',
  'the gazetteer cannot say which mentions belong to this journey'
);

console.log('\n' + '─'.repeat(78));
console.log(`${checks} checks, ${failures} failed`);
db.close();
process.exit(failures ? 1 : 0);
