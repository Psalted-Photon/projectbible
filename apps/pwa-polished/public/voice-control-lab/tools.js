/**
 * Voice Control lab — the actions Needle chooses from, written the way
 * Cactus's guide asks: one tool per action, formats in the descriptions, fixed
 * choices as enums.
 *
 * Each action is named after the thing it brings up, never after a verb.
 * People say "open" (or "go to", "show me", "pull up") for nearly everything,
 * so a verb in a name or description pulls every "open …" toward that one
 * action: "open Habakkuk" landed on open_commentary that way. Each thing is
 * owned by one action ("map" is only the map action, not also a window), and
 * the descriptions lead with the thing.
 *
 * Every group has trigger words, and only the groups whose words were said are
 * sent. Above five actions Needle keeps the five it thinks closest to what was
 * said, and the rest can't be picked at all. With no trigger word every CORE
 * action goes and Needle's own pick decides. The lab can also send everything
 * at once, to measure that drop.
 */

/** Windows that only the window action brings up; the rest belong to their own actions. */
const WINDOWS = ['Bible', 'Harmonies', 'Art', 'Notes', 'Journal'];

/** Every window, for closing. */
const ALL_WINDOWS = [
  'Bible', 'Harmonies', 'Connections', 'Commentary', 'Encyclopedia', 'People',
  'Topical', 'Strongs', 'Map', 'Timeline', 'Art', 'Family Tree', 'Notes', 'Journal',
];

export const TRANSLATIONS = ['KJV', 'WEB', 'BSB', 'NET', 'LXX', 'Byzantine', 'Textus Receptus'];

/** The highlighter's colors, in the order its popup shows them. */
export const COLORS = ['yellow', 'green', 'orange', 'red', 'pink', 'purple', 'blue'];

/** The highlighter's looks, as people say them; tidy() turns "wavy", "blue text" and the like into these. */
export const LOOKS = ['marker', 'letters', 'underline', 'dashed', 'squiggle', 'box'];

/** The commentaries as people say them: the shortest name that is always said, so it's in the words. */
const COMMENTARY_NAMES = [
  'Matthew Henry', 'Clarke', 'Barnes', 'Spurgeon', 'Bullinger', 'Jamieson Fausset Brown',
  'Calvin', 'Lightfoot', 'Wesley', 'King Comments', 'Luther', 'Robertson', 'Abbott',
  'Family Bible Notes', 'Aquinas', 'Treasury of Scripture Knowledge',
];

const BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

/** Verses in each chapter, in BOOKS order (from packages/core BibleMetadata). */
const VERSE_COUNTS = [
  '31 25 24 26 32 22 24 22 29 32 32 20 18 24 21 16 27 33 38 18 34 24 20 67 34 35 46 22 35 43 55 32 20 31 29 43 36 30 23 23 57 38 34 34 28 34 31 22 33 26',
  '22 25 22 31 23 30 25 32 35 29 10 51 22 31 27 36 16 27 25 26 36 31 33 18 40 37 21 43 46 38 18 35 23 35 35 38 29 31 43 38',
  '17 16 17 35 19 30 38 36 24 20 47 8 59 57 33 34 16 30 37 27 24 33 44 23 55 46 34',
  '54 34 51 49 31 27 89 26 23 36 35 16 33 45 41 50 13 32 22 29 35 41 30 25 18 65 23 31 40 16 54 42 56 29 34 13',
  '46 37 29 49 33 25 26 20 29 22 32 32 18 29 23 22 20 22 21 20 23 30 25 22 19 19 26 68 29 20 30 52 29 12',
  '18 24 17 24 15 27 26 35 27 43 23 24 33 15 63 10 18 28 51 9 45 34 16 33',
  '36 23 31 24 31 40 25 35 57 18 40 15 25 20 20 31 13 31 30 48 25',
  '22 23 18 22',
  '28 36 21 22 12 21 17 22 27 27 15 25 23 52 35 23 58 30 24 42 15 23 29 22 44 25 12 25 11 31 13',
  '27 32 39 12 25 23 29 18 13 19 27 31 39 33 37 23 29 33 43 26 22 51 39 25',
  '53 46 28 34 18 38 51 66 28 29 43 33 34 31 34 34 24 46 21 43 29 53',
  '18 25 27 44 27 33 20 29 37 36 21 21 25 29 38 20 41 37 37 21 26 20 37 20 30',
  '54 55 24 43 26 81 40 40 44 14 47 40 14 17 29 43 27 17 19 8 30 19 32 31 31 32 34 21 30',
  '17 18 17 22 14 42 22 18 31 19 23 16 22 15 19 14 19 34 11 37 20 12 21 27 28 23 9 27 36 27 21 33 25 33 27 23',
  '11 70 13 24 17 22 28 36 15 44',
  '11 20 32 23 19 19 73 18 38 39 36 47 31',
  '22 23 15 17 14 14 10 17 32 3',
  '22 13 26 21 27 30 21 22 35 22 20 25 28 22 35 22 16 21 29 29 34 30 17 25 6 14 23 28 25 31 40 22 33 37 16 33 24 41 30 24 34 17',
  '6 12 8 8 12 10 17 9 20 18 7 8 6 7 5 11 15 50 14 9 13 31 6 10 22 12 14 9 11 12 24 11 22 22 28 12 40 22 13 17 13 11 5 26 17 11 9 14 20 23 19 9 6 7 23 13 11 11 17 12 8 12 11 10 13 20 7 35 36 5 24 20 28 23 10 12 20 72 13 19 16 8 18 12 13 17 7 18 52 17 16 15 5 23 11 13 12 9 9 5 8 28 22 35 45 48 43 13 31 7 10 10 9 8 18 19 2 29 176 7 8 9 4 8 5 6 5 6 8 8 3 18 3 3 21 26 9 8 24 13 10 7 12 15 21 10 20 14 9 6',
  '33 22 35 27 23 35 27 36 18 32 31 28 25 35 33 33 28 24 29 30 31 29 35 34 28 28 27 28 27 33 31',
  '18 26 22 16 20 12 29 17 18 20 10 14',
  '17 17 11 16 16 13 13 14',
  '31 22 26 6 30 13 25 22 21 34 16 6 22 32 9 14 14 7 25 6 17 25 18 23 12 21 13 29 24 33 9 20 24 17 10 22 38 22 8 31 29 25 28 28 25 13 15 22 26 11 23 15 12 17 13 12 21 14 21 22 11 12 19 12 25 24',
  '19 37 25 31 31 30 34 22 26 25 23 17 27 22 21 21 27 23 15 18 14 30 40 10 38 24 22 17 32 24 40 44 26 22 19 32 21 28 18 16 18 22 13 30 5 28 7 47 39 46 64 34',
  '22 22 66 22 22',
  '28 10 27 17 17 14 27 18 11 22 25 28 23 23 8 63 24 32 14 49 32 31 49 27 17 21 36 26 21 26 18 32 33 31 15 38 28 23 29 49 26 20 27 31 25 24 23 35',
  '21 49 30 37 31 28 28 27 27 21 45 13',
  '11 23 5 19 15 11 16 14 17 15 12 14 16 9',
  '20 32 21',
  '15 16 15 13 27 14 17 14 15',
  '21',
  '17 10 10 11',
  '16 13 12 13 15 16 20',
  '15 13 19',
  '17 20 19',
  '18 15 20',
  '15 23',
  '21 13 10 14 11 15 14 23 17 12 17 14 9 21',
  '14 17 18 6',
  '25 23 17 25 48 34 29 34 38 42 30 50 58 36 39 28 27 35 30 34 46 46 39 51 46 75 66 20',
  '45 28 35 41 43 56 37 38 50 52 33 44 37 72 47 20',
  '80 52 38 44 39 49 50 56 62 42 54 59 35 35 32 31 37 43 48 47 38 71 56 53',
  '51 25 36 54 47 71 53 59 41 42 57 50 38 31 27 33 26 40 42 31 25',
  '26 47 26 37 42 15 60 40 43 48 30 25 52 28 41 40 34 28 41 38 40 30 35 27 27 32 44 31',
  '32 29 31 25 21 23 25 39 33 21 36 21 14 23 33 27',
  '31 16 23 21 13 20 40 13 27 33 34 31 13 40 58 24',
  '24 17 18 18 21 18 16 24 15 18 33 21 14',
  '24 21 29 31 26 18',
  '23 22 21 32 33 24',
  '30 30 21 23',
  '29 23 25 18',
  '10 20 13 18 28',
  '12 17 18',
  '20 15 16 16 25 21',
  '18 26 17 22',
  '16 15 15',
  '25',
  '14 18 19 16 14 20 28 13 28 39 40 29 25',
  '27 26 18 17 20',
  '25 25 22 19 14',
  '21 22 18',
  '10 29 24 21 21',
  '13',
  '14',
  '25',
  '20 29 22 11 14 17 17 13 21 11 19 17 18 20 8 21 18 24 21 15 27 21',
];

