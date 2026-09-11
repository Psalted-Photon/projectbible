#!/usr/bin/env node
/**
 * Build the journeys overlay data.
 *
 * Paul's first journey, the Exodus, and Jesus' ministry in Galilee ship already
 * as ordered waypoints — the data knows he walked to Seleucia and sailed to
 * Salamis, and what happened at each stop.
 *
 * Thin at three routes and twenty-four stops. It is a seed: enough to prove the
 * overlay system works with something that is not the timeline, and to add
 * Paul's second and third journeys onto later.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const OUT = path.join(ROOT, 'apps/pwa-polished/public/atlas');

const db = new Database(path.join(ROOT, 'packs/maps-enhanced.sqlite'), { readonly: true });

const routes = db.prepare('SELECT * FROM journey_routes').all();
const stops = db.prepare(`
  SELECT id, journey_id, sequence, place_name, latitude, longitude,
         distance_from_previous_km, travel_method, icon
  FROM journey_waypoints ORDER BY journey_id, sequence
`).all();
const events = db.prepare('SELECT waypoint_id, event_description, verse_reference FROM journey_events').all();

const eventsFor = new Map();
for (const e of events) {
  if (!eventsFor.has(e.waypoint_id)) eventsFor.set(e.waypoint_id, []);
  eventsFor.get(e.waypoint_id).push({ what: e.event_description, ref: e.verse_reference || '' });
}

const out = routes.map((r) => ({
  id: r.id,
  name: r.name,
  traveler: r.traveler || '',
  dates: r.date_range || '',
  description: r.description || '',
  km: r.total_distance_km || 0,
  stops: stops
    .filter((s) => s.journey_id === r.id)
    .map((s) => ({
      n: s.place_name,
      y: s.latitude,
      x: s.longitude,
      // How they travelled between stops decides how the leg is drawn: a sea
      // crossing is not a road, and drawing both the same would say it was.
      by: s.travel_method || 'foot',
      km: s.distance_from_previous_km || null,
      events: eventsFor.get(s.id) ?? [],
    })),
}));

db.close();

const json = JSON.stringify(out);
fs.writeFileSync(path.join(OUT, 'journeys.json'), json);

const indexPath = path.join(OUT, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
index.journeys = { file: 'journeys.json', count: out.length };
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));

for (const r of out) {
  const methods = [...new Set(r.stops.map((s) => s.by))].join('/');
  console.log(`${r.name}: ${r.stops.length} stops, ${r.stops.reduce((n, s) => n + s.events.length, 0)} events, by ${methods}`);
}
console.log(`${(json.length / 1024).toFixed(1)} KB`);
