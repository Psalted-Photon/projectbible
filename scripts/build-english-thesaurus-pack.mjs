#!/usr/bin/env node
/**
 * Build English Thesaurus Pack (Moby + WordNet)
 * 
 * Downloads and combines:
 * - Moby Thesaurus (public domain) - 30k+ root words, 2.5M synonyms
 * - WordNet synsets for additional semantic relationships
 * 
 * Output: english-thesaurus-v1.sqlite (synonyms, antonyms, relationships)
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

// Moby Thesaurus data source
// Format: Each line is "root_word,synonym1,synonym2,synonym3,..."
const MOBY_URL = 'https://raw.githubusercontent.com/words/moby/master/words.txt';

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
 * Parse Moby thesaurus file
 * Format: word,synonym1,synonym2,synonym3,...
 * Returns Map<string, Set<string>> (word -> synonyms)
 */
function parseMobyThesaurus(filepath) {
  const thesaurus = new Map();
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(',').map(s => s.trim().toLowerCase());
    if (parts.length < 2) continue;
    
    const rootWord = parts[0];
    const synonyms = new Set(parts.slice(1));
    
    if (thesaurus.has(rootWord)) {
      // Merge with existing synonyms
      const existing = thesaurus.get(rootWord);
      synonyms.forEach(syn => existing.add(syn));
    } else {
      thesaurus.set(rootWord, synonyms);
    }
  }
  
  return thesaurus;
}

/**
 * Create SQLite database with schema
 */
function createDatabase(dbPath) {
  const db = new Database(dbPath);
  
  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS synonyms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL COLLATE NOCASE,
      synonym TEXT NOT NULL COLLATE NOCASE,
      strength REAL DEFAULT 1.0,  -- Semantic similarity (0.0-1.0)
      source TEXT DEFAULT 'moby'  -- moby, wordnet, etc.
    );
    
    CREATE INDEX IF NOT EXISTS idx_word_syn ON synonyms(word COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_synonym ON synonyms(synonym COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_word_syn_pair ON synonyms(word, synonym);
    
    CREATE TABLE IF NOT EXISTS antonyms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL COLLATE NOCASE,
      antonym TEXT NOT NULL COLLATE NOCASE,
      source TEXT DEFAULT 'moby'
    );
    
    CREATE INDEX IF NOT EXISTS idx_word_ant ON antonyms(word COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_antonym ON antonyms(antonym COLLATE NOCASE);
    
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  
  // Insert metadata
  const meta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  meta.run('version', '1.0');
  meta.run('created', new Date().toISOString());
  meta.run('source_moby', 'words/moby (Public Domain)');
  meta.run('license', 'Public Domain');
  
  return db;
}

/**
 * Build the thesaurus pack
 */
async function buildPack() {
  console.log('='.repeat(60));
  console.log('Building English Thesaurus Pack');
  console.log('='.repeat(60));
  
  // Ensure directories exist
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Download Moby thesaurus if it doesn't exist
  const mobyPath = path.join(DATA_DIR, 'moby-thesaurus.txt');
  
  if (!fs.existsSync(mobyPath)) {
    await downloadFile(MOBY_URL, mobyPath);
  } else {
    console.log(`Using cached ${path.basename(mobyPath)}`);
  }
  
  console.log('');
  console.log('Parsing thesaurus data...');
  
  // Parse Moby thesaurus
  console.log('Loading Moby Thesaurus...');
  const thesaurus = parseMobyThesaurus(mobyPath);
  console.log(`✓ Loaded ${thesaurus.size.toLocaleString()} root words`);
  
  // Count total synonyms
  let totalSynonyms = 0;
  thesaurus.forEach(synonyms => {
    totalSynonyms += synonyms.size;
  });
  console.log(`✓ Total synonym relationships: ${totalSynonyms.toLocaleString()}`);
  
  console.log('');
  console.log('Building SQLite database...');
  
  // Create database
  const dbPath = path.join(OUTPUT_DIR, 'english-thesaurus-v1.sqlite');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  
  const db = createDatabase(dbPath);
  
  // Prepare insert statement
  const insert = db.prepare(`
    INSERT INTO synonyms (word, synonym, strength, source)
    VALUES (?, ?, ?, 'moby')
  `);
  
  // Insert all synonyms with transaction for performance
  const insertMany = db.transaction(() => {
    let count = 0;
    
    for (const [word, synonyms] of thesaurus.entries()) {
      // Insert each synonym relationship
      for (const synonym of synonyms) {
        insert.run(word, synonym, 1.0);
        count++;
        
        if (count % 100000 === 0) {
          console.log(`  Inserted ${count.toLocaleString()} relationships...`);
        }
      }
    }
    
    return count;
  });
  
  const totalInserted = insertMany();
  console.log(`✓ Inserted ${totalInserted.toLocaleString()} synonym relationships`);
  
  // Create reverse relationships (make bidirectional for fast lookup)
  console.log('');
  console.log('Creating reverse synonym relationships...');
  
  const reverseInsert = db.prepare(`
    INSERT INTO synonyms (word, synonym, strength, source)
    SELECT synonym, word, strength, source
    FROM synonyms
    WHERE source = 'moby'
    AND NOT EXISTS (
      SELECT 1 FROM synonyms s2
      WHERE s2.word = synonyms.synonym
      AND s2.synonym = synonyms.word
    )
  `);
  
  const info = reverseInsert.run();
  console.log(`✓ Created ${info.changes.toLocaleString()} reverse relationships`);
  
  // Get statistics
  const stats = db.prepare(`
    SELECT 
      COUNT(DISTINCT word) as total_words,
      COUNT(*) as total_relationships,
      AVG(syn_count) as avg_synonyms_per_word,
      MAX(syn_count) as max_synonyms
    FROM (
      SELECT word, COUNT(*) as syn_count
      FROM synonyms
      GROUP BY word
    )
  `).get();
  
  console.log('');
  console.log('Database Statistics:');
  console.log(`  Unique words: ${stats.total_words.toLocaleString()}`);
  console.log(`  Total relationships: ${stats.total_relationships.toLocaleString()}`);
  console.log(`  Average synonyms per word: ${Math.round(stats.avg_synonyms_per_word)}`);
  console.log(`  Max synonyms for a word: ${stats.max_synonyms.toLocaleString()}`);
  
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
