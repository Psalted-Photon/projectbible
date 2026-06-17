import Database from 'better-sqlite3';

const dbPath = 'c:/Users/Marlowe/Desktop/ProjectBible/packs/consolidated/dictionary-en.sqlite';
const db = new Database(dbPath, { readonly: true });

console.log('\n===== DATABASE SCHEMA =====\n');

// Get table names
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
console.log('Tables in database:');
tables.forEach(t => console.log(`  - ${t.name}`));

console.log('\n===== QUERY 1: word_mapping count =====\n');
const wordMappingCount = db.prepare(`SELECT COUNT(*) as count FROM word_mapping`).get();
console.log(`Total rows in word_mapping: ${wordMappingCount.count}`);

console.log('\n===== QUERY 2: Definition table counts =====\n');
const modernCount = db.prepare(`SELECT COUNT(*) as count FROM english_definitions_modern`).get();
const historicCount = db.prepare(`SELECT COUNT(*) as count FROM english_definitions_historic`).get();
const wordsetCount = db.prepare(`SELECT COUNT(*) as count FROM english_definitions_wordset`).get();

console.log(`english_definitions_modern: ${modernCount.count} rows`);
console.log(`english_definitions_historic: ${historicCount.count} rows`);
console.log(`english_definitions_wordset: ${wordsetCount.count} rows`);

console.log('\n===== QUERY 3: "should" in word_mapping (exact match) =====\n');
const shouldExact = db.prepare(`SELECT * FROM word_mapping WHERE lemma = 'should'`).all();
console.log(`Found ${shouldExact.length} row(s):`);
shouldExact.forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

console.log('\n===== QUERY 4: "should" in word_mapping (LIKE) =====\n');
const shouldLike = db.prepare(`SELECT * FROM word_mapping WHERE lemma LIKE '%should%'`).all();
console.log(`Found ${shouldLike.length} row(s):`);
shouldLike.forEach(row => {
  console.log(JSON.stringify(row, null, 2));
});

// Get the word_id for "should" if it exists
const shouldWordId = shouldExact.length > 0 ? shouldExact[0].word_id : null;

if (shouldWordId) {
  console.log(`\n===== QUERY 5: "should" in english_definitions_modern (word_id=${shouldWordId}) =====\n`);
  const modernDefs = db.prepare(`SELECT * FROM english_definitions_modern WHERE word_id = ?`).all(shouldWordId);
  console.log(`Found ${modernDefs.length} row(s):`);
  modernDefs.slice(0, 5).forEach(row => {
    console.log(JSON.stringify(row, null, 2));
  });
  if (modernDefs.length > 5) {
    console.log(`... and ${modernDefs.length - 5} more rows`);
  }

  console.log(`\n===== QUERY 6: "should" in english_definitions_historic (word_id=${shouldWordId}) =====\n`);
  const historicDefs = db.prepare(`SELECT * FROM english_definitions_historic WHERE word_id = ?`).all(shouldWordId);
  console.log(`Found ${historicDefs.length} row(s):`);
  historicDefs.slice(0, 5).forEach(row => {
    console.log(JSON.stringify(row, null, 2));
  });
  if (historicDefs.length > 5) {
    console.log(`... and ${historicDefs.length - 5} more rows`);
  }

  console.log(`\n===== QUERY 7: "should" in english_definitions_wordset (word_id=${shouldWordId}) =====\n`);
  const wordsetDefs = db.prepare(`SELECT * FROM english_definitions_wordset WHERE word_id = ?`).all(shouldWordId);
  console.log(`Found ${wordsetDefs.length} row(s):`);
  wordsetDefs.slice(0, 5).forEach(row => {
    console.log(JSON.stringify(row, null, 2));
  });
  if (wordsetDefs.length > 5) {
    console.log(`... and ${wordsetDefs.length - 5} more rows`);
  }
} else {
  console.log('\n"should" not found in word_mapping, skipping definition queries');
}

db.close();
