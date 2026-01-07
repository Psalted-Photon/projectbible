/**
 * OSIS Cross-Reference Parser
 * Parses cross-references from OSIS XML Bible files
 */

import { parseStringPromise } from 'xml2js';
import fs from 'fs';
import path from 'path';

/**
 * Parse OSIS XML and extract cross-references
 * @param {string} osisFilePath - Path to OSIS XML file
 * @returns {Promise<Array>} Array of cross-reference objects
 */
export async function parseOSISCrossReferences(osisFilePath) {
  const xmlContent = fs.readFileSync(osisFilePath, 'utf-8');
  const result = await parseStringPromise(xmlContent);
  
  const crossRefs = [];
  
  // Navigate the OSIS structure
  const osisText = result.osis?.osisText?.[0];
  if (!osisText) {
    console.warn(`No osisText found in ${osisFilePath}`);
    return crossRefs;
  }
  
  const div = osisText.div?.[0];
  if (!div) {
    console.warn(`No div found in ${osisFilePath}`);
    return crossRefs;
  }
  
  // Process chapters
  const chapters = div.chapter || [];
  for (const chapter of chapters) {
    const chapterOsisID = chapter.$?.osisID;
    if (!chapterOsisID) continue;
    
    // Extract book and chapter from osisID (e.g., "Gen.1")
    const [book, chapterNum] = chapterOsisID.split('.');
    
    // Process verses
    const verses = chapter.verse || [];
    for (const verse of verses) {
      const verseOsisID = verse.$?.osisID;
      if (!verseOsisID) continue;
      
      // Extract verse number (e.g., "Gen.1.1" -> "1")
      const [_, __, verseNum] = verseOsisID.split('.');
      
      // Look for <note type="crossReference"> elements
      const notes = verse.note || [];
      for (const note of notes) {
        if (note.$?.type === 'crossReference') {
          // Extract cross-reference text
          const refElements = note.reference || [];
          for (const ref of refElements) {
            const targetRef = ref.$?.osisRef;
            if (targetRef) {
              // Parse target reference (e.g., "John.3.16")
              const targets = targetRef.split('-'); // Handle ranges
              for (const target of targets) {
                const [toBook, toChapter, toVerse] = target.split('.');
                
                crossRefs.push({
                  from_book: book,
                  from_chapter: parseInt(chapterNum),
                  from_verse: parseInt(verseNum),
                  to_book: toBook,
                  to_chapter: parseInt(toChapter),
                  to_verse_start: parseInt(toVerse),
                  to_verse_end: parseInt(toVerse), // Same as start if not a range
                  votes: 0,
                  source: 'osis'
                });
              }
            }
          }
        }
      }
    }
  }
  
  console.log(`Extracted ${crossRefs.length} cross-references from ${path.basename(osisFilePath)}`);
  return crossRefs;
}

/**
 * Convert book abbreviation from OSIS to standard format
 * @param {string} osisBook - OSIS book abbreviation
 * @returns {string} Standard book abbreviation
 */
function normalizeBookName(osisBook) {
  const bookMap = {
    'Gen': 'Genesis',
    'Exod': 'Exodus',
    'Lev': 'Leviticus',
    'Num': 'Numbers',
    'Deut': 'Deuteronomy',
    'Josh': 'Joshua',
    'Judg': 'Judges',
    'Ruth': 'Ruth',
    '1Sam': '1Samuel',
    '2Sam': '2Samuel',
    '1Kgs': '1Kings',
    '2Kgs': '2Kings',
    '1Chr': '1Chronicles',
    '2Chr': '2Chronicles',
    'Ezra': 'Ezra',
    'Neh': 'Nehemiah',
    'Esth': 'Esther',
    'Job': 'Job',
    'Ps': 'Psalms',
    'Prov': 'Proverbs',
    'Eccl': 'Ecclesiastes',
    'Song': 'SongOfSolomon',
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
    'Matt': 'Matthew',
    'Mark': 'Mark',
    'Luke': 'Luke',
    'John': 'John',
    'Acts': 'Acts',
    'Rom': 'Romans',
    '1Cor': '1Corinthians',
    '2Cor': '2Corinthians',
    'Gal': 'Galatians',
    'Eph': 'Ephesians',
    'Phil': 'Philippians',
    'Col': 'Colossians',
    '1Thess': '1Thessalonians',
    '2Thess': '2Thessalonians',
    '1Tim': '1Timothy',
    '2Tim': '2Timothy',
    'Titus': 'Titus',
    'Phlm': 'Philemon',
    'Heb': 'Hebrews',
    'Jas': 'James',
    '1Pet': '1Peter',
    '2Pet': '2Peter',
    '1John': '1John',
    '2John': '2John',
    '3John': '3John',
    'Jude': 'Jude',
    'Rev': 'Revelation'
  };
  
  return bookMap[osisBook] || osisBook;
}

/**
 * Parse all OSIS files in a directory and combine cross-references
 * @param {string} dirPath - Directory containing OSIS XML files
 * @returns {Promise<Array>} Combined array of all cross-references
 */
export async function parseOSISDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);
  const osisFiles = files.filter(f => f.endsWith('.xml'));
  
  console.log(`Found ${osisFiles.length} OSIS XML files`);
  
  const allCrossRefs = [];
  for (const file of osisFiles) {
    const filePath = path.join(dirPath, file);
    try {
      const refs = await parseOSISCrossReferences(filePath);
      allCrossRefs.push(...refs);
    } catch (error) {
      console.error(`Error parsing ${file}:`, error.message);
    }
  }
  
  console.log(`Total cross-references extracted: ${allCrossRefs.length}`);
  return allCrossRefs;
}

/**
 * Export cross-references to TSV format
 * @param {Array} crossRefs - Array of cross-reference objects
 * @param {string} outputPath - Output TSV file path
 */
export function exportToTSV(crossRefs, outputPath) {
  const header = 'from_book\tfrom_chapter\tfrom_verse\tto_book\tto_chapter\tto_verse_start\tto_verse_end\tvotes\tsource\n';
  const rows = crossRefs.map(ref => 
    `${ref.from_book}\t${ref.from_chapter}\t${ref.from_verse}\t${ref.to_book}\t${ref.to_chapter}\t${ref.to_verse_start}\t${ref.to_verse_end}\t${ref.votes}\t${ref.source}`
  ).join('\n');
  
  fs.writeFileSync(outputPath, header + rows, 'utf-8');
  console.log(`Exported ${crossRefs.length} cross-references to ${outputPath}`);
}
