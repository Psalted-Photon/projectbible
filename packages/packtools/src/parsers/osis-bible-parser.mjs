/**
 * OSIS Bible Text Parser
 * 
 * Parses complete Bible texts from OSIS XML files, including:
 * - Verse text
 * - Cross-references
 * - Footnotes
 * - Section headings
 * - Word-level morphology (when available)
 * 
 * Converts to SQLite pack format for ProjectBible.
 */

import { parseStringPromise } from 'xml2js';
import fs from 'fs';
import path from 'path';

/**
 * OSIS book name to standard abbreviation mapping
 */
const OSIS_BOOK_MAP = {
  'Gen': 'Genesis',
  'Exod': 'Exodus',
  'Lev': 'Leviticus',
  'Num': 'Numbers',
  'Deut': 'Deuteronomy',
  'Josh': 'Joshua',
  'Judg': 'Judges',
  'Ruth': 'Ruth',
  '1Sam': '1 Samuel',
  '2Sam': '2 Samuel',
  '1Kgs': '1 Kings',
  '2Kgs': '2 Kings',
  '1Chr': '1 Chronicles',
  '2Chr': '2 Chronicles',
  'Ezra': 'Ezra',
  'Neh': 'Nehemiah',
  'Esth': 'Esther',
  'Job': 'Job',
  'Ps': 'Psalms',
  'Prov': 'Proverbs',
  'Eccl': 'Ecclesiastes',
  'Song': 'Song of Solomon',
  'Isa': 'Isaiah',
  'Jer': 'Jeremiah',
  'Lam': 'Lamentations',
  'Ezek': 'Ezekiel',
  'Dan': 'Daniel',
  'Hos': 'Hosea',
  'Joel': 'Joel',
  'Amos': 'Amos',
  'Obad': 'Obadiah',
  'Jonah': 'Jonah',
  'Mic': 'Micah',
  'Nah': 'Nahum',
  'Hab': 'Habakkuk',
  'Zeph': 'Zephaniah',
  'Hag': 'Haggai',
  'Zech': 'Zechariah',
  'Mal': 'Malachi',
  // NT
  'Matt': 'Matthew',
  'Mark': 'Mark',
  'Luke': 'Luke',
  'John': 'John',
  'Acts': 'Acts',
  'Rom': 'Romans',
  '1Cor': '1 Corinthians',
  '2Cor': '2 Corinthians',
  'Gal': 'Galatians',
  'Eph': 'Ephesians',
  'Phil': 'Philippians',
  'Col': 'Colossians',
  '1Thess': '1 Thessalonians',
  '2Thess': '2 Thessalonians',
  '1Tim': '1 Timothy',
  '2Tim': '2 Timothy',
  'Titus': 'Titus',
  'Phlm': 'Philemon',
  'Heb': 'Hebrews',
  'Jas': 'James',
  '1Pet': '1 Peter',
  '2Pet': '2 Peter',
  '1John': '1 John',
  '2John': '2 John',
  '3John': '3 John',
  'Jude': 'Jude',
  'Rev': 'Revelation',
  // LXX/Apocrypha (common variations)
  'Tob': 'Tobit',
  'Jdt': 'Judith',
  'Wis': 'Wisdom',
  'Sir': 'Sirach',
  'Bar': 'Baruch',
  'EpJer': 'Epistle of Jeremiah',
  'PrAzar': 'Prayer of Azariah',
  'Sus': 'Susanna',
  'Bel': 'Bel and the Dragon',
  '1Macc': '1 Maccabees',
  '2Macc': '2 Maccabees',
  '3Macc': '3 Maccabees',
  '4Macc': '4 Maccabees',
  '1Esd': '1 Esdras',
  '2Esd': '2 Esdras',
  'PrMan': 'Prayer of Manasseh',
  // Alternative spellings
  'Esias': 'Isaiah',
  'Jeremias': 'Jeremiah',
  'Jezekiel': 'Ezekiel',
  'Osee': 'Hosea',
  'Michaeas': 'Micah',
  'Naum': 'Nahum',
  'Ambacum': 'Habakkuk',
  'Sophonias': 'Zephaniah',
  'Aggaeus': 'Haggai',
  'Zacharias': 'Zechariah',
  'Malachias': 'Malachi'
};

/**
 * Extract text content from OSIS node, handling mixed content
 */
function extractText(node) {
  if (typeof node === 'string') {
    return node;
  }
  
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  
  if (typeof node === 'object' && node !== null) {
    let text = '';
    
    // Handle different node types
    if (node._) {
      text += node._;
    }
    
    // Recursively process child elements
    for (const key in node) {
      if (key !== '$' && key !== '_') {
        const value = node[key];
        if (Array.isArray(value)) {
          text += value.map(extractText).join('');
        } else if (typeof value === 'object') {
          text += extractText(value);
        } else if (typeof value === 'string') {
          text += value;
        }
      }
    }
    
    return text;
  }
  
  return '';
}

/**
 * Parse OSIS book abbreviation to standard name
 */
function normalizeBookName(osisBook) {
  return OSIS_BOOK_MAP[osisBook] || osisBook;
}

/**
 * Parse verse reference from osisID (e.g., "Gen.1.1" -> {book, chapter, verse})
 */
function parseVerseRef(osisID) {
  const parts = osisID.split('.');
  return {
    book: normalizeBookName(parts[0]),
    chapter: parseInt(parts[1], 10),
    verse: parseInt(parts[2], 10)
  };
}

/**
 * Parse OSIS XML and extract Bible verses
 * @param {string} osisFilePath - Path to OSIS XML file
 * @returns {Promise<Object>} Parsed Bible data
 */
