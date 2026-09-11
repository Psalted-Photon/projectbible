/**
 * Work out which OpenBible geometry files the atlas needs.
 *
 * openbible.sqlite ships the geometry *index* (588 rows) but not the shapes —
 * every geojson column is empty, because the real geometry lives as separate
 * files in the upstream repo. This lists what to fetch: region extents only,
 * skipping rivers and travel paths, which the atlas draws from AWMC instead.
 */
import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('packs/openbible.sqlite', { readonly: true });
const rows = db
  .prepare('SELECT id, friendly_id, type, class, identifications_json FROM ancient_places')
  .all();

/** id -> what it is, so the fetch can be logged in terms of real places. */
const want = new Map();
const skipTypes = new Set(['river', 'stream', 'path', 'road', 'spring', 'well']);

for (const row of rows) {
  if (!row.identifications_json) continue;
  let idents;
  try {
    idents = JSON.parse(row.identifications_json);
  } catch {
    continue;
  }

  for (const ident of idents || []) {
    for (const res of ident.resolutions || []) {
      const shape = res.ancient_geometry;
      if (shape !== 'polygon' && shape !== 'rough_boundary' && shape !== 'isobands') continue;
      if (skipTypes.has(res.type)) continue;

      const roles = res.geojson_roles || {};
      // Prefer the simplified rendition when upstream offers one.
      const role = roles.simplified_precise || roles.geometry || roles.precise;
      if (!role?.id) continue;

      want.set(role.id, {
        place: row.friendly_id,
        type: res.type || '',
        shape,
        landOrWater: res.land_or_water || '',
      });
    }
  }
}

fs.writeFileSync('scripts/atlas/geometry-wanted.json', JSON.stringify([...want], null, 2));

const byShape = {};
for (const v of want.values()) byShape[v.shape] = (byShape[v.shape] || 0) + 1;

console.log(`region geometries wanted: ${want.size}`);
console.log('by shape:', byShape);
console.log('\nsample:');
for (const [id, v] of [...want].slice(0, 12)) console.log(`  ${id}  <-  ${v.place} (${v.type || v.shape})`);
