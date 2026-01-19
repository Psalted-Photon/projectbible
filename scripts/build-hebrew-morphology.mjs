#!/usr/bin/env node
/**
 * Build Hebrew Bible pack with FULL morphology from OSHB
 * 
 * Source: Open Scriptures Hebrew Bible (OSHB)
 * - Westminster Leningrad Codex with complete morphology
 * - Word-level lemmas (Strong's numbers)
 * - Full morphology codes (OSHM format)
 * - Creative Commons BY 4.0 license
 * 
 * Creates SQLite pack with:
 * - Full Hebrew text (39 OT books)
 * - Word-level morphology
 * - Lemmas (Strong's)
 * - Grammar codes
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// OT book order
const OT_BOOKS = {
  'Gen': 'Genesis', 'Exod': 'Exodus', 'Lev': 'Leviticus', 'Num': 'Numbers', 'Deut': 'Deuteronomy',
  'Josh': 'Joshua', 'Judg': 'Judges', 'Ruth': 'Ruth',
  '1Sam': '1 Samuel', '2Sam': '2 Samuel', '1Kgs': '1 Kings', '2Kgs': '2 Kings',
  '1Chr': '1 Chronicles', '2Chr': '2 Chronicles',
  'Ezra': 'Ezra', 'Neh': 'Nehemiah', 'Esth': 'Esther',
  'Job': 'Job', 'Ps': 'Psalms', 'Prov': 'Proverbs', 'Eccl': 'Ecclesiastes', 'Song': 'Song of Solomon',
  'Isa': 'Isaiah', 'Jer': 'Jeremiah', 'Lam': 'Lamentations', 'Ezek': 'Ezekiel', 'Dan': 'Daniel',
  'Hos': 'Hosea', 'Joel': 'Joel', 'Amos': 'Amos', 'Obad': 'Obadiah', 'Jonah': 'Jonah', 
  'Mic': 'Micah', 'Nah': 'Nahum', 'Hab': 'Habakkuk', 'Zeph': 'Zephaniah', 'Hag': 'Haggai', 
  'Zech': 'Zechariah', 'Mal': 'Malachi'
};

async function buildHebrewPack() {
  console.log('\n📖 Building Hebrew Bible with OSHB Morphology...');
  
  const wlcPath = resolve(__dirname, '../data-sources/oshb/morphhb-master/wlc');
  const outputPath = resolve(__dirname, '../packs/hebrew-oshb.sqlite');
  
  const files = readdirSync(wlcPath).filter(f => f.endsWith('.xml'));
  if (!files.length) {
    console.log('❌ OSHB WLC files not found.');
    return;
  }
  
  const db = new Database(outputPath);
  
  try {
    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS verses (
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (book, chapter, verse)
      );
      
      CREATE TABLE IF NOT EXISTS words (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        word_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        lemma TEXT NOT NULL,
        morph_code TEXT NOT NULL,
        strongs TEXT,
        transliteration TEXT,
        gloss_en TEXT,
        UNIQUE(book, chapter, verse, word_index)
      );
      
      CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
      CREATE INDEX IF NOT EXISTS idx_verses_book_chapter ON verses(book, chapter);
      CREATE INDEX IF NOT EXISTS idx_words_verse ON words(book, chapter, verse);
      CREATE INDEX IF NOT EXISTS idx_words_word_index ON words(book, chapter, verse, word_index);
      CREATE INDEX IF NOT EXISTS idx_words_lemma ON words(lemma);
      CREATE INDEX IF NOT EXISTS idx_words_strongs ON words(strongs);
      CREATE INDEX IF NOT EXISTS idx_words_morph ON words(morph_code);
    `);
    
    // Insert metadata
    const metadata = {
      pack_id: 'hebrew-oshb',
      translation_id: 'WLC',
      translation_name: 'Westminster Leningrad Codex (with OSHB Morphology)',
      version: '4.20',
      type: 'text',
      language: 'hbo',
      language_name: 'Biblical Hebrew',
      license: 'CC BY 4.0',
      attribution: 'Open Scriptures Hebrew Bible. Westminster Leningrad Codex with complete morphology. https://github.com/openscriptures/morphhb',
      features: 'morphology,lemma,strongs,full-parsing',
      morphology_schema_version: '2'
    };
    
    const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    const metaTransaction = db.transaction((entries) => {
      for (const [key, value] of entries) {
        insertMeta.run(key, value);
      }
    });
    
    metaTransaction(Object.entries(metadata));
    
    // Prepare statements
    const insertWord = db.prepare(`
      INSERT OR REPLACE INTO words (book, chapter, verse, word_index, text, lemma, morph_code, strongs, transliteration, gloss_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertVerse = db.prepare('INSERT OR IGNORE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
    
    // XML parser
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false
    });
    
    let totalWords = 0;
    let totalVerses = 0;
    
    console.log(`   Processing ${files.length} OT books...`);
    
    for (const file of files.sort()) {
      const bookCode = basename(file, '.xml');
      const bookName = OT_BOOKS[bookCode];
      if (!bookName) {
        console.log(`   ⚠️  Skipping ${bookCode} - not in book list`);
        continue;
      }
      
      const filePath = resolve(wlcPath, file);
      const xmlContent = readFileSync(filePath, 'utf8');
      const parsed = parser.parse(xmlContent);
      
      const osisText = parsed.osis?.osisText?.div;
      if (!osisText) {
        console.log(`   ⚠️  Skipping ${bookCode} - invalid structure`);
        continue;
      }
      
      const verses = [];
      const words = [];
      
      // Navigate to chapters
      const chapters = Array.isArray(osisText.chapter) ? osisText.chapter : [osisText.chapter];
      
      for (const chapter of chapters) {
        if (!chapter) continue;
        
        const chapterVerses = Array.isArray(chapter.verse) ? chapter.verse : [chapter.verse];
        
        for (const verseData of chapterVerses) {
          if (!verseData || !verseData['@_osisID']) continue;
          
          // Parse reference like "Gen.1.1"
          const osisID = verseData['@_osisID'];
          const parts = osisID.split('.');
          if (parts.length < 3) continue;
          
          const chNum = parseInt(parts[1]);
          const vNum = parseInt(parts[2]);
          
          if (!chNum || !vNum || isNaN(chNum) || isNaN(vNum)) continue;
          
          // Extract words
          const verseWords = Array.isArray(verseData.w) ? verseData.w : (verseData.w ? [verseData.w] : []);
          
          if (verseWords.length === 0) continue;
          
          const verseText = verseWords.map(w => {
            if (typeof w === 'string') return w;
            return w['#text'] || '';
          }).join(' ').replace(/\s+/g, ' ').trim();
          
          // Normalize text (NFC) for consistent matching
          const normalizedText = verseText.normalize('NFC');
          
          verses.push({ bookName, chapter: chNum, verse: vNum, text: normalizedText });
          
          // Process words with morphology
          let wordIndex = 0;
          for (const word of verseWords) {
            if (typeof word === 'string' || !word['@_lemma']) continue;
            
            const text = (word['#text'] || '').normalize('NFC');
            const lemma = word['@_lemma'] || '';
            const morphCode = word['@_morph'] || '';
            
            // Extract Strong's number from lemma (format like "b/7225" or "1254 a")
            const strongsMatch = lemma.match(/\d+/);
            const strongs = strongsMatch ? 'H' + strongsMatch[0].padStart(4, '0') : '';
            
            // Note: transliteration and gloss_en will be added by separate script (add-strongs-glosses.mjs)
            
            words.push({
              bookName,
              chapter: chNum,
              verse: vNum,
              wordIndex,  // 0-based index
              text,
              lemma,
              morphCode,
              strongs,
              transliteration: null,
              gloss_en: null
            });
            
            wordIndex++;
          }
        }
      }
      
      // Insert data
      const verseTransaction = db.transaction((vv) => {
        vv.forEach(v => insertVerse.run(v.bookName, v.chapter, v.verse, v.text));
      });
      
      const wordTransaction = db.transaction((ww) => {
        ww.forEach(w => insertWord.run(w.bookName, w.chapter, w.verse, w.wordIndex, w.text, w.lemma, w.morphCode, w.strongs, w.transliteration, w.gloss_en));
      });
      
      verseTransaction(verses);
      wordTransaction(words);
      
      totalWords += words.length;
      totalVerses += verses.length;
      
      console.log(`   ✓ ${bookName}: ${verses.length} verses, ${words.length} words`);
    }
    
    const fileSize = statSync(outputPath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    
    console.log(`\n   ✅ Hebrew pack built: ${fileSizeMB} MB`);
    console.log(`   📊 ${totalVerses} verses, ${totalWords} words with full morphology`);
    console.log(`   📚 ${files.length} books (complete OT)`);
    
  } finally {
    db.close();
  }
}

// Run
buildHebrewPack().catch(console.error);
