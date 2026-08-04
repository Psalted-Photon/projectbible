/**
 * Parses a TSK cross-reference string into a resolved { book, chapter, verse } target.
 * Returns null when the string cannot be resolved (unknown abbreviation, malformed).
 *
 * Reference formats handled:
 *   "Ex 20:21"    → { book: 'Exodus', chapter: 20, verse: 21 }
 *   "Am 5:18-20"  → { book: 'Amos',   chapter: 5,  verse: 18 }  (range → first verse)
 *   "3:14,15"     → { book: contextBook,    chapter: 3,  verse: 14 }
 *   "8:22"        → { book: contextBook,    chapter: 8,  verse: 22 }
 *   "10,31"       → { book: contextBook,    chapter: contextChapter, verse: 10 }
 */

export interface RefTarget {
  book: string;
  chapter: number;
  verse: number;
}

/**
 * KJV/TSK abbreviation → canonical book name (matching bibleData.ts).
 * Keys are lower-cased for case-insensitive lookup.
 */
export const BOOK_MAP: Record<string, string> = {
  // Genesis
  ge: 'Genesis', gen: 'Genesis',
  // Exodus
  ex: 'Exodus', exo: 'Exodus', exod: 'Exodus',
  // Leviticus
  le: 'Leviticus', lev: 'Leviticus',
  // Numbers
  nu: 'Numbers', num: 'Numbers',
  // Deuteronomy
  de: 'Deuteronomy', dt: 'Deuteronomy', deu: 'Deuteronomy', deut: 'Deuteronomy',
  // Joshua
  jos: 'Joshua', josh: 'Joshua',
  // Judges
  jdg: 'Judges', jg: 'Judges', judg: 'Judges',
  // Ruth
  ru: 'Ruth', rth: 'Ruth', ruth: 'Ruth',
  // 1–2 Samuel
  '1sa': '1 Samuel', '1s': '1 Samuel', '1sam': '1 Samuel',
  '2sa': '2 Samuel', '2s': '2 Samuel', '2sam': '2 Samuel',
  // 1–2 Kings
  '1ki': '1 Kings', '1k': '1 Kings', '1kgs': '1 Kings',
  '2ki': '2 Kings', '2k': '2 Kings', '2kgs': '2 Kings',
  // 1–2 Chronicles
  '1ch': '1 Chronicles', '1chr': '1 Chronicles', '1chron': '1 Chronicles',
  '2ch': '2 Chronicles', '2chr': '2 Chronicles', '2chron': '2 Chronicles',
  // Ezra
  ezr: 'Ezra', ezra: 'Ezra',
  // Nehemiah
  ne: 'Nehemiah', neh: 'Nehemiah',
  // Esther
  es: 'Esther', est: 'Esther', esth: 'Esther',
  // Job
  job: 'Job', jb: 'Job',
  // Psalms
  ps: 'Psalm', psa: 'Psalm', psalm: 'Psalm', psalms: 'Psalm',
  // Proverbs
  pr: 'Proverbs', pro: 'Proverbs', prov: 'Proverbs',
  // Ecclesiastes
  ec: 'Ecclesiastes', ecc: 'Ecclesiastes', eccl: 'Ecclesiastes',
  // Song of Solomon
  song: 'Song of Solomon', so: 'Song of Solomon', sos: 'Song of Solomon',
  ca: 'Song of Solomon', cant: 'Song of Solomon',
  // Isaiah
  isa: 'Isaiah', is: 'Isaiah',
  // Jeremiah  (jr = SWORD/JFB abbreviation)
  jer: 'Jeremiah', je: 'Jeremiah', jr: 'Jeremiah',
  // Lamentations
  la: 'Lamentations', lam: 'Lamentations',
  // Ezekiel
  eze: 'Ezekiel', ezek: 'Ezekiel', ezk: 'Ezekiel',
  // Daniel
  da: 'Daniel', dan: 'Daniel', dn: 'Daniel',
  // Hosea
  ho: 'Hosea', hos: 'Hosea',
  // Joel
  joe: 'Joel', joel: 'Joel', jl: 'Joel',
  // Amos
  am: 'Amos', amo: 'Amos', amos: 'Amos',
  // Obadiah
  ob: 'Obadiah', obad: 'Obadiah',
  // Jonah
  jon: 'Jonah', jonah: 'Jonah',
  // Micah
  mi: 'Micah', mic: 'Micah',
  // Nahum
  na: 'Nahum', nah: 'Nahum', nahum: 'Nahum',
  // Habakkuk
  hab: 'Habakkuk', hb: 'Habakkuk',
  // Zephaniah
  zep: 'Zephaniah', zph: 'Zephaniah', zeph: 'Zephaniah',
  // Haggai
  hag: 'Haggai', hg: 'Haggai',
  // Zechariah
  zec: 'Zechariah', zch: 'Zechariah', zech: 'Zechariah',
  // Malachi
  mal: 'Malachi', ml: 'Malachi',
  // Matthew
  mt: 'Matthew', mat: 'Matthew', matt: 'Matthew',
  // Mark
  mr: 'Mark', mk: 'Mark', mar: 'Mark', mark: 'Mark',
  // Luke
  lu: 'Luke', lk: 'Luke', luc: 'Luke', luke: 'Luke', luk: 'Luke',
  // John (joh/jn preferred; jo kept for legacy TSK)
  joh: 'John', jn: 'John', jo: 'John', john: 'John',
  // Acts
  ac: 'Acts', act: 'Acts', acts: 'Acts',
  // Romans
  ro: 'Romans', rom: 'Romans',
  // 1–2 Corinthians
  '1co': '1 Corinthians', '1cor': '1 Corinthians',
  '2co': '2 Corinthians', '2cor': '2 Corinthians',
  // Galatians
  ga: 'Galatians', gal: 'Galatians',
  // Ephesians
  ep: 'Ephesians', eph: 'Ephesians',
  // Philippians
  php: 'Philippians', ph: 'Philippians', phil: 'Philippians',
  // Colossians
  col: 'Colossians',
  // 1–2 Thessalonians
  '1th': '1 Thessalonians', '1the': '1 Thessalonians', '1thess': '1 Thessalonians',
  '2th': '2 Thessalonians', '2the': '2 Thessalonians', '2thess': '2 Thessalonians',
  // 1–2 Timothy
  '1ti': '1 Timothy', '1tim': '1 Timothy',
  '2ti': '2 Timothy', '2tim': '2 Timothy',
  // Titus
  tit: 'Titus',
  // Philemon
  phm: 'Philemon', phlm: 'Philemon', phile: 'Philemon',
  // Hebrews
  heb: 'Hebrews', he: 'Hebrews',
  // James
  jas: 'James', jam: 'James', jm: 'James',
  // 1–2 Peter
  '1pe': '1 Peter', '1pet': '1 Peter',
  '2pe': '2 Peter', '2pet': '2 Peter',
  // 1–3 John
  '1jo': '1 John', '1jn': '1 John', '1john': '1 John',
  '2jo': '2 John', '2jn': '2 John', '2john': '2 John',
  '3jo': '3 John', '3jn': '3 John', '3john': '3 John',
  // Jude
  jude: 'Jude', jud: 'Jude',
  // Revelation
  re: 'Revelation', rev: 'Revelation',
  // Full canonical single-word names not already covered by abbreviations above
  genesis: 'Genesis', exodus: 'Exodus', leviticus: 'Leviticus',
  numbers: 'Numbers', deuteronomy: 'Deuteronomy', joshua: 'Joshua',
  judges: 'Judges', nehemiah: 'Nehemiah', esther: 'Esther',
  proverbs: 'Proverbs', ecclesiastes: 'Ecclesiastes',
  isaiah: 'Isaiah', jeremiah: 'Jeremiah', lamentations: 'Lamentations',
  ezekiel: 'Ezekiel', daniel: 'Daniel', hosea: 'Hosea',
  obadiah: 'Obadiah', micah: 'Micah', habakkuk: 'Habakkuk',
  zephaniah: 'Zephaniah', haggai: 'Haggai', zechariah: 'Zechariah',
  malachi: 'Malachi', matthew: 'Matthew', romans: 'Romans',
  galatians: 'Galatians', ephesians: 'Ephesians', philippians: 'Philippians',
  colossians: 'Colossians', hebrews: 'Hebrews', james: 'James',
  revelation: 'Revelation', titus: 'Titus', philemon: 'Philemon',
  // Full canonical multi-word names with number prefix (lowercase, space-separated)
  '1 samuel': '1 Samuel', '2 samuel': '2 Samuel',
  '1 kings': '1 Kings',   '2 kings': '2 Kings',
  '1 chronicles': '1 Chronicles', '2 chronicles': '2 Chronicles',
  '1 corinthians': '1 Corinthians', '2 corinthians': '2 Corinthians',
  '1 thessalonians': '1 Thessalonians', '2 thessalonians': '2 Thessalonians',
  '1 timothy': '1 Timothy', '2 timothy': '2 Timothy',
  '1 peter': '1 Peter', '2 peter': '2 Peter',
  '1 john': '1 John', '2 john': '2 John', '3 john': '3 John',
  // Song of Solomon variants
  'song of solomon': 'Song of Solomon', 'song of songs': 'Song of Solomon',
};

