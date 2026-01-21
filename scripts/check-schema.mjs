import Database from 'better-sqlite3';

const db1 = new Database('packs/byz-full.sqlite', { readonly: true });
console.log('\n📦 Byzantine Greek tables:');
const tables1 = db1.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
tables1.forEach(t => console.log(`   ${t.name}`));

const verse1 = db1.prepare('SELECT * FROM verses LIMIT 1').get();
console.log('\nVerse structure:', verse1);
db1.close();

const db2 = new Database('packs/strongs-greek.sqlite', { readonly: true });
console.log('\n📦 Strong\'s Greek tables:');
const tables2 = db2.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
tables2.forEach(t => console.log(`   ${t.name}`));

const entry = db2.prepare('SELECT * FROM strongs_entries LIMIT 1').get();
console.log('\nEntry structure:', entry);
db2.close();
