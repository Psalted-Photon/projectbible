#!/usr/bin/env node
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// Get the correct text from KJV.json
const kjv = JSON.parse(readFileSync('data-sources/KJV.json', 'utf8'));

const fixes = [
  { book: 'Joshua', chapter: 15, verse: 1 },
  { book: 'Job', chapter: 7, verse: 1 },
  { book: 'Hosea', chapter: 8, verse: 1 }
];

console.log('Updating KJV pack with correct verse text...\n');

for (const fix of fixes) {
  const book = kjv.books.find(b => b.name === fix.book);
  const ch = book.chapters.find(c => c.chapter === fix.chapter);
  const verse = ch.verses.find(v => v.verse === fix.verse);
  
  const text = verse.text.replace(/'/g, "''"); // Escape single quotes for SQL
  
  const sql = `UPDATE verses SET text = '${text}' WHERE book = '${fix.book}' AND chapter = ${fix.chapter} AND verse = ${fix.verse};`;
  
  console.log(`Updating ${fix.book} ${fix.chapter}:${fix.verse}`);
  console.log(`  Text: ${verse.text.substring(0, 60)}...`);
  
  execSync(`sqlite3 packs/kjv.sqlite "${sql}"`, { encoding: 'utf8' });
}

console.log('\n✅ All verses updated in kjv.sqlite');

// Verify
console.log('\nVerifying updates:');
for (const fix of fixes) {
  const result = execSync(`sqlite3 packs/kjv.sqlite "SELECT substr(text, 1, 60) FROM verses WHERE book = '${fix.book}' AND chapter = ${fix.chapter} AND verse = ${fix.verse};"`, { encoding: 'utf8' });
  console.log(`  ${fix.book} ${fix.chapter}:${fix.verse}: ${result.trim()}...`);
}
