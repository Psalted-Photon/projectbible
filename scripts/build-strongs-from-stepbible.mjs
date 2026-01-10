#!/usr/bin/env node
/**
 * Build Strong's Dictionary Packs from STEPBible lexicons
 * 
 * Uses the STEPBible TSV lexicon files we already have
 * Source: data-sources/stepbible/STEPBible-Data-master/Lexicons/
 * License: CC BY 4.0
 * 
 * Usage: node scripts/build-strongs-from-stepbible.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const GREEK_LEX = join(repoRoot, 'data-sources/stepbible/STEPBible-Data-master/Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt');
const HEBREW_LEX = join(repoRoot, 'data-sources/stepbible/STEPBible-Data-master/Lexicons/TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt');

const GREEK_OUTPUT = join(repoRoot, 'packs/strongs-greek.sqlite');
const HEBREW_OUTPUT = join(repoRoot, 'packs/strongs-hebrew.sqlite');

// Parse STEPBible TSV lexicon
function parseStepBibleLexicon(filePath, language) {
  console.log(`📖 Parsing ${filePath}...`);
  
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const entriesMap = new Map(); // Use Map to deduplicate by ID
  let inData = false;
  
  for (const line of lines) {
    // Skip header until we reach the data separator
    if (line.includes('=======') && line.length > 50) {
      inData = true;
      continue;
    }
    
    if (!inData || !line.trim() || line.startsWith('$=') || line.startsWith('*')) continue;
    
    // Parse TSV format: eStrong\tdStrong\tuStrong\tGreek/Hebrew\tTranslit\tMorph\tGloss\tMeaning...
    const fields = line.split('\t');
    if (fields.length < 8) continue;
    
    const strongsRaw = fields[0].trim(); // e.g., G0001, H0121
    if (!strongsRaw || (!strongsRaw.startsWith('G') && !strongsRaw.startsWith('H'))) continue;
    
    const lemma = fields[3].trim();
    const transliteration = fields[4].trim();
    const partOfSpeech = fields[5].trim();
    const gloss = fields[6].trim();
    const meaning = fields.slice(7).join('\t').trim();
    
    // Normalize Strong's number to 4 digits
    const match = strongsRaw.match(/^([GH])(\d+)/);
    if (!match) continue;
    
    const prefix = match[1];
    const number = match[2].padStart(4, '0');
    const strongsId = prefix + number;
    
    // Only keep first occurrence of each Strong's ID
    if (!entriesMap.has(strongsId)) {
      entriesMap.set(strongsId, {
        id: strongsId,
        lemma: lemma || '',
        transliteration: transliteration || '',
        definition: meaning || gloss || 'No definition available',
        shortDefinition: gloss || meaning.split(/[.;]/)[0].substring(0, 200),
        partOfSpeech: partOfSpeech || '',
        language: language,
        derivation: '',
        kjvUsage: '',
        occurrences: null
      });
    }
  }
  
  const entries = Array.from(entriesMap.values());
  console.log(`✅ Parsed ${entries.length} unique ${language} Strong's entries`);
  return entries;
}

// Create SQLite pack
function createStrongsPack(entries, outputPath, language) {
  console.log(`💾 Creating Strong's ${language} pack: ${outputPath}`);
  
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
      language TEXT DEFAULT '${language.toLowerCase()}',
      derivation TEXT,
      kjvUsage TEXT,
      occurrences INTEGER
    );
    
    CREATE INDEX idx_strongs_lemma ON strongs_entries(lemma);
    CREATE INDEX idx_strongs_language ON strongs_entries(language);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  const packId = `strongs-${language.toLowerCase()}`;
  insertMeta.run('pack_id', packId);
  insertMeta.run('packId', packId);
  insertMeta.run('version', '1.0');
  insertMeta.run('type', 'lexicon');
  insertMeta.run('translation_id', `STRONGS_${language.toUpperCase()}`);
  insertMeta.run('translationId', `STRONGS_${language.toUpperCase()}`);
  insertMeta.run('translation_name', `Strong's ${language} Dictionary`);
  insertMeta.run('translationName', `Strong's ${language} Dictionary`);
  insertMeta.run('license', 'CC BY 4.0');
  insertMeta.run('attribution', 'STEPBible.org - Translators Brief Lexicon of Extended Strongs');
  insertMeta.run('description', `Strong's Exhaustive Concordance ${language} Dictionary from STEPBible`);
  
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
  console.log(`✅ Strong's ${language} pack created: ${entries.length} entries`);
}

// Main execution
async function main() {
  try {
    console.log("📚 Building Strong's Dictionary Packs from STEPBible\n");
    
    // Build Greek pack
    if (existsSync(GREEK_LEX)) {
      const greekEntries = parseStepBibleLexicon(GREEK_LEX, 'greek');
      createStrongsPack(greekEntries, GREEK_OUTPUT, 'Greek');
    } else {
      console.warn(`⚠️  Greek lexicon not found: ${GREEK_LEX}`);
    }
    
    console.log('');
    
    // Build Hebrew pack
    if (existsSync(HEBREW_LEX)) {
      const hebrewEntries = parseStepBibleLexicon(HEBREW_LEX, 'hebrew');
      createStrongsPack(hebrewEntries, HEBREW_OUTPUT, 'Hebrew');
    } else {
      console.warn(`⚠️  Hebrew lexicon not found: ${HEBREW_LEX}`);
    }
    
    console.log('\n✅ Strong\'s packs build complete!');
    console.log(`\n📦 Greek pack: ${GREEK_OUTPUT}`);
    console.log(`📦 Hebrew pack: ${HEBREW_OUTPUT}`);
    console.log('\nImport these packs in the PWA to see Strong\'s definitions.');
    
  } catch (error) {
    console.error('❌ Error building Strong\'s packs:', error);
    process.exit(1);
  }
}

main();
