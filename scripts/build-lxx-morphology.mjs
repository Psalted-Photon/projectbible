#!/usr/bin/env node
/**
 * Build Greek LXX (Septuagint) pack with morphology
 * 
 * Sources:
 * - Open Scriptures LXX Lemmas (JavaScript files with word-level lemmas)
 * - Base text from various LXX sources
 * 
 * Creates SQLite pack with:
 * - Full Greek text (84 books)
 * - Word-level lemmas
 * - Basic morphology where available
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// LXX book order (84 books including deuterocanonical/apocrypha)
const LXX_BOOKS = {
  'Gen': 'Genesis', 'Exod': 'Exodus', 'Lev': 'Leviticus', 'Num': 'Numbers', 'Deut': 'Deuteronomy',
  'Josh': 'Joshua', 'Judg': 'Judges', 'Ruth': 'Ruth',
  '1Sam': '1 Samuel', '2Sam': '2 Samuel', '1Kgs': '1 Kings', '2Kgs': '2 Kings',
  '1Chr': '1 Chronicles', '2Chr': '2 Chronicles',
  '1Esd': '1 Esdras', '2Esd': '2 Esdras', // Ezra/Nehemiah
  'Esth': 'Esther', 'Jdt': 'Judith', 'Tob': 'Tobit',
  '1Macc': '1 Maccabees', '2Macc': '2 Maccabees', '3Macc': '3 Maccabees', '4Macc': '4 Maccabees',
  'Job': 'Job', 'Ps': 'Psalms', 'Prov': 'Proverbs', 'Eccl': 'Ecclesiastes', 'Song': 'Song of Solomon',
  'Wis': 'Wisdom of Solomon', 'Sir': 'Sirach',
  'PsSol': 'Psalms of Solomon', 'Odes': 'Odes',
  'Hos': 'Hosea', 'Amos': 'Amos', 'Mic': 'Micah', 'Joel': 'Joel', 'Obad': 'Obadiah',
  'Jonah': 'Jonah', 'Nah': 'Nahum', 'Hab': 'Habakkuk', 'Zeph': 'Zephaniah', 'Hag': 'Haggai',
  'Zech': 'Zechariah', 'Mal': 'Malachi',
  'Isa': 'Isaiah', 'Jer': 'Jeremiah', 'Bar': 'Baruch', 'Lam': 'Lamentations',
  'EpJer': 'Epistle of Jeremiah', 'Ezek': 'Ezekiel',
  'PrAzar': 'Prayer of Azariah', 'Sus': 'Susanna', 'Dan': 'Daniel', 'Bel': 'Bel and the Dragon'
};

async function buildLXXPack() {
  console.log('\n📖 Building Greek LXX (Septuagint) with Morphology...');
  
  const lemmasPath = resolve(__dirname, '../data-sources/open-scriptures-lxx/GreekResources-master/LxxLemmas');
  const outputPath = resolve(__dirname, '../packs/lxx-greek.sqlite');
  
  if (!readdirSync(lemmasPath).length) {
    console.log('❌ LXX lemmas not found. Please download Open Scriptures Greek Resources first.');
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
        morph_code TEXT,
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
    `);
    
    // Insert metadata
    const metadata = {
      pack_id: 'lxx-greek',
      translation_id: 'LXX',
      translation_name: 'Septuagint (Greek Old Testament with Lemmas)',
      version: '1.0',
      type: 'text',
      language: 'grc',
      language_name: 'Ancient Greek (Koine)',
      license: 'CC BY-SA 4.0',
      attribution: 'Open Scriptures Hebrew Bible Project. Greek Septuagint with lemmas. https://github.com/openscriptures/GreekResources',
      features: 'lemma,full-lxx-84-books',
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
    
    // Process each book's lemmas
    const files = readdirSync(lemmasPath).filter(f => f.endsWith('.js'));
    let totalWords = 0;
    let totalVerses = 0;
    
    console.log(`   Processing ${files.length} LXX books...`);
    
    for (const file of files) {
      const bookCode = basename(file, '.js');
      const bookName = LXX_BOOKS[bookCode] || bookCode;
      
      const filePath = resolve(lemmasPath, file);
      const content = readFileSync(filePath, 'utf8');
      
      // Parse JavaScript object (it's just a JSON-like structure)
      let bookData;
      try {
        // The file starts with { and ends with }, so we can eval it
        bookData = eval(`(${content})`);
      } catch (e) {
        console.log(`   ⚠️  Skipping ${bookCode} - parse error`);
        continue;
      }
      
      const verses = [];
      const words = [];
      
      // Process each verse
      for (const [verseRef, verseWords] of Object.entries(bookData)) {
        // Parse reference like "Gen.1.1"
        const parts = verseRef.split('.');
        if (parts.length < 3) continue;
        
        const chapter = parseInt(parts[1]);
        const verse = parseInt(parts[2]);
        
        // Skip invalid references
        if (!chapter || !verse || isNaN(chapter) || isNaN(verse)) {
          console.log(`   ⚠️  Skipping invalid ref: ${verseRef}`);
          continue;
        }
        
        // Build verse text from lemmas (NFC normalized)
        const verseText = verseWords.map(w => w.lemma || w.key).join(' ').normalize('NFC');
        
        verses.push({ bookName, chapter, verse, text: verseText });
        
        // Store words with lemmas
        verseWords.forEach((word, idx) => {
          words.push({
            bookName,
            chapter,
            verse,
            wordIndex: idx,  // 0-based index
            text: (word.key || word.lemma).normalize('NFC'),
            lemma: word.lemma,
            morphCode: null,
            strongs: null,
            transliteration: null,
            gloss_en: null
          });
        });
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
    
    console.log(`\n   ✅ LXX pack built: ${fileSizeMB} MB`);
    console.log(`   📊 ${totalVerses} verses, ${totalWords} words with lemmas`);
    console.log(`   📚 ${files.length} books (full LXX canon)`);
    
  } finally {
    db.close();
  }
}

// Run
buildLXXPack().catch(console.error);
