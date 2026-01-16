#!/usr/bin/env node
import Database from 'better-sqlite3';

const kjvDb = new Database('packs/kjv.sqlite');
const webDb = new Database('packs/web.sqlite');

const books = ['Ruth', 'I Samuel', 'II Samuel', 'I Kings', 'II Kings', 'I Chronicles', 'II Chronicles', 'Ezra'];

console.log('=== Checking KJV ===\n');
for (const book of books) {
  const chapters = kjvDb.prepare('SELECT DISTINCT chapter FROM verses WHERE book = ? ORDER BY chapter').all(book);
  
  for (const ch of chapters) {
    const verses = kjvDb.prepare('SELECT verse, text FROM verses WHERE book = ? AND chapter = ? ORDER BY verse').all(book, ch.chapter);
    const verseNums = verses.map(v => v.verse);
    const maxVerse = Math.max(...verseNums);
    
    // Check for missing verse numbers
    for (let i = 1; i <= maxVerse; i++) {
      if (!verseNums.includes(i)) {
        console.log(`Missing: ${book} ${ch.chapter}:${i}`);
      }
    }
    
    // Check for blank verses
    for (const v of verses) {
      if (v.text === '' || v.text === null) {
        console.log(`Blank: ${book} ${ch.chapter}:${v.verse}`);
      }
    }
  }
}

console.log('\n=== Checking WEB ===\n');
for (const book of books) {
  const chapters = webDb.prepare('SELECT DISTINCT chapter FROM verses WHERE book = ? ORDER BY chapter').all(book);
  
  for (const ch of chapters) {
    const verses = webDb.prepare('SELECT verse, text FROM verses WHERE book = ? AND chapter = ? ORDER BY verse').all(book, ch.chapter);
    const verseNums = verses.map(v => v.verse);
    const maxVerse = Math.max(...verseNums);
    
    // Check for missing verse numbers
    for (let i = 1; i <= maxVerse; i++) {
      if (!verseNums.includes(i)) {
        console.log(`Missing: ${book} ${ch.chapter}:${i}`);
      }
    }
    
    // Check for blank verses  
    for (const v of verses) {
      if (v.text === '' || v.text === null) {
        console.log(`Blank: ${book} ${ch.chapter}:${v.verse}`);
      }
    }
  }
}

kjvDb.close();
webDb.close();

console.log('\n✅ Check complete');
