import Database from 'better-sqlite3';

const db = new Database('C:\\Users\\Marlowe\\Desktop\\ProjectBible\\packs\\workbench\\commentaries.sqlite', { readonly: true });

// Check Genesis 2:1
console.log('\nGenesis 2:1 commentaries:');
const gen21 = db.prepare('SELECT author, substr(text, 1, 100) as preview FROM commentary_entries WHERE book = ? AND chapter = ? AND verse_start = ?').all('Genesis', 2, 1);
gen21.forEach(e => console.log(`  ${e.author}: ${e.preview}...`));

// Check Revelation 3:11
console.log('\nRevelation 3:11 commentaries:');
const rev311 = db.prepare('SELECT author, substr(text, 1, 100) as preview FROM commentary_entries WHERE book = ? AND chapter = ? AND verse_start = ?').all('Revelation', 3, 11);
rev311.forEach(e => console.log(`  ${e.author}: ${e.preview}...`));

// Check Matthew 1:1 (should have many)
console.log('\nMatthew 1:1 commentaries:');
const matt11 = db.prepare('SELECT author, substr(text, 1, 100) as preview FROM commentary_entries WHERE book = ? AND chapter = ? AND verse_start = ?').all('Matthew', 1, 1);
matt11.forEach(e => console.log(`  ${e.author}: ${e.preview}...`));

db.close();
