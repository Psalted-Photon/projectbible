/**
 * Parse TSK OSIS XML → flat cross-reference pairs (NDJSON)
 *
 * Source: data-sources/commentaries/osis/tsk.osis.xml
 * Output: data/processed/tsk-full.ndjson
 *
 * Each output line:
 *   {"fromBook":"Genesis","fromChapter":1,"fromVerse":1,"toBook":"John","toChapter":1,"toVerseStart":1,"toVerseEnd":null}
 *
 * The OSIS file uses two completely separate abbreviation systems:
 *   1. OSIS verse osisID codes (Gen, 1Kgs, Ps, Matt...) — for tracking which verse is being annotated
 *   2. TSK KJV-style abbreviations inside <scripRef> text (Ge, 1Ki, Ps, Mt...) — for the references themselves
 */

import { createReadStream, createWriteStream, mkdirSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INPUT_FILE = join(__dirname, '../data-sources/commentaries/osis/tsk.osis.xml');
const OUTPUT_FILE = join(__dirname, '../data/processed/tsk-full.ndjson');
const PROCESSED_DIR = join(__dirname, '../data/processed');

// ---------------------------------------------------------------------------
// Map 1: OSIS verse osisID book codes → canonical display names
// These are the codes used in <verse osisID="Gen.1.1">, <verse osisID="1Kgs.4.33">
// ---------------------------------------------------------------------------
const OSIS_BOOK = {
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
};

// ---------------------------------------------------------------------------
// Map 2: TSK KJV-style abbreviations inside <scripRef> text → canonical display names
// These are the abbreviated codes like "1Ki", "Ge", "Ps", "Mr" used in the reference strings
// ---------------------------------------------------------------------------
const TSK_ABBR = {
  'Ge': 'Genesis',
  'Ex': 'Exodus',
  'Le': 'Leviticus',
  'Nu': 'Numbers',
  'De': 'Deuteronomy',
  'Jos': 'Joshua',
  'Jud': 'Judges',
  'Ru': 'Ruth',
  '1Sa': '1 Samuel',
  '2Sa': '2 Samuel',
  '1Ki': '1 Kings',
  '2Ki': '2 Kings',
  '1Ch': '1 Chronicles',
  '2Ch': '2 Chronicles',
  'Ezr': 'Ezra',
  'Ne': 'Nehemiah',
  'Es': 'Esther',
  'Job': 'Job',
  'Ps': 'Psalms',
  'Pr': 'Proverbs',
  'Ec': 'Ecclesiastes',
  'So': 'Song of Solomon',
  'Isa': 'Isaiah',
  'Jer': 'Jeremiah',
  'La': 'Lamentations',
  'Eze': 'Ezekiel',
  'Da': 'Daniel',
  'Ho': 'Hosea',
  'Joe': 'Joel',
  'Am': 'Amos',
  'Ob': 'Obadiah',
  'Jon': 'Jonah',
  'Mic': 'Micah',
  'Na': 'Nahum',
  'Hab': 'Habakkuk',
  'Zep': 'Zephaniah',
  'Hag': 'Haggai',
  'Zec': 'Zechariah',
  'Mal': 'Malachi',
  'Mt': 'Matthew',
  'Mr': 'Mark',
  'Lu': 'Luke',
  'Joh': 'John',
  'Ac': 'Acts',
  'Ro': 'Romans',
  '1Co': '1 Corinthians',
  '2Co': '2 Corinthians',
  'Ga': 'Galatians',
  'Eph': 'Ephesians',
  'Php': 'Philippians',
  'Col': 'Colossians',
  '1Th': '1 Thessalonians',
  '2Th': '2 Thessalonians',
  '1Ti': '1 Timothy',
  '2Ti': '2 Timothy',
  'Tit': 'Titus',
  'Phm': 'Philemon',
  'Heb': 'Hebrews',
  'Jas': 'James',
  '1Pe': '1 Peter',
  '2Pe': '2 Peter',
  '1Jo': '1 John',
  '2Jo': '2 John',
  '3Jo': '3 John',
  'Jude': 'Jude',
  'Re': 'Revelation',
};

// ---------------------------------------------------------------------------
// Reference string parser
// ---------------------------------------------------------------------------

/**
 * Parse verse spec like "22", "22-24", "22,24", "22,24-26"
 * All parts resolved against the given book and chapter.
 * Returns array of {book, chapter, verseStart, verseEnd}
 */
function parseVerseSpec(spec, book, chapter) {
  const results = [];
  const parts = spec.split(',');
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    const dashIdx = part.indexOf('-');
    if (dashIdx > 0) {
      const vs = parseInt(part.slice(0, dashIdx), 10);
      const ve = parseInt(part.slice(dashIdx + 1), 10);
      if (!isNaN(vs) && !isNaN(ve) && vs > 0 && ve >= vs) {
        results.push({ book, chapter, verseStart: vs, verseEnd: ve });
      }
    } else {
      const vs = parseInt(part, 10);
      if (!isNaN(vs) && vs > 0) {
        results.push({ book, chapter, verseStart: vs, verseEnd: null });
      }
    }
  }
  return results;
}

