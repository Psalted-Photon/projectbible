#!/usr/bin/env node

/**
 * Download and Process CCAT Septuagint (LXX)
 * 
 * Downloads the Greek Septuagint text from CCAT and processes it
 * into a JSON format suitable for the ProjectBible pack system.
 * 
 * Source: http://ccat.sas.upenn.edu/gopher/text/religion/biblical/lxxmorph/
 * License: CCAT - Free for non-commercial use
 * 
 * Usage:
 *   node scripts/download-lxx.mjs [--force]
 * 
 * This script will:
 * 1. Download CCAT LXX morphology files (if not already downloaded)
 * 2. Parse the morphological codes and Greek text
 * 3. Convert to JSON format matching our pack structure
 * 4. Save as data-sources/LXX-Greek.json (actual Greek, not French)
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const DOWNLOAD_DIR = join(repoRoot, 'data-sources/catss-lxx');
const OUTPUT_FILE = join(repoRoot, 'data-sources/LXX-Greek.json');

// CCAT LXX files (morphologically analyzed Greek text)
const CCAT_BASE_URL = 'http://ccat.sas.upenn.edu/gopher/text/religion/biblical/lxxmorph/';

// Books in CCAT LXX collection
const LXX_BOOKS = [
  { file: '01.Gen', name: 'Genesis' },
  { file: '02.Exod', name: 'Exodus' },
  { file: '03.Lev', name: 'Leviticus' },
  { file: '04.Num', name: 'Numbers' },
  { file: '05.Deut', name: 'Deuteronomy' },
  { file: '06.Josh', name: 'Joshua' },
  { file: '07.Judg', name: 'Judges' },
  { file: '08.Ruth', name: 'Ruth' },
  { file: '09.1Sam', name: '1 Samuel' },
  { file: '10.2Sam', name: '2 Samuel' },
  { file: '11.1Kgs', name: '1 Kings' },
  { file: '12.2Kgs', name: '2 Kings' },
  { file: '13.1Chr', name: '1 Chronicles' },
  { file: '14.2Chr', name: '2 Chronicles' },
  { file: '15.Esra', name: 'Ezra' },
  { file: '16.Neh', name: 'Nehemiah' },
  { file: '17.Esth', name: 'Esther' },
  { file: '18.Job', name: 'Job' },
  { file: '19.Ps', name: 'Psalms' },
  { file: '20.Prov', name: 'Proverbs' },
  { file: '21.Eccl', name: 'Ecclesiastes' },
  { file: '22.Song', name: 'Song of Solomon' },
  { file: '23.Isa', name: 'Isaiah' },
  { file: '24.Jer', name: 'Jeremiah' },
  { file: '25.Lam', name: 'Lamentations' },
  { file: '26.Ezek', name: 'Ezekiel' },
  { file: '27.Dan', name: 'Daniel' },
  { file: '28.Hos', name: 'Hosea' },
  { file: '29.Joel', name: 'Joel' },
  { file: '30.Amos', name: 'Amos' },
  { file: '31.Obad', name: 'Obadiah' },
  { file: '32.Jonah', name: 'Jonah' },
  { file: '33.Mic', name: 'Micah' },
  { file: '34.Nah', name: 'Nahum' },
  { file: '35.Hab', name: 'Habakkuk' },
  { file: '36.Zeph', name: 'Zephaniah' },
  { file: '37.Hag', name: 'Haggai' },
  { file: '38.Zech', name: 'Zechariah' },
  { file: '39.Mal', name: 'Malachi' }
];

async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const fileStream = createWriteStream(destPath);
  await finished(Readable.fromWeb(response.body).pipe(fileStream));
}

/**
 * Parse CCAT LXX morphology file format
 * 
 * Example line:
 * Gen  1:1   {Εν                    N-----DSFA εν                     e)n
 * 
 * Format: BOOK CHAPTER:VERSE {WORD MORPHOLOGY LEMMA TRANSLITERATION}
 */
