#!/usr/bin/env node

/**
 * Build BSB Pack (Berean Standard Bible)
 * 
 * Downloads and builds a SQLite pack for the Berean Standard Bible with rich text,
 * footnotes, cross-references, and section headings.
 * 
 * BSB is public domain and freely available at https://berean.bible
 * Source: scrollmapper/bible_databases (MIT License) or Berean Bible website
 * 
 * Usage: node scripts/build-bsb-pack.mjs
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const DATA_DIR = join(repoRoot, 'data-sources');
const PACKS_DIR = join(repoRoot, 'packs');
const OUTPUT_PATH = join(PACKS_DIR, 'bsb.sqlite');

// Ensure packs directory exists
if (!existsSync(PACKS_DIR)) {
  mkdirSync(PACKS_DIR, { recursive: true });
}

// All Bible books in canonical order
const BIBLE_BOOKS = [
  // Old Testament
  { name: 'Genesis', abbr: 'GEN', testament: 'OT', file: '01GENBSB.SFM' },
  { name: 'Exodus', abbr: 'EXO', testament: 'OT', file: '02EXOBSB.SFM' },
  { name: 'Leviticus', abbr: 'LEV', testament: 'OT', file: '03LEVBSB.SFM' },
  { name: 'Numbers', abbr: 'NUM', testament: 'OT', file: '04NUMBSB.SFM' },
  { name: 'Deuteronomy', abbr: 'DEU', testament: 'OT', file: '05DEUBSB.SFM' },
  { name: 'Joshua', abbr: 'JOS', testament: 'OT', file: '06JOSBSB.SFM' },
  { name: 'Judges', abbr: 'JDG', testament: 'OT', file: '07JDGBSB.SFM' },
  { name: 'Ruth', abbr: 'RUT', testament: 'OT', file: '08RUTBSB.SFM' },
  { name: '1 Samuel', abbr: '1SA', testament: 'OT', file: '091SABSB.SFM' },
  { name: '2 Samuel', abbr: '2SA', testament: 'OT', file: '102SABSB.SFM' },
  { name: '1 Kings', abbr: '1KI', testament: 'OT', file: '111KIBSB.SFM' },
  { name: '2 Kings', abbr: '2KI', testament: 'OT', file: '122KIBSB.SFM' },
  { name: '1 Chronicles', abbr: '1CH', testament: 'OT', file: '131CHBSB.SFM' },
  { name: '2 Chronicles', abbr: '2CH', testament: 'OT', file: '142CHBSB.SFM' },
  { name: 'Ezra', abbr: 'EZR', testament: 'OT', file: '15EZRBSB.SFM' },
  { name: 'Nehemiah', abbr: 'NEH', testament: 'OT', file: '16NEHBSB.SFM' },
  { name: 'Esther', abbr: 'EST', testament: 'OT', file: '17ESTBSB.SFM' },
  { name: 'Job', abbr: 'JOB', testament: 'OT', file: '18JOBBSB.SFM' },
  { name: 'Psalms', abbr: 'PSA', testament: 'OT', file: '19PSABSB.SFM' },
  { name: 'Proverbs', abbr: 'PRO', testament: 'OT', file: '20PROBSB.SFM' },
  { name: 'Ecclesiastes', abbr: 'ECC', testament: 'OT', file: '21ECCBSB.SFM' },
  { name: 'Song of Solomon', abbr: 'SNG', testament: 'OT', file: '22SNGBSB.SFM' },
  { name: 'Isaiah', abbr: 'ISA', testament: 'OT', file: '23ISABSB.SFM' },
  { name: 'Jeremiah', abbr: 'JER', testament: 'OT', file: '24JERBSB.SFM' },
  { name: 'Lamentations', abbr: 'LAM', testament: 'OT', file: '25LAMBSB.SFM' },
  { name: 'Ezekiel', abbr: 'EZK', testament: 'OT', file: '26EZKBSB.SFM' },
  { name: 'Daniel', abbr: 'DAN', testament: 'OT', file: '27DANBSB.SFM' },
  { name: 'Hosea', abbr: 'HOS', testament: 'OT', file: '28HOSBSB.SFM' },
  { name: 'Joel', abbr: 'JOL', testament: 'OT', file: '29JOLBSB.SFM' },
  { name: 'Amos', abbr: 'AMO', testament: 'OT', file: '30AMOBSB.SFM' },
  { name: 'Obadiah', abbr: 'OBA', testament: 'OT', file: '31OBABSB.SFM' },
  { name: 'Jonah', abbr: 'JON', testament: 'OT', file: '32JONBSB.SFM' },
  { name: 'Micah', abbr: 'MIC', testament: 'OT', file: '33MICBSB.SFM' },
  { name: 'Nahum', abbr: 'NAM', testament: 'OT', file: '34NAMBSB.SFM' },
  { name: 'Habakkuk', abbr: 'HAB', testament: 'OT', file: '35HABBSB.SFM' },
  { name: 'Zephaniah', abbr: 'ZEP', testament: 'OT', file: '36ZEPBSB.SFM' },
  { name: 'Haggai', abbr: 'HAG', testament: 'OT', file: '37HAGBSB.SFM' },
  { name: 'Zechariah', abbr: 'ZEC', testament: 'OT', file: '38ZECBSB.SFM' },
  { name: 'Malachi', abbr: 'MAL', testament: 'OT', file: '39MALBSB.SFM' },
  // New Testament
  { name: 'Matthew', abbr: 'MAT', testament: 'NT', file: '41MATBSB.SFM' },
  { name: 'Mark', abbr: 'MRK', testament: 'NT', file: '42MRKBSB.SFM' },
  { name: 'Luke', abbr: 'LUK', testament: 'NT', file: '43LUKBSB.SFM' },
  { name: 'John', abbr: 'JHN', testament: 'NT', file: '44JHNBSB.SFM' },
  { name: 'Acts', abbr: 'ACT', testament: 'NT', file: '45ACTBSB.SFM' },
  { name: 'Romans', abbr: 'ROM', testament: 'NT', file: '46ROMBSB.SFM' },
  { name: '1 Corinthians', abbr: '1CO', testament: 'NT', file: '471COBSB.SFM' },
  { name: '2 Corinthians', abbr: '2CO', testament: 'NT', file: '482COBSB.SFM' },
  { name: 'Galatians', abbr: 'GAL', testament: 'NT', file: '49GALBSB.SFM' },
  { name: 'Ephesians', abbr: 'EPH', testament: 'NT', file: '50EPHBSB.SFM' },
  { name: 'Philippians', abbr: 'PHP', testament: 'NT', file: '51PHPBSB.SFM' },
  { name: 'Colossians', abbr: 'COL', testament: 'NT', file: '52COLBSB.SFM' },
  { name: '1 Thessalonians', abbr: '1TH', testament: 'NT', file: '531THBSB.SFM' },
  { name: '2 Thessalonians', abbr: '2TH', testament: 'NT', file: '542THBSB.SFM' },
  { name: '1 Timothy', abbr: '1TI', testament: 'NT', file: '551TIBSB.SFM' },
  { name: '2 Timothy', abbr: '2TI', testament: 'NT', file: '562TIBSB.SFM' },
  { name: 'Titus', abbr: 'TIT', testament: 'NT', file: '57TITBSB.SFM' },
  { name: 'Philemon', abbr: 'PHM', testament: 'NT', file: '58PHMBSB.SFM' },
  { name: 'Hebrews', abbr: 'HEB', testament: 'NT', file: '59HEBBSB.SFM' },
  { name: 'James', abbr: 'JAS', testament: 'NT', file: '60JASBSB.SFM' },
  { name: '1 Peter', abbr: '1PE', testament: 'NT', file: '611PEBSB.SFM' },
  { name: '2 Peter', abbr: '2PE', testament: 'NT', file: '622PEBSB.SFM' },
  { name: '1 John', abbr: '1JN', testament: 'NT', file: '631JNBSB.SFM' },
  { name: '2 John', abbr: '2JN', testament: 'NT', file: '642JNBSB.SFM' },
  { name: '3 John', abbr: '3JN', testament: 'NT', file: '653JNBSB.SFM' },
  { name: 'Jude', abbr: 'JUD', testament: 'NT', file: '66JUDBSB.SFM' },
  { name: 'Revelation', abbr: 'REV', testament: 'NT', file: '67REVBSB.SFM' }
];

/**
 * Parse USFM file and extract verses with rich text (footnotes, cross-refs, headings)
 */
