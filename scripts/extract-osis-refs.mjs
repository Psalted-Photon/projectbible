/**
 * Extract Cross-References from OSIS Files
 * 
 * Usage:
 *   node scripts/extract-osis-refs.mjs <path-to-osis-file-or-directory>
 * 
 * Examples:
 *   node scripts/extract-osis-refs.mjs data-sources/cross-references/KJV.xml
 *   node scripts/extract-osis-refs.mjs data-sources/cross-references/osis-modules/
 */

import { parseOSISCrossReferences, parseOSISDirectory, exportToTSV } from '../packages/packtools/src/parsers/osis-crossref-parser.mjs';
import { createRequire } from 'module';
import { existsSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('❌ Error: Please provide a path to an OSIS file or directory');
  console.error('\nUsage:');
  console.error('  node scripts/extract-osis-refs.mjs <path-to-osis-file-or-directory>');
  console.error('\nExamples:');
  console.error('  node scripts/extract-osis-refs.mjs data-sources/cross-references/KJV.xml');
  console.error('  node scripts/extract-osis-refs.mjs data-sources/cross-references/osis-modules/');
  process.exit(1);
}

const inputPath = args[0];

if (!existsSync(inputPath)) {
  console.error(`❌ Error: Path does not exist: ${inputPath}`);
  process.exit(1);
}

console.log('🔍 Extracting cross-references from OSIS files...\n');

const stats = statSync(inputPath);
let crossRefs = [];

if (stats.isDirectory()) {
  console.log(`📂 Processing directory: ${inputPath}`);
  crossRefs = await parseOSISDirectory(inputPath);
} else if (inputPath.endsWith('.xml')) {
  console.log(`📄 Processing file: ${inputPath}`);
  crossRefs = await parseOSISCrossReferences(inputPath);
} else {
  console.error('❌ Error: Path must be a directory or an XML file');
  process.exit(1);
}

if (crossRefs.length === 0) {
  console.log('⚠️  No cross-references found in the OSIS file(s)');
  console.log('   This is normal if the OSIS file doesn\'t include <note type="crossReference"> elements');
  process.exit(0);
}

// Export to TSV
const outputTSV = join(dirname(inputPath), `${basename(inputPath, '.xml')}-cross-refs.tsv`);
exportToTSV(crossRefs, outputTSV);

// Also import into the database
console.log('\n💾 Importing into cross-references database...');

const dbPath = join(__dirname, '../packs/cross-references.sqlite');
const db = new Database(dbPath);

const insertRef = db.prepare(`
  INSERT OR IGNORE INTO cross_references 
  (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end, source, votes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction((refs) => {
  let imported = 0;
  for (const ref of refs) {
    const result = insertRef.run(
      ref.from_book,
      ref.from_chapter,
      ref.from_verse,
      ref.to_book,
      ref.to_chapter,
      ref.to_verse_start,
      ref.to_verse_end,
      ref.source,
      ref.votes || 0
    );
    if (result.changes > 0) imported++;
  }
  return imported;
});

const imported = insertMany(crossRefs);

// Update metadata
db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(
  new Date().toISOString(),
  'updated'
);

const totalCount = db.prepare('SELECT COUNT(*) as count FROM cross_references').get();
db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(
  totalCount.count.toString(),
  'entry_count'
);

db.close();

console.log(`\n✅ Import complete!`);
console.log(`   📊 Found: ${crossRefs.length} cross-references`);
console.log(`   ✨ Imported: ${imported} new references`);
console.log(`   📈 Total in database: ${totalCount.count}`);
console.log(`   📄 TSV export: ${outputTSV}`);
console.log(`   💾 Database: ${dbPath}`);
