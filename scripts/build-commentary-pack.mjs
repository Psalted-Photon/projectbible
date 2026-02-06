#!/usr/bin/env node
/**
 * Commentary Pack Builder
 * 
 * Creates a SQLite pack from parsed commentary data (NDJSON).
 * Follows Pack Standard v1.0 with type='commentary'.
 * 
 * Usage:
 *   node scripts/build-commentary-pack.mjs
 * 
 * Output:
 *   packs/workbench/commentaries.sqlite (~1.8-2.0 GB)
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const INPUT_FILE = join(__dirname, '../data/processed/commentary-final.ndjson');
const OUTPUT_DIR = join(__dirname, '../packs/workbench');
const OUTPUT_FILE = join(OUTPUT_DIR, 'commentaries.sqlite');
const REPORT_FILE = join(OUTPUT_DIR, 'commentary-report.md');
const COVERAGE_FILE = join(OUTPUT_DIR, 'commentary-coverage.json');

// Constants
const MAX_PACK_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const BATCH_SIZE = 1000; // Insert batch size

/**
 * Main build function
 */
async function buildCommentaryPack() {
  console.log('Commentary Pack Builder - Starting...\n');
  
  // Check input file exists
  if (!existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    console.log('\nPlease run parser first:');
    console.log('  node scripts/parse-commentary-sources.mjs\n');
    process.exit(1);
  }
  
  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Load commentary entries
  console.log(`Loading entries from ${INPUT_FILE}...`);
  const ndjson = readFileSync(INPUT_FILE, 'utf-8');
  const lines = ndjson.trim().split('\n');
  const entries = lines.map(line => JSON.parse(line));
  console.log(`Loaded ${entries.length.toLocaleString()} entries\n`);
  
  // Create database
  console.log(`Creating pack: ${OUTPUT_FILE}`);
  const db = new Database(OUTPUT_FILE);
  
  // Enable optimizations
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY');
  
  // Create schema
  console.log('Creating schema...');
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    CREATE TABLE commentary_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse_start INTEGER NOT NULL,
      verse_end INTEGER,
      author TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      source TEXT,
      year INTEGER
    );
    
    CREATE INDEX idx_commentary_verse ON commentary_entries(book, chapter, verse_start);
    CREATE INDEX idx_commentary_author ON commentary_entries(author);
    CREATE INDEX idx_commentary_book ON commentary_entries(book);
  `);
  
  // Insert metadata (Pack Standard v1.0)
  console.log('Inserting metadata...');
  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  
  const metadata = {
    id: 'commentaries.v1',
    type: 'commentary',
    version: '1.0.0',
    schemaVersion: '1.0',
    name: 'Bible Commentaries Collection',
    description: 'Historical and modern Bible commentaries including Matthew Henry, JFB, Barnes, Keil & Delitzsch, and more',
    language: 'en',
    license: 'Public Domain / Free for Personal Use',
    attribution: 'CrossWire Sword Project, Plano Bible Chapel, and various authors. See individual commentary metadata for specific licensing.',
  };
  
  for (const [key, value] of Object.entries(metadata)) {
    insertMeta.run(key, value);
  }
  
  // Insert commentary entries
  console.log('Inserting commentary entries...');
  const insertEntry = db.prepare(`
    INSERT INTO commentary_entries (book, chapter, verse_start, verse_end, author, title, text, source, year)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((entries) => {
    for (const entry of entries) {
      insertEntry.run(
        entry.book,
        entry.chapter,
        entry.verse_start,
        entry.verse_end || null,
        entry.author,
        entry.title || null,
        entry.text,
        entry.source || null,
        entry.year || null
      );
    }
  });
  
  // Process in batches with progress
  const totalBatches = Math.ceil(entries.length / BATCH_SIZE);
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    insertMany(batch);
    
    if (batchNum % 10 === 0 || batchNum === totalBatches) {
      console.log(`  Progress: ${batchNum}/${totalBatches} batches (${((batchNum / totalBatches) * 100).toFixed(1)}%)`);
    }
  }
  
  console.log(`✅ Inserted ${entries.length.toLocaleString()} entries\n`);
  
  // Optimize database
  console.log('Optimizing database...');
  db.pragma('optimize');
  db.exec('VACUUM');
  db.close();
  
  // Check pack size
  const packSize = statSync(OUTPUT_FILE).size;
  console.log(`Pack size: ${(packSize / 1024 / 1024).toFixed(2)} MB (${(packSize / 1024 / 1024 / 1024).toFixed(2)} GB)`);
  
  if (packSize > MAX_PACK_SIZE) {
    console.warn(`⚠️  Pack exceeds 2GB limit! Consider splitting into multiple packs.`);
  } else {
    const remaining = MAX_PACK_SIZE - packSize;
    console.log(`Remaining capacity: ${(remaining / 1024 / 1024).toFixed(2)} MB (${((packSize / MAX_PACK_SIZE) * 100).toFixed(1)}% used)\n`);
  }
  
  // Generate coverage report
  console.log('Generating coverage report...');
  
  const byAuthor = {};
  const byBook = {};
  const byTestament = { OT: 0, NT: 0 };
  
  const OT_BOOKS = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
    '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
    'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
    'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel',
    'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
    'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'
  ];
  
  for (const entry of entries) {
    // By author
    byAuthor[entry.author] = (byAuthor[entry.author] || 0) + 1;
    
    // By book
    byBook[entry.book] = (byBook[entry.book] || 0) + 1;
    
    // By testament
    if (OT_BOOKS.includes(entry.book)) {
      byTestament.OT++;
    } else {
      byTestament.NT++;
    }
  }
  
  // Write coverage JSON
  const coverage = {
    totalEntries: entries.length,
    packSize: packSize,
    byAuthor,
    byBook,
    byTestament
  };
  
  writeFileSync(COVERAGE_FILE, JSON.stringify(coverage, null, 2));
  console.log(`Coverage data: ${COVERAGE_FILE}\n`);
  
  // Generate markdown report
  let report = `# Commentary Pack Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Pack:** ${OUTPUT_FILE}\n`;
  report += `**Pack Size:** ${(packSize / 1024 / 1024).toFixed(2)} MB (${(packSize / 1024 / 1024 / 1024).toFixed(2)} GB)\n`;
  report += `**Total Entries:** ${entries.length.toLocaleString()}\n\n`;
  
  report += `## Testament Coverage\n\n`;
  report += `- Old Testament: ${byTestament.OT.toLocaleString()} entries\n`;
  report += `- New Testament: ${byTestament.NT.toLocaleString()} entries\n\n`;
  
  report += `## Entries by Author\n\n`;
  report += `| Author | Entries | Percentage |\n`;
  report += `|--------|---------|------------|\n`;
  for (const [author, count] of Object.entries(byAuthor).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / entries.length) * 100).toFixed(1);
    report += `| ${author} | ${count.toLocaleString()} | ${pct}% |\n`;
  }
  report += `\n`;
  
  report += `## Entries by Book (Top 20)\n\n`;
  report += `| Book | Entries |\n`;
  report += `|------|----------|\n`;
  const topBooks = Object.entries(byBook)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  
  for (const [book, count] of topBooks) {
    report += `| ${book} | ${count.toLocaleString()} |\n`;
  }
  report += `\n`;
  
  report += `## Pack Metadata\n\n`;
  report += `\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n\n`;
  
  report += `## Next Steps\n\n`;
  report += `1. Test pack import:\n`;
  report += `   \`\`\`bash\n`;
  report += `   npm run dev:polished\n`;
  report += `   # Open DevTools > Application > IndexedDB\n`;
  report += `   # Upload pack via Import UI\n`;
  report += `   \`\`\`\n\n`;
  report += `2. Validate commentary retrieval:\n`;
  report += `   - Navigate to Romans 5\n`;
  report += `   - Select verse 1\n`;
  report += `   - Click "Commentary" button\n`;
  report += `   - Should see entries from multiple authors\n\n`;
  report += `3. Promote to production:\n`;
  report += `   \`\`\`bash\n`;
  report += `   # Copy to polished bundled packs\n`;
  report += `   cp packs/workbench/commentaries.sqlite apps/pwa-polished/public/packs/\n`;
  report += `   \`\`\`\n`;
  
  writeFileSync(REPORT_FILE, report);
  console.log(`Report: ${REPORT_FILE}\n`);
  
  // Final summary
  console.log('=== Build Complete ===');
  console.log(`✅ Pack created: ${OUTPUT_FILE}`);
  console.log(`✅ Size: ${(packSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`✅ Entries: ${entries.length.toLocaleString()}`);
  console.log(`✅ Authors: ${Object.keys(byAuthor).length}`);
  console.log(`✅ Books covered: ${Object.keys(byBook).length}/66\n`);
  
  console.log('Next: Import pack into pwa-polished app\n');
}

// Helper: Write file (create dir if needed)
function writeFileSync(filePath, data) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  import('fs').then(fs => fs.writeFileSync(filePath, data, 'utf-8'));
}

// Run
buildCommentaryPack().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
