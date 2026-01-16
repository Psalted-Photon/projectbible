#!/usr/bin/env node
/**
 * Build English Grammar Pack
 * 
 * Creates a basic grammar database with:
 * - Part-of-speech tags derived from wordlist patterns
 * - Common verb forms (base, present, past, past participle, present participle)
 * - Noun plurals (singular/plural pairs)
 * - Basic morphology patterns
 * 
 * Output: english-grammar-v1.sqlite (POS tags, verb forms, plurals)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data-sources/english-lexical');
const OUTPUT_DIR = path.join(__dirname, '../packs/polished');

/**
 * Common English verb forms (irregular verbs)
 * Format: [base, present, past, past_participle, present_participle]
 */
const IRREGULAR_VERBS = [
  ['be', 'am/is/are', 'was/were', 'been', 'being'],
  ['have', 'has', 'had', 'had', 'having'],
  ['do', 'does', 'did', 'done', 'doing'],
  ['say', 'says', 'said', 'said', 'saying'],
  ['go', 'goes', 'went', 'gone', 'going'],
  ['get', 'gets', 'got', 'gotten', 'getting'],
  ['make', 'makes', 'made', 'made', 'making'],
  ['know', 'knows', 'knew', 'known', 'knowing'],
  ['think', 'thinks', 'thought', 'thought', 'thinking'],
  ['take', 'takes', 'took', 'taken', 'taking'],
  ['see', 'sees', 'saw', 'seen', 'seeing'],
  ['come', 'comes', 'came', 'come', 'coming'],
  ['give', 'gives', 'gave', 'given', 'giving'],
  ['find', 'finds', 'found', 'found', 'finding'],
  ['tell', 'tells', 'told', 'told', 'telling'],
  ['become', 'becomes', 'became', 'become', 'becoming'],
  ['leave', 'leaves', 'left', 'left', 'leaving'],
  ['feel', 'feels', 'felt', 'felt', 'feeling'],
  ['bring', 'brings', 'brought', 'brought', 'bringing'],
  ['begin', 'begins', 'began', 'begun', 'beginning'],
  ['keep', 'keeps', 'kept', 'kept', 'keeping'],
  ['hold', 'holds', 'held', 'held', 'holding'],
  ['write', 'writes', 'wrote', 'written', 'writing'],
  ['stand', 'stands', 'stood', 'stood', 'standing'],
  ['hear', 'hears', 'heard', 'heard', 'hearing'],
  ['let', 'lets', 'let', 'let', 'letting'],
  ['mean', 'means', 'meant', 'meant', 'meaning'],
  ['set', 'sets', 'set', 'set', 'setting'],
  ['meet', 'meets', 'met', 'met', 'meeting'],
  ['run', 'runs', 'ran', 'run', 'running'],
  ['put', 'puts', 'put', 'put', 'putting'],
  ['read', 'reads', 'read', 'read', 'reading'],
  ['speak', 'speaks', 'spoke', 'spoken', 'speaking'],
  ['buy', 'buys', 'bought', 'bought', 'buying'],
  ['eat', 'eats', 'ate', 'eaten', 'eating'],
  ['fall', 'falls', 'fell', 'fallen', 'falling'],
  ['grow', 'grows', 'grew', 'grown', 'growing'],
  ['lose', 'loses', 'lost', 'lost', 'losing'],
  ['pay', 'pays', 'paid', 'paid', 'paying'],
  ['send', 'sends', 'sent', 'sent', 'sending'],
  ['sit', 'sits', 'sat', 'sat', 'sitting'],
  ['break', 'breaks', 'broke', 'broken', 'breaking'],
  ['build', 'builds', 'built', 'built', 'building'],
  ['choose', 'chooses', 'chose', 'chosen', 'choosing'],
  ['draw', 'draws', 'drew', 'drawn', 'drawing'],
  ['drive', 'drives', 'drove', 'driven', 'driving'],
  ['fly', 'flies', 'flew', 'flown', 'flying'],
  ['forget', 'forgets', 'forgot', 'forgotten', 'forgetting'],
  ['hide', 'hides', 'hid', 'hidden', 'hiding'],
  ['ride', 'rides', 'rode', 'ridden', 'riding'],
  ['ring', 'rings', 'rang', 'rung', 'ringing'],
  ['rise', 'rises', 'rose', 'risen', 'rising'],
  ['shake', 'shakes', 'shook', 'shaken', 'shaking'],
  ['sing', 'sings', 'sang', 'sung', 'singing'],
  ['sink', 'sinks', 'sank', 'sunk', 'sinking'],
  ['swim', 'swims', 'swam', 'swum', 'swimming'],
  ['throw', 'throws', 'threw', 'thrown', 'throwing'],
  ['wear', 'wears', 'wore', 'worn', 'wearing'],
  ['win', 'wins', 'won', 'won', 'winning'],
];

