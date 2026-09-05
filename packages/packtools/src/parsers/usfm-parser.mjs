/**
 * USFM (Unified Standard Format Markers) Bible Parser
 * 
 * Parses USFM files from eBible.org and other sources
 * into SQLite packs for ProjectBible.
 * 
 * USFM is a text-based format with backslash markers:
 * \id - Book ID
 * \c - Chapter
 * \v - Verse
 * \f - Footnote
 * \x - Cross-reference
 */

import fs from 'fs';
import path from 'path';
import { parseUSFM, processVerses, cleanUSFMMarkup } from './usfm-scanner.mjs';

/**
 * Parsing is the shared scanner's job; what stays here is the book map this
 * collection needs for its deuterocanonical titles, and the pack writer.
 *
 * The scanner replaced a line-based parser that only recognised poetry on a
 * bare \q1 and emitted no paragraph break at all, which is why the shipped
 * LXX pack carries 2,466 poetic lines and exactly one paragraph break against
 * 1,008 in its source.
 *
 * \add, \it, \em and \qt were all stored as <i> before and still are; the
 * source is tagged word by word, so the space after a closing marker has to
 * survive or the words run together.
 */
const LXX_OPTIONS = {
  paragraphFromProseMarker: true,
  legacySpacedMarkers: new Set(),
  italicMarkers: new Set(['add', 'it', 'em', 'qt']),
  preserveSpaceAfterCharClose: true,
};

/**
 * USFM book ID to standard name mapping
 */
const USFM_BOOK_MAP = {
  'GEN': 'Genesis',
  'EXO': 'Exodus',
  'LEV': 'Leviticus',
  'NUM': 'Numbers',
  'DEU': 'Deuteronomy',
  'JOS': 'Joshua',
  'JDG': 'Judges',
  'RUT': 'Ruth',
  '1SA': '1 Samuel',
  '2SA': '2 Samuel',
  '1KI': '1 Kings',
  '2KI': '2 Kings',
  '1CH': '1 Chronicles',
  '2CH': '2 Chronicles',
  'EZR': 'Ezra',
  'NEH': 'Nehemiah',
  'EST': 'Esther',
  'JOB': 'Job',
  'PSA': 'Psalms',
  'PRO': 'Proverbs',
  'ECC': 'Ecclesiastes',
  'SNG': 'Song of Solomon',
  'ISA': 'Isaiah',
  'JER': 'Jeremiah',
  'LAM': 'Lamentations',
  'EZK': 'Ezekiel',
  'DAN': 'Daniel',
  'HOS': 'Hosea',
  'JOL': 'Joel',
  'AMO': 'Amos',
  'OBA': 'Obadiah',
  'JON': 'Jonah',
  'MIC': 'Micah',
  'NAM': 'Nahum',
  'HAB': 'Habakkuk',
  'ZEP': 'Zephaniah',
  'HAG': 'Haggai',
  'ZEC': 'Zechariah',
  'MAL': 'Malachi',
  // NT
  'MAT': 'Matthew',
  'MRK': 'Mark',
  'LUK': 'Luke',
  'JHN': 'John',
  'ACT': 'Acts',
  'ROM': 'Romans',
  '1CO': '1 Corinthians',
  '2CO': '2 Corinthians',
  'GAL': 'Galatians',
  'EPH': 'Ephesians',
  'PHP': 'Philippians',
  'COL': 'Colossians',
  '1TH': '1 Thessalonians',
  '2TH': '2 Thessalonians',
  '1TI': '1 Timothy',
  '2TI': '2 Timothy',
  'TIT': 'Titus',
  'PHM': 'Philemon',
  'HEB': 'Hebrews',
  'JAS': 'James',
  '1PE': '1 Peter',
  '2PE': '2 Peter',
  '1JN': '1 John',
  '2JN': '2 John',
  '3JN': '3 John',
  'JUD': 'Jude',
  'REV': 'Revelation',
  // Apocrypha/Deuterocanon
  'TOB': 'Tobit',
  'JDT': 'Judith',
  'WIS': 'Wisdom',
  'SIR': 'Sirach',
  'BAR': 'Baruch',
  'LJE': 'Epistle of Jeremiah',
  'S3Y': 'Prayer of Azariah',
  'SUS': 'Susanna',
  'BEL': 'Bel and the Dragon',
  '1MA': '1 Maccabees',
  '2MA': '2 Maccabees',
  '3MA': '3 Maccabees',
  '4MA': '4 Maccabees',
  '1ES': '1 Esdras',
  '2ES': '2 Esdras',
  'MAN': 'Prayer of Manasseh'
};