const BOOK_NAMES = [...new Set(BOOKS.map((b) => b.replace(/^\d /, '').toLowerCase())), 'psalm', 'song of songs', 'revelations'];
const BOOK_RE = new RegExp(String.raw`\b(${BOOK_NAMES.map((b) => b.replace(/ /g, String.raw`\s+`)).join('|')})\b`);
const LONG_BOOKS = BOOK_NAMES.filter((b) => !b.includes(' ') && b.length >= 5);

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * A book of the Bible is named, with or without a chapter, or close enough to
 * one ("habukkuk") that Whistle probably misspelled it.
 */
const passageSaid = {
  test(t) {
    if (BOOK_RE.test(t)) return true;
    return (t.match(/[a-z]{5,}/g) || []).some((w) => {
      const most = w.length >= 8 ? 2 : 1;
      return LONG_BOOKS.some((b) => Math.abs(b.length - w.length) <= most && editDistance(w, b) <= most);
    });
  },
};

/**
 * A book with a chapter, or after "go to", "open", "the book of" and the like,
 * is surely the book. A bare name ("who was James", "the exodus", "Ruth's
 * family") is weak: it counts only when nothing else was asked for.
 */
function passageIsSure(t) {
  return new RegExp(String.raw`\b(?:${BOOK_ALT})\s+\d|\b(?:go to|open|turn to|take me to|jump to|read|book of)\s+(?:the\s+)?(?:[123]\s+)?(?:${BOOK_ALT})\b(?!'s)`, 'i').test(t);
}

const BOOK_ALIASES = { psalm: 'psalms', 'song of songs': 'song of solomon', revelations: 'revelation' };

/** Verses per chapter for each book a spoken name can mean ("corinthians" with no number is either). */
function countsFor(num, name) {
  const base = BOOK_ALIASES[name.toLowerCase().replace(/\s+/g, ' ')] || name.toLowerCase().replace(/\s+/g, ' ');
  const exact = BOOKS.findIndex((b) => b.toLowerCase() === (num ? `${num} ${base}` : base));
  const idx = exact >= 0 ? [exact] : num ? [] : BOOKS.flatMap((b, i) => (b.toLowerCase().slice(2) === base ? [i] : []));
  return idx.map((i) => VERSE_COUNTS[i].split(' ').map(Number));
}

const REF_RE = new RegExp(String.raw`\b(?:([123])\s+)?(${BOOK_NAMES.map((b) => b.replace(/ /g, String.raw`\s+`)).join('|')})\s+(\d+)(?:\s+(\d+))?(?![\d:])`, 'gi');
const ORDINALS = { first: '1', '1st': '1', second: '2', '2nd': '2', third: '3', '3rd': '3' };

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const UNIT = String.raw`(?:one|two|three|four|five|six|seven|eight|nine)`;
const UNDER_100 = String.raw`(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-]+${UNIT})?|${SMALL.slice(1).join('|')})`;
// "one hundred and nineteen", "one oh five", or plain "sixteen".
const NUMBER = String.raw`(?:${UNIT}\s+hundred(?:\s+and)?(?:\s+${UNDER_100})?|${UNIT}\s+oh\s+${UNIT}|${UNDER_100})`;
const BOOK_ALT = BOOK_NAMES.map((b) => b.replace(/ /g, String.raw`\s+`)).join('|');
// Number words become digits only where a number is expected, so "the one who" stays as it is.
const NUMBER_RE = new RegExp(String.raw`(\b(?:verses?|chapters?|${BOOK_ALT})\s+(?:\d+\s+)?|\d\s+(?:and|to|through|thru)\s+)(${NUMBER})\b`, 'gi');
// "Psalm one nineteen" is Psalm 119; no other book has a hundred chapters.
const PSALM_HUNDREDS_RE = new RegExp(String.raw`\b(psalms?\s+)(${UNIT})\s+(${UNDER_100})\b`, 'gi');

/** One number said in words or digits, starting at toks[i]: [value, next index], or null. */
function readNumber(toks, i) {
  const t = toks[i];
  if (t == null) return null;
  if (/^\d+$/.test(t)) return [+t, i + 1];
  const unit = (w) => {
    const k = SMALL.indexOf(w);
    return k >= 1 && k <= 9 ? k : -1;
  };
  const under100 = (j) => {
    const tens = TENS.indexOf(toks[j]);
    if (tens >= 2) return unit(toks[j + 1]) > 0 ? [tens * 10 + unit(toks[j + 1]), j + 2] : [tens * 10, j + 1];
    const s = SMALL.indexOf(toks[j]);
    return s >= 1 ? [s, j + 1] : null;
  };
  const u = unit(t);
  if (u > 0 && toks[i + 1] === 'hundred') {
    const j = toks[i + 2] === 'and' ? i + 3 : i + 2;
    const r = under100(j);
    return r ? [u * 100 + r[0], r[1]] : [u * 100, i + 2];
  }
  // "one o five" is 105.
  if (u > 0 && (toks[i + 1] === 'o' || toks[i + 1] === 'oh')) return unit(toks[i + 2]) > 0 ? [u * 100 + unit(toks[i + 2]), i + 3] : null;
  return under100(i);
}