/**
 * Parse location spec like "8:22-24", "8:22", "8:22,24", or bare verse spec.
 * Returns array of {book, chapter, verseStart, verseEnd}
 */
function parseLocationSpec(spec, book, fallbackChapter) {
  const colonIdx = spec.indexOf(':');
  if (colonIdx === -1) {
    // No colon — treat as bare verse spec in current chapter
    return parseVerseSpec(spec, book, fallbackChapter);
  }
  const chapter = parseInt(spec.slice(0, colonIdx), 10);
  if (isNaN(chapter) || chapter <= 0) return [];
  const versePart = spec.slice(colonIdx + 1).trim();
  return parseVerseSpec(versePart, book, chapter);
}

/**
 * Parse a full <scripRef> content string like:
 *   "Pr 8:22-24; 16:4; Mr 13:19; Joh 1:1-3; Heb 1:10; 1Jo 1:1"
 *   "2Sa 5:4; 1Ch 23:1; 29:27,28; Ps 90:10"
 *   "8,19; 2Sa 12:1-15"
 *   "2:17-25"
 *   "10,12,18,25,31; Ec 2:13; 11:7"
 *
 * Context (fromBook, fromChapter) is used as default when a token has no book prefix.
 * Running book/chapter context updates across semicolon-separated tokens within one scripRef.
 *
 * Returns array of {book, chapter, verseStart, verseEnd}
 */
function parseScripRef(refStr, fromBook, fromChapter) {
  const results = [];
  let curBook = fromBook;
  let curChapter = fromChapter;

  const tokens = refStr.split(';').map(t => t.trim()).filter(t => t.length > 0);

  for (const token of tokens) {
    // Try to match a book abbreviation at the start: "1Ki 4:33", "So 2:1", "Jude 14"
    // Abbreviations are 1–4 alphanum chars followed by a space
    const bookMatch = token.match(/^([A-Za-z0-9]{1,4})\s+(.+)$/);
    if (bookMatch && TSK_ABBR[bookMatch[1]]) {
      // Token starts with a recognized book abbreviation
      curBook = TSK_ABBR[bookMatch[1]];
      const loc = bookMatch[2].trim();
      const refs = parseLocationSpec(loc, curBook, curChapter);
      if (refs.length > 0) {
        curChapter = refs[refs.length - 1].chapter;
      }
      results.push(...refs);
    } else if (/^\d+:/.test(token)) {
      // Chapter:verse format with no book — same book, new chapter
      // e.g., "29:27,28" → same book, chapter 29
      const refs = parseLocationSpec(token, curBook, curChapter);
      if (refs.length > 0) {
        curChapter = refs[refs.length - 1].chapter;
      }
      results.push(...refs);
    } else if (/^[\d,\- ]+$/.test(token)) {
      // Only digits, commas, dashes, spaces — bare verse numbers in current chapter
      // e.g., "8,19" or "10,12,18,25,31" or "22-24"
      results.push(...parseVerseSpec(token, curBook, curChapter));
    }
    // else: annotation text, "*marg:", Hebrew notes, etc. — silently skip
  }

  return results;
}

// ---------------------------------------------------------------------------
// Verse processor
// ---------------------------------------------------------------------------

let totalPairs = 0;
let totalVerses = 0;
const bookStats = {};
const unknownOsisIds = new Set();

/** @type {import('fs').WriteStream} */
let out;

