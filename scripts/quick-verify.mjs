import fs from 'fs';

console.log('Reading pack...');
const pack = JSON.parse(fs.readFileSync('packs/chronological-v1.json', 'utf8'));
const verses = pack.verses;

console.log('Analyzing book order...');
const seen = new Set();
const bookOrder = [];
let lastBook = null;

for (let i = 0; i < verses.length; i++) {
  const book = verses[i].book;
  if (book !== lastBook) {
    if (!seen.has(book)) {
      bookOrder.push({ book, firstIndex: verses[i].chrono_index, position: i });
      seen.add(book);
    }
    lastBook = book;
  }
}

console.log('\n📖 CHRONOLOGICAL BOOK ORDER:\n');
bookOrder.forEach((entry, idx) => {
  console.log(`${String(idx + 1).padStart(2)}. ${entry.book.padEnd(20)} (starts at chrono_index ${entry.firstIndex})`);
});

console.log(`\n✅ Total Unique Books: ${bookOrder.length}`);
console.log(`✅ Total Verses in Pack: ${verses.length}`);
