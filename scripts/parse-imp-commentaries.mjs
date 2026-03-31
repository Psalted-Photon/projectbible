import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const IMP_DIR = 'C:\\Users\\Marlowe\\Desktop\\ProjectBible\\data-sources\\commentaries\\imp';
const OUTPUT_FILE = 'C:\\Users\\Marlowe\\Desktop\\ProjectBible\\data\\processed\\commentary-imp.ndjson';

// Book name mapping
const BOOK_MAP = {
  'Matthew': 'Matthew', 'Mark': 'Mark', 'Luke': 'Luke', 'John': 'John',
  'Acts': 'Acts', 'Romans': 'Romans', '1 Corinthians': '1 Corinthians', '2 Corinthians': '2 Corinthians',
  'Galatians': 'Galatians', 'Ephesians': 'Ephesians', 'Philippians': 'Philippians', 'Colossians': 'Colossians',
  '1 Thessalonians': '1 Thessalonians', '2 Thessalonians': '2 Thessalonians',
  '1 Timothy': '1 Timothy', '2 Timothy': '2 Timothy', 'Titus': 'Titus', 'Philemon': 'Philemon',
  'Hebrews': 'Hebrews', 'James': 'James', '1 Peter': '1 Peter', '2 Peter': '2 Peter',
  '1 John': '1 John', '2 John': '2 John', '3 John': '3 John', 'Jude': 'Jude',
  'Revelation': 'Revelation',
  'Genesis': 'Genesis', 'Exodus': 'Exodus', 'Leviticus': 'Leviticus', 'Numbers': 'Numbers', 'Deuteronomy': 'Deuteronomy',
  'Joshua': 'Joshua', 'Judges': 'Judges', 'Ruth': 'Ruth', '1 Samuel': '1 Samuel', '2 Samuel': '2 Samuel',
  '1 Kings': '1 Kings', '2 Kings': '2 Kings', '1 Chronicles': '1 Chronicles', '2 Chronicles': '2 Chronicles',
  'Ezra': 'Ezra', 'Nehemiah': 'Nehemiah', 'Esther': 'Esther', 'Job': 'Job', 'Psalms': 'Psalms',
  'Proverbs': 'Proverbs', 'Ecclesiastes': 'Ecclesiastes', 'Song of Solomon': 'Song of Solomon',
  'Isaiah': 'Isaiah', 'Jeremiah': 'Jeremiah', 'Lamentations': 'Lamentations', 'Ezekiel': 'Ezekiel', 'Daniel': 'Daniel',
  'Hosea': 'Hosea', 'Joel': 'Joel', 'Amos': 'Amos', 'Obadiah': 'Obadiah', 'Jonah': 'Jonah', 'Micah': 'Micah',
  'Nahum': 'Nahum', 'Habakkuk': 'Habakkuk', 'Zephaniah': 'Zephaniah', 'Haggai': 'Haggai',
  'Zechariah': 'Zechariah', 'Malachi': 'Malachi'
};

const COMMENTARY_META = {
  'barnes': { author: 'Albert Barnes', title: "Barnes' Notes on the Bible", year: 1834 },
  'calvincommentaries': { author: 'John Calvin', title: "Calvin's Commentaries", year: 1564 },
  'family': { author: 'Family Bible Notes', title: 'Family Bible Notes', year: 1860 },
  'tfg': { author: 'E.W. Bullinger', title: 'Treasury of Scriptural Knowledge', year: 1913 },
  'tsk': { author: 'Treasury of Scripture Knowledge', title: 'Treasury of Scripture Knowledge', year: 1834 }
};

console.log('Parsing IMP commentary files...\n');

const entries = [];
const files = readdirSync(IMP_DIR).filter(f => f.endsWith('.imp'));

for (const file of files) {
  const filePath = join(IMP_DIR, file);
  const commentaryId = basename(file, '.imp');
  const meta = COMMENTARY_META[commentaryId] || { author: 'Unknown', title: 'Unknown', year: 1900 };
  
  console.log(`Parsing ${file}...`);
  
  const content = readFileSync(filePath, 'utf-8');
  const verses = content.split('$$$').slice(1); // Skip empty first element
  
  let parsed = 0;
  
  for (const verse of verses) {
    const lines = verse.trim().split('\n');
    if (lines.length < 2) continue;
    
    // Parse reference line: "Matthew 1:1"
    const refLine = lines[0].trim();
    const match = refLine.match(/^(.+?)\s+(\d+):(\d+)$/);
    if (!match) continue;
    
    const [, bookName, chapter, verseNum] = match;
    const book = BOOK_MAP[bookName];
    if (!book) {
      console.log(`  Unknown book: ${bookName}`);
      continue;
    }
    
    // Text is everything after the reference line
    const text = lines.slice(1).join('\n').trim();
    if (!text || text.length < 10) continue;
    
    // Clean text: remove HTML tags, scripture refs, decode entities
    let cleanText = text
      .replace(/<scripRef[^>]*>.*?<\/scripRef>/gs, '') // Remove <scripRef> including contents
      // Repair Windows-1252 mojibake (UTF-8 bytes misread as Latin-1/cp1252)
      .replace(/\u00e2\u20ac\u201c/g, '\u2013')   // â€" → – (en dash)
      .replace(/\u00e2\u20ac\u201d/g, '\u2014')   // â€" → — (em dash)
      .replace(/\u00e2\u20ac\u0153/g, '\u201c')   // â€œ → " (left double quote)
      .replace(/\u00e2\u20ac[\u009d\ufffd]/g, '\u201d') // â€? → " (right double quote)
      .replace(/\u00e2\u20ac\u2122/g, '\u2019')   // â€™ → ' (right single quote)
      .replace(/\u00e2\u20ac\u02dc/g, '\u2018')   // â€˜ → ' (left single quote)
      .replace(/\u00e2\u20ac\u00a6/g, '\u2026')   // â€¦ → … (ellipsis)
      // Repair 2-byte UTF-8 sequences misread as Latin-1 (covers Greek, etc.)
      .replace(/[\u00c2-\u00cf][\u0080-\u00bf]/g, (m) => {
        const b1 = m.charCodeAt(0), b2 = m.charCodeAt(1);
        return String.fromCodePoint(((b1 & 0x1f) << 6) | (b2 & 0x3f));
      })
      .replace(/&amp;/g, '&')   // Decode HTML entities before stripping tags
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, ' ')
      .replace(/&apos;/g, "'")
      .replace(/<[^>]+>/g, ' ') // Strip all remaining HTML tags (replace with space)
      .replace(/\(\s*;?\s*cf\.?\s*\)/g, '') // Remove empty citation parens
      .replace(/\(\s*\)/g, '')  // Remove empty parens ()
      .replace(/\s+/g, ' ')
      .trim();
    
    if (cleanText.length < 20) continue;
    
    entries.push({
      book,
      chapter: parseInt(chapter),
      verse_start: parseInt(verseNum),
      verse_end: null,
      author: meta.author,
      title: meta.title,
      text: cleanText,
      source: 'CrossWire',
      year: meta.year
    });
    
    parsed++;
  }
  
  console.log(`  ✓ Parsed ${parsed.toLocaleString()} entries`);
}

console.log(`\n✅ Total: ${entries.toLocaleString()} entries`);
console.log(`Writing to ${OUTPUT_FILE}...`);

const ndjson = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
writeFileSync(OUTPUT_FILE, ndjson, 'utf-8');

console.log('Done!');