/**
 * Common irregular plurals
 */
const IRREGULAR_PLURALS = [
  ['man', 'men'],
  ['woman', 'women'],
  ['child', 'children'],
  ['tooth', 'teeth'],
  ['foot', 'feet'],
  ['mouse', 'mice'],
  ['goose', 'geese'],
  ['person', 'people'],
  ['ox', 'oxen'],
  ['sheep', 'sheep'],
  ['fish', 'fish'],
  ['deer', 'deer'],
  ['moose', 'moose'],
  ['cactus', 'cacti'],
  ['fungus', 'fungi'],
  ['nucleus', 'nuclei'],
  ['radius', 'radii'],
  ['stimulus', 'stimuli'],
  ['alumnus', 'alumni'],
  ['analysis', 'analyses'],
  ['basis', 'bases'],
  ['crisis', 'crises'],
  ['diagnosis', 'diagnoses'],
  ['hypothesis', 'hypotheses'],
  ['oasis', 'oases'],
  ['thesis', 'theses'],
];

/**
 * Create SQLite database with schema
 */
function createDatabase(dbPath) {
  const db = new Database(dbPath);
  
  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL COLLATE NOCASE,
      pos TEXT NOT NULL,  -- noun, verb, adjective, adverb, etc.
      frequency INTEGER DEFAULT 0,
      UNIQUE(word, pos)
    );
    
    CREATE INDEX IF NOT EXISTS idx_word_pos ON pos_tags(word COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_pos_type ON pos_tags(pos);
    
    CREATE TABLE IF NOT EXISTS verb_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_form TEXT NOT NULL UNIQUE COLLATE NOCASE,
      present TEXT,
      past TEXT,
      past_participle TEXT,
      present_participle TEXT,
      is_regular BOOLEAN DEFAULT 1
    );
    
    CREATE INDEX IF NOT EXISTS idx_base_verb ON verb_forms(base_form COLLATE NOCASE);
    
    CREATE TABLE IF NOT EXISTS noun_plurals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      singular TEXT NOT NULL UNIQUE COLLATE NOCASE,
      plural TEXT NOT NULL COLLATE NOCASE,
      is_regular BOOLEAN DEFAULT 1
    );
    
    CREATE INDEX IF NOT EXISTS idx_singular ON noun_plurals(singular COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_plural ON noun_plurals(plural COLLATE NOCASE);
    
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  
  // Insert metadata
  const meta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  meta.run('version', '1.0');
  meta.run('created', new Date().toISOString());
  meta.run('source', 'Manual curation + pattern rules');
  meta.run('license', 'Public Domain');
  meta.run('note', 'Basic grammar pack - POS tagging will be enhanced with NLP corpus data in future versions');
  
  return db;
}

/**
 * Infer POS tags from word patterns
 */
function inferPOSTags(words) {
  const tags = [];
  
  for (const word of words) {
    const lower = word.toLowerCase();
    
    // Common suffixes for different POS
    if (lower.endsWith('ly')) {
      tags.push([word, 'adverb']);
    }
    if (lower.endsWith('ness') || lower.endsWith('tion') || lower.endsWith('ment') || 
        lower.endsWith('ship') || lower.endsWith('hood') || lower.endsWith('ism')) {
      tags.push([word, 'noun']);
    }
    if (lower.endsWith('ing') && !lower.endsWith('thing') && !lower.endsWith('something')) {
      tags.push([word, 'verb']); // Could also be noun or adjective
    }
    if (lower.endsWith('ed') && lower.length > 4) {
      tags.push([word, 'verb']); // Past tense
    }
    if (lower.endsWith('able') || lower.endsWith('ible') || lower.endsWith('ful') || 
        lower.endsWith('less') || lower.endsWith('ous') || lower.endsWith('ive')) {
      tags.push([word, 'adjective']);
    }
  }
  
  return tags;
}

/**
 * Build the grammar pack
 */