/**
 * Storage sentinels. \x01 terminates a note run; the poetry markers below are
 * deliberately NOT \x0B/\x0C, which JavaScript treats as whitespace and would
 * silently eat in trim()/\s. See docs/FEATURES-REFERENCE.md.
 */
const STANZA = '\x10';   // stanza break (verse-initial only)
const LINE_1 = '\x11';   // new poetic line
const LINE_2 = '\x12';   // new poetic line, indented

const POETRY_LEVEL = {
  q: LINE_1, q1: LINE_1, pi: LINE_1, pi1: LINE_1,
  q2: LINE_2, q3: LINE_2, q4: LINE_2, qr: LINE_2, qm: LINE_2, pi2: LINE_2
};

/** Line-level markers whose text continues the verse as ordinary prose. */
const PROSE_MARKERS = ['p', 'm', 'mi', 'nb', 'pmo', 'pm', 'pc', 'cls', 'ph1', 'li', 'li1', 'li2', 'li3'];

/**
 * Markers this builder has always separated with an unconditional space. Source
 * lines usually end in a space already, so that produces a double space —
 * invisible in HTML, and every shipped pack has them. Collapsing them now would
 * shift saved highlight offsets in ~7,700 poetic verses, so the existing byte
 * layout is preserved exactly. Markers outside this set are new here (their text
 * used to be glued onto the previous word) and get a space only when one is
 * actually missing.
 */
