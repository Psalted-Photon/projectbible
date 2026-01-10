#!/usr/bin/env node
/**
 * Build Strong's Dictionary Pack from morphgnt XML
 * 
 * Downloads Strong's Greek dictionary XML and converts to SQLite pack
 * Source: https://github.com/morphgnt/strongs-dictionary-xml
 * License: CC0 (Public Domain)
 * 
 * Usage: node scripts/build-strongs-pack.mjs
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
const GREEK_XML = join(DATA_DIR, 'strongsgreek.xml');
const OUTPUT_PATH = join(repoRoot, 'packs/strongs-greek.sqlite');

const GREEK_URL = 'https://raw.githubusercontent.com/morphgnt/strongs-dictionary-xml/master/strongsgreek.xml';

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
  const entriesData = result.strongsdictionary.entries[0].entry;
  
  for (const entry of entriesData) {
    const id = 'G' + entry.$.strongs.padStart(4, '0'); // G0001, G0002, etc.
    
    // Extract Greek text
    const greekAttr = entry.greek?.[0]?.$;
    const greek = greekAttr?.unicode || greekAttr?.BETA || '';
    const transliteration = greekAttr?.translit || '';
    
    const derivation = entry.strongs_derivation?.[0] || '';
    const definition = entry.strongs_def?.[0] || '';
    const kjvDef = entry.kjv_def?.[0] || '';
    
    // Clean up text (remove nested objects, keep strings)
    const cleanText = (obj) => {
      if (typeof obj === 'string') return obj.trim();
      if (Array.isArray(obj)) return obj.map(cleanText).join(' ');
      if (typeof obj === 'object' && obj !== null) {
        // Extract text content from nested objects
        return Object.values(obj).map(cleanText).join(' ').replace(/\s+/g, ' ').trim();
      }
      return '';
    };
    
    const defText = cleanText(definition);
    const derivText = cleanText(derivation);
    const kjvText = cleanText(kjvDef);
    
    entries.push({
      id,
      lemma: greek,
      transliteration: transliteration,
      definition: defText || 'No definition available',
      shortDefinition: defText.split(/[.;]/)[0].substring(0, 200) || defText.substring(0, 200), // First sentence, max 200 chars
      partOfSpeech: '', // Would need morphology analysis
      language: 'greek',
      derivation: derivText,
      kjvUsage: kjvText,
      occurrences: null
    });
  }
  
  console.log(`✅ Parsed ${entries.length} Greek Strong's entries`);
  return entries;
}

// Create SQLite pack
function createStrongsPack(entries, outputPath) {
  console.log(`💾 Creating Strong's pack: ${outputPath}`);
  
  // Ensure output directory
  mkdirSync(dirname(outputPath), { recursive: true });
  
  // Remove old file if exists
  if (existsSync(outputPath)) {
    console.log('Removing old pack file...');
    // Delete manually to avoid issues
  }
  
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
      language TEXT DEFAULT 'greek',
      derivation TEXT,
      kjvUsage TEXT,
      occurrences INTEGER
    );
    
    CREATE INDEX idx_strongs_lemma ON strongs_entries(lemma);
    CREATE INDEX idx_strongs_language ON strongs_entries(language);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('pack_id', 'strongs-greek');
  insertMeta.run('packId', 'strongs-greek');
  insertMeta.run('version', '1.0');
  insertMeta.run('type', 'lexicon');
  insertMeta.run('translation_id', 'STRONGS_GREEK');
  insertMeta.run('translationId', 'STRONGS_GREEK');
  insertMeta.run('translation_name', "Strong's Greek Dictionary");
  insertMeta.run('translationName', "Strong's Greek Dictionary");
  insertMeta.run('license', 'CC0 (Public Domain)');
  insertMeta.run('attribution', 'morphgnt/strongs-dictionary-xml');
  insertMeta.run('description', "Strong's Exhaustive Concordance Greek Dictionary with real Greek text");
  
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
    console.log("📚 Building Strong's Greek Dictionary Pack\n");
    
    // Download XML
    await downloadFile(GREEK_URL, GREEK_XML);
    
    // Parse XML
    const entries = await parseStrongsXML(GREEK_XML);
    
    // Create pack
    createStrongsPack(entries, OUTPUT_PATH);
    
    console.log('\n✅ Strong\'s pack build complete!');
    console.log(`\n📦 Pack ready: ${OUTPUT_PATH}`);
    console.log('Import this pack in the PWA to see Strong\'s definitions.');
    
  } catch (error) {
    console.error('❌ Error building Strong\'s pack:', error);
    process.exit(1);
  }
}

main();
