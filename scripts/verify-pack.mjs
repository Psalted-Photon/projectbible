// Test script to verify sample pack structure
import Database from 'better-sqlite3';

const packPath = process.argv[2];
if (!packPath) {
  console.error('Usage: node verify-pack.mjs <pack-file.sqlite>');
  process.exit(1);
}

console.log(`\n📦 Verifying pack: ${packPath}\n`);

try {
  const db = new Database(packPath, { readonly: true });

  // Check metadata
  console.log('Metadata:');
  const meta = db.prepare('SELECT key, value FROM metadata').all();
  meta.forEach(({ key, value }) => {
    console.log(`  ${key}: ${value}`);
  });

  // Check verse count
  const verseCount = db.prepare('SELECT COUNT(*) as count FROM verses').get();
  console.log(`\nVerses: ${verseCount.count} total`);

  // Sample verses
  console.log('\nSample verses:');
  const samples = db.prepare('SELECT book, chapter, verse, text FROM verses LIMIT 3').all();
  samples.forEach(({ book, chapter, verse, text }) => {
    const preview = text.length > 60 ? text.substring(0, 60) + '...' : text;
    console.log(`  ${book} ${chapter}:${verse} - ${preview}`);
  });

  // Check indexes
  console.log('\nIndexes:');
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all();
  indexes.forEach(({ name }) => {
    console.log(`  ✓ ${name}`);
  });

  db.close();
  console.log('\n✅ Pack structure looks good!\n');

} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
