import Database from 'better-sqlite3';

const db = new Database('packs/bsb-audio/bsb-audio.sqlite', { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('\nTables:', tables.map(t => t.name).join(', '));

const sample = db.prepare('SELECT * FROM audio_chapters LIMIT 5').all();
console.log('\nSample entries:', JSON.stringify(sample, null, 2));

const count = db.prepare('SELECT COUNT(*) as c FROM audio_chapters').get();
console.log('\nTotal audio chapters:', count.c);

const books = db.prepare('SELECT DISTINCT book FROM audio_chapters ORDER BY book').all();
console.log('\nBooks with audio:', books.length);

db.close();
