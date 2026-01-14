import fs from 'fs';

const pack = JSON.parse(fs.readFileSync('packs/chronological-v1.json', 'utf8'));
const data = pack.verses;

const books = new Map();

data.forEach(verse => {
  if (!books.has(verse.book)) {
    books.set(verse.book, {
      count: 0,
      firstIndex: verse.chrono_index
    });
  }
  books.get(verse.book).count++;
});

const sorted = [...books.entries()].sort((a, b) => a[1].firstIndex - b[1].firstIndex);

console.log('\n📖 COMPLETE CHRONOLOGICAL BOOK ORDER (All 66 Books):\n');
console.log('─'.repeat(70));

sorted.forEach(([book, info], idx) => {
  const num = String(idx + 1).padStart(2);
  const bookName = book.padEnd(22);
  const verses = String(info.count).padStart(5);
  const index = String(info.firstIndex).padStart(6);
  console.log(`${num}. ${bookName} ${verses} verses  (index: ${index})`);
});

console.log('─'.repeat(70));
console.log(`\n✅ Total Books: ${books.size}`);
console.log(`✅ Total Verses: ${data.length}`);
console.log(`\n📍 Key Chronological Transitions:`);
console.log(`   • Genesis 1-11 (Creation to Babel): indices 1-299`);
console.log(`   • Job (Patriarchal Era ~2100 BC): indices 300-1369`);
console.log(`   • Genesis 12-50 (Abraham to Joseph): indices 1370+`);
console.log(`   • Exodus through Joshua (1446-1400 BC)`);
console.log(`   • Prophets inserted during Kings/Chronicles`);
console.log(`   • Gospels (Life of Christ ~4 BC - 30 AD)`);
console.log(`   • Acts & Epistles (Early Church 30-100 AD)`);
console.log(`   • Revelation (Apocalypse ~95 AD)\n`);
