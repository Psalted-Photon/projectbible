/** Sanity check: which lands land on which era's map. */
const Database = require('better-sqlite3');
const db = new Database('packs/atlas.sqlite', { readonly: true });
const eras = process.argv[2] ? [process.argv[2]] : ['patriarchs','conquest','divided-kingdom','babylon','apostolic'];
for (const era of eras) {
  const row = db.prepare("SELECT geojson FROM atlas_layers WHERE era_id=? AND kind='region'").get(era);
  if (!row) { console.log(`\n=== ${era} — no region layer ===`); continue; }
  const fc = JSON.parse(row.geojson);
  console.log(`\n=== ${era} — ${fc.features.length} lands ===`);
  console.log('  ' + fc.features.map(f => `${f.properties.name}(${f.properties.verses})`).slice(0, 24).join(', '));
}
