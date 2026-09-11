/**
 * Flatten atlas.sqlite into one JSON file the preview lab can load directly.
 * The app itself reads the sqlite pack; this exists only so the look can be
 * judged in a browser without installing anything.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const db = new Database(path.join(ROOT, 'packs/atlas.sqlite'), { readonly: true });

const eras = db.prepare('SELECT * FROM atlas_eras ORDER BY sort_order').all();
const layers = db.prepare('SELECT id, era_id, kind, title, source, confidence, sort_order, geojson FROM atlas_layers').all();
const places = db.prepare('SELECT era_id, name, lat, lon, kind, verses FROM atlas_places WHERE verses > 0').all();

const out = {
  eras,
  layers: layers.map((l) => ({ ...l, geojson: JSON.parse(l.geojson) })),
  places,
  attribution: db.prepare("SELECT value FROM metadata WHERE key='attribution'").get()?.value ?? '',
};

const dest = path.join(ROOT, 'apps/pwa-polished/public/atlas-lab-data.json');
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${eras.length} eras, ${layers.length} layers, ${places.length} placed names`);
console.log(`${(fs.statSync(dest).size / 1e6).toFixed(2)} MB -> ${dest}`);