export async function parseOSISBible(osisFilePath) {
  console.log(`📖 Parsing OSIS file: ${path.basename(osisFilePath)}`);
  
  const xmlContent = fs.readFileSync(osisFilePath, 'utf-8');
  const result = await parseStringPromise(xmlContent, {
    explicitArray: true,
    preserveChildrenOrder: true,
    charsAsChildren: true
  });
  
  const metadata = {
    source: 'osis',
    filename: path.basename(osisFilePath)
  };
  
  const verses = [];
  const crossRefs = [];
  const footnotes = [];
  
  // Navigate OSIS structure
  const osisText = result.osis?.osisText?.[0];
  if (!osisText) {
    throw new Error('No osisText found in OSIS file');
  }
  
  // Extract metadata from header
  const header = osisText.header?.[0];
  if (header) {
    const work = header.work?.[0];
    if (work) {
      if (work.title?.[0]) {
        metadata.title = extractText(work.title[0]);
      }
      if (work.description?.[0]) {
        metadata.description = extractText(work.description[0]);
      }
      if (work.rights?.[0]) {
        metadata.license = extractText(work.rights[0]);
      }
      if (work.publisher?.[0]) {
        metadata.publisher = extractText(work.publisher[0]);
      }
    }
  }
  
  // Process books
  const divs = osisText.div || [];
  
  function processDiv(div) {
    // Books are typically <div type="book">
    if (div.$?.type === 'book' || div.$?.osisID) {
      const bookID = div.$?.osisID;
      if (bookID) {
        const bookName = normalizeBookName(bookID);
        console.log(`  📕 Processing ${bookName}...`);
      }
    }
    
    // Process chapters
    const chapters = div.chapter || [];
    for (const chapter of chapters) {
      processChapter(chapter);
    }
    
    // Process nested divs
    const nestedDivs = div.div || [];
    for (const nestedDiv of nestedDivs) {
      processDiv(nestedDiv);
    }
    
    // Process verses that might be direct children
    const directVerses = div.verse || [];
    for (const verse of directVerses) {
      processVerse(verse);
    }
  }
  
  function processChapter(chapter) {
    const verses = chapter.verse || [];
    for (const verse of verses) {
      processVerse(verse);
    }
  }
  
  function processVerse(verse) {
    const osisID = verse.$?.osisID || verse.$?.sID;
    if (!osisID) {
      return;
    }
    
    const ref = parseVerseRef(osisID);
    
    // Extract verse text
    let text = '';
    
    // Handle verse content - could be string, array, or mixed
    if (verse._) {
      text = verse._;
    } else {
      text = extractText(verse);
    }
    
    // Clean up whitespace
    text = text.trim().replace(/\s+/g, ' ');
    
    if (text) {
      verses.push({
        book: ref.book,
        chapter: ref.chapter,
        verse: ref.verse,
        text: text
      });
    }
    
    // Extract cross-references
    const notes = verse.note || [];
    for (const note of notes) {
      if (note.$?.type === 'crossReference') {
        const references = note.reference || [];
        for (const reference of references) {
          const targetRef = reference.$?.osisRef;
          if (targetRef) {
            crossRefs.push({
              from: osisID,
              to: targetRef,
              text: extractText(reference)
            });
          }
        }
      } else {
        // Regular footnote
        footnotes.push({
          verse: osisID,
          text: extractText(note)
        });
      }
    }
  }
  
  // Start processing
  for (const div of divs) {
    processDiv(div);
  }
  
  console.log(`✅ Parsed ${verses.length} verses`);
  if (crossRefs.length > 0) {
    console.log(`   📎 ${crossRefs.length} cross-references`);
  }
  if (footnotes.length > 0) {
    console.log(`   📝 ${footnotes.length} footnotes`);
  }
  
  return {
    metadata,
    verses,
    crossRefs,
    footnotes
  };
}

/**
 * Build SQLite pack from parsed OSIS data
 * @param {Object} parsedData - Data from parseOSISBible
 * @param {string} outputPath - Path for output SQLite file
 * @param {Object} packMetadata - Additional pack metadata
 */
export function buildPackFromOSIS(parsedData, outputPath, packMetadata = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(outputPath);
  
  console.log(`\n💾 Building SQLite pack: ${path.basename(outputPath)}`);
  
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
    
    CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
    CREATE INDEX IF NOT EXISTS idx_verses_book_chapter ON verses(book, chapter);
  `);
  
  // Insert metadata
  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('source', parsedData.metadata.source);
  insertMeta.run('filename', parsedData.metadata.filename);
  
  if (parsedData.metadata.title) {
    insertMeta.run('title', parsedData.metadata.title);
  }
  if (parsedData.metadata.description) {
    insertMeta.run('description', parsedData.metadata.description);
  }
  if (parsedData.metadata.license) {
    insertMeta.run('license', parsedData.metadata.license);
  }
  if (parsedData.metadata.publisher) {
    insertMeta.run('publisher', parsedData.metadata.publisher);
  }
  
  // Add custom pack metadata
  for (const [key, value] of Object.entries(packMetadata)) {
    insertMeta.run(key, String(value));
  }
  
  insertMeta.run('createdAt', new Date().toISOString());
  
  // Insert verses
  const insertVerse = db.prepare('INSERT OR REPLACE INTO verses (book, chapter, verse, text) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((verses) => {
    for (const verse of verses) {
      insertVerse.run(verse.book, verse.chapter, verse.verse, verse.text);
    }
  });
  
  insertMany(parsedData.verses);
  
  console.log(`✅ Inserted ${parsedData.verses.length} verses`);
  
  db.close();
  
  return outputPath;
}