async function buildPack() {
  console.log('='.repeat(60));
  console.log('Building English Grammar Pack');
  console.log('='.repeat(60));
  
  // Ensure directories exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  console.log('');
  console.log('Building SQLite database...');
  
  // Create database
  const dbPath = path.join(OUTPUT_DIR, 'english-grammar-v1.sqlite');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  
  const db = createDatabase(dbPath);
  
  // Insert irregular verbs
  console.log('Inserting irregular verb forms...');
  const insertVerb = db.prepare(`
    INSERT INTO verb_forms (base_form, present, past, past_participle, present_participle, is_regular)
    VALUES (?, ?, ?, ?, ?, 0)
  `);
  
  const insertVerbsTransaction = db.transaction(() => {
    let count = 0;
    for (const [base, present, past, pastPart, presentPart] of IRREGULAR_VERBS) {
      insertVerb.run(base, present, past, pastPart, presentPart);
      count++;
    }
    return count;
  });
  
  const verbCount = insertVerbsTransaction();
  console.log(`✓ Inserted ${verbCount} irregular verbs`);
  
  // Insert irregular plurals
  console.log('Inserting irregular noun plurals...');
  const insertPlural = db.prepare(`
    INSERT INTO noun_plurals (singular, plural, is_regular)
    VALUES (?, ?, 0)
  `);
  
  const insertPluralsTransaction = db.transaction(() => {
    let count = 0;
    for (const [singular, plural] of IRREGULAR_PLURALS) {
      insertPlural.run(singular, plural);
      count++;
    }
    return count;
  });
  
  const pluralCount = insertPluralsTransaction();
  console.log(`✓ Inserted ${pluralCount} irregular plurals`);
  
  // Try to load wordlist for POS inference (if exists from previous build)
  const wordlistPath = path.join(DATA_DIR, 'words_alpha.txt');
  if (fs.existsSync(wordlistPath)) {
    console.log('');
    console.log('Inferring POS tags from wordlist patterns...');
    
    const content = fs.readFileSync(wordlistPath, 'utf8');
    const words = content.split('\n')
      .map(w => w.trim())
      .filter(w => w.length > 0)
      .slice(0, 50000); // Sample first 50k words for performance
    
    const posTags = inferPOSTags(words);
    console.log(`✓ Inferred ${posTags.length.toLocaleString()} POS tags`);
    
    console.log('Inserting POS tags...');
    const insertPOS = db.prepare(`
      INSERT OR IGNORE INTO pos_tags (word, pos, frequency)
      VALUES (?, ?, 1)
    `);
    
    const insertPOSTransaction = db.transaction(() => {
      let count = 0;
      for (const [word, pos] of posTags) {
        const info = insertPOS.run(word, pos);
        if (info.changes > 0) count++;
        
        if (count % 10000 === 0 && count > 0) {
          console.log(`  Inserted ${count.toLocaleString()} POS tags...`);
        }
      }
      return count;
    });
    
    const posCount = insertPOSTransaction();
    console.log(`✓ Inserted ${posCount.toLocaleString()} unique POS tags`);
  } else {
    console.log('');
    console.log('⚠ Wordlist not found - skipping POS tag inference');
    console.log('  Run build-english-wordlist-pack.mjs first to enable POS tagging');
  }
  
  // Get statistics
  const stats = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM verb_forms) as total_verbs,
      (SELECT COUNT(*) FROM noun_plurals) as total_plurals,
      (SELECT COUNT(*) FROM pos_tags) as total_pos_tags,
      (SELECT COUNT(DISTINCT pos) FROM pos_tags) as unique_pos_types
  `).get();
  
  console.log('');
  console.log('Database Statistics:');
  console.log(`  Irregular verbs: ${stats.total_verbs.toLocaleString()}`);
  console.log(`  Irregular plurals: ${stats.total_plurals.toLocaleString()}`);
  console.log(`  POS tags: ${stats.total_pos_tags.toLocaleString()}`);
  console.log(`  Unique POS types: ${stats.unique_pos_types}`);
  
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
  console.log('');
  console.log('Note: This is a basic grammar pack with irregular forms');
  console.log('Future versions will include:');
  console.log('  - Full POS tagging from NLP corpora');
  console.log('  - Regular verb conjugation rules');
  console.log('  - Regular plural formation rules');
  console.log('  - Grammar pattern matching');
}

// Run the builder
buildPack().catch(err => {
  console.error('Error building pack:', err);
  process.exit(1);
});