/**
 * Storage sentinels shared with the BSB pack builder and the PWA renderer.
 * See docs/FEATURES-REFERENCE.md for the full namespace.
 */
const NOTE_END = '\x01';    // terminates a "+ note text" run
const STANZA = '\x10';      // stanza break (verse-initial only)
const LINE_1 = '\x11';      // new poetic line
const LINE_2 = '\x12';      // new poetic line, indented
// NB: \x0B and \x0C are whitespace to JS (trim(), \s), which would silently eat
// them. \x10-\x12 are not, so the markers survive every existing string cleanup.

/** Markers whose own text is footnote content, not verse text. */
const FOOTNOTE_INNER = new Set(['fr', 'ft', 'fq', 'fqa', 'fl', 'fk', 'fv', 'fp', 'fdc']);

/** Markers whose text is supplied/emphasised wording — stored as <i> like NET. */
const ITALIC_MARKERS = new Set(['add', 'it', 'em', 'qt']);

/** Front matter and structural lines that carry no verse text. */
const SKIP_LINE_MARKERS = new Set([
  'id', 'ide', 'h', 'toc1', 'toc2', 'toc3', 'mt1', 'mt2', 'mt3', 'ms', 'ms1', 'mr',
  'ip', 'is1', 'is2', 'cl', 'cp', 'rem', 'sts', 'tr', 'tc1', 'tc2', 'th1', 'th2',
  's', 's1', 's2', 'r', 'sp', 'b'
]);

/** Poetic line markers → the sentinel that represents them. */
function poetryLevel(marker) {
  if (marker === 'q' || marker === 'q1' || marker === 'pi' || marker === 'pi1') return LINE_1;
  if (marker === 'q2' || marker === 'q3' || marker === 'q4' || marker === 'qr' || marker === 'pi2') return LINE_2;
  return null;
}

/**
 * Read a marker name at `i` (which must point at the backslash).
 * Returns { marker, closing, next } where `closing` is true for e.g. \add*.
 * A leading "+" marks a nested character marker (\+add inside a footnote) and
 * is not part of the name.
 */
function readMarker(src, i) {
  let j = i + 1;
  if (src[j] === '+') j++;
  let marker = '';
  while (j < src.length && /[a-zA-Z0-9]/.test(src[j])) marker += src[j++];
  const closing = src[j] === '*';
  if (closing) j++;
  return { marker, closing, next: j };
}

/**
 * Consume a footnote (\f … \f*) or cross-reference (\x … \x*) starting at the
 * backslash, and return it as a " + text\x01" run — the same shape the BSB pack
 * builder emits, so the reader never has to guess where a note ends.
 */
function readNote(src, i, endMarker) {
  let { next: j } = readMarker(src, i);
  while (j < src.length && src[j] === ' ') j++;
  // Caller character (+ - ?) identifying the note; not part of the text
  if (src[j] === '+' || src[j] === '-' || src[j] === '?') j++;

  let text = '';
  // LXX2012 writes "\ft Gr. meeting \f*place" — the space that separates the
  // note from the verse text it interrupts lives *inside* the note. Remember it
  // so the words don't run together once the note is lifted out.
  let trailingSpace = false;
  while (j < src.length) {
    if (src[j] === '\\') {
      const m = readMarker(src, j);
      if (m.marker === endMarker && m.closing) {
        trailingSpace = /\s$/.test(text);
        j = m.next;
        break;
      }
      // Inner markers (\fr \ft \xo \xt …) are structure; their text is the note
      j = m.next;
      if (src[j] === ' ') j++;
      if (text && !text.endsWith(' ')) text += ' ';
      continue;
    }
    text += src[j++];
  }

  text = text.replace(/\s+/g, ' ').trim();
  return { text, next: j, trailingSpace };
}

/**
 * Convert one line of USFM body text into stored verse text.
 * Footnotes/cross-refs become sentinel-terminated note runs, \add/\it become
 * <i>, and every other marker is dropped while keeping its text.
 */