/**
 * Try to extract a recognised book abbreviation from the start of `ref`.
 * Returns { book (canonical), rest (chapter:verse string) } or null.
 */
function extractBook(ref: string): { book: string; rest: string } | null {
  // Handle "1 Samuel 3:4", "2 Kings 5:1" style (digit + space + word)
  const mNum = ref.match(/^(\d+\s+[A-Za-z]+)\s+(\d.*)$/);
  if (mNum) {
    const canonical = BOOK_MAP[mNum[1].toLowerCase()];
    if (canonical) return { book: canonical, rest: mNum[2] };
  }
  // Handle "Song of Solomon 1:1" style (word + " of " + word)
  const mOf = ref.match(/^([A-Za-z]+\s+of\s+[A-Za-z]+)\s+(\d.*)$/);
  if (mOf) {
    const canonical = BOOK_MAP[mOf[1].toLowerCase()];
    if (canonical) return { book: canonical, rest: mOf[2] };
  }
  // Match: optional leading digit(s) + letters + mandatory whitespace + at least one digit
  // e.g. "Ex 20:21", "Genesis 1:1", "1Co 15:52", "Ps 97:2"
  const m = ref.match(/^(\d*[A-Za-z]+)\s+(\d.*)$/);
  if (!m) return null;
  const canonical = BOOK_MAP[m[1].toLowerCase()];
  if (!canonical) return null;
  return { book: canonical, rest: m[2] };
}

