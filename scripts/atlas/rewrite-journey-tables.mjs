#!/usr/bin/env node
/**
 * Rebuild only the three journey tables, in place, in an existing atlas pack.
 *
 * The full builder deletes and rebuilds a 340 MB pack — 12,606 places, 38 AWMC
 * layers, every geometry shard — none of which an edit to journey-index.json
 * touches. When the only thing that changed is the index, this rewrites the
 * three tables it feeds and leaves the rest of the file exactly as it was.
 *
 * Same precedent as scripts/rebuild-journey-tables.mjs, which phase 1 wrote for
 * the same reason against maps-enhanced.sqlite.
 *
 * It calls the real buildJourneyTables rather than reimplementing it, so there
 * is one definition of what those tables contain and this cannot drift from the
 * full build. Verify by re-running the full build when convenient: the tables
 * should hash identical.
 *
 * Run: node scripts/atlas/rewrite-journey-tables.mjs [--app]
 *   --app  also rewrite the app's public/packs copy
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildJourneyTables } from './build-journey-tables.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const TABLES = ['atlas_journeys', 'atlas_journey_stops', 'atlas_journey_geometry'];

const targets = [join(ROOT, 'packs', 'consolidated', 'atlas-map.sqlite')];
if (process.argv.includes('--app')) {
  targets.push(join(ROOT, 'apps', 'pwa-polished', 'public', 'packs', 'consolidated', 'atlas-map.sqlite'));
}

for (const target of targets) {
  if (!existsSync(target)) {
    console.error(`No pack at ${target}`);
    process.exit(1);
  }

  const db = new Database(target);

  // The tables have to exist already, or this is being pointed at a pack that
  // never had journeys — which is a full build, not a rewrite.
  const present = TABLES.filter(
    (t) => db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', t)
  );
  if (present.length !== TABLES.length) {
    console.error(
      `${target} is missing ${TABLES.filter((t) => !present.includes(t)).join(', ')} — ` +
      `run the full build (scripts/atlas/build-atlas-packs.mjs) rather than this.`
    );
    db.close();
    process.exit(1);
  }

  console.log(`\n${target}`);
  db.exec('BEGIN');
  try {
    for (const t of TABLES) db.exec(`DROP TABLE ${t}`);
    const stats = buildJourneyTables(db, { log: () => {} });
    db.exec('COMMIT');
    console.log(
      `  ${stats.journeys} journeys, ${stats.stops} stops, ${stats.points} points, ` +
      `${(stats.gzBytes / 1024).toFixed(0)} KB gzipped`
    );
  } catch (err) {
    // A half-written set of journey tables is worse than the old ones: the app
    // would import stops with no journeys to hang them on.
    db.exec('ROLLBACK');
    console.error(`  failed, rolled back: ${err.message}`);
    db.close();
    process.exit(1);
  }

  // VACUUM outside the transaction — the dropped tables' pages are otherwise
  // left as free space in a file that is copied into the app.
  db.exec('VACUUM');
  db.close();
}

console.log('\nDone. Re-run the journey checks against the rewritten pack.');
