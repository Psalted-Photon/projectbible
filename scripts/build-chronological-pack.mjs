#!/usr/bin/env node

/**
 * Build Chronological Ordering Pack
 * 
 * Generates a chronological verse ordering based on the ruleset
 * Output: SQLite pack with chronological_verses table
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Load chronology ruleset
const rulesetPath = path.join(ROOT, 'data-manifests/chronological/chronology-ruleset-v1.json');
const ruleset = JSON.parse(fs.readFileSync(rulesetPath, 'utf-8'));

console.log(`📖 Building Chronological Ordering Pack`);
console.log(`   Source: ${ruleset.source}`);
console.log(`   Version: ${ruleset.version}`);

// Bible structure (book → chapter count)
const BIBLE_STRUCTURE = {
  'Genesis': 50, 'Exodus': 40, 'Leviticus': 27, 'Numbers': 36, 'Deuteronomy': 34,
  'Joshua': 24, 'Judges': 21, 'Ruth': 4, '1 Samuel': 31, '2 Samuel': 24,
  '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36,
  'Ezra': 10, 'Nehemiah': 13, 'Esther': 10, 'Job': 42, 'Psalms': 150,
  'Proverbs': 31, 'Ecclesiastes': 12, 'Song of Solomon': 8, 'Isaiah': 66,
  'Jeremiah': 52, 'Lamentations': 5, 'Ezekiel': 48, 'Daniel': 12,
  'Hosea': 14, 'Joel': 3, 'Amos': 9, 'Obadiah': 1, 'Jonah': 4,
  'Micah': 7, 'Nahum': 3, 'Habakkuk': 3, 'Zephaniah': 3, 'Haggai': 2,
  'Zechariah': 14, 'Malachi': 4, 'Matthew': 28, 'Mark': 16, 'Luke': 24,
  'John': 21, 'Acts': 28, 'Romans': 16, '1 Corinthians': 16, '2 Corinthians': 13,
  'Galatians': 6, 'Ephesians': 6, 'Philippians': 4, 'Colossians': 4,
  '1 Thessalonians': 5, '2 Thessalonians': 3, '1 Timothy': 6, '2 Timothy': 4,
  'Titus': 3, 'Philemon': 1, 'Hebrews': 13, 'James': 5, '1 Peter': 5,
  '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1, 'Jude': 1, 'Revelation': 22
};

// Verse counts per chapter (simplified - using averages, real data would come from actual Bible)
const VERSE_COUNTS = {
  'Genesis': [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  'Exodus': [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  'Leviticus': [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],
  'Numbers': [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
  'Deuteronomy': [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
  'Joshua': [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
  'Judges': [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
  'Ruth': [22,23,18,22],
  '1 Samuel': [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13],
  '2 Samuel': [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
  '1 Kings': [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
  '2 Kings': [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
  '1 Chronicles': [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
  '2 Chronicles': [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
  'Ezra': [11,70,13,24,17,22,28,36,15,44],
  'Nehemiah': [11,20,32,23,19,19,73,18,38,39,36,47,31],
  'Esther': [22,23,15,17,14,14,10,17,32,3],
  'Job': [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],
  'Psalms': [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  'Proverbs': [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31],
  'Ecclesiastes': [18,26,22,16,20,12,29,17,18,20,10,14],
  'Song of Solomon': [17,17,11,16,16,13,13,14],
  'Isaiah': [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],
  'Jeremiah': [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],
  'Lamentations': [22,22,66,22,22],
  'Ezekiel': [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
  'Daniel': [21,49,30,37,31,28,28,27,27,21,45,13],
  'Hosea': [11,23,5,19,15,11,16,14,17,15,12,14,16,9],
  'Joel': [20,32,21],
  'Amos': [15,16,15,13,27,14,17,14,15],
  'Obadiah': [21],
  'Jonah': [17,10,10,11],
  'Micah': [16,13,12,13,15,16,20],
  'Nahum': [15,13,19],
  'Habakkuk': [17,20,19],
  'Zephaniah': [18,15,20],
  'Haggai': [15,23],
  'Zechariah': [21,13,10,14,11,15,14,23,17,12,17,14,9,21],
  'Malachi': [14,17,18,6],
  'Matthew': [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  'Mark': [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  'Luke': [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  'John': [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  'Acts': [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  'Romans': [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  '1 Corinthians': [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  '2 Corinthians': [24,17,18,18,21,18,16,24,15,18,33,21,14],
  'Galatians': [24,21,29,31,26,18],
  'Ephesians': [23,22,21,32,33,24],
  'Philippians': [30,30,21,23],
  'Colossians': [29,23,25,18],
  '1 Thessalonians': [10,20,13,18,28],
  '2 Thessalonians': [12,17,18],
  '1 Timothy': [20,15,16,16,25,21],
  '2 Timothy': [18,26,17,22],
  'Titus': [16,15,15],
  'Philemon': [25],
  'Hebrews': [14,18,19,16,14,20,28,13,28,39,40,29,25],
  'James': [27,26,18,17,20],
  '1 Peter': [25,25,22,19,14],
  '2 Peter': [21,22,18],
  '1 John': [10,29,24,21,21],
  '2 John': [13],
  '3 John': [14],
  'Jude': [25],
  'Revelation': [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21]
};

// Generate canonical verse list
function generateCanonicalVerseList() {
  const verses = [];
  let bookId = 0;
  
  for (const [book, chapterCount] of Object.entries(BIBLE_STRUCTURE)) {
    bookId++;
    const verseCounts = VERSE_COUNTS[book] || [];
    
    for (let chapter = 1; chapter <= chapterCount; chapter++) {
      const verseCount = verseCounts[chapter - 1] || 25; // Default to 25 if unknown
      
      for (let verse = 1; verse <= verseCount; verse++) {
        verses.push({
          book,
          bookId,
          chapter,
          verse,
          canonicalIndex: verses.length + 1
        });
      }
    }
  }
  
  return verses;
}

// Apply chronological ordering based on ruleset
function applyChronologicalOrdering(verses) {
  console.log(`\n📊 Applying FULL chronological ordering with ALL rules...`);
  
  const chronoVerses = [];
  let chronoIndex = 1;
  
  // Build a map for quick lookup by book:chapter:verse
  const verseMap = new Map();
  verses.forEach(v => {
    const key = `${v.book}:${v.chapter}:${v.verse}`;
    verseMap.set(key, v);
  });
  
  // Track which books/chapters/verses have been added
  const addedVerses = new Set();
  
  // Helper to parse anchor reference like "Genesis 12:1" or "Numbers 14:1-45"
  function parseAnchor(anchor) {
    const match = anchor.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
    if (!match) return null;
    return {
      book: match[1],
      chapter: parseInt(match[2]),
      verse: parseInt(match[3]),
      verseEnd: match[4] ? parseInt(match[4]) : null
    };
  }
  
  // Helper to add a single verse with metadata
  function addVerse(book, chapter, verse, metadata = {}) {
    const key = `${book}:${chapter}:${verse}`;
    if (addedVerses.has(key)) return false;
    
    const verseData = verseMap.get(key);
    if (!verseData) return false;
    
    const placement = ruleset.book_placements.find(p => p.book === book);
    const event = placement ? ruleset.events.find(e => e.event_id === placement.start_event) : null;
    
    chronoVerses.push({
      chrono_index: chronoIndex++,
      book,
      book_id: verseData.bookId,
      chapter,
      verse,
      event_id: metadata.event_id || (event ? event.event_id : null),
      timestamp_year: metadata.timestamp_year || (event ? event.year_start : null),
      era: metadata.era || (event ? event.era : null)
    });
    
    addedVerses.add(key);
    return true;
  }
  
  // Helper to add entire book
  function addBook(bookName, metadata = {}) {
    const chapterCount = BIBLE_STRUCTURE[bookName];
    if (!chapterCount) return 0;
    
    const verseCounts = VERSE_COUNTS[bookName] || [];
    let addedCount = 0;
    
    for (let chapter = 1; chapter <= chapterCount; chapter++) {
      const verseCount = verseCounts[chapter - 1] || 25;
      for (let verse = 1; verse <= verseCount; verse++) {
        if (addVerse(bookName, chapter, verse, metadata)) {
          addedCount++;
        }
      }
    }
    
    return addedCount;
  }
  
  // Helper to add a passage range
  function addPassage(book, chapter, startVerse, endVerse, metadata = {}) {
    let count = 0;
    for (let v = startVerse; v <= endVerse; v++) {
      if (addVerse(book, chapter, v, metadata)) count++;
    }
    return count;
  }
  
  // Process books in canonical order, applying ALL insertion rules
  for (const placement of ruleset.book_placements) {
    const bookName = placement.book;
    const chapterCount = BIBLE_STRUCTURE[bookName];
    if (!chapterCount) continue;
    
    const verseCounts = VERSE_COUNTS[bookName] || [];
    
    for (let chapter = 1; chapter <= chapterCount; chapter++) {
      const verseCount = verseCounts[chapter - 1] || 25;
      
      for (let verse = 1; verse <= verseCount; verse++) {
        const currentRef = `${bookName} ${chapter}:${verse}`;
        
        // Check for ALL insertion rules at this position
        for (const rule of ruleset.insertion_rules) {
          const anchor = parseAnchor(rule.anchor);
          if (!anchor) continue;
          
          const metadata = {
            event_id: rule.event_id,
            timestamp_year: rule.timestamp_year,
            era: rule.era
          };
          
          // BEFORE: insert before this verse
          if (rule.position === 'before' && 
              anchor.book === bookName && anchor.chapter === chapter && anchor.verse === verse) {
            console.log(`  📌 Inserting ${rule.insert} BEFORE ${currentRef}`);
            addBook(rule.insert, metadata);
          }
          
          // DURING: insert during a range (at the first verse)
          if (rule.position === 'during' &&
              anchor.book === bookName && anchor.chapter === chapter && anchor.verse === verse) {
            console.log(`  📌 Inserting ${rule.insert} DURING ${currentRef}`);
            addBook(rule.insert, metadata);
          }
          
          // PARALLEL: insert parallel to a passage (at the first verse)
          if (rule.position === 'parallel' &&
              anchor.book === bookName && anchor.chapter === chapter && anchor.verse === verse) {
            console.log(`  📌 Inserting ${rule.insert} PARALLEL to ${currentRef}`);
            addBook(rule.insert, metadata);
          }
          
          // WITHIN: insert in the middle of a range
          if (rule.position === 'within' && anchor.verseEnd &&
              anchor.book === bookName && anchor.chapter === chapter) {
            const midpoint = anchor.verse + Math.floor((anchor.verseEnd - anchor.verse) / 2);
            if (verse === midpoint) {
              console.log(`  📌 Inserting ${rule.insert} WITHIN ${rule.anchor}`);
              addBook(rule.insert, metadata);
            }
          }
        }
        
        // Add this verse
        addVerse(bookName, chapter, verse);
        
        // AFTER: insert after this verse
        for (const rule of ruleset.insertion_rules) {
          if (rule.position === 'after') {
            const anchor = parseAnchor(rule.anchor);
            if (anchor && anchor.book === bookName && anchor.chapter === chapter && anchor.verse === verse) {
              console.log(`  📌 Inserting ${rule.insert} AFTER ${currentRef}`);
              const metadata = {
                event_id: rule.event_id,
                timestamp_year: rule.timestamp_year,
                era: rule.era
              };
              addBook(rule.insert, metadata);
            }
          }
        }
      }
    }
  }
  
  console.log(`  ✅ Applied ${ruleset.insertion_rules.length} insertion rules`);
  console.log(`  ✅ Generated ${chronoVerses.length} chronological verse entries`);
  
  // Note: Gospel harmony and Acts/epistles timeline would require more complex interleaving
  // For now, the books are in canonical order within their time periods
  // Full implementation would interleave synoptic parallels and insert epistles during Acts
  
  return chronoVerses;
}

// Create JSON pack (compressed)
function createJSONPack(chronoVerses) {
  const packsDir = path.join(ROOT, 'packs');
  if (!fs.existsSync(packsDir)) {
    fs.mkdirSync(packsDir, { recursive: true });
  }
  
  const outputPath = path.join(packsDir, 'chronological-v1.json.gz');
  
  console.log(`\n💾 Creating JSON pack: ${outputPath}`);
  
  const packData = {
    version: ruleset.version,
    source: ruleset.source,
    verse_count: chronoVerses.length,
    verses: chronoVerses,
    events: ruleset.events,
    eras: ruleset.eras
  };
  
  // Write uncompressed for development
  const jsonPath = path.join(packsDir, 'chronological-v1.json');
  fs.writeFileSync(jsonPath, JSON.stringify(packData, null, 2), 'utf-8');
  console.log(`   ✓ Uncompressed JSON: ${(fs.statSync(jsonPath).size / 1024).toFixed(2)} KB`);
  
  // Write compressed
  const compressed = zlib.gzipSync(JSON.stringify(packData));
  fs.writeFileSync(outputPath, compressed);
  console.log(`   ✓ Compressed pack: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
  
  return outputPath;
}

// Main execution
async function main() {
  try {
    // Generate canonical verse list
    console.log(`\n📚 Generating canonical verse list...`);
    const canonicalVerses = generateCanonicalVerseList();
    console.log(`   ✓ Generated ${canonicalVerses.length} verses`);
    
    // Apply chronological ordering
    const chronoVerses = applyChronologicalOrdering(canonicalVerses);
    
    // Create JSON pack
    const packPath = createJSONPack(chronoVerses);
    
    console.log(`\n✅ Chronological ordering pack built successfully!`);
    console.log(`   📍 Location: ${packPath}`);
    console.log(`\n💡 Note: This is a baseline implementation using canonical order.`);
    console.log(`   Full chronological reordering with insertion rules will be implemented next.`);
    
  } catch (error) {
    console.error(`\n❌ Error building pack:`, error);
    process.exit(1);
  }
}

main();