/** Every number in a run of words, or null if something in it isn't a number. */
function numbersIn(toks) {
  const out = [];
  for (let i = 0; i < toks.length; ) {
    const r = readNumber(toks, i);
    if (!r) return null;
    out.push(r[0]);
    i = r[1];
  }
  return out;
}

/** A part that has to be one number: "nineteen", or "one nineteen" said for 119. */
const oneNumber = (ns) => (ns.length === 1 ? [ns[0]] : ns.length === 2 && ns[0] <= 9 && ns[1] >= 10 && ns[1] <= 99 ? [ns[0] * 100 + ns[1]] : []);

/**
 * The numbers after a book name, read as its reference. Whistle writes them
 * however they came ("Psalms, one, nineteen, verse, one, o, five"), and the
 * book's real chapter and verse counts decide what they meant: "John three
 * sixteen" is 3:16, "Psalm one nineteen" is 119. Null when nothing fits.
 */
function readRefTail(num, name, tail) {
  const toks = tail.toLowerCase().split(/[\s,.:-]+/).filter(Boolean);
  const part = { ch: [], vs: [], end: [] };
  let cur = 'ch';
  for (const tk of toks) {
    if (tk === 'chapter') {
      if (cur !== 'ch' || part.ch.length) return null;
    } else if (tk === 'verse' || tk === 'verses' || tk === 'colon') {
      if (cur !== 'ch' || !part.ch.length) return null;
      cur = 'vs';
    } else if (['and', 'to', 'through', 'thru'].includes(tk)) {
      if (!part[cur].length) return null;
      cur = 'end';
    } else {
      part[cur].push(tk);
    }
  }
  const ch = numbersIn(part.ch);
  const vs = numbersIn(part.vs);
  const end = numbersIn(part.end);
  if (!ch?.length || !vs || !end) return null;
  const tries = [];
  if (part.vs.length) {
    for (const c of oneNumber(ch)) for (const v of oneNumber(vs)) tries.push([c, v]);
  } else {
    const [a, b, c, d] = ch;
    const hundreds = (x, y) => (x <= 9 && y >= 10 && y <= 99 ? x * 100 + y : -1);
    if (ch.length === 1) tries.push([a, null]);
    if (ch.length === 2) tries.push([a, b], [hundreds(a, b), null]);
    if (ch.length === 3) tries.push([hundreds(a, b), c], [a, hundreds(b, c)]);
    if (ch.length === 4) tries.push([hundreds(a, b), hundreds(c, d)]);
  }
  const counts = countsFor(num, name);
  const fits = ([c, v]) => counts.some((k) => c >= 1 && c <= k.length && (v == null || (v >= 1 && v <= k[c - 1])));
  const hit = tries.find(fits);
  if (!hit) return null;
  const last = oneNumber(end)[0];
  return `${hit[0]}${hit[1] != null ? ':' + hit[1] : ''}${last != null && hit[1] != null && last > hit[1] ? '-' + last : ''}`;
}

const SPOKEN_REF_RE = new RegExp(String.raw`\b(?:([123]|first|second|third|1st|2nd|3rd)[\s,]+)?(${BOOK_ALT})((?:[\s,.:-]+(?:\d+|${[...SMALL, ...TENS.slice(2), 'hundred', 'oh', 'o', 'verses?', 'chapter', 'colon', 'and', 'to', 'through', 'thru'].join('|')})\b)+)`, 'gi');

// "One thousand B.C.", "fifteen hundred BC": a year said in words, before its era.
const YEAR_RE = new RegExp(String.raw`\b((?:${UNIT}\s+thousand(?:\s+(?:and\s+)?(?:${UNIT}\s+hundred(?:\s+and)?(?:\s+${UNDER_100})?|${UNDER_100}))?)|(?:${UNIT}|${UNDER_100})\s+hundred(?:\s+and)?(?:\s+${UNDER_100})?)\s+(BC|AD|BCE|CE)\b`, 'gi');

function wordsToNumber(words) {
  const w = words.toLowerCase().split(/[\s-]+/).filter((x) => x !== 'and');
  let total = 0;
  let n = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 'thousand') {
      total += n * 1000;
      n = 0;
    } else if (w[i] === 'hundred' || w[i] === 'oh') n *= 100;
    else if (TENS.includes(w[i])) n += 10 * TENS.indexOf(w[i]);
    else n += SMALL.indexOf(w[i]);
  }
  return total + n;
}

/**
 * What was said, put in the words the actions use before the trigger words or
 * Needle see it. The engine holds back an action whose values aren't in what
 * was said, so "John 3:16" and "squiggle" have to be in the words:
 * "john chapter 3 verse 16", "john 3 16" and (when Whistle runs the numbers
 * together) "john 316" become "john 3:16"; "wavy line" becomes "squiggle" and
 * "blue text" "blue letters". A run of digits is split only when exactly one
 * chapter:verse exists in that book. Number words after "verse", "chapter" or a
 * book become digits, and the mishearings the lab caught are put right: "I
 * like verse 5", "hilight", "mark verse 5" and "mark John 3:16" are
 * highlights, "Versix" and "verse No. 6" are verse 6, "H43-0" is H430, and
 * "Destellonians" or "the Salonians" is Thessalonians.
 */
