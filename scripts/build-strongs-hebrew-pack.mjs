#!/usr/bin/env node
/**
 * Build Strong's Hebrew Dictionary Pack from openscriptures
 * 
 * Downloads Strong's Hebrew dictionary and converts to SQLite pack
 * Source: https://github.com/openscriptures/strongs
 * License: Public Domain
 * 
 * Usage: node scripts/build-strongs-hebrew-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { parseStringPromise } from 'xml2js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const DATA_DIR = join(repoRoot, 'data-sources/strongs');
const HEBREW_XML = join(DATA_DIR, 'StrongHebrewG.xml');
const OUTPUT_PATH = join(repoRoot, 'packs/strongs-hebrew.sqlite');

const HEBREW_URL = 'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/StrongHebrewG.xml';

// Download XML file if not exists
async function downloadFile(url, filepath) {
  if (existsSync(filepath)) {
    console.log(`✓ File already exists: ${filepath}`);
    return;
  }

  console.log(`📥 Downloading ${url}...`);
  
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        mkdirSync(dirname(filepath), { recursive: true });
        writeFileSync(filepath, buffer);
        console.log(`✅ Downloaded: ${filepath}`);
        resolve();
      });
    }).on('error', reject);
  });
}

// Parse XML and extract Strong's entries
async function parseStrongsXML(xmlPath) {
  console.log(`📖 Parsing ${xmlPath}...`);
  const xml = readFileSync(xmlPath, 'utf8');
  const result = await parseStringPromise(xml);
  
  const entries = [];
  const entriesData = result.strongshebrew?.entry || [];
  
  for (const entry of entriesData) {
    const strongsNum = entry.$.id || entry.$.strongs;
    if (!strongsNum) continue;
    
    const id = 'H' + strongsNum.padStart(4, '0'); // H0001, H0002, etc.
    
    // Extract Hebrew text and transliteration
    const hebrew = entry.w?.[0]?._ || entry.w?.[0] || '';
    const transliteration = entry.w?.[0]?.$.xlit || entry.translit?.[0] || '';
    
    // Extract definitions
    const pronunciation = entry.pronunciation?.[0] || '';
    const derivation = entry.derivation?.[0] || '';
    const strongs_def = entry.strongs_def?.[0] || entry.def?.[0] || '';
    const kjvDef = entry.kjv_def?.[0] || '';
    
    // Clean up text (remove nested objects, keep strings)
    const cleanText = (obj) => {
      if (typeof obj === 'string') return obj.trim();
      if (Array.isArray(obj)) return obj.map(cleanText).join(' ');
      if (typeof obj === 'object' && obj !== null) {
        // Extract text content from nested objects
        if (obj._) return cleanText(obj._);
        return Object.values(obj).filter(v => typeof v === 'string' || Array.isArray(v)).map(cleanText).join(' ').replace(/\s+/g, ' ').trim();
      }
      return '';
    };
    
    const defText = cleanText(strongs_def);
    const derivText = cleanText(derivation);
    const kjvText = cleanText(kjvDef);
    
    entries.push({
      id,
      lemma: hebrew,
      transliteration: transliteration || pronunciation,
      definition: defText || 'No definition available',
      shortDefinition: defText.split(/[.;]/)[0].substring(0, 200) || defText.substring(0, 200),
      partOfSpeech: '',
      language: 'hebrew',
      derivation: derivText,
      kjvUsage: kjvText,
      occurrences: null
    });
  }
  
  console.log(`✅ Parsed ${entries.length} Hebrew Strong's entries`);
  return entries;
}

// Create SQLite pack
function createStrongsPack(entries, outputPath) {
  console.log(`💾 Creating Strong's pack: ${outputPath}`);
  
  // Ensure output directory
  mkdirSync(dirname(outputPath), { recursive: true });
  
  const db = new Database(outputPath);
  
  // Create schema
  db.exec(`
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    
    CREATE TABLE strongs_entries (
      id TEXT PRIMARY KEY,
      lemma TEXT NOT NULL,
      transliteration TEXT,
      definition TEXT NOT NULL,
      shortDefinition TEXT,
      partOfSpeech TEXT,
      language TEXT DEFAULT 'hebrew',
      derivation TEXT,
      kjvUsage TEXT,
      occurrences INTEGER
    );
    
    CREATE INDEX idx_strongs_lemma ON strongs_entries(lemma);
    CREATE INDEX idx_strongs_language ON strongs_entries(language);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('pack_id', 'strongs-hebrew');
  insertMeta.run('packId', 'strongs-hebrew');
  insertMeta.run('version', '1.0');
  insertMeta.run('type', 'lexicon');
  insertMeta.run('translation_id', 'STRONGS_HEBREW');
  insertMeta.run('translationId', 'STRONGS_HEBREW');
  insertMeta.run('translation_name', "Strong's Hebrew Dictionary");
  insertMeta.run('translationName', "Strong's Hebrew Dictionary");
  insertMeta.run('license', 'Public Domain');
  insertMeta.run('attribution', 'openscriptures/strongs');
  insertMeta.run('description', "Strong's Exhaustive Concordance Hebrew/Aramaic Dictionary");
  
  // Insert Strong's entries
  const insert = db.prepare(`
    INSERT INTO strongs_entries (id, lemma, transliteration, definition, shortDefinition, partOfSpeech, language, derivation, kjvUsage, occurrences)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((entries) => {
    for (const e of entries) {
      insert.run(e.id, e.lemma, e.transliteration, e.definition, e.shortDefinition, e.partOfSpeech, e.language, e.derivation, e.kjvUsage, e.occurrences);
    }
  });
  
  insertMany(entries);
  
  db.close();
  console.log(`✅ Strong's pack created: ${entries.length} entries`);
}

// Main execution
async function main() {
  try {
    console.log("📚 Building Strong's Hebrew Dictionary Pack\n");
    
    // Download XML
    await downloadFile(HEBREW_URL, HEBREW_XML);
    
    // Parse XML
    const entries = await parseStrongsXML(HEBREW_XML);
    
    // Create pack
    createStrongsPack(entries, OUTPUT_PATH);
    
    console.log('\n✅ Strong\'s Hebrew pack build complete!');
    console.log(`\n📦 Pack ready: ${OUTPUT_PATH}`);
    console.log('Import this pack in the PWA to see Strong\'s Hebrew definitions.');
    
  } catch (error) {
    console.error('❌ Error building Strong\'s pack:', error);
    process.exit(1);
  }
}

main();