const LEGACY_SPACED_MARKERS = new Set(['p', 'm', 'q', 'q1', 'q2', 'q3', 'qm', 'qr', 'pmo', 'pm', 'pi', 'pi1', 'pi2']);

function parseUSFM(content) {
  const verses = [];
  let currentChapter = 0;
  let currentVerse = null;
  let verseText = '';
  let pendingHeading = '';
  let pendingCrossRef = '';
  // Structure that appears before the verse it belongs to
  let pendingPoetry = '';
  let pendingStanza = false;
  let pendingTitle = '';

  // Process content character by character to handle inline markers
  let i = 0;
  while (i < content.length) {
    // Look for backslash markers
    if (content[i] === '\\') {
      const markerStart = i;
      i++;
      
      // Extract marker name
      let marker = '';
      while (i < content.length && /[a-z0-9]/.test(content[i])) {
        marker += content[i];
        i++;
      }

      // Closing form of a character marker, e.g. \it*
      let closingMarker = false;
      if (content[i] === '*') {
        closingMarker = true;
        i++;
      }

      // Skip whitespace after marker
      while (i < content.length && content[i] === ' ') {
        i++;
      }
      
      // Chapter marker
      if (marker === 'c') {
        // Save previous verse
        if (currentVerse !== null && verseText.trim()) {
          verses.push({
            chapter: currentChapter,
            verse: currentVerse,
            text: verseText.trim()
          });
          verseText = '';
        }
        
        // Read chapter number
        let chNum = '';
        while (i < content.length && /\d/.test(content[i])) {
          chNum += content[i];
          i++;
        }
        currentChapter = parseInt(chNum);
        currentVerse = null;
        pendingHeading = '';
        pendingCrossRef = '';
        pendingPoetry = '';
        pendingStanza = false;
        pendingTitle = '';
        
        // Skip to end of line
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }
      
      // Section headings
      if (marker === 's1' || marker === 's2') {
        const lineEnd = content.indexOf('\n', i);
        if (lineEnd > i) {
          pendingHeading = content.substring(i, lineEnd).trim();
          i = lineEnd;
        }
        continue;
      }
      
      // Cross-reference marker (parallel passages)
      if (marker === 'r') {
        const lineEnd = content.indexOf('\n', i);
        if (lineEnd > i) {
          const ref = content.substring(i, lineEnd).trim();
          // Remove parentheses if present
          pendingCrossRef = ref.replace(/^\(|\)$/g, '').trim();
          i = lineEnd;
        }
        continue;
      }
      
      // Verse marker
      if (marker === 'v') {
        // Save previous verse
        if (currentVerse !== null && verseText.trim()) {
          verses.push({
            chapter: currentChapter,
            verse: currentVerse,
            text: verseText.trim(),
            heading: null // Heading goes with the verse it precedes
          });
        }
        
        // Read verse number
        let vNum = '';
        while (i < content.length && /\d/.test(content[i])) {
          vNum += content[i];
          i++;
        }
        currentVerse = parseInt(vNum);
        verseText = '';
        
        // Skip whitespace
        while (i < content.length && content[i] === ' ') i++;
        
        // Store heading separately (will be attached to this verse)
        const headingForVerse = pendingHeading;
        pendingHeading = '';

        // We'll attach the heading when saving the verse
        // Mark this verse as having a heading
        if (headingForVerse) {
          // Store temporarily - we'll add it when verse completes
          verseText = `__HEADING__${headingForVerse}__HEADING_END__`;
        }

        // Structure that arrived ahead of this verse: stanza gap, the poetic
        // line it opens, and any psalm superscription. The heading token stays
        // first so processVerses() can still strip it off the front.
        verseText += (pendingStanza ? STANZA : '') + pendingPoetry;
        if (pendingTitle) verseText += `${pendingTitle} `;
        pendingStanza = false;
        pendingPoetry = '';
        pendingTitle = '';

        continue;
      }
      
      // Footnote marker: \f + \fr ref \ft text \f*
      if (marker === 'f') {
        // Skip the + sign
        if (content[i] === '+') i++;
        while (i < content.length && content[i] === ' ') i++;
        
        let footnoteText = '';
        let inFootnote = true;
        
        while (i < content.length && inFootnote) {
          if (content[i] === '\\') {
            // Check for end marker \f*
            if (content.substring(i, i + 3) === '\\f*') {
              i += 3;
              inFootnote = false;
              break;
            }
            // Skip \fr (footnote reference) and \ft (footnote text) markers
            if (content.substring(i, i + 3) === '\\fr' || content.substring(i, i + 3) === '\\ft') {
              i += 3;
              while (i < content.length && content[i] === ' ') i++;
              continue;
            }
          }
          footnoteText += content[i];
          i++;
        }
        
        // Add footnote as inline note (\x01 sentinel marks end of note unambiguously)
        if (footnoteText.trim()) {
          verseText += ` + ${footnoteText.trim()}\x01`;
        }
        continue;
      }
      
      // Stanza break — belongs to the verse that follows it
      if (marker === 'b') {
        pendingStanza = true;
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }

      // Psalm superscription ("A Psalm of David") — printed as an italic title
      // above verse 1, and the pack has nowhere else to put it, so it leads
      // that verse rather than being dropped.
      if (marker === 'd') {
        // A bare "\d" (Zechariah 12) puts the newline right at i, so guard the
        // not-found case explicitly — treating it as "no newline" would swallow
        // the rest of the file as the title.
        const lineEnd = content.indexOf('\n', i);
        const end = lineEnd === -1 ? content.length : lineEnd;
        const title = content.substring(i, end).trim();
        if (title) pendingTitle = `<i>${cleanUSFMMarkup(title)}</i>`;
        i = end;
        continue;
      }

      // Acrostic stanza labels (ALEPH, BETH…) belong above the verse, not welded
      // to the end of the previous one. They ship in the headings pack instead.
      if (marker === 'qa') {
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }

      // Skip structural markers that carry no verse text
      if (['id', 'h', 'toc1', 'toc2', 'toc3', 'mt1', 'mt2', 'mt3', 'ms', 'ms1', 'mr', 'sp', 'rem'].includes(marker)) {
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }

      // Italic character marker (supplied/emphasised wording), stored the way
      // NET stores it so the existing <i> renderer picks it up.
      if (marker === 'it') {
        if (currentVerse !== null) verseText += closingMarker ? '</i>' : '<i>';
        continue;
      }

      // Poetry and paragraph continuation markers. The rest of the line may hold
      // verse text; a bare marker instead opens the line the next verse starts.
      const poetry = POETRY_LEVEL[marker];
      if (poetry || PROSE_MARKERS.includes(marker)) {
        let k = i;
        while (k < content.length && content[k] !== '\n' && /\s/.test(content[k])) k++;
        const bareLine = k >= content.length || content[k] === '\n';

        if (bareLine) {
          if (poetry) pendingPoetry = poetry;
          continue;
        }
        // The separating space is kept beside the marker: strip the markers and
        // the text is byte-for-byte what this builder produced before.
        if (currentVerse !== null && verseText.trim().length > 0) {
          if (LEGACY_SPACED_MARKERS.has(marker) || !/\s$/.test(verseText)) {
            verseText += ' ';
          }
          if (poetry) verseText += poetry;
        }
        continue;
      }

      // Unknown marker - skip it
      continue;
    }
    
    // Regular text - add to current verse if we have one.
    // The sources are CRLF; a bare \r is a line terminator, not verse text, and
    // leaving it in makes "does this already end in whitespace?" answer wrongly.
    if (currentVerse !== null && content[i] !== '\n' && content[i] !== '\r') {
      verseText += content[i];
    }
    
    // Add cross-ref at end of verse text (before newline)
    if (content[i] === '\n' && currentVerse !== null && pendingCrossRef && verseText.trim()) {
      verseText += ` + ${pendingCrossRef}\x01`;
      pendingCrossRef = '';
    }
    
    i++;
  }
  
  // Save final verse
  if (currentVerse !== null && verseText.trim()) {
    // Extract heading if present
    let heading = null;
    let finalText = verseText.trim();
    const headingMatch = finalText.match(/^__HEADING__(.+?)__HEADING_END__/);
    if (headingMatch) {
      heading = headingMatch[1];
      finalText = finalText.replace(/^__HEADING__.+?__HEADING_END__/, '').trim();
    }
    verses.push({
      chapter: currentChapter,
      verse: currentVerse,
      text: finalText,
      heading: heading
    });
  }
  
  return verses;
}