export function tidy(text) {
  let t = text
    .replace(new RegExp(String.raw`\bver(?:se?)?(${SMALL.slice(1).join('|')}|twenty|thirty|forty|fifty)\b`, 'gi'), 'verse $1')
    .replace(/\b(verses?|chapters?)\s+(?:no\.?|number)\s*/gi, '$1 ')
    .replace(/\bb\.\s?c\.?(?=\s|$)/gi, 'BC')
    .replace(/\ba\.\s?d\.?(?=\s|$)/gi, 'AD')
    .replace(YEAR_RE, (m, num, era) => `${wordsToNumber(num)} ${era.toUpperCase()}`)
    // Numbers after a book name are its reference, however Whistle wrote them.
    .replace(SPOKEN_REF_RE, (m, ord, name, tail) => {
      const num = ord ? ORDINALS[ord.toLowerCase()] || ord : undefined;
      // A trailing "and" or "verse" with no number after it belongs to what comes next.
      const nums = tail.replace(/(?:[\s,.:-]+(?:and|to|through|thru|verses?|chapter|colon))+$/i, '');
      const ref = readRefTail(num, name, nums);
      return ref ? `${num ? num + ' ' : ''}${name} ${ref}${tail.slice(nums.length)}` : m;
    })
    .replace(PSALM_HUNDREDS_RE, (m, lead, h, rest) => `${lead}${100 * wordsToNumber(h) + wordsToNumber(rest)}`);
  // Twice, so "verses three and four" gets both.
  for (let i = 0; i < 2; i++) t = t.replace(NUMBER_RE, (m, lead, num) => `${lead}${wordsToNumber(num)}`);
  if (/strong/i.test(t)) t = t.replace(/\b([gh])\s?(\d{1,4})[\s-](\d{1,3})\b/gi, (m, l, a, b) => `${l.toUpperCase()}${a}${b}`);
  return t
    .replace(/\b(?:hi|high)[\s-]?light/gi, 'highlight')
    // So "James" here isn't the book or the person.
    .replace(/\bking james(?: version| bible)?\b/gi, 'KJV')
    .replace(/\b(close|shut)\s+(?:everything|it all|all of them|every window|all (?:the )?windows)\b/gi, '$1 all')
    .replace(new RegExp(String.raw`\bi like\s+(?=(?:all\s+(?:of\s+)?)?(?:the\s+)?(?:verses?\b|chapter\b|\d|(?:${BOOK_ALT})\b))`, 'gi'), 'highlight ')
    // "Mark 5" is the book; "mark verse 5" and "mark John 3:16" are highlights.
    .replace(/\bmark\s+(?=(?:all\s+(?:of\s+)?)?(?:the\s+)?verses?\b)/gi, 'highlight ')
    .replace(new RegExp(String.raw`(^|[,.]\s*)mark\s+(?=(?:[123]\s+)?(?:${BOOK_ALT})\s+\d)`, 'gi'), '$1highlight ')
    .replace(/\bthe\s+s[ae]l+oni[ae]ns\b/gi, 'thessalonians')
    .replace(/\b(?!babylonians\b)[a-z]*l+onians\b/gi, 'thessalonians')
    .replace(/\b(squiggl(y|es|ed)|wavy|wiggly)( (under)?lines?)?\b/gi, 'squiggle')
    .replace(/\b(boxed|boxes)\b/gi, 'box')
    .replace(/\b(dotted|dashes)\b/gi, 'dashed')
    .replace(/\bunderlin(ed|ing)\b/gi, 'underline')
    .replace(new RegExp(String.raw`\b(${COLORS.join('|')})\s+(text|words|font|lettering|writing)\b`, 'gi'), '$1 letters')
    .replace(/\b(first|1st|second|2nd|third|3rd)[\s,]+(?=(samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)\b)/gi, (m, o) => ORDINALS[o.toLowerCase()] + ' ')
    // "2 Corinthians, chapter 5" is 2 Corinthians 5.
    .replace(new RegExp(String.raw`\b((?:[123]\s+)?(?:${BOOK_ALT}))\s*,?\s+chapter\s+(\d+)`, 'gi'), '$1 $2')
    .replace(/\b(?:chapter\s+)?(\d+)[,\s]+verses?\s+(\d+)/gi, '$1:$2')
    .replace(REF_RE, (m, num, name, a, b) => {
      const counts = countsFor(num, name);
      const fits = (c, v) => counts.some((k) => c >= 1 && c <= k.length && v >= 1 && v <= k[c - 1]);
      const ref = (c, v) => `${num ? num + ' ' : ''}${name} ${c}:${v}`;
      if (b) return fits(+a, +b) ? ref(a, b) : m;
      if (a.length < 2 || counts.some((k) => +a <= k.length)) return m;
      const splits = [];
      for (let i = 1; i < a.length; i++) {
        if (a[i] !== '0' && fits(+a.slice(0, i), +a.slice(i))) splits.push([a.slice(0, i), a.slice(i)]);
      }
      return splits.length === 1 ? ref(...splits[0]) : m;
    });
}

/**
 * People's names that are everyday words too ("so", "on", "lot", "mark") or
 * titles ("king", "lord"), found by how often the KJV, WEB, BSB and NET write
 * them in small letters, plus a few that are common in speech. These never
 * bring in the people actions on their own.
 */
const EVERYDAY = new Set(`ancient apostle branch comforter concubine counsellor daughter daughters ephah ephod er
  evangelist father fathers firstborn ghost head hen high holy host hosts ir journey judge king lamb last lawgiver
  light lot mark master mother on prince prophet put queen ram root saviour sceptre shamed sister so son sons
  sorcerer spirit spirits star steward sun tanner wife wonderful word almighty amok core dodo emperor god hod lord
  mash messiah non pinon pul shisha tartan tidal urbane christ dayspring roman exodus`.split(/\s+/));

export const isEveryday = (name) => EVERYDAY.has(name);

/** Every person's name, from the app's own people list (the worker hands it over once it has read it). */
let PEOPLE_NAMES = new Set();
export function usePeopleNames(names) {
  PEOPLE_NAMES = new Set([...names].filter((n) => !EVERYDAY.has(n)));
}

// A book with a chapter ("james 5"), "the book of Job", and commentators ("Matthew Henry") aren't people here.
const NOT_PEOPLE_RE = new RegExp(String.raw`\b(?:[123]\s+)?(?:${BOOK_ALT})\s+\d+(?::\d+)?|\bbook\s+of\s+(?:${BOOK_ALT})\b|\b(?:matthew henry|adam clarke|albert barnes|charles spurgeon|john calvin|john wesley|john lightfoot|martin luther|thomas aquinas|a\.? ?t\.? robertson|jamieson|fausset|king comments)\b`, 'gi');

