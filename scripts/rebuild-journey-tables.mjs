#!/usr/bin/env node

/**
 * Rewrite the three journey tables in packs/maps-enhanced.sqlite from source.
 *
 * build-enhanced-map-pack.mjs read five field names the source never had —
 * traveler, dateRange, totalDistanceKm, distanceFromPreviousKm and event.verse
 * against person, yearRange, totalDistance, distanceFromPrevious and verses[] —
 * so every one of them wrote NULL. The result was a journeys overlay with no
 * travellers, no dates, no distances and not one verse on any of its thirty
 * events, which is why the overlay was parked as too thin to ship.
 *
 * The names are fixed in the builder, but that builder deletes and rebuilds the
 * whole 340 MB pack: 12,606 places and 38 AWMC layers, none of which this bug
 * touched. So this rewrites the three journey tables alone and leaves the rest
 * of the file exactly as it is. Same reasoning as fix-maps-enhanced-metadata.mjs.
 *
 * Idempotent: it clears the three tables before inserting, so it can be re-run.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const SOURCE = path.join(projectRoot, 'data-sources/maps/extracted/journey-routes.json');
const PACK = path.join(projectRoot, 'packs/maps-enhanced.sqlite');

// The source carries a year as a signed number — negative is BC — and a range
// as a pair. The column is TEXT because what a reader wants here is a label,
// not arithmetic, so the pair is rendered once rather than being reassembled by
// everything downstream that wants to print it. Kept identical to the copy in
// build-enhanced-map-pack.mjs so a full rebuild and this agree.
function dateRangeLabel(range) {
  if (!range) return null;
  const era = (y) => (y < 0 ? `${Math.abs(y)} BC` : `AD ${y}`);
  const { start, end } = range;
  if (start == null && end == null) return null;
  if (start == null) return era(end);
  if (end == null) return era(start);
  if (start === end) return era(start);
  // Within one epoch the era is said once, but which end it attaches to differs:
  // BC counts down to its label ("1446–1406 BC") and AD counts up from it
  // ("AD 46–48"). Crossing the epoch, both ends need naming.
  if (start < 0 && end < 0) return `${Math.abs(start)}–${Math.abs(end)} BC`;
  if (start >= 0 && end >= 0) return `AD ${start}–${end}`;
  return `${era(start)}–${era(end)}`;
}

const journeyRoutes = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
console.log(`Loaded ${journeyRoutes.journeys.length} journeys from source`);

const db = new Database(PACK);

const insertJourney = db.prepare(`
  INSERT INTO journey_routes (id, name, description, traveler, date_range, total_distance_km)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertWaypoint = db.prepare(`
  INSERT INTO journey_waypoints (journey_id, sequence, place_name, latitude, longitude, distance_from_previous_km, travel_method, icon)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertEvent = db.prepare(`
  INSERT INTO journey_events (waypoint_id, event_description, verse_reference)
  VALUES (?, ?, ?)
`);

const rewrite = db.transaction(() => {
  // Events reference waypoints, waypoints reference routes, so they go in that
  // order and come out in the reverse of it.
  db.prepare('DELETE FROM journey_events').run();
  db.prepare('DELETE FROM journey_waypoints').run();
  db.prepare('DELETE FROM journey_routes').run();

  for (const journey of journeyRoutes.journeys) {
    insertJourney.run(
      journey.id,
      journey.name,
      journey.description,
      journey.person || null,
      dateRangeLabel(journey.yearRange),
      journey.totalDistance || null
    );

    for (let i = 0; i < journey.waypoints.length; i++) {
      const wp = journey.waypoints[i];
      const result = insertWaypoint.run(
        journey.id,
        i + 1,
        wp.name,
        wp.coordinates[1], // lat
        wp.coordinates[0], // lon
        wp.distanceFromPrevious ?? null,
        wp.travelMethod || null,
        wp.icon || null
      );

      const waypointId = result.lastInsertRowid;

      for (const event of wp.events ?? []) {
        insertEvent.run(
          waypointId,
          event.description,
          // A stop can be the place of more than one thing, and the source gives
          // each event its own list of references. Joined rather than truncated
          // to the first: dropping the rest would quietly lose the verses that
          // are the whole point of a stop.
          event.verses?.length ? event.verses.join('; ') : null
        );
      }
    }
  }
});

rewrite();

// Report what landed, since the whole point of this script is that the previous
// run of it reported success while writing nulls.
const routes = db.prepare('SELECT id, traveler, date_range, total_distance_km FROM journey_routes').all();
for (const r of routes) {
  console.log(`  ${r.id}: ${r.traveler} | ${r.date_range} | ${r.total_distance_km} km`);
}
const ev = db.prepare('SELECT COUNT(*) c, COUNT(verse_reference) v FROM journey_events').get();
const wp = db.prepare('SELECT COUNT(*) c, COUNT(distance_from_previous_km) d, COUNT(travel_method) t FROM journey_waypoints').get();
console.log(`  events: ${ev.v}/${ev.c} carry a verse`);
console.log(`  waypoints: ${wp.c}, ${wp.d} with a distance, ${wp.t} with a travel method`);

db.close();