function processVerse(osisId, content) {
  // Parse osisId: "Gen.1.1" or "1Kgs.4.33"
  const dotIdx1 = osisId.indexOf('.');
  if (dotIdx1 === -1) return;
  const dotIdx2 = osisId.indexOf('.', dotIdx1 + 1);
  if (dotIdx2 === -1) return;

  const osisBookId = osisId.slice(0, dotIdx1);
  const fromChapter = parseInt(osisId.slice(dotIdx1 + 1, dotIdx2), 10);
  const fromVerse = parseInt(osisId.slice(dotIdx2 + 1), 10);

  const fromBook = OSIS_BOOK[osisBookId];
  if (!fromBook) {
    unknownOsisIds.add(osisBookId);
    return;
  }
  if (isNaN(fromChapter) || isNaN(fromVerse)) return;

  totalVerses++;
  let versePairs = 0;

  // Match bare <scripRef> elements (no passage= attribute)
  // <scripRef passage="..."> are chapter-outline anchors and must be skipped
  const scripRefRe = /<scripRef>([^<]+)<\/scripRef>/g;
  let match;

  while ((match = scripRefRe.exec(content)) !== null) {
    const refStr = match[1].trim();
    const refs = parseScripRef(refStr, fromBook, fromChapter);

    for (const ref of refs) {
      // Skip exact self-references (verse pointing to itself)
      if (
        ref.book === fromBook &&
        ref.chapter === fromChapter &&
        ref.verseStart === fromVerse &&
        ref.verseEnd === null
      ) {
        continue;
      }

      out.write(
        JSON.stringify({
          fromBook,
          fromChapter,
          fromVerse,
          toBook: ref.book,
          toChapter: ref.chapter,
          toVerseStart: ref.verseStart,
          toVerseEnd: ref.verseEnd,
        }) + '\n'
      );
      versePairs++;
    }
  }

  totalPairs += versePairs;
  bookStats[fromBook] = (bookStats[fromBook] || 0) + versePairs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(PROCESSED_DIR)) {
    mkdirSync(PROCESSED_DIR, { recursive: true });
  }

  console.log('Parsing TSK OSIS XML → cross-reference pairs...');
  console.log(`Input:  ${INPUT_FILE}`);
  console.log(`Output: ${OUTPUT_FILE}\n`);

  out = createWriteStream(OUTPUT_FILE, { encoding: 'utf-8' });

  const rl = createInterface({
    input: createReadStream(INPUT_FILE, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let linesRead = 0;
  let inVerse = false;
  let verseOsisId = null;
  let verseContent = '';
  let lastBookReport = '';

  for await (const line of rl) {
    linesRead++;
    const trimmed = line.trim();

    if (!inVerse) {
      const openMatch = trimmed.match(/<verse\s+osisID="([^"]+)"/);
      if (openMatch) {
        inVerse = true;
        verseOsisId = openMatch[1];
        verseContent = trimmed;

        // Progress reporting when book changes
        const bookPart = verseOsisId.split('.')[0];
        if (bookPart !== lastBookReport) {
          const displayName = OSIS_BOOK[bookPart] || bookPart;
          process.stdout.write(`\rProcessing: ${displayName.padEnd(25)} (line ${linesRead.toLocaleString()})...`);
          lastBookReport = bookPart;
        }

        // Handle single-line verse (most common in TSK)
        if (trimmed.includes('</verse>')) {
          processVerse(verseOsisId, verseContent);
          inVerse = false;
          verseOsisId = null;
          verseContent = '';
        }
      }
    } else {
      // Accumulate multi-line verse content
      verseContent += ' ' + trimmed;
      if (trimmed.includes('</verse>')) {
        processVerse(verseOsisId, verseContent);
        inVerse = false;
        verseOsisId = null;
        verseContent = '';
      }
    }
  }

  await new Promise((resolve) => out.end(resolve));

  console.log(`\n\nDone!`);
  console.log(`  Lines read:        ${linesRead.toLocaleString()}`);
  console.log(`  Verses processed:  ${totalVerses.toLocaleString()}`);
  console.log(`  Total pairs:       ${totalPairs.toLocaleString()}`);

  if (unknownOsisIds.size > 0) {
    console.warn(`\nWARNING: Unknown OSIS book IDs (add to OSIS_BOOK map if needed):`);
    for (const id of unknownOsisIds) {
      console.warn(`  "${id}"`);
    }
  }

  console.log('\nPairs per book (source verse):');
  const sorted = Object.entries(bookStats).sort((a, b) => b[1] - a[1]);
  for (const [book, count] of sorted) {
    console.log(`  ${book.padEnd(25)} ${count.toLocaleString()}`);
  }

  // Books with zero pairs (potential gaps)
  const allBooks = Object.values(OSIS_BOOK);
  const missingBooks = allBooks.filter(b => !bookStats[b]);
  if (missingBooks.length > 0) {
    console.warn('\nBooks with zero pairs (no <scripRef> entries found):');
    for (const b of missingBooks) {
      console.warn(`  ${b}`);
    }
  } else {
    console.log('\nAll 66 books have cross-reference pairs.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