/** A person is named: "jacob", "ruth's". */
export function personNamed(t) {
  if (!PEOPLE_NAMES.size) return null;
  const words = t.replace(NOT_PEOPLE_RE, ' ').toLowerCase().match(/[a-z]+(?:'s)?/g) || [];
  for (const w of words) {
    const n = w.replace(/'s$/, '');
    if (PEOPLE_NAMES.has(n)) return n;
  }
  return null;
}

const FAMILY_RE = /\b(tree|family|genealog\w*|ancestors?|descend\w*|sons?|daughters?|child(ren)?|kids?|father|mother|parents?|wife|wives|husbands?|brothers?|sisters?|grand(son|daughter|father|mother|child|children)s?|begat|born to|related|relatives?|cousins?|uncles?|aunts?|nephews?|nieces?|offspring|firstborn|married|marry)\b/;
const SAYS_RE = /\bwhere\b[^.?!]*\b(say|says|said|written|talks?|mentions?|speaks?|teach(es)?)\b|\bwhere in the bible\b/;
/** "Where's Bethlehem", "where did Paul go": a place. "Where does it say…" is a search. */
const placeWhere = (t) => /\bwhere\b/.test(t) && !SAYS_RE.test(t);

// "Tell me about" asks for the bio even next to a family word; "who was" gives way to one.
const STRONG_BIO_RE = /\b(bio|biography|tell me about|life of|story of)\b/;
const WEAK_BIO_RE = /\b(who (is|was|were|are)|who's|person|people)\b/;

const str = (description) => ({ type: 'string', description });

export const CORE = [
  {
    key: 'passage',
    triggers: passageSaid,
    tools: [
      {
        name: 'passage',
        description: 'A book of the Bible to read, at a chapter and verse if they are said.',
        parameters: {
          type: 'object',
          properties: {
            reference: str('The book, chapter and verse as spoken, e.g. "habakkuk", "james 5", "1 corinthians 16", "john 3:16".'),
          },
          required: ['reference'],
        },
      },
    ],
  },
  {
    key: 'commentary',
    triggers: /\b(commentar(y|ies)|comments?|henry|clarke?|barnes|spurgeon|bullinger|jamieson|fausset|jfb|calvin|lightfoot|wesley|luther|robertson|abbott?|aquinas|catena|treasury|tsk)\b/,
    tools: [
      {
        name: 'commentary',
        description: "A commentator's notes on the passage being read.",
        parameters: {
          type: 'object',
          properties: {
            author: { type: 'string', enum: COMMENTARY_NAMES, description: 'The commentator, when one is named.' },
            new_window: { type: 'boolean', description: 'True only when a new window is asked for.' },
          },
        },
      },
    ],
  },
  {
    key: 'word',
    triggers: /\b(word stud(y|ies)|study the word|greek|hebrew|original|mean(s|ing)?|definition|define)\b/,
    tools: [
      {
        name: 'word_study',
        description: 'A word study on an English word: the Greek or Hebrew behind it and where it is used.',
        parameters: {
          type: 'object',
          properties: { word: str('The English word, e.g. "rivers", "grace".') },
          required: ['word'],
        },
      },
    ],
  },
  {
    key: 'strongs',
    triggers: /\b(strong'?s|lexicon|[gh] ?\d+)\b/,
    tools: [
      {
        name: 'strongs',
        description: "The Strong's dictionary, at a number or a Greek or Hebrew word if one is said.",
        parameters: {
          type: 'object',
          properties: { query: str('A Strong\'s number like "G26" or "H430", or a word like "agape".') },
        },
      },
    ],
  },
  {
    key: 'highlight',
    // "Mark" as a verb: not "Mark 4", "Mark chapter 4", "open Mark" or "the book of Mark".
    triggers: new RegExp(String.raw`\b(highlight\w*|(?<!(?:open|to|of|read)\s)mark(?!\s+(?:\d|chapter))|colou?r|${[...COLORS, ...LOOKS].join('|')})\b`),
    tools: [
      {
        name: 'highlight',
        description: 'A highlight on verses, in the chapter being read unless a book and chapter are said. With no color said, the verses are only selected for the highlighter.',
        parameters: {
          type: 'object',
          properties: {
            verses: str('The verses as spoken, e.g. "16", "16 to 18", "john 3:16", "all of chapter 1".'),
            color: { type: 'string', enum: COLORS, description: 'The color, when one is said.' },
            look: {
              type: 'string',
              enum: LOOKS,
              description: 'The look, when one is said: marker is the usual highlight, letters colors the words themselves, underline is a straight line, dashed a dashed line, squiggle a wavy line, box a box around the words.',
            },
          },
          required: ['verses'],
        },
      },
    ],
  },
  {
    key: 'search',
    triggers: { test: (t) => /\b(search\w*|find|look for|which verses?|verses? (about|that|with)|what does the bible say)\b/.test(t) || SAYS_RE.test(t) },
    tools: [
      {
        name: 'search',
        description: 'A search of the Bible text for words or a phrase.',
        parameters: {
          type: 'object',
          properties: { query: str('The words to search for.') },
          required: ['query'],
        },
      },
    ],
  },
  {
    key: 'windows',
    // Only the windows no other action owns. "In a new window" belongs to the
    // commentary's new_window, and "the Bible" is a window only when it's
    // opened ("where does the Bible talk about…" is a search).
    triggers: /\b((?<!new )windows?|panels?|panes?|(?:open|show|bring up|pull up)\s+(?:me\s+)?(?:the\s+|a\s+|my\s+)?bible|harmon(y|ies)|art|notes|journal)\b/,
    tools: [
      {
        name: 'window',
        description: "One of the app's windows: the Bible, the Harmonies, Art, Notes or the Journal.",
        parameters: {
          type: 'object',
          properties: { window: { type: 'string', enum: WINDOWS } },
          required: ['window'],
        },
      },
    ],
  },
  {
    key: 'closing',
    triggers: /\b(close|shut|hide)\b/,
    tools: [
      {
        name: 'close_window',
        description: 'Closing a window, or all of them.',
        parameters: {
          type: 'object',
          properties: { window: { type: 'string', enum: [...ALL_WINDOWS, 'all'], description: 'The window, when one is named.' } },
        },
      },
    ],
  },
  {
    key: 'reading',
    triggers: /\b(read\w*|aloud|listen|play|resume)\b/,
    tools: [
      {
        name: 'read_aloud',
        description: 'Reading the Bible aloud, from a verse if one is said.',
        parameters: {
          type: 'object',
          properties: { from_verse: { type: 'integer', description: 'The verse to start from.' } },
        },
      },
    ],
  },
  {
    key: 'stopping',
    triggers: /\b(stop|pause|quiet|enough|silence|shh+)\b/,
    tools: [
      {
        name: 'stop_reading',
        description: 'Stopping or pausing reading aloud.',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
  {
    key: 'translation',
    triggers: /\b(translations?|versions?|kjv|king james|web|world english|bsb|berean|net|lxx|septuagint|byzantine|majority text|textus receptus)\b/,
    tools: [
      {
        name: 'translation',
        description: 'The Bible translation to read in.',
        parameters: {
          type: 'object',
          properties: {
            translation: {
              type: 'string',
              enum: TRANSLATIONS,
              description: 'KJV is the King James, WEB the World English Bible, BSB the Berean Standard Bible, NET the NET Bible, LXX the Septuagint.',
            },
          },
          required: ['translation'],
        },
      },
    ],
  },
];

export const GROUPS = [
  {
    key: 'repeats',
    triggers: /\b(repeat\w*|repetitions?|every (time|place)|each time|occurrences?|how (many times|often))\b/,
    tools: [
      {
        name: 'repeats',
        description: 'A word marked everywhere it comes up in the Bible, with its own colored pill.',
        parameters: {
          type: 'object',
          properties: { word: str('The word, e.g. "peace", "abide".') },
          required: ['word'],
        },
      },
    ],
  },
  {
    key: 'map',
    // "Where" means a place, unless it asks where the Bible says something.
    triggers: { test: (t) => /\b(maps?|how far|located|location)\b/.test(t) || placeWhere(t) },
    tools: [
      {
        name: 'map',
        description: 'The Bible map, at a place and a year if they are said.',
        parameters: {
          type: 'object',
          properties: {
            place: str('The place, e.g. "jericho", "the sea of galilee".'),
            year: str('A year as spoken, e.g. "1000 bc".'),
          },
        },
      },
    ],
  },
  {
    key: 'connections',
    triggers: /\b(connections?|cross ?references?|arcs?)\b/,
    tools: [
      {
        name: 'connections',
        description: 'The cross-reference connections for a passage.',
        parameters: {
          type: 'object',
          properties: { reference: str('The passage as spoken; the current one if none is said.') },
        },
      },
    ],
  },
  {
    key: 'tree',
    // Family words, or any person's name: "how many sons does Jacob have" asks about family.
    triggers: { test: (t) => FAMILY_RE.test(t) || !!personNamed(t) },
    tools: [
      {
        name: 'family_tree',
        description: 'The family tree, on a person if one is named.',
        parameters: {
          type: 'object',
          properties: { person: str('The person, e.g. "david", "mephibosheth".') },
        },
      },
    ],
  },
  {
    key: 'people',
    triggers: { test: (t) => STRONG_BIO_RE.test(t) || WEAK_BIO_RE.test(t) || !!personNamed(t) },
    tools: [
      {
        name: 'biography',
        description: 'The life of a Bible person, or the list of people if no one is named.',
        parameters: {
          type: 'object',
          properties: { person: str('The person, e.g. "ruth", "barnabas".') },
        },
      },
    ],
  },
  {
    key: 'encyclopedia',
    triggers: /\b(encyclopedia|isbe|article)\b/,
    tools: [
      {
        name: 'encyclopedia',
        description: 'The encyclopedia, at an article if a subject is said.',
        parameters: {
          type: 'object',
          properties: { topic: str('The subject, e.g. "tabernacle".') },
        },
      },
    ],
  },
  {
    key: 'topical',
    triggers: /\b(topics?|topical|naves?)\b/,
    tools: [
      {
        name: 'topical',
        description: "Nave's topical index, at a subject if one is said.",
        parameters: {
          type: 'object',
          properties: { topic: str('The subject, e.g. "forgiveness".') },
        },
      },
    ],
  },
  {
    key: 'timeline',
    triggers: /\b(timeline|when (did|was|were|is)|what year|how long ago)\b/,
    tools: [
      {
        name: 'timeline',
        description: 'The timeline, at an event, person or era if one is said.',
        parameters: {
          type: 'object',
          properties: { event: str('The event, e.g. "the exodus", "the exile".') },
        },
      },
    ],
  },
];

/**
 * The tools to send for what was said, and the groups whose trigger words
 * picked them. When two groups fire, the words usually say which one is meant,
 * so most turns end with one action:
 * - a bare book name counts only when nothing else was asked for
 * - a reference in a highlight, commentary or connections request belongs to it
 * - stop words beat reading, and closing beats opening
 * - "where" means the map, even with a person named
 * - with a person named, family words mean the tree and bio words the bio
 */
export function toolsFor(text, everything = false) {
  const all = [...CORE, ...GROUPS];
  if (everything) return { tools: all.flatMap((g) => g.tools), groups: ['everything'] };
  const t = text.toLowerCase();
  const keys = new Set(all.filter((g) => g.triggers.test(t)).map((g) => g.key));
  if (keys.has('passage') && keys.size > 1 && !passageIsSure(t)) keys.delete('passage');
  if (keys.has('passage') && ['highlight', 'commentary', 'connections'].some((k) => keys.has(k))) keys.delete('passage');
  if (keys.has('stopping')) keys.delete('reading');
  if (keys.has('closing')) keys.delete('windows');
  // "Where was Jesus born": the question is about a place, not the person.
  if (keys.has('map') && placeWhere(t)) {
    keys.delete('tree');
    keys.delete('people');
  }
  if (keys.has('tree') && keys.has('people')) {
    const family = FAMILY_RE.test(t);
    const bio = STRONG_BIO_RE.test(t);
    if (family && !bio) keys.delete('people');
    else if (!family && (bio || WEAK_BIO_RE.test(t))) keys.delete('tree');
  }
  const hit = all.filter((g) => keys.has(g.key));
  if (hit.length) return { tools: hit.flatMap((g) => g.tools), groups: hit.map((g) => g.key) };
  return { tools: CORE.flatMap((g) => g.tools), groups: [] };
}

/**
 * A sentence with several commands, cut at commas and "then" so each gets its
 * own small set of actions: "go to Romans 6, open the King Comments, word study
 * rivers" is three turns. A piece that adds nothing new ("…verse 6, green")
 * stays with the piece before it.
 */
export function splitCommands(text) {
  // A comma inside a number ("1,000 BC") doesn't count.
  const parts = text.split(/\s*(?:[,;](?!\d)|\band then\b|\bthen\b|\band also\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return [text];
  const out = [];
  for (const part of parts) {
    const groups = new Set(toolsFor(part).groups);
    const prev = out[out.length - 1];
    if (prev && (!groups.size || [...groups].every((g) => prev.groups.has(g)))) {
      prev.text += ' ' + part;
    } else if (prev && !prev.groups.size) {
      // Words before the first command ("okay, go to John 3") go with it.
      prev.text += ' ' + part;
      prev.groups = groups;
    } else {
      out.push({ text: part, groups });
    }
  }
  return out.map((p) => p.text);
}

const FIND_REF_RE = new RegExp(String.raw`\b(?:([123])\s+)?(${BOOK_ALT})\s+(\d+)(?::(\d+)(?:\s*(?:-|to|through)\s*(\d+))?)?(?![\d:])`, 'gi');

/**
 * Every reference in the words, the way the app's own reference reader would
 * take them, checked against the real chapter and verse counts. An impossible
 * Psalm with a hundred less ("Psalms 19:105") is offered as the one it likely
 * was (Psalm 119:105).
 */
export function findRefs(text) {
  const out = [];
  for (const m of text.matchAll(FIND_REF_RE)) {
    const [, num, name, ch, vs, ve] = m;
    const counts = countsFor(num, name);
    if (!counts.length) continue;
    const base = BOOK_ALIASES[name.toLowerCase().replace(/\s+/g, ' ')] || name.toLowerCase().replace(/\s+/g, ' ');
    const book = BOOKS.find((b) => b.toLowerCase() === (num ? `${num} ${base}` : base)) || base.replace(/\b\w/g, (c) => c.toUpperCase());
    const c = +ch;
    const v = vs ? +vs : null;
    const at = (cc) => `${book} ${cc}${v != null ? ':' + v : ''}${ve ? '-' + ve : ''}`;
    const fits = (cc) => counts.some((k) => cc >= 1 && cc <= k.length && (v == null || (v >= 1 && v <= k[cc - 1])));
    const valid = fits(c);
    const suggest = !valid && base === 'psalms' && c < 100 && fits(c + 100) ? at(c + 100) : null;
    out.push({ text: at(c), valid, suggest });
  }
  return out;
}

const NOOP_RE = /^\s*(?:thank(?:s| you)(?: (?:so|very) much)?|never ?mind|cancel|forget it|no(?:pe)? thanks?|ok(?:ay)?|that'?s (?:all|it)|amen)[\s.!]*$/i;

/** Things said to the app that ask for nothing: null if it's a command, else the reply ("" for none). */
export function noopReply(text) {
  if (!NOOP_RE.test(text)) return null;
  return /^\s*thank/i.test(text) ? "You're welcome." : '';
}

/** The commentaries the app ships, for the "not installed" reply. */
export const COMMENTARY_AUTHORS = [
  'A.T. Robertson', 'Abbott', 'Adam Clarke', 'Albert Barnes', 'Charles Spurgeon',
  'E.W. Bullinger', 'Family Bible Notes', 'Jamieson-Fausset-Brown', 'John Calvin',
  'John Lightfoot', 'John Wesley', 'KingComments', 'Martin Luther', 'Matthew Henry',
  'Thomas Aquinas (Catena Aurea)', 'Treasury of Scripture Knowledge',
];

const squash = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

/** The installed commentary a spoken name means, or null. */
export function findCommentary(spoken) {
  const s = squash(spoken);
  if (!s) return null;
  for (const a of COMMENTARY_AUTHORS) {
    const full = squash(a);
    if (full.includes(s) || s.includes(full)) return a;
    // Any one name of the author on its own ("henry", "calvin", "jfb").
    const words = a.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    if (words.some((w) => s === w || s.endsWith(w))) return a;
  }
  if (s === 'jfb') return 'Jamieson-Fausset-Brown';
  if (s === 'tsk') return 'Treasury of Scripture Knowledge';
  return null;
}

/**
 * Words that sound alike, each with how often the KJV, WEB, BSB and NET use
 * it together. Whistle can only guess which one was meant ("the word peace"
 * came out "piece"), so a word for Repeats or a word study becomes the one the
 * Bible uses at least 5 times as often, and otherwise stays as heard; the rest
 * are a tap away. Groups whose common word is a little word ("him" and
 * "hymn") are left out.
 */
const SOUNDALIKES = [
  'peace:1556 piece:167',
  'prophet:1053 profit:140',
  'prophets:977 profits:14',
  'pray:678 prey:215',
  'praise:998 prays:24 preys:3',
  'holy:2608 wholly:56',
  'son:9540 sun:578',
  'soul:1209 sole:36',
  'souls:219 soles:32',
  'altar:1535 alter:13',
  'altars:241 alters:1',
  'reign:673 rain:403 rein:0',
  'reigned:569 rained:28 reined:0',
  'reigns:35 rains:32 reins:18',
  'mourning:214 morning:938',
  'aloud:103 allowed:68',
  'seen:971 scene:3',
  'sow:152 sew:7',
  'sowed:35 sewed:9',
  'sowing:16 sewing:0',
  'sower:22 sewer:2',
  'heal:174 heel:28',
  'healed:316 heeled:0',
  'wait:396 weight:169',
  'bread:1283 bred:4',
  'flour:278 flower:65',
  'flowers:63 flours:0',
  'sent:2681 scent:16 cent:1',
  'sea:1666 see:3731',
  'knew:402 new:721',
  'right:1654 write:319 rite:1',
  'rose:368 rows:65',
  'vain:280 vein:2 vane:0',
  'way:2692 weigh:43',
  'ways:748 weighs:20',
  'whole:1179 hole:38',
  'idol:100 idle:36',
  'idols:565 idles:0',
  'hear:1717 here:1324',
  'heard:2416 herd:101',
  'lessen:2 lesson:13',
  'meat:570 meet:494 mete:8',
  'passed:535 past:178',
  'patience:88 patients:0',
  'presence:676 presents:49',
  'principal:30 principle:7',
  'raise:281 rays:4 raze:2',
  'reed:98 read:314',
  'reeds:75 reads:70',
  'road:229 rode:53 rowed:8',
  'sail:55 sale:22',
  'sight:1099 site:25 cite:0',
  'steal:100 steel:5',
  'tale:8 tail:55',
  'throne:690 thrown:216',
  'vial:11 vile:40',
  'waste:230 waist:81',
  'weak:220 week:54',
  'rest:1213 wrest:5',
  'ring:79 wring:6',
  'blew:93 blue:197',
  'bore:280 boar:3',
  'bow:403 bough:13',
  'bridal:4 bridle:31',
  'council:109 counsel:374',
  'dear:91 deer:39',
  'dew:144 due:116',
  'die:1280 dye:0',
  'fair:107 fare:7',
  'feet:1431 feat:0',
  'fir:37 fur:2',
  'flee:367 flea:8',
  'fowl:39 foul:17',
  'fowls:56 fouls:0',
  'gate:1060 gait:0',
  'grown:127 groan:65',
  'hail:140 hale:1',
  'need:306 knead:7',
  'night:1246 knight:0',
  'lone:5 loan:13',
  'male:665 mail:15',
  'main:37 mane:3',
  'pale:24 pail:0',
  'pain:143 pane:0',
  'pair:36 pear:0 pare:2',
  'plain:194 plane:5',
  'pole:48 poll:5',
  'pour:300 pore:1 poor:725',
  'real:11 reel:8',
  'root:161 route:19',
  'wrote:243 rote:0',
  'straight:145 strait:11',
  'sweet:255 suite:0',
  'vale:9 veil:121',
  'whale:5 wail:96',
  'wet:23 whet:5',
  'isle:11 aisle:0',
  'ark:912 arc:0',
  'abel:107 able:647',
  'cain:95 cane:14',
  'manna:76 manner:243 manor:0',
  'cymbal:4 symbol:11',
  'censer:42 censor:0',
  'mary:223 marry:129 merry:57',
  'tares:8 tears:172',
  'lamb:444 lam:0',
].map((g) => g.split(' ').map((p) => [p.split(':')[0], Number(p.split(':')[1])]));

/** The word a heard word most likely is in the Bible, and its sound-alikes to offer. */
export function bibleWord(heard) {
  const w = String(heard ?? '').toLowerCase().trim();
  const group = SOUNDALIKES.find((g) => g.some(([x]) => x === w));
  if (!group) return { word: w, others: [] };
  const [best, most] = group.reduce((a, b) => (b[1] > a[1] ? b : a));
  const word = most >= 5 * group.find(([x]) => x === w)[1] ? best : w;
  return { word, others: group.filter(([x, n]) => x !== word && n > 0).map(([x]) => x) };
}

/** Names Whistle is told to favor: one per line, as people say them. */
export const APP_KEYWORDS = [
  ...new Set(BOOKS.map((b) => b.replace(/^\d /, ''))),
  'Matthew Henry', 'Adam Clarke', 'Albert Barnes', 'John Calvin', 'John Wesley',
  'Jamieson Fausset Brown', 'Robertson', 'King Comments', 'Bullinger', 'Spurgeon',
  'Lightfoot', 'Luther', 'Aquinas', 'Treasury of Scripture Knowledge',
  'Connections', 'Encyclopedia', 'Topical', "Strong's", 'Timeline', 'Family Tree',
  'Harmonies', 'King James', 'World English Bible', 'Berean', 'NET Bible', 'Septuagint',
].join('\n');

/**
 * Hard things to say, for the test-phrases panel. `want` is what counts as
 * right: `do` lists actions with values their words must contain ("a|b" takes
 * either), `person` who the people list must find, `quote` the verse the words
 * must match, `count` a family question answered from the people list, `none`
 * nothing done (a question gets the steering-wheel reply).
 */
export const PHRASES = [
  // Passages
  { say: 'Go to Second Corinthians chapter five', should: 'go to 2 Corinthians 5', tests: '"second" and "chapter" spoken out', want: { do: [['passage', 'corinthians', '5']] } },
  { say: 'Take me to the book of Job', should: 'go to Job', tests: 'Job is a book and a person', want: { do: [['passage', 'job']] } },
  { say: 'Open Mark chapter four', should: 'go to Mark 4', tests: 'Mark is a book, a person and a verb', want: { do: [['passage', 'mark', '4']] } },
  { say: 'Psalm one nineteen verse one oh five', should: 'go to Psalm 119:105', tests: 'big numbers said the way people say them', want: { do: [['passage', '119:105']] } },
  { say: 'First Thessalonians four sixteen', should: 'go to 1 Thessalonians 4:16', tests: 'the book Whistle heard as "Destellonians"', want: { do: [['passage', 'thessalonians', '4:16']] } },
  // Commentaries and word study
  { say: 'Open Matthew Henry on Romans 8', should: 'Matthew Henry (on Romans 8)', tests: 'a commentator and a passage together', want: { do: [['commentary', 'henry']] } },
  { say: 'What does Spurgeon say about this', should: 'open Spurgeon', tests: 'a question that is really a command', want: { do: [['commentary', 'spurgeon']] } },
  { say: 'What does the word grace mean', should: 'word study on grace', tests: 'a question that is really a word study', want: { do: [['word_study|strongs', 'grace']] } },
  { say: "Strong's H430", should: "Strong's H430", tests: 'a letter and a number', want: { do: [['strongs', '430']] } },
  { say: 'Word study on prophet', should: 'word study on prophet', tests: 'prophet or profit', want: { do: [['word_study', 'prophet|profit']] } },
  // Highlights
  { say: 'Highlight verse sixteen in yellow', should: 'highlight verse 16 yellow', tests: 'the word Whistle heard as "I like"', want: { do: [['highlight', '16', 'yellow']] } },
  { say: 'Mark verse five in green', should: 'highlight verse 5 green', tests: 'mark as a verb, not the book', want: { do: [['highlight', '5', 'green']] } },
  { say: 'Highlight verses three to five in pink', should: 'highlight verses 3–5 pink', tests: 'a range in number words', want: { do: [['highlight', '3', '5', 'pink']] } },
  { say: 'Underline John 3:16 with a wavy line', should: 'squiggle on John 3:16', tests: 'a look in everyday words', want: { do: [['highlight', '316', 'squiggle']] } },
  { say: 'Highlight all of chapter one', should: 'highlight the whole chapter', tests: 'every verse at once', want: { do: [['highlight', 'all|1']] } },
  // Search and quotes
  { say: 'Find every verse about the wind', should: 'search for wind', tests: '"every" without "every time"', want: { do: [['search', 'wind']] } },
  { say: 'Where does it say the Lord is my shepherd', should: 'go to Psalm 23:1', tests: 'a quote inside a question', want: { quote: 'Psalms 23:1' } },
  { say: 'For God so loved the world', should: 'go to John 3:16', tests: 'a quote with no command word', want: { quote: 'John 3:16' } },
  { say: 'Jesus wept', should: 'go to John 11:35', tests: 'a two-word verse and a person', want: { quote: 'John 11:35' } },
  { say: 'The wages of sin is death', should: 'go to Romans 6:23', tests: 'a quote that skips its first word', want: { quote: 'Romans 6:23' } },
  // People
  { say: 'How many sons does Jacob have', should: 'answer from the people list, family tree on Jacob', tests: 'a person named with no command word', want: { count: true, do: [['family_tree', 'jacob']] } },
  { say: 'Who was Mephibosheth', should: 'bio of Mephibosheth', tests: 'a name Whistle mishears, found by sound', want: { do: [['biography|family_tree']], person: 'Mephibosheth' } },
  { say: "Show me Ruth's family", should: 'family tree on Ruth', tests: 'a name with an apostrophe s', want: { do: [['family_tree', 'ruth']] } },
  { say: 'Tell me about the apostle Paul', should: 'bio of Paul', tests: 'a title before the name', want: { do: [['biography', 'paul']], person: 'Paul' } },
  { say: "Who were David's wives", should: 'family tree on David', tests: 'a family word in a question', want: { do: [['family_tree|biography', 'david']] } },
  { say: 'Who was James', should: 'bio, asking which James', tests: 'three Jameses and a book', want: { do: [['biography', 'james']] } },
  // Places and times
  { say: 'Where is Bethlehem', should: 'map at Bethlehem', tests: 'a place in a question', want: { do: [['map', 'bethlehem']] } },
  { say: 'Show Jerusalem on the map in 1000 BC', should: 'map at Jerusalem, 1000 BC', tests: 'a place and a year', want: { do: [['map', 'jerusalem', '1000']] } },
  { say: 'When did the exodus happen', should: 'timeline at the exodus', tests: 'Exodus the event, not the book', want: { do: [['timeline', 'exodus']] } },
  { say: 'Where was Jesus born', should: 'the map', tests: '"where" with a person named', want: { do: [['map']] } },
  { say: 'Where does the Bible talk about forgiveness', should: 'search for forgiveness', tests: 'a "where" that isn\'t a place', want: { do: [['search', 'forgiveness']] } },
  // The app itself
  { say: 'Close everything', should: 'close every window', tests: 'no window named', want: { do: [['close_window', 'all']] } },
  { say: 'Start reading from verse ten', should: 'read aloud from verse 10', tests: 'a number word after "verse"', want: { do: [['read_aloud', '10']] } },
  { say: 'Switch to the King James', should: 'KJV', tests: 'a translation by its full name', want: { do: [['translation', 'kjv']] } },
  { say: 'Go to Romans 6, open the King Comments in a new window, word study rivers', should: 'all three, in order', tests: 'three commands at once', want: { do: [['passage', 'romans', '6'], ['commentary', 'king'], ['word_study', 'river']] } },
  // Nothing to do
  { say: "What's the weather in Lagos", should: 'nothing (the steering-wheel reply)', tests: 'a question the app has no answer for', want: { none: true } },
  { say: 'Who made this app', should: 'nothing (the steering-wheel reply)', tests: 'a question about the app', want: { none: true } },
  { say: 'Thank you', should: 'nothing', tests: 'manners', want: { none: true } },
];

/** Names that are hard to hear right, for the names test. */
export const HARD_NAMES = [
  'Mephibosheth', 'Chedorlaomer', 'Nebuchadnezzar', 'Melchizedek', 'Zerubbabel',
  'Tiglath-pileser', 'Jehoshaphat', 'Ahasuerus', 'Abednego', 'Habakkuk', 'Zephaniah',
  'Maher-shalal-hash-baz', 'Bartholomew', 'Thessalonians', 'Ecclesiastes', 'Philemon',
];
