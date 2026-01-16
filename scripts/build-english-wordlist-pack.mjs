#!/usr/bin/env node
/**
 * Build English Wordlist + IPA Pack
 * 
 * Downloads and combines:
 * - IPA pronunciation data (en_US, en_UK) from open-dict-data/ipa-dict
 * - English wordlist (479k words) from dwyl/english-words
 * 
 * Output: english-wordlist-v1.sqlite (wordlist + pronunciations)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data-sources/english-lexical');
const OUTPUT_DIR = path.join(__dirname, '../packs/polished');

// Data source URLs
const SOURCES = {
  ipa_us: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt',
  ipa_uk: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt',
  wordlist: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt'
};

/**
 * Download a file from URL
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${path.basename(dest)}...`);
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log(`✓ Downloaded ${path.basename(dest)}`);
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`✓ Downloaded ${path.basename(dest)}`);
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * Parse IPA dictionary file (tab-delimited: word\tipa)
 */
function parseIPAFile(filepath) {
  const data = new Map();
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    const [word, ipa] = line.split('\t');
    if (word && ipa) {
      data.set(word.toLowerCase(), ipa.trim());
    }
  }
  
  return data;
}

/**
 * Parse wordlist file (newline-delimited)
 */
function parseWordlist(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  return content.split('\n')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0);
}

/**
 * Create SQLite database with schema
 */
function createDatabase(dbPath) {
  const db = new Database(dbPath);
  
  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE COLLATE NOCASE,
      ipa_us TEXT,
      ipa_uk TEXT,
      pos TEXT,  -- Placeholder for future POS tagging
      frequency INTEGER DEFAULT 0  -- Placeholder for corpus frequency
    );
    
    CREATE INDEX IF NOT EXISTS idx_word ON words(word COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_pos ON words(pos);
    
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  
  // Insert metadata
  const meta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  meta.run('version', '1.0');
  meta.run('created', new Date().toISOString());
  meta.run('source_ipa_us', 'open-dict-data/ipa-dict en_US');
  meta.run('source_ipa_uk', 'open-dict-data/ipa-dict en_UK');
  meta.run('source_wordlist', 'dwyl/english-words');
  meta.run('license', 'MIT (IPA), Unlicense (wordlist)');
  
  return db;
}

/**
 * Build the pack
 */
async function buildPack() {
  console.log('='.repeat(60));
  console.log('Building English Wordlist + IPA Pack');
  console.log('='.repeat(60));
  
  // Ensure directories exist
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Download source files if they don't exist
  const ipaUSPath = path.join(DATA_DIR, 'en_US.txt');
  const ipaUKPath = path.join(DATA_DIR, 'en_UK.txt');
  const wordlistPath = path.join(DATA_DIR, 'words_alpha.txt');
  
  if (!fs.existsSync(ipaUSPath)) {
    await downloadFile(SOURCES.ipa_us, ipaUSPath);
  } else {
    console.log(`Using cached ${path.basename(ipaUSPath)}`);
  }
  
  if (!fs.existsSync(ipaUKPath)) {
    await downloadFile(SOURCES.ipa_uk, ipaUKPath);
  } else {
    console.log(`Using cached ${path.basename(ipaUKPath)}`);
  }
  
  if (!fs.existsSync(wordlistPath)) {
    await downloadFile(SOURCES.wordlist, wordlistPath);
  } else {
    console.log(`Using cached ${path.basename(wordlistPath)}`);
  }
  
  console.log('');
  console.log('Parsing data files...');
  
  // Parse IPA data
  console.log('Loading US IPA pronunciations...');
  const ipaUS = parseIPAFile(ipaUSPath);
  console.log(`✓ Loaded ${ipaUS.size.toLocaleString()} US pronunciations`);
  
  console.log('Loading UK IPA pronunciations...');
  const ipaUK = parseIPAFile(ipaUKPath);
  console.log(`✓ Loaded ${ipaUK.size.toLocaleString()} UK pronunciations`);
  
  // Parse wordlist
  console.log('Loading English wordlist...');
  const wordlist = parseWordlist(wordlistPath);
  console.log(`✓ Loaded ${wordlist.length.toLocaleString()} words`);
  
  console.log('');
  console.log('Building SQLite database...');
  
  // Create database
  const dbPath = path.join(OUTPUT_DIR, 'english-wordlist-v1.sqlite');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  
  const db = createDatabase(dbPath);
  
  // Prepare insert statement
  const insert = db.prepare(`
    INSERT INTO words (word, ipa_us, ipa_uk)
    VALUES (?, ?, ?)
  `);
  
  // Build set of all unique words (wordlist + IPA keys)
  const allWords = new Set(wordlist);
  ipaUS.forEach((_, word) => allWords.add(word));
  ipaUK.forEach((_, word) => allWords.add(word));
  
  console.log(`Total unique words: ${allWords.size.toLocaleString()}`);
  
  // Insert all words with transaction for performance
  const insertMany = db.transaction((words) => {
    let count = 0;
    for (const word of words) {
      const us = ipaUS.get(word) || null;
      const uk = ipaUK.get(word) || null;
      insert.run(word, us, uk);
      count++;
      
      if (count % 50000 === 0) {
        console.log(`  Inserted ${count.toLocaleString()} words...`);
      }
    }
    return count;
  });
  
  const totalInserted = insertMany(Array.from(allWords));
  console.log(`✓ Inserted ${totalInserted.toLocaleString()} words`);
  
  // Get statistics
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      COUNT(ipa_us) as with_us_ipa,
      COUNT(ipa_uk) as with_uk_ipa,
      COUNT(CASE WHEN ipa_us IS NOT NULL AND ipa_uk IS NOT NULL THEN 1 END) as with_both
    FROM words
  `).get();
  
  console.log('');
  console.log('Database Statistics:');
  console.log(`  Total words: ${stats.total.toLocaleString()}`);
  console.log(`  With US pronunciation: ${stats.with_us_ipa.toLocaleString()} (${(stats.with_us_ipa/stats.total*100).toFixed(1)}%)`);
  console.log(`  With UK pronunciation: ${stats.with_uk_ipa.toLocaleString()} (${(stats.with_uk_ipa/stats.total*100).toFixed(1)}%)`);
  console.log(`  With both pronunciations: ${stats.with_both.toLocaleString()} (${(stats.with_both/stats.total*100).toFixed(1)}%)`);
  
  // Optimize database
  console.log('');
  console.log('Optimizing database...');
  db.exec('VACUUM');
  db.exec('ANALYZE');
  
  db.close();
  
  // Get file size
  const fileSize = fs.statSync(dbPath).size;
  const sizeMB = (fileSize / 1024 / 1024).toFixed(2);
  
  console.log('');
  console.log('='.repeat(60));
  console.log('✓ Pack built successfully!');
  console.log(`Output: ${dbPath}`);
  console.log(`Size: ${sizeMB} MB`);
  console.log('='.repeat(60));
}

// Run the builder
buildPack().catch(err => {
  console.error('Error building pack:', err);
  process.exit(1);
});
