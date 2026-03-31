import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';

const INPUT_FILE = 'C:\\Users\\Marlowe\\Desktop\\ProjectBible\\data\\processed\\commentary-unified.ndjson';
const OUTPUT_FILE = 'C:\\Users\\Marlowe\\Desktop\\ProjectBible\\data\\processed\\commentary-unified.ndjson';

const EXCLUDED_AUTHORS = [
  'Quoting Passages',
  'Martin Luther',
  'John Lightfoot'
];

console.log('Filtering commentary entries...');
console.log(`Excluding: ${EXCLUDED_AUTHORS.join(', ')}\n`);

// Stream line-by-line to handle large files
const tmp = OUTPUT_FILE + '.tmp';
const outStream = createWriteStream(tmp, { encoding: 'utf-8' });
const rl = createInterface({ input: createReadStream(INPUT_FILE, { encoding: 'utf-8' }), crlfDelay: Infinity });

let total = 0, kept = 0;
const authorCounts = {};

rl.on('line', line => {
  if (!line.trim()) return;
  total++;
  const entry = JSON.parse(line);
  if (!EXCLUDED_AUTHORS.includes(entry.author)) {
    outStream.write(line + '\n');
    kept++;
    authorCounts[entry.author] = (authorCounts[entry.author] || 0) + 1;
  }
});

rl.on('close', () => {
  outStream.end();
  outStream.on('finish', () => {
    // Rename tmp → output (in-place replace)
    import('fs').then(fs => {
      fs.renameSync(tmp, OUTPUT_FILE);
      console.log(`Total entries before filter: ${total.toLocaleString()}`);
      console.log(`Total entries after filter: ${kept.toLocaleString()}`);
      console.log(`Removed: ${(total - kept).toLocaleString()} entries\n`);
      console.log('Remaining authors:');
      Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).forEach(([author, count]) => {
        console.log(`  ${author}: ${count.toLocaleString()}`);
      });
      console.log('\n✅ Filtered file saved');
    });
  });
});