function parseCCATLine(line) {
  // Skip empty lines and comments
  if (!line.trim() || line.startsWith('#')) return null;
  
  // Match: BOOK CHAPTER:VERSE {GREEK_WORD ...}
  const match = line.match(/^(\S+)\s+(\d+):(\d+)\s+\{([^\s]+)/);
  if (!match) return null;
  
  const [, , chapter, verse, greekWord] = match;
  
  return {
    chapter: parseInt(chapter, 10),
    verse: parseInt(verse, 10),
    word: greekWord
  };
}

function parseCCATBook(filePath, bookName) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const chapters = new Map();
  
  for (const line of lines) {
    const parsed = parseCCATLine(line);
    if (!parsed) continue;
    
    const { chapter, verse, word } = parsed;
    
    if (!chapters.has(chapter)) {
      chapters.set(chapter, new Map());
    }
    
    const chapterData = chapters.get(chapter);
    if (!chapterData.has(verse)) {
      chapterData.set(verse, []);
    }
    
    chapterData.get(verse).push(word);
  }
  
  // Convert to output format
  const result = [];
  for (const [chapterNum, verses] of chapters) {
    const verseArray = [];
    for (const [verseNum, words] of verses) {
      verseArray.push({
        verse: verseNum,
        text: words.join(' ')
      });
    }
    result.push({
      chapter: chapterNum,
      verses: verseArray.sort((a, b) => a.verse - b.verse)
    });
  }
  
  return result.sort((a, b) => a.chapter - b.chapter);
}

