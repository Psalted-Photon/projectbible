/** Guard against the mistake that sank the first attempt: fills must be shapes. */
const Database = require('better-sqlite3');
const db = new Database('packs/basemap.sqlite', { readonly: true });
const MUST_FILL = new Set(['land', 'ocean', 'lakes', 'terrain', 'marine', 'countries']);
let bad = 0;
for (const row of db.prepare('SELECT id, kind, geojson FROM basemap_layers').all()) {
  const fc = JSON.parse(row.geojson);
  const types = {};
  for (const f of fc.features) types[f.geometry.type] = (types[f.geometry.type] || 0) + 1;
  const kinds = Object.keys(types);
  const isPoly = kinds.every((t) => t === 'Polygon' || t === 'MultiPolygon');
  const flag = MUST_FILL.has(row.kind) && !isPoly ? '  <-- NOT FILLABLE' : '';
  if (flag) bad++;
  console.log(`${row.id.padEnd(16)} ${JSON.stringify(types)}${flag}`);
}
console.log(bad ? `\n${bad} layer(s) cannot be filled` : '\nall fill layers are polygons');
console.log('peaks :', db.prepare("SELECT COUNT(*) c FROM basemap_points WHERE kind='peak'").get().c);
console.log('cities:', db.prepare("SELECT COUNT(*) c FROM basemap_points WHERE kind='city'").get().c);
console.log('sample city:', JSON.stringify(db.prepare("SELECT name,country,population FROM basemap_points WHERE kind='city' ORDER BY population DESC LIMIT 1").get()));
console.log('unicode check:', db.prepare("SELECT name FROM basemap_points WHERE name LIKE 'Z%rich' OR name LIKE 'Malm%' LIMIT 3").all().map(r=>r.name).join(', '));