function parseInlineText(src) {
  let out = '';
  let i = 0;

  while (i < src.length) {
    if (src[i] !== '\\') {
      out += src[i++];
      continue;
    }

    const m = readMarker(src, i);

    if ((m.marker === 'f' || m.marker === 'x') && !m.closing) {
      const note = readNote(src, i, m.marker);
      // LXX2012 has ~2,400 footnotes that are a bare reference with no text
      // ("\f + \fr 89:13 \f*"). There is nothing to show, so they are not notes.
      const hasContent = note.text.replace(/^\d+:\d+\s*/, '').trim().length > 0;
      if (note.text && hasContent) {
        if (out && !out.endsWith(' ')) out += ' ';
        out += `+ ${note.text}${NOTE_END}`;
        if (note.trailingSpace && note.next < src.length && !/\s/.test(src[note.next])) out += ' ';
      }
      i = note.next;
      continue;
    }

    if (ITALIC_MARKERS.has(m.marker)) {
      out += m.closing ? '</i>' : '<i>';
      i = m.next;
      if (!m.closing && src[i] === ' ') i++;
      continue;
    }

    // Published verse number (\vp 36)\vp*) — Brenton prints it, so keep the text
    // but drop the markers. Everything else: drop the marker, keep its text.
    i = m.next;
    if (src[i] === ' ' && !m.closing) i++;
  }

  return out;
}

/**
 * Collapse whitespace without disturbing the sentinels.
 *
 * The space that joins two poetic lines is deliberately kept next to the line
 * marker: strip the markers and the text is exactly what a marker-less build
 * would produce, so nothing downstream that counts characters is disturbed.
 */
function tidy(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/<i>\s*<\/i>/g, '')
    .trim();
}

/**
 * Parse a single USFM file
 */
export function parseUSFMFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // \id carries the book code; USFM_BOOK_MAP above is the only place that
  // knows the deuterocanonical names this collection adds to the 66.
  const idLine = content.match(/^\\id\s+(\S+)/m);
  const bookId = idLine ? idLine[1] : null;
  const bookName = bookId ? (USFM_BOOK_MAP[bookId] || bookId) : null;
  if (!bookName) return { bookName: null, verses: [] };

  const verses = processVerses(parseUSFM(content, LXX_OPTIONS))
    .map((v) => ({
      book: bookName,
      chapter: v.chapter,
      verse: v.verse,
      text: cleanUSFMMarkup(v.text),
    }))
    .filter((v) => v.text);

  return { bookName, verses };
}

/**
 * Parse all USFM files in a directory
 */
export function parseUSFMDirectory(dirPath) {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.usfm'))
    .sort();
  
  let allVerses = [];
  const metadata = {
    source: 'usfm',
    books: []
  };
  
  for (const file of files) {
    // Skip front matter and intro files
    if (file.startsWith('00-') || file.startsWith('01-INT')) {
      continue;
    }
    
    const filePath = path.join(dirPath, file);
    console.log(`  📄 Parsing ${file}...`);
    
    const { bookName, verses } = parseUSFMFile(filePath);
    if (bookName && verses.length > 0) {
      metadata.books.push(bookName);
      allVerses = allVerses.concat(verses);
      console.log(`     ✅ ${verses.length} verses`);
    }
  }
  
  return {
    metadata,
    verses: allVerses
  };
}

/**
 * Build SQLite pack from USFM directory
 */
export async function buildPackFromUSFM(dirPath, outputPath, packMetadata = {}) {
  const Database = (await import('better-sqlite3')).default;
  
  console.log(`\n📖 Parsing USFM files from ${path.basename(dirPath)}...\n`);
  const parsedData = parseUSFMDirectory(dirPath);
  
  console.log(`\n💾 Building SQLite pack: ${path.basename(outputPath)}`);

  // Start from scratch — verses are written with INSERT OR REPLACE, so building
  // over an existing file would keep stale rows from an interrupted run.
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  const db = new Database(outputPath);
  
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
  
  // Insert metadata - use snake_case for compatibility with pack-import.ts
  const insertMeta = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMeta.run('source', parsedData.metadata.source);
  insertMeta.run('books', JSON.stringify(parsedData.metadata.books));
  
  // Map camelCase to snake_case for consistency
  const metadataKeyMap = {
    packId: 'pack_id',
    packVersion: 'version',
    packType: 'type',
    translationId: 'translation_id',
    translationName: 'translation_name',
    languageName: 'language_name'
  };
  
  for (const [key, value] of Object.entries(packMetadata)) {
    const dbKey = metadataKeyMap[key] || key;
    insertMeta.run(dbKey, String(value));
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
  console.log(`   Books: ${parsedData.metadata.books.length}`);
  
  db.close();
  
  return outputPath;
}
