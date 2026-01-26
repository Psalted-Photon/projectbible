#!/usr/bin/env node
/**
 * Commentary Parser
 * 
 * Parses commentary sources (OSIS, PDF, HTML) into unified NDJSON format.
 * 
 * Output schema:
 * {
 *   book: string,
 *   chapter: number,
 *   verse_start: number,
 *   verse_end: number | null,
 *   author: string,
 *   title: string,
 *   text: string,
 *   source: string,
 *   year: number
 * }
 * 
 * Usage:
 *   node scripts/parse-commentary-sources.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const parseXML = promisify(parseString);

// Paths
const SOURCES_DIR = join(__dirname, '../data-sources/commentaries/raw');
const OUTPUT_FILE = join(__dirname, '../data/processed/commentary-unified.ndjson');

// Canonical book names (66 books)
const BOOK_NAMES = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
  'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel',
  'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
  '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
  'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation'
];

// OSIS book abbreviations to canonical names (comprehensive mapping with variants)
const OSIS_BOOK_MAP = {
  // Old Testament
  'Gen': 'Genesis', 'Genesis': 'Genesis',
  'Exod': 'Exodus', 'Exo': 'Exodus', 'Exodus': 'Exodus',
  'Lev': 'Leviticus', 'Leviticus': 'Leviticus',
  'Num': 'Numbers', 'Numbers': 'Numbers',
  'Deut': 'Deuteronomy', 'Deu': 'Deuteronomy', 'Deuteronomy': 'Deuteronomy',
  'Josh': 'Joshua', 'Jos': 'Joshua', 'Joshua': 'Joshua',
  'Judg': 'Judges', 'Jdg': 'Judges', 'Judges': 'Judges',
  'Ruth': 'Ruth', 'Rut': 'Ruth',
  '1Sam': '1 Samuel', '1Sa': '1 Samuel', '1Samuel': '1 Samuel',
  '2Sam': '2 Samuel', '2Sa': '2 Samuel', '2Samuel': '2 Samuel',
  '1Kgs': '1 Kings', '1Ki': '1 Kings', '1Kings': '1 Kings',
  '2Kgs': '2 Kings', '2Ki': '2 Kings', '2Kings': '2 Kings',
  '1Chr': '1 Chronicles', '1Ch': '1 Chronicles', '1Chronicles': '1 Chronicles',
  '2Chr': '2 Chronicles', '2Ch': '2 Chronicles', '2Chronicles': '2 Chronicles',
  'Ezra': 'Ezra', 'Ezr': 'Ezra',
  'Neh': 'Nehemiah', 'Nehemiah': 'Nehemiah',
  'Esth': 'Esther', 'Est': 'Esther', 'Esther': 'Esther',
  'Job': 'Job',
  'Ps': 'Psalms', 'Psa': 'Psalms', 'Psalm': 'Psalms', 'Psalms': 'Psalms',
  'Prov': 'Proverbs', 'Pro': 'Proverbs', 'Proverbs': 'Proverbs',
  'Eccl': 'Ecclesiastes', 'Ecc': 'Ecclesiastes', 'Ecclesiastes': 'Ecclesiastes',
  'Song': 'Song of Solomon', 'SOS': 'Song of Solomon', 'Cant': 'Song of Solomon', 'Sol': 'Song of Solomon', 'SongOfSolomon': 'Song of Solomon',
  'Isa': 'Isaiah', 'Isaiah': 'Isaiah',
  'Jer': 'Jeremiah', 'Jeremiah': 'Jeremiah',
  'Lam': 'Lamentations', 'Lamentations': 'Lamentations',
  'Ezek': 'Ezekiel', 'Eze': 'Ezekiel', 'Ezekiel': 'Ezekiel',
  'Dan': 'Daniel', 'Daniel': 'Daniel',
  'Hos': 'Hosea', 'Hosea': 'Hosea',
  'Joel': 'Joel', 'Joe': 'Joel',
  'Amos': 'Amos', 'Amo': 'Amos',
  'Obad': 'Obadiah', 'Oba': 'Obadiah', 'Obadiah': 'Obadiah',
  'Jonah': 'Jonah', 'Jon': 'Jonah',
  'Mic': 'Micah', 'Micah': 'Micah',
  'Nah': 'Nahum', 'Nahum': 'Nahum',
  'Hab': 'Habakkuk', 'Habakkuk': 'Habakkuk',
  'Zeph': 'Zephaniah', 'Zep': 'Zephaniah', 'Zephaniah': 'Zephaniah',
  'Hag': 'Haggai', 'Haggai': 'Haggai',
  'Zech': 'Zechariah', 'Zec': 'Zechariah', 'Zechariah': 'Zechariah',
  'Mal': 'Malachi', 'Malachi': 'Malachi',
  
  // New Testament
  'Matt': 'Matthew', 'Mat': 'Matthew', 'Matthew': 'Matthew',
  'Mark': 'Mark', 'Mar': 'Mark', 'Mrk': 'Mark',
  'Luke': 'Luke', 'Luk': 'Luke',
  'John': 'John', 'Joh': 'John', 'Jhn': 'John',
  'Acts': 'Acts', 'Act': 'Acts',
  'Rom': 'Romans', 'Romans': 'Romans',
  '1Cor': '1 Corinthians', '1Co': '1 Corinthians', '1Corinthians': '1 Corinthians',
  '2Cor': '2 Corinthians', '2Co': '2 Corinthians', '2Corinthians': '2 Corinthians',
  'Gal': 'Galatians', 'Galatians': 'Galatians',
  'Eph': 'Ephesians', 'Ephesians': 'Ephesians',
  'Phil': 'Philippians', 'Php': 'Philippians', 'Philippians': 'Philippians',
  'Col': 'Colossians', 'Colossians': 'Colossians',
  '1Thess': '1 Thessalonians', '1Th': '1 Thessalonians', '1Thessalonians': '1 Thessalonians',
  '2Thess': '2 Thessalonians', '2Th': '2 Thessalonians', '2Thessalonians': '2 Thessalonians',
  '1Tim': '1 Timothy', '1Ti': '1 Timothy', '1Timothy': '1 Timothy',
  '2Tim': '2 Timothy', '2Ti': '2 Timothy', '2Timothy': '2 Timothy',
  'Titus': 'Titus', 'Tit': 'Titus',
  'Phlm': 'Philemon', 'Phm': 'Philemon', 'Philemon': 'Philemon',
  'Heb': 'Hebrews', 'Hebrews': 'Hebrews',
  'Jas': 'James', 'Jam': 'James', 'James': 'James',
  '1Pet': '1 Peter', '1Pe': '1 Peter', '1P': '1 Peter', '1Peter': '1 Peter',
  '2Pet': '2 Peter', '2Pe': '2 Peter', '2P': '2 Peter', '2Peter': '2 Peter',
  '1John': '1 John', '1Jn': '1 John', '1Jo': '1 John', '1J': '1 John', '1Joh': '1 John',
  '2John': '2 John', '2Jn': '2 John', '2Jo': '2 John', '2J': '2 John', '2Joh': '2 John',
  '3John': '3 John', '3Jn': '3 John', '3Jo': '3 John', '3J': '3 John', '3Joh': '3 John',
  'Jude': 'Jude', 'Jud': 'Jude',
  'Rev': 'Revelation', 'Revelation': 'Revelation'
};

// Track unmapped OSIS books for debugging
const UNMAPPED_OSIS_BOOKS = new Set();

// Commentary metadata
const COMMENTARY_METADATA = {
  'MHC': { author: 'Matthew Henry', title: "Matthew Henry's Complete Commentary", year: 1706, source: 'CrossWire' },
  'JFB': { author: 'Jamieson-Fausset-Brown', title: 'Commentary Critical and Explanatory', year: 1871, source: 'CrossWire' },
  'Barnes': { author: 'Albert Barnes', title: "Barnes' Notes on the Bible", year: 1834, source: 'CrossWire' },
  'KD': { author: 'Keil & Delitzsch', title: 'Commentary on the Old Testament', year: 1866, source: 'CrossWire' },
  'Gill': { author: 'John Gill', title: "Gill's Exposition of the Bible", year: 1746, source: 'CrossWire' },
  'Clarke': { author: 'Adam Clarke', title: "Clarke's Commentary", year: 1810, source: 'CrossWire' },
  'Wesley': { author: 'John Wesley', title: "Wesley's Explanatory Notes", year: 1754, source: 'CrossWire' },
  'Constable': { author: 'Thomas L. Constable', title: "Constable's Notes", year: 2023, source: 'Plano Bible Chapel' },
};

/**
 * Parse OSIS ID to book/chapter/verse
 * Example: "Gen.1.1" -> { book: "Genesis", chapter: 1, verse: 1 }
 */
