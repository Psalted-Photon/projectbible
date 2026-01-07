#!/usr/bin/env node
/**
 * Add Reverse Interlinear English to existing morphology packs
 * 
 * Takes Greek/Hebrew packs and adds:
 * - English verse translations built from glosses
 * - RIID (Reverse Interlinear ID) mappings for hover functionality
 * 
 * Each English word is tagged with the original language word_order ID,
 * enabling instant lookup of Greek/Hebrew morphology when hovering.
 */

import Database from 'better-sqlite3';
import { readdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function addReverseInterlinear(packPath) {
  console.log(`\n📖 Adding Reverse Interlinear to ${packPath}...`);
  
  const db = new Database(packPath);
  
  try {
    // Create RIID tables
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
        original_word_order INTEGER NOT NULL,
        FOREIGN KEY (book, chapter, verse, original_word_order) 
          REFERENCES words(book, chapter, verse, word_order)
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
    
    console.log(`   Processing ${verses.length} verses...`);
    
    const insertEnglishVerse = db.prepare(`
      INSERT OR REPLACE INTO english_verses (book, chapter, verse, text)
      VALUES (?, ?, ?, ?)
    `);
    
    const insertRIID = db.prepare(`
      INSERT INTO riid_map (book, chapter, verse, english_word_pos, original_word_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    // Check if gloss_en column exists
    const columns = db.prepare('PRAGMA table_info(words)').all();
    const hasGloss = columns.some(c => c.name === 'gloss_en');
    const hasStrongs = columns.some(c => c.name === 'strongs');
    
    const selectColumns = ['word_order', 'text', 'lemma'];
    if (hasGloss) selectColumns.push('gloss_en');
    if (hasStrongs) selectColumns.push('strongs');
    
    const getWords = db.prepare(`
      SELECT ${selectColumns.join(', ')}
      FROM words
      WHERE book = ? AND chapter = ? AND verse = ?
      ORDER BY word_order
    `);
    
    let processedCount = 0;
    const transaction = db.transaction(() => {
      for (const verse of verses) {
        const words = getWords.all(verse.book, verse.chapter, verse.verse);
        
        // Build English text from glosses
        const englishWords = [];
        const riidMappings = [];
        
        for (const word of words) {
          // Clean gloss (remove brackets and split alternatives)
          let gloss = '';
          
          if (hasGloss && word.gloss_en) {
            gloss = word.gloss_en.replace(/[〔〕「」]/g, '').trim();
          } else {
            // Fallback: use Strong's number or lemma as placeholder
            // This will be enhanced later with Strong's dictionary lookup
            const strongsRef = hasStrongs && word.strongs ? word.strongs : '';
            gloss = strongsRef || word.lemma || word.text;
          }
          
          // Take first gloss if multiple options (split by /)
          const primaryGloss = gloss.split('/')[0].trim();
          
          if (primaryGloss) {
            const englishWordPos = englishWords.length;
            englishWords.push(primaryGloss);
            riidMappings.push({
              englishWordPos,
              originalWordOrder: word.word_order
            });
          }
        }
        
        const englishText = englishWords.join(' ');
        
        // Insert English verse
        insertEnglishVerse.run(verse.book, verse.chapter, verse.verse, englishText);
        
        // Insert RIID mappings
        for (const mapping of riidMappings) {
          insertRIID.run(
            verse.book,
            verse.chapter,
            verse.verse,
            mapping.englishWordPos,
            mapping.originalWordOrder
          );
        }
        
        processedCount++;
        if (processedCount % 1000 === 0) {
          console.log(`   Processed ${processedCount}/${verses.length} verses...`);
        }
      }
    });
    
    transaction();
    
    // Update metadata
    db.prepare(`
      INSERT OR REPLACE INTO metadata (key, value)
      VALUES ('features', 'morphology,lemma,strongs,glosses,riid,reverse-interlinear')
    `).run();
    
    const fileSize = statSync(packPath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    
    console.log(`\n   ✅ Reverse Interlinear added!`);
    console.log(`   📊 ${verses.length} verses with RIID mappings`);
    console.log(`   📦 Pack size: ${fileSizeMB} MB`);
    
  } finally {
    db.close();
  }
}

// Process all morphology packs
const packsDir = resolve(__dirname, '../packs');
const morphologyPacks = [
  'opengnt-morphology.sqlite',
  'lxx-greek.sqlite',
  'hebrew-oshb.sqlite'
];

console.log('🔄 Adding Reverse Interlinear to morphology packs...\n');

for (const pack of morphologyPacks) {
  const packPath = resolve(packsDir, pack);
  try {
    addReverseInterlinear(packPath);
  } catch (error) {
    console.error(`❌ Error processing ${pack}:`, error.message);
  }
}

console.log('\n✅ All packs enhanced with Reverse Interlinear!');
console.log('\n💡 Usage:');
console.log('   - Query english_verses table for readable English');
console.log('   - Use riid_map to link English word → original word');
console.log('   - Join with words table to get morphology on hover');