async function downloadAndProcessLXX() {
  console.log('📥 Downloading CCAT Septuagint (LXX)...\n');
  console.log('⚠️  NOTE: CCAT requires registration and has usage restrictions.');
  console.log('   For now, we\'ll use the OpenScriptures LXX lemma data to');
  console.log('   reconstruct the Greek text.\n');
  
  // Ensure download directory exists
  if (!existsSync(DOWNLOAD_DIR)) {
    mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
  
  console.log('🔄 Using OpenScriptures LXX lemma files instead...');
  console.log('   These files contain lemmas but not inflected forms.');
  console.log('   For a production build, you would need the actual CCAT files.\n');
  
  // For now, let's use the lemma data we have
  const lemmaDir = join(repoRoot, 'data-sources/open-scriptures-lxx/GreekResources-master/LxxLemmas');
  
  if (!existsSync(lemmaDir)) {
    console.error('❌ OpenScriptures LXX lemma files not found.');
    console.error('   Expected at:', lemmaDir);
    process.exit(1);
  }
  
  const output = {
    translation: 'Septuagint (LXX) - Greek Old Testament',
    source: 'Reconstructed from OpenScriptures LXX lemma data',
    license: 'CC BY 4.0 - Open Scriptures LXX Project',
    note: 'This uses lemmas (dictionary forms). For inflected text, download CCAT LXX.',
    books: []
  };
  
  // Map OpenScriptures book files to our book names
  const bookMap = {
    'Gen.js': 'Genesis',
    'Exod.js': 'Exodus',
    'Lev.js': 'Leviticus',
    'Num.js': 'Numbers',
    'Deut.js': 'Deuteronomy',
    'JoshA.js': 'Joshua',
    'JudgA.js': 'Judges',
    'Ruth.js': 'Ruth',
    '1Sam.js': '1 Samuel',
    '2Sam.js': '2 Samuel',
    '1Kgs.js': '1 Kings',
    '2Kgs.js': '2 Kings',
    '1Chr.js': '1 Chronicles',
    '2Chr.js': '2 Chronicles',
    '2Esd.js': 'Ezra', // 2 Esdras = Ezra-Nehemiah
    'Esth.js': 'Esther',
    'Job.js': 'Job',
    'Ps.js': 'Psalms',
    'Prov.js': 'Proverbs',
    'Eccl.js': 'Ecclesiastes',
    'Song.js': 'Song of Solomon',
    'Isa.js': 'Isaiah',
    'Jer.js': 'Jeremiah',
    'Lam.js': 'Lamentations',
    'Ezek.js': 'Ezekiel',
    'DanTh.js': 'Daniel', // Theodotion version
    'Hos.js': 'Hosea',
    'Joel.js': 'Joel',
    'Amos.js': 'Amos',
    'Obad.js': 'Obadiah',
    'Jonah.js': 'Jonah',
    'Mic.js': 'Micah',
    'Nah.js': 'Nahum',
    'Hab.js': 'Habakkuk',
    'Zeph.js': 'Zephaniah',
    'Hag.js': 'Haggai',
    'Zech.js': 'Zechariah',
    'Mal.js': 'Malachi'
  };
  
  console.log('📖 Processing books...\n');
  
  for (const [file, bookName] of Object.entries(bookMap)) {
    const filePath = join(lemmaDir, file);
    
    if (!existsSync(filePath)) {
      console.log(`  ⚠️  ${bookName} - file not found (${file})`);
      continue;
    }
    
    try {
      // Read the JavaScript file and parse it
      const content = readFileSync(filePath, 'utf-8');
      
      // Extract the JSON (file starts with "{" and is valid JSON)
      const jsonMatch = content.match(/\{[\s\S]+\}/);
      if (!jsonMatch) {
        console.log(`  ⚠️  ${bookName} - invalid format`);
        continue;
      }
      
      const data = JSON.parse(jsonMatch[0]);
      const chapters = new Map();
      
      // Process each verse
      for (const [ref, words] of Object.entries(data)) {
        // ref format: "Gen.1.1"
        const parts = ref.split('.');
        if (parts.length < 3) continue;
        
        const chapter = parseInt(parts[1], 10);
        const verse = parseInt(parts[2], 10);
        
        if (!chapters.has(chapter)) {
          chapters.set(chapter, new Map());
        }
        
        // Join the lemmas to form the verse text
        const text = words.map(w => w.lemma).join(' ');
        chapters.get(chapter).set(verse, text);
      }
      
      // Convert to output format
      const bookChapters = [];
      for (const [chapterNum, verses] of [...chapters].sort((a, b) => a[0] - b[0])) {
        const verseArray = [];
        for (const [verseNum, text] of [...verses].sort((a, b) => a[0] - b[0])) {
          verseArray.push({
            verse: verseNum,
            text: text
          });
        }
        bookChapters.push({
          chapter: chapterNum,
          verses: verseArray
        });
      }
      
      output.books.push({
        name: bookName,
        chapters: bookChapters
      });
      
      const verseCount = [...chapters.values()].reduce((sum, v) => sum + v.size, 0);
      console.log(`  ✅ ${bookName} - ${chapters.size} chapters, ${verseCount} verses`);
      
    } catch (error) {
      console.log(`  ❌ ${bookName} - error: ${error.message}`);
    }
  }
  
  // Write output
  console.log('\n💾 Writing to', OUTPUT_FILE);
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  
  const bookCount = output.books.length;
  const chapterCount = output.books.reduce((sum, b) => sum + b.chapters.length, 0);
  const verseCount = output.books.reduce((sum, b) => 
    sum + b.chapters.reduce((s, c) => s + c.verses.length, 0), 0
  );
  
  console.log('\n✅ LXX processing complete!');
  console.log(`   Books: ${bookCount}`);
  console.log(`   Chapters: ${chapterCount}`);
  console.log(`   Verses: ${verseCount}`);
  console.log('\n💡 Note: This uses lemmas (dictionary forms) from OpenScriptures.');
  console.log('   For fully inflected Greek text, acquire CCAT LXX morphology files.');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadAndProcessLXX().catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
}

export { downloadAndProcessLXX };