function parseOsisID(osisID) {
  const parts = osisID.split('.');
  if (parts.length < 1) return null;
  
  const bookAbbr = parts[0];
  const book = OSIS_BOOK_MAP[bookAbbr];
  if (!book) {
    console.warn(`Unknown OSIS book: ${bookAbbr}`);
    return null;
  }
  
  const chapter = parts[1] ? parseInt(parts[1], 10) : 0;
  const verse = parts[2] ? parseInt(parts[2], 10) : 0; // 0 = chapter-level
  
  return { book, chapter, verse };
}

/**
 * Extract text from OSIS XML node (recursive)
 */
function extractText(node) {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join(' ');
  if (typeof node === 'object') {
    if (node._) return extractText(node._);
    if (node.$$) return extractText(node.$$);
    return '';
  }
  return '';
}

/**
 * Parse OSIS XML commentary
 */
async function parseOSISCommentary(filePath, commentaryId) {
  console.log(`Parsing OSIS: ${filePath}`);
  
  const xml = readFileSync(filePath, 'utf-8');
  const result = await parseXML(xml);
  
  const entries = [];
  const metadata = COMMENTARY_METADATA[commentaryId] || { 
    author: 'Unknown', 
    title: 'Unknown Commentary', 
    year: 1900, 
    source: 'Unknown' 
  };
  
  // Navigate to div elements (OSIS structure: <osis><osisText><div type="book">...)
  const osisText = result?.osis?.osisText?.[0];
  if (!osisText) {
    console.error('No osisText found in OSIS file');
    return entries;
  }
  
  // Find all verse elements
  function findVerses(node, bookContext = null, chapterContext = null) {
    if (!node) return;
    
    // Check if this is a book div
    if (node.div) {
      for (const div of node.div) {
        const divType = div.$?.type;
        const osisID = div.$?.osisID;
        
        if (divType === 'book' && osisID) {
          const ref = parseOsisID(osisID);
          if (ref) {
            findVerses(div, ref.book, null);
          }
        } else if (divType === 'chapter' && osisID) {
          const ref = parseOsisID(osisID);
          if (ref) {
            findVerses(div, ref.book, ref.chapter);
          }
        } else {
          findVerses(div, bookContext, chapterContext);
        }
      }
    }
    
    // Check for verse elements
    if (node.verse) {
      for (const verse of node.verse) {
        const osisID = verse.$?.osisID;
        if (!osisID) continue;
        
        const ref = parseOsisID(osisID);
        if (!ref) continue;
        
        const text = extractText(verse).trim();
        if (!text) continue;
        
        // Handle verse ranges (e.g., "Gen.1.1-Gen.1.3")
        let verseEnd = null;
        if (osisID.includes('-')) {
          const [start, end] = osisID.split('-');
          const endRef = parseOsisID(end);
          if (endRef && endRef.verse > ref.verse) {
            verseEnd = endRef.verse;
          }
        }
        
        entries.push({
          book: ref.book,
          chapter: ref.chapter,
          verse_start: ref.verse,
          verse_end: verseEnd,
          author: metadata.author,
          title: metadata.title,
          text: cleanText(text),
          source: metadata.source,
          year: metadata.year
        });
      }
    }
    
    // Recurse through other elements
    for (const key in node) {
      if (key !== '$' && key !== 'verse' && key !== 'div' && Array.isArray(node[key])) {
        for (const child of node[key]) {
          findVerses(child, bookContext, chapterContext);
        }
      }
    }
  }
  
  findVerses(osisText);
  
  console.log(`  Found ${entries.length} entries`);
  return entries;
}