/**
 * Post-process verses to extract headings properly
 */
function processVerses(verses) {
  return verses.map(v => {
    let heading = v.heading;
    let text = v.text;
    
    // Extract heading if embedded in text
    const headingMatch = text.match(/^__HEADING__(.+?)__HEADING_END__/);
    if (headingMatch) {
      heading = headingMatch[1];
      text = text.replace(/^__HEADING__.+?__HEADING_END__/, '').trim();
    }
    
    return {
      chapter: v.chapter,
      verse: v.verse,
      text: text,
      heading: heading
    };
  });
}

/**
 * Clean USFM markup from text
 */
function cleanUSFMMarkup(text) {
  // Remove common USFM markers but keep inline notes (our + prefix)
  return text
    .replace(/\\f \+.*?\\f\*/g, '') // Remove footnotes
    .replace(/\\x \+.*?\\x\*/g, '') // Remove cross-refs in \\x format
    .replace(/\\+[a-z]{1,3}\s/g, '') // Remove other markers
    .replace(/\\+[a-z]{1,3}\*/g, '')
    .replace(/â€"/g, '—') // Fix em-dash encoding
    .replace(/â€"/g, '–') // Fix en-dash encoding
    .replace(/â€œ/g, '"') // Fix left quote
    .replace(/â€\u009d/g, '"') // Fix right quote
    .trim();
}

/**
 * Build BSB pack from USFM files with footnotes and cross-references
 */
async function buildBSBPack() {
  console.log('📖 Building Berean Standard Bible Pack (with footnotes & cross-references)\n');
  
  const USFM_DIR = join(DATA_DIR, 'bsb_usfm', 'bsb_usfm');
  
  if (!existsSync(USFM_DIR)) {
    console.error(`❌ USFM files not found: ${USFM_DIR}`);
    console.log('\nThe USFM files should already be extracted.');
    console.log('If not, download and extract:');
    console.log('  cd data-sources');
    console.log('  Invoke-WebRequest -Uri "https://bereanbible.com/bsb_usfm.zip" -OutFile "bsb_usfm.zip"');
    console.log('  Expand-Archive -Path "bsb_usfm.zip" -DestinationPath "bsb_usfm"\n');
    process.exit(1);
  }
  
  // Create database. Start from scratch: rows are written with INSERT OR
  // REPLACE, so building over a previous file would leave stale verses behind
  // wherever a run was interrupted — a pack that is half one build, half another.
  if (existsSync(OUTPUT_PATH)) unlinkSync(OUTPUT_PATH);
  const db = new Database(OUTPUT_PATH);
  
  try {
    // Create schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      
      CREATE TABLE IF NOT EXISTS verses (
        book TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        text TEXT NOT NULL,
        heading TEXT,
        PRIMARY KEY (book, chapter, verse)
      );
      
      CREATE INDEX IF NOT EXISTS idx_verses_book ON verses(book);
      CREATE INDEX IF NOT EXISTS idx_verses_chapter ON verses(book, chapter);
    `);
    
    // Insert metadata
    const metaInsert = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    metaInsert.run('pack_id', 'bsb');
    metaInsert.run('type', 'text');
    metaInsert.run('translation_id', 'BSB');
    metaInsert.run('translation_name', 'Berean Standard Bible');
    metaInsert.run('description', 'Public domain modern English translation with section headings, footnotes, and cross-references');
    metaInsert.run('language', 'en');
    metaInsert.run('license', 'Public Domain');
    metaInsert.run('attribution', 'Berean Standard Bible (BSB) - Public Domain. https://berean.bible');
    metaInsert.run('version', '1.0.0');
    metaInsert.run('build_date', new Date().toISOString());
    
    // Insert verses from USFM files
    const verseInsert = db.prepare('INSERT OR REPLACE INTO verses (book, chapter, verse, text, heading) VALUES (?, ?, ?, ?, ?)');
    let totalVerses = 0;
    
    for (const book of BIBLE_BOOKS) {
      const filePath = join(USFM_DIR, book.file);
      
      if (!existsSync(filePath)) {
        console.log(`⚠️  ${book.name}: File not found (${book.file})`);
        continue;
      }
      
      console.log(`Processing ${book.name}...`);
      
      const content = readFileSync(filePath, 'utf-8').replace(/\r/g, '');
      const rawVerses = parseUSFM(content);
      const verses = processVerses(rawVerses);
      
      for (const verse of verses) {
        const cleanText = cleanUSFMMarkup(verse.text);
        verseInsert.run(book.name, verse.chapter, verse.verse, cleanText, verse.heading || null);
        totalVerses++;
      }
      
      console.log(`  ✓ ${verses.length} verses`);
    }
    
    // Optimize database
    db.exec('VACUUM');
    db.exec('ANALYZE');
    
    const stats = db.prepare('SELECT COUNT(*) as count FROM verses').get();
    const size = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get();
    
    console.log('\n✨ BSB Pack Complete!\n');
    console.log('📊 Summary:');
    console.log(`   Total verses: ${stats.count.toLocaleString()}`);
    console.log(`   File size: ${(size.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Output: ${OUTPUT_PATH}`);
    console.log('\n� Features included:');
    console.log('   • Section headings as inline notes');
    console.log('   • Footnotes with references and explanations');
    console.log('   • Cross-references to parallel passages');
    console.log('\n�📖 The Berean Standard Bible is public domain and free to use.');
    console.log('   Learn more at https://berean.bible\n');
    
  } catch (error) {
    console.error('\n❌ Error building BSB pack:', error);
    throw error;
  } finally {
    db.close();
  }
}

buildBSBPack().catch(error => {
  console.error(error);
  process.exit(1);
});
