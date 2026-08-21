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
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const GREEK_LEX = join(repoRoot, 'data-sources/stepbible/STEPBible-Data-master/Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt');
const HEBREW_LEX = join(repoRoot, 'data-sources/stepbible/STEPBible-Data-master/Lexicons/TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt');
const GREEK_XML  = join(repoRoot, 'data-sources/strongs/strongsgreek.xml');
const HEBREW_XML = join(repoRoot, 'data-sources/strongs/StrongHebrewG.xml');

const GREEK_OUTPUT = join(repoRoot, 'packs/strongs-greek.sqlite');
const HEBREW_OUTPUT = join(repoRoot, 'packs/strongs-hebrew.sqlite');

/**
 * Strong's own dictionary data, which the STEPBible lexicons do not carry.
 *
 * TBESG/TBESH give the modern definitions, but Strong's two other columns —
 * how the KJV actually renders a word, and where the word comes from — only
 * exist in Strong's own text. Both files are public domain.
 *
 * Returns Map<strongsId, { phonetic, derivation, kjvUsage }>.
 */

/** Tags inside these fields carry meaning, so unwrap them before stripping. */
function xmlFieldToText(fragment) {
  return fragment
    // Cross-references to other entries become readable ids, so "from G1537
    // and G2064" survives as prose — and can be linkified later.
    .replace(/<strongsref[^>]*language="GREEK"[^>]*strongs="(\d+)"[^>]*\/>/gi,
             (_, n) => 'G' + String(n).padStart(4, '0'))
    .replace(/<strongsref[^>]*language="HEBREW"[^>]*strongs="(\d+)"[^>]*\/>/gi,
             (_, n) => 'H' + String(n).padStart(4, '0'))
    .replace(/<strongsref[^>]*strongs="(\d+)"[^>]*\/>/gi,
             (_, n) => 'G' + String(n).padStart(4, '0'))
    // Inline Greek/Hebrew words are attributes, not text content.
    .replace(/<(?:greek|hebrew)[^>]*unicode="([^"]*)"[^>]*\/>/gi, '$1')
    .replace(/<w\b[^>]*src="(\d+)"[^>]*\/>/gi,
             (_, n) => 'H' + String(n).padStart(4, '0'))
    .replace(/<w\b[^>]*lemma="([^"]*)"[^>]*\/>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.—-]+/, '')  // Strong's prefixes KJV usage with "--"
    .trim();
}

function loadGreekStrongsData() {
  const map = new Map();
  if (!existsSync(GREEK_XML)) {
    console.warn('⚠️  strongsgreek.xml not found – KJV usage and derivation skipped');
    return map;
  }
  const xml = readFileSync(GREEK_XML, 'utf8');
  const entryRe = /<entry\s+strongs="(\d+)"[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const id = 'G' + String(parseInt(m[1], 10)).padStart(4, '0');
    const body = m[2];
    const pron = body.match(/<pronunciation strongs="([^"]+)"/i);
    const deriv = body.match(/<strongs_derivation>([\s\S]*?)<\/strongs_derivation>/i);
    const kjv = body.match(/<kjv_def>([\s\S]*?)<\/kjv_def>/i);
    map.set(id, {
      phonetic: pron ? pron[1] : null,
      derivation: deriv ? xmlFieldToText(deriv[1]) : '',
      kjvUsage: kjv ? xmlFieldToText(kjv[1]) : '',
    });
  }
  console.log(`✅ Loaded ${map.size} Greek entries from strongsgreek.xml`);
  return map;
}

/**
 * The Hebrew dictionary is OSIS rather than Strong's own XML shape, so the same
 * two columns live under different names: "exegesis" is the derivation, and
 * "translation" is the KJV rendering.
 */
function loadHebrewStrongsData() {
  const map = new Map();
  if (!existsSync(HEBREW_XML)) {
    console.warn('⚠️  StrongHebrewG.xml not found – KJV usage and derivation skipped');
    return map;
  }
  const xml = readFileSync(HEBREW_XML, 'utf8');
  const entryRe = /<div\s+type="entry"\s+n="(\d+)"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const id = 'H' + String(parseInt(m[1], 10)).padStart(4, '0');
    const body = m[2];
    const deriv = body.match(/<note type="exegesis">([\s\S]*?)<\/note>/i);
    const kjv = body.match(/<note type="translation">([\s\S]*?)<\/note>/i);
    map.set(id, {
      phonetic: null,
      derivation: deriv ? xmlFieldToText(deriv[1]) : '',
      kjvUsage: kjv ? xmlFieldToText(kjv[1]) : '',
    });
  }
  console.log(`✅ Loaded ${map.size} Hebrew entries from StrongHebrewG.xml`);
  return map;
}

// Parse STEPBible TSV lexicon
function parseStepBibleLexicon(filePath, language) {
  const strongsData = language === 'greek' ? loadGreekStrongsData() : loadHebrewStrongsData();
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
    
    const strongsRaw = fields[0].trim(); // eStrong, e.g. G0001, H0121
    // uStrong is the disambiguated id: G0001 splits into G0001G (the letter
    // alpha) and G0001H (the interjection). Keying only on eStrong threw the
    // second of each pair away — 188 Greek entries and 2,337 Hebrew ones.
    const uStrongRaw = (fields[2] || '').trim();
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
    
    const entry = {
      id: strongsId,
      lemma: lemma || '',
      transliteration: transliteration || '',
      definition: meaning || gloss || 'No definition available',
      shortDefinition: gloss || meaning.split(/[.;]/)[0].substring(0, 200),
      partOfSpeech: partOfSpeech || '',
      language: language,
      derivation: strongsData.get(strongsId)?.derivation || '',
      kjvUsage: strongsData.get(strongsId)?.kjvUsage || '',
      occurrences: null,
      phonetic: strongsData.get(strongsId)?.phonetic || null
    };

    // Primary key stays eStrong so every existing lookup keeps working.
    if (!entriesMap.has(strongsId)) entriesMap.set(strongsId, entry);

    // Also file it under its disambiguated id, which is what TAGNT tags words
    // with. Same-language only: a Greek entry's uStrong can point at the Hebrew
    // it translates (G0002 Aaron = "the Greek of H0175"), and that is a
    // cross-reference, not a Greek headword.
    const um = uStrongRaw.match(/^([GH])(\d+)([A-Za-z]?)$/);
    if (um && um[1] === prefix) {
      const uId = um[1] + um[2].padStart(4, '0') + um[3];
      if (uId !== strongsId && !entriesMap.has(uId)) {
        entriesMap.set(uId, { ...entry, id: uId });
      }
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

  // Rebuild from scratch. Without this a second run fails on "table metadata
  // already exists", so the pack silently stays at whatever the first run made.
  if (existsSync(outputPath)) unlinkSync(outputPath);

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
      phonetic TEXT,
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
    INSERT INTO strongs_entries (id, lemma, transliteration, phonetic, definition, shortDefinition, partOfSpeech, language, derivation, kjvUsage, occurrences)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((entries) => {
    for (const e of entries) {
      insert.run(e.id, e.lemma, e.transliteration, e.phonetic || null, e.definition, e.shortDefinition, e.partOfSpeech, e.language, e.derivation, e.kjvUsage, e.occurrences);
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
