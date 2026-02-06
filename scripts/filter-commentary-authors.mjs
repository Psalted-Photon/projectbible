import { readFileSync, writeFileSync } from 'fs';

const INPUT_FILE = 'C:\\Users\\Marlowe\\Desktop\\ProjectBible\\data\\processed\\commentary-unified.ndjson';
const OUTPUT_FILE = 'C:\\Users\\Marlowe\\Desktop\\ProjectBible\\data\\processed\\commentary-unified.ndjson';

const EXCLUDED_AUTHORS = [
  'Quoting Passages',
  'Martin Luther',
  'John Lightfoot'
];

console.log('Filtering commentary entries...');
console.log(`Excluding: ${EXCLUDED_AUTHORS.join(', ')}\n`);

const ndjson = readFileSync(INPUT_FILE, 'utf-8');
const lines = ndjson.trim().split('\n');
const entries = lines.map(line => JSON.parse(line));

console.log(`Total entries before filter: ${entries.length.toLocaleString()}`);

const filtered = entries.filter(entry => !EXCLUDED_AUTHORS.includes(entry.author));

console.log(`Total entries after filter: ${filtered.length.toLocaleString()}`);
console.log(`Removed: ${(entries.length - filtered.length).toLocaleString()} entries\n`);

// Write filtered NDJSON
const output = filtered.map(e => JSON.stringify(e)).join('\n') + '\n';
writeFileSync(OUTPUT_FILE, output, 'utf-8');

// Show remaining authors
const authorCounts = {};
filtered.forEach(e => {
  authorCounts[e.author] = (authorCounts[e.author] || 0) + 1;
});

console.log('Remaining authors:');
Object.entries(authorCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([author, count]) => {
    console.log(`  ${author}: ${count.toLocaleString()}`);
  });

console.log('\n✅ Filtered file saved');
