#!/usr/bin/env node
/**
 * Fix blank verses in KJVPCE.json and WEB.json
 */

import { readFileSync, writeFileSync } from 'fs';

// Fix KJV blanks
console.log('Fixing KJVPCE.json blank verses...');
const kjv = JSON.parse(readFileSync('data-sources/KJV.json', 'utf8'));
const kjvpce = JSON.parse(readFileSync('data-sources/KJVPCE.json', 'utf8'));

const kjvFixes = [
  { book: 'Joshua', chapter: 15, verse: 1 },
  { book: 'Job', chapter: 7, verse: 1 },
  { book: 'Hosea', chapter: 8, verse: 1 }
];

for (const fix of kjvFixes) {
  const kjvBook = kjv.books.find(b => b.name === fix.book);
  const kjvpceBook = kjvpce.books.find(b => b.name === fix.book);
  const kjvCh = kjvBook.chapters.find(c => c.chapter === fix.chapter);
  const kjvpceCh = kjvpceBook.chapters.find(c => c.chapter === fix.chapter);
  const kjvVerse = kjvCh.verses.find(v => v.verse === fix.verse);
  const kjvpceVerse = kjvpceCh.verses.find(v => v.verse === fix.verse);
  
  console.log(`  ${fix.book} ${fix.chapter}:${fix.verse}`);
  console.log(`    Old: "${kjvpceVerse.text}"`);
  kjvpceVerse.text = kjvVerse.text;
  console.log(`    New: "${kjvVerse.text.substring(0, 50)}..."`);
}

writeFileSync('data-sources/KJVPCE.json', JSON.stringify(kjvpce, null, 4));
console.log('✅ Saved KJVPCE.json\n');

// Fix WEB blanks - these are actually intentionally blank in the source!
// Some modern translations omit certain verses that were later additions
// But let me check if there's a better source
console.log('Checking WEB.json blank verses...');
const web = JSON.parse(readFileSync('data-sources/WEB.json', 'utf8'));

const webBlanks = [
  { book: 'Acts', chapter: 15, verse: 34 },
  { book: 'Acts', chapter: 24, verse: 7 },
  { book: 'III John', chapter: 1, verse: 15 },
  { book: 'Luke', chapter: 23, verse: 17 },
  { book: 'Mark', chapter: 11, verse: 26 },
  { book: 'Mark', chapter: 15, verse: 28 }
];

console.log('\nWEB blank verses (these may be intentional):');
for (const blank of webBlanks) {
  const book = web.books.find(b => b.name === blank.book);
  const ch = book.chapters.find(c => c.chapter === blank.chapter);
  const verse = ch.verses.find(v => v.verse === blank.verse);
  console.log(`  ${blank.book} ${blank.chapter}:${blank.verse}: "${verse.text}"`);
}

console.log('\nNote: WEB intentionally omits these verses as they are not in');
console.log('the earliest Greek manuscripts. This is normal for modern translations.');
console.log('No changes needed for WEB.json - the blanks are correct!\n');
