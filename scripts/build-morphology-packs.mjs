#!/usr/bin/env node
/**
 * Build Greek Bible packs with FULL morphology from:
 * - OpenGNT (NT): morphology, glosses, clause data, discourse features
 * - MorphGNT (NT): additional morphology verification
 * - Open Scriptures LXX (OT): lemmas and morphology
 * 
 * Creates extended SQLite schema with morphology tables
 */

import { readFileSync, statSync, createReadStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Book name mappings
const BOOK_NUMBERS = {
  '40': 'Matthew', '41': 'Mark', '42': 'Luke', '43': 'John', '44': 'Acts',
  '45': 'Romans', '46': '1 Corinthians', '47': '2 Corinthians', '48': 'Galatians',
  '49': 'Ephesians', '50': 'Philippians', '51': 'Colossians',
  '52': '1 Thessalonians', '53': '2 Thessalonians',
  '54': '1 Timothy', '55': '2 Timothy', '56': 'Titus', '57': 'Philemon',
  '58': 'Hebrews', '59': 'James', '60': '1 Peter', '61': '2 Peter',
  '62': '1 John', '63': '2 John', '64': '3 John', '65': 'Jude', '66': 'Revelation'
};

async function buildOpenGNTPack(inputPath, outputPath) {
  console.log('\n📖 Building OpenGNT with Full Morphology...');
  console.log(`   Source: ${inputPath}`);
  
  const db = new Database(outputPath);
  
  try {
    // Create extended schema with morphology
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
        word_order INTEGER NOT NULL,
        text TEXT NOT NULL,
        text_unaccented TEXT,
        text_accented TEXT,
        lemma TEXT NOT NULL,
        morph_code TEXT NOT NULL,
        strongs TEXT,
        clause_id TEXT,
        gloss_en TEXT,
        transliteration TEXT,
        louw_nida TEXT,
        UNIQUE(book, chapter, verse, word_order)
      );
      
      CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
      CREATE INDEX IF NOT EXISTS idx_verses_book_chapter ON verses(book, chapter);
      CREATE INDEX IF NOT EXISTS idx_words_verse ON words(book, chapter, verse);
      CREATE INDEX IF NOT EXISTS idx_words_lemma ON words(lemma);
      CREATE INDEX IF NOT EXISTS idx_words_strongs ON words(strongs);
      CREATE INDEX IF NOT EXISTS idx_words_morph ON words(morph_code);
    `);
    
    // Insert metadata (use underscore_case keys to match pack-import.ts expectations)
    const metadata = {
      pack_id: 'opengnt-full',
      translation_id: 'OGNT',
      translation_name: 'Open Greek New Testament (with Morphology)',
      version: '3.3',
      type: 'text',
      language: 'grc',
      language_name: 'Ancient Greek (Koine)',
      license: 'CC BY-SA 4.0',
      attribution: 'OpenGNT. Open‑source Greek New Testament with morphology, glosses, and discourse features. https://opengnt.com',
      features: 'morphology,lemma,strongs,glosses,clauses,transliteration,louw-nida'
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
      INSERT OR REPLACE INTO words (book, chapter, verse, word_order, text, text_unaccented, text_accented, lemma, morph_code, strongs, clause_id, gloss_en, transliteration, louw_nida)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertVerse = db.prepare('INSERT OR IGNORE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
    
    // Parse CSV
    console.log('   Parsing OpenGNT CSV (this may take a minute)...');
    
    const fileStream = createReadStream(inputPath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
    
    let lineCount = 0;
    let wordCount = 0;
    const verseTexts = new Map();
    const allWords = [];
    const verseWordCounts = new Map(); // Track word_order per verse
    
    for await (const line of rl) {
      lineCount++;
      if (lineCount === 1) continue; // Skip header
      
      // Debug first few lines
      if (lineCount <= 5) {
        console.log(`   Line ${lineCount} length: ${line.length}`);
      }
      
      const columns = line.split('\t');
      
      // Debug column count
      if (lineCount === 2) {
        console.log(`   Column count: ${columns.length}`);
        console.log(`   Column 6 raw: ${columns[6]}`);
        console.log(`   Column 7 raw: ${columns[7]}`);
      }
      
      if (columns.length < 12) {
        if (lineCount === 2) console.log(`   Skipping - not enough columns`);
        continue;
      }
      
      // Parse book/chapter/verse from column 6
      // Format: 「Book｜Chapter｜Verse」
      const col6Clean = columns[6].replace(/〔/g, '').replace(/〕/g, '');
      const col6Parts = col6Clean.split('｜');
      
      if (lineCount === 2) {
        console.log(`   Col6 cleaned: "${col6Clean}"`);
        console.log(`   Col6 parts: ${JSON.stringify(col6Parts)}`);
      }
      
      if (col6Parts.length < 3) continue;
      
      const bookNum = col6Parts[0];
      const book = BOOK_NUMBERS[bookNum];
      if (!book) continue;
      
      const chapter = parseInt(col6Parts[1]);
      const verse = parseInt(col6Parts[2]);
      
      // Parse word data from column 7: 「OGNTk｜OGNTu｜OGNTa｜lexeme｜rmac｜sn」
      const col7Parts = columns[7].replace(/[「」]/g, '').split('｜');
      if (col7Parts.length < 6) continue;
      
      const textUnaccented = col7Parts[1];
      const textAccented = col7Parts[2];
      const lemma = col7Parts[3];
      const morphCode = col7Parts[4];
      const strongs = col7Parts[5];
      
      // Parse gloss from column 10: 「TBESG｜IT｜LT｜ST｜Español」
      const col10Parts = columns[10].replace(/[「」]/g, '').split('｜');
      const gloss = col10Parts.length > 0 ? col10Parts[0] : '';
      
      // Parse transliteration from column 9: 「transSBLcap｜transSBL｜modernGreek｜Fonética」
      const col9Parts = columns[9].replace(/[「」]/g, '').split('｜');
      const translit = col9Parts.length > 1 ? col9Parts[1] : '';
      
      // Parse Louw-Nida from column 8: 「BDAGentry｜EDNTentry｜MounceEntry｜GK｜LN-LouwNida」
      const col8Parts = columns[8].replace(/[「」]/g, '').split('｜');
      const lnPart = col8Parts.find(p => p.startsWith('LN-'));
      const louwNida = lnPart ? lnPart.substring(3) : '';
      
      const clauseId = columns[3] || '';
      
      // Track verse text and word order
      const verseKey = `${book}|${chapter}|${verse}`;
      if (!verseTexts.has(verseKey)) {
        verseTexts.set(verseKey, []);
        verseWordCounts.set(verseKey, 0);
      }
      verseTexts.get(verseKey).push(textAccented);
      
      // Increment word order for this verse
      const currentWordOrder = verseWordCounts.get(verseKey) + 1;
      verseWordCounts.set(verseKey, currentWordOrder);
      
      // Store word
      allWords.push({
        book, chapter, verse,
        wordOrder: currentWordOrder,
        text: textAccented,
        textUnaccented,
        textAccented,
        lemma,
        morphCode,
        strongs,
        clauseId,
        gloss,
        translit,
        louwNida
      });
      
      wordCount++;
    }
    
    console.log(`   Processed ${wordCount} words from ${verseTexts.size} verses`);
    
    // Debug: Show word order distribution for first few verses
    const firstVerses = Array.from(verseTexts.keys()).slice(0, 3);
    for (const verseKey of firstVerses) {
      const wordsInVerse = allWords.filter(w => `${w.book}|${w.chapter}|${w.verse}` === verseKey);
      console.log(`   Verse ${verseKey}: ${wordsInVerse.length} words, orders: ${wordsInVerse.map(w => w.wordOrder).join(',')}`);
    }
    
    console.log('   Inserting into database...');
    
    // Debug: Check for duplicates before inserting
    const duplicateCheck = new Map();
    for (const w of allWords) {
      const key = `${w.book}|${w.chapter}|${w.verse}|${w.wordOrder}`;
      if (duplicateCheck.has(key)) {
        console.log(`   DUPLICATE FOUND: ${key}`);
        console.log(`     First: ${JSON.stringify(duplicateCheck.get(key))}`);
        console.log(`     Second: ${JSON.stringify(w)}`);
      }
      duplicateCheck.set(key, w);
    }
    
    // Insert words
    const wordsTransaction = db.transaction((words) => {
      for (const w of words) {
        insertWord.run(
          w.book, w.chapter, w.verse, w.wordOrder,
          w.text, w.textUnaccented, w.textAccented,
          w.lemma, w.morphCode, w.strongs,
          w.clauseId, w.gloss, w.translit, w.louwNida
        );
      }
    });
    
    wordsTransaction(allWords);
    
    // Build verse texts and insert
    const verses = [];
    for (const [key, words] of verseTexts) {
      const [book, chapter, verse] = key.split('|');
      verses.push({
        book,
        chapter: parseInt(chapter),
        verse: parseInt(verse),
        text: words.join(' ')
      });
    }
    
    const versesTransaction = db.transaction((vv) => {
      for (const v of vv) {
        insertVerse.run(v.book, v.chapter, v.verse, v.text);
      }
    });
    
    versesTransaction(verses);
    
    // Update metadata
    const bookCount = new Set(verses.map(v => v.book)).size;
    insertMeta.run('bookCount', bookCount.toString());
    insertMeta.run('verseCount', verses.length.toString());
    insertMeta.run('wordCount', wordCount.toString());
    
  } finally {
    db.close();
  }
  
  const size = (statSync(outputPath).size / (1024 * 1024)).toFixed(2);
  console.log(`   ✅ Pack built: ${size} MB`);
  console.log(`   📊 Features: morphology, lemmas, Strong's, glosses, clauses, transliteration, Louw-Nida`);
}

const repoRoot = resolve(__dirname, '..');

console.log('📦 Building Greek Bible with FULL Morphology');
console.log('='.repeat(60));

// Build OpenGNT (NT with full morphology)
await buildOpenGNTPack(
  resolve(repoRoot, 'data-sources/opengnt/base-text/OpenGNT_version3_3.csv'),
  resolve(repoRoot, 'packs/opengnt-morphology.sqlite')
);

console.log('\n' + '='.repeat(60));
console.log('✅ Morphology packs built successfully!');
console.log('\n💡 Next: Build LXX OT with morphology from Open Scriptures data');