/**
 * Clean text: remove excess whitespace, HTML tags, footnotes
 */
function cleanText(text) {
  return text
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/\[\d+\]/g, '') // Remove footnote markers [1]
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/**
 * Main parser
 */
async function main() {
  console.log('Commentary Parser - Starting...\n');
  
  if (!existsSync(SOURCES_DIR)) {
    console.error(`Sources directory not found: ${SOURCES_DIR}`);
    console.log('\nPlease download commentary sources first. See data-sources/commentaries/README.md');
    process.exit(1);
  }
  
  const allEntries = [];
  let totalSize = 0;
  
  // Find all subdirectories in raw/
  const subdirs = readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  if (subdirs.length === 0) {
    console.warn('No commentary source directories found.');
    console.log('\nExpected structure:');
    console.log('  data-sources/commentaries/raw/matthew-henry/MHC.osis.xml');
    console.log('  data-sources/commentaries/raw/jfb/JFB.osis.xml');
    console.log('\nSee README.md for download instructions.');
    process.exit(1);
  }
  
  for (const subdir of subdirs) {
    const subdirPath = join(SOURCES_DIR, subdir);
    const files = readdirSync(subdirPath);
    
    for (const file of files) {
      const filePath = join(subdirPath, file);
      const ext = file.split('.').pop().toLowerCase();
      
      // Determine commentary ID from filename
      const commentaryId = file.split('.')[0]; // e.g., "MHC" from "MHC.osis.xml"
      
      if (ext === 'xml' || file.includes('.osis.')) {
        // OSIS XML format
        try {
          const entries = await parseOSISCommentary(filePath, commentaryId);
          allEntries.push(...entries);
          
          const fileSize = statSync(filePath).size;
          totalSize += fileSize;
          console.log(`  Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB\n`);
        } catch (error) {
          console.error(`Error parsing ${file}:`, error.message);
        }
      } else if (ext === 'pdf') {
        console.log(`Skipping PDF (not yet implemented): ${file}`);
      } else if (ext === 'html' || ext === 'htm') {
        console.log(`Skipping HTML (not yet implemented): ${file}`);
      }
    }
  }
  
  // Write NDJSON output
  console.log(`\nWriting ${allEntries.length} entries to ${OUTPUT_FILE}`);
  
  const ndjson = allEntries.map(entry => JSON.stringify(entry)).join('\n');
  writeFileSync(OUTPUT_FILE, ndjson, 'utf-8');
  
  // Statistics
  console.log('\n=== Parsing Complete ===');
  console.log(`Total entries: ${allEntries.length.toLocaleString()}`);
  console.log(`Total source size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Output file: ${OUTPUT_FILE}`);
  console.log(`Output size: ${(Buffer.byteLength(ndjson, 'utf-8') / 1024 / 1024).toFixed(2)} MB`);
  
  // Coverage by author
  const byAuthor = {};
  for (const entry of allEntries) {
    byAuthor[entry.author] = (byAuthor[entry.author] || 0) + 1;
  }
  
  console.log('\nEntries by author:');
  for (const [author, count] of Object.entries(byAuthor).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${author}: ${count.toLocaleString()}`);
  }
  
  // Coverage by book (top 10)
  const byBook = {};
  for (const entry of allEntries) {
    byBook[entry.book] = (byBook[entry.book] || 0) + 1;
  }
  
  console.log('\nTop 10 books by entries:');
  Object.entries(byBook)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([book, count]) => {
      console.log(`  ${book}: ${count.toLocaleString()}`);
    });
  
  console.log('\n✅ Ready for pack building');
  console.log('Next: node scripts/build-commentary-pack.mjs\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
