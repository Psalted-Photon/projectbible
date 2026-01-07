#!/usr/bin/env node
/**
 * Add Strong's dictionary glosses to LXX and Hebrew packs
 * 
 * Parses STEPBible Strong's lexicons and adds English glosses
 * to enhance the reverse interlinear functionality.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseStrongsLexicon(filePath) {
  console.log(`   Parsing ${filePath}...`);
  
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const lexicon = new Map();
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
    if (fields.length < 7) continue;
    
    const strongs = fields[0].trim(); // eStrong number (e.g., G0001, H0121)
    const gloss = fields[6].trim();   // Short English gloss
    
    if (strongs && gloss) {
      // Store both with and without leading zeros (G1, G0001, G00001 all work)
      const baseNum = strongs.replace(/^([GH])0+/, '$1');
      lexicon.set(strongs, gloss);
      lexicon.set(baseNum, gloss);
      
      // Also store with 4-digit padding for compatibility
      const match = strongs.match(/^([GH])(\d+)/);
      if (match) {
        const letter = match[1];
        const num = match[2].padStart(4, '0');
        lexicon.set(letter + num, gloss);
      }
    }
  }
  
  return lexicon;
}

function enhancePackWithStrongGlosses(packPath, lexicon, language) {
  console.log(`\n📖 Enhancing ${packPath} with Strong's glosses...`);
  
  const db = new Database(packPath);
  
  try {
    // Check if strongs column exists
    const columns = db.prepare('PRAGMA table_info(words)').all();
    const hasStrongs = columns.some(c => c.name === 'strongs');
    
    if (!hasStrongs) {
      console.log(`   ⚠️  No strongs column found - skipping`);
      return;
    }
    
    // Add gloss_en column if it doesn't exist
    const hasGloss = columns.some(c => c.name === 'gloss_en');
    if (!hasGloss) {
      db.exec('ALTER TABLE words ADD COLUMN gloss_en TEXT');
      console.log('   Added gloss_en column');
    }
    
    // Get all unique Strong's numbers
    const strongsNumbers = db.prepare(`
      SELECT DISTINCT strongs 
      FROM words 
      WHERE strongs IS NOT NULL AND strongs != ''
    `).all();
    
    console.log(`   Found ${strongsNumbers.length} unique Strong's numbers`);
    
    // Update glosses
    const updateGloss = db.prepare(`
      UPDATE words 
      SET gloss_en = ? 
      WHERE strongs = ? AND (gloss_en IS NULL OR gloss_en = '')
    `);
    
    let matchedCount = 0;
    const transaction = db.transaction(() => {
      for (const row of strongsNumbers) {
        const strongs = row.strongs;
        const gloss = lexicon.get(strongs);
        
        if (gloss) {
          updateGloss.run(gloss, strongs);
          matchedCount++;
        }
      }
    });
    
    transaction();
    
    console.log(`   ✅ Added ${matchedCount}/${strongsNumbers.length} glosses`);
    
    // Now rebuild reverse interlinear with proper English
    console.log('   Rebuilding reverse interlinear...');
    
    // Drop old RIID tables if they exist
    db.exec('DROP TABLE IF EXISTS english_verses');
    db.exec('DROP TABLE IF EXISTS riid_map');
    
    // Recreate tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS english_verses (
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (book, chapter, verse)
      );
      
      CREATE TABLE IF NOT EXISTS riid_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        english_word_pos INTEGER NOT NULL,
        original_word_order INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_riid_verse ON riid_map(book, chapter, verse);
      CREATE INDEX IF NOT EXISTS idx_riid_english ON riid_map(book, chapter, verse, english_word_pos);
    `);
    
    // Get all verses
    const verses = db.prepare(`
      SELECT DISTINCT book, chapter, verse 
      FROM words 
      ORDER BY book, chapter, verse
    `).all();
    
    const insertEnglishVerse = db.prepare(`
      INSERT OR REPLACE INTO english_verses (book, chapter, verse, text)
      VALUES (?, ?, ?, ?)
    `);
    
    const insertRIID = db.prepare(`
      INSERT INTO riid_map (book, chapter, verse, english_word_pos, original_word_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const getWords = db.prepare(`
      SELECT word_order, gloss_en, text, lemma
      FROM words
      WHERE book = ? AND chapter = ? AND verse = ?
      ORDER BY word_order
    `);
    
    const riidTransaction = db.transaction(() => {
      for (const verse of verses) {
        const words = getWords.all(verse.book, verse.chapter, verse.verse);
        
        const englishWords = [];
        const riidMappings = [];
        
        for (const word of words) {
          let gloss = word.gloss_en || word.lemma || word.text;
          gloss = gloss.split('/')[0].trim();
          
          if (gloss) {
            const englishWordPos = englishWords.length;
            englishWords.push(gloss);
            riidMappings.push({
              englishWordPos,
              originalWordOrder: word.word_order
            });
          }
        }
        
        const englishText = englishWords.join(' ');
        insertEnglishVerse.run(verse.book, verse.chapter, verse.verse, englishText);
        
        for (const mapping of riidMappings) {
          insertRIID.run(
            verse.book,
            verse.chapter,
            verse.verse,
            mapping.englishWordPos,
            mapping.originalWordOrder
          );
        }
      }
    });
    
    riidTransaction();
    
    console.log(`   ✅ Rebuilt reverse interlinear for ${verses.length} verses`);
    
    // Update metadata
    db.prepare(`
      INSERT OR REPLACE INTO metadata (key, value)
      VALUES ('features', 'morphology,lemma,strongs,glosses,riid,reverse-interlinear')
    `).run();
    
  } finally {
    db.close();
  }
}

// Main execution
console.log('Adding Strongs Dictionary glosses to packs...\n');

// Parse Greek lexicon
const greekLexPath = resolve(__dirname, '../data-sources/stepbible/STEPBible-Data-master/Lexicons/TBESG - Translators Brief lexicon of Extended Strongs for Greek - STEPBible.org CC BY.txt');
const greekLexicon = parseStrongsLexicon(greekLexPath);
console.log(`   ✅ Loaded ${greekLexicon.size} Greek entries\n`);

// Parse Hebrew lexicon
const hebrewLexPath = resolve(__dirname, '../data-sources/stepbible/STEPBible-Data-master/Lexicons/TBESH - Translators Brief lexicon of Extended Strongs for Hebrew - STEPBible.org CC BY.txt');
const hebrewLexicon = parseStrongsLexicon(hebrewLexPath);
console.log(`   ✅ Loaded ${hebrewLexicon.size} Hebrew entries\n`);

// Enhance packs
const packsDir = resolve(__dirname, '../packs');

// Greek LXX
enhancePackWithStrongGlosses(
  resolve(packsDir, 'lxx-greek.sqlite'),
  greekLexicon,
  'Greek'
);

// Hebrew OT
enhancePackWithStrongGlosses(
  resolve(packsDir, 'hebrew-oshb.sqlite'),
  hebrewLexicon,
  'Hebrew'
);

console.log('\nAll packs enhanced with Strongs glosses!');
console.log('   Both LXX and Hebrew now have proper English translations.');