/**
 * Parse chapter and first verse from strings like:
 *   "20:21"  → { chapter: 20, verse: 21 }
 *   "5:18-20"→ { chapter: 5,  verse: 18 }
 *   "14,15"  → { chapter: contextChapter, verse: 14 }
 *   "31"     → { chapter: contextChapter, verse: 31 }
 */
function parseChapterVerse(
  s: string,
  contextChapter: number,
): { chapter: number; verse: number } | null {
  const cv = s.match(/^(\d+):(\d+)/);
  if (cv) return { chapter: parseInt(cv[1]), verse: parseInt(cv[2]) };
  const v = s.match(/^(\d+)/);
  if (v) return { chapter: contextChapter, verse: parseInt(v[1]) };
  return null;
}

/**
 * Parse a TSK reference string into a navigable target verse.
 *
 * @param ref            Raw reference string, e.g. "Ex 20:21" or "3:14,15"
 * @param contextBook    Canonical book name for resolving relative refs (e.g. "Joel")
 * @param contextChapter Chapter number for resolving verse-only refs (e.g. 2)
 * @returns { book, chapter, verse } or null if unresolvable
 */
export function parseRefString(
  ref: string,
  contextBook: string,
  contextChapter: number,
): RefTarget | null {
  if (!ref) return null;
  const trimmed = ref.trim();

  // Handle "v. N", "ver. N", "ver N", "verse N", "v N" bare verse references
  const bareVerse = trimmed.match(/^(?:verse|ver\.?|v\.?)\s+(\d+)\b/i);
  if (bareVerse) {
    return { book: contextBook, chapter: contextChapter, verse: parseInt(bareVerse[1]) };
  }

  const extracted = extractBook(trimmed);
  if (extracted) {
    const rest = extracted.rest;
    // "5:18" or "5:18-20" → chapter 5, verse 18 (chapter explicitly stated)
    const full = rest.match(/^(\d+):(\d+)/);
    if (full) return { book: extracted.book, chapter: parseInt(full[1]), verse: parseInt(full[2]) };
    // "5" bare number with explicit book → chapter 5, verse 1 (not verse 5 of current chapter)
    const bare = rest.match(/^(\d+)/);
    if (bare) return { book: extracted.book, chapter: parseInt(bare[1]), verse: 1 };
    return null;
  }

  // No book prefix → relative to contextBook
  const cv = parseChapterVerse(trimmed, contextChapter);
  if (!cv) return null;
  return { book: contextBook, chapter: cv.chapter, verse: cv.verse };
}

/**
 * Parse an OSIS-style ref string (e.g. "Gen.2.4", "1John.4.9-1John.4.10")
 * into a navigable target. Returns null if the ref can't be parsed.
 */
export function parseOsisRef(ref: string): RefTarget | null {
  if (!ref) return null;
  // Take only the first ref in a range (strip everything from '-' onward)
  const primary = ref.split('-')[0].trim();
  // OSIS format: BOOK.CHAPTER.VERSE  (e.g. Gen.2.4, 1John.4.9)
  // The book portion is everything up to the first run of digits followed by a dot+digit
  const m = primary.match(/^([1-9]?[A-Za-z]+)\.([0-9]+)\.([0-9]+)$/);
  if (!m) return null;
  const [, bookRaw, chapterStr, verseStr] = m;
  const canonical = BOOK_MAP[bookRaw.toLowerCase()];
  if (!canonical) return null;
  return { book: canonical, chapter: parseInt(chapterStr), verse: parseInt(verseStr) };
}
