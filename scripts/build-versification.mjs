/**
 * Where a verse in one numbering lands in another, for the texts the app ships.
 *
 * English Bibles and the Hebrew text disagree about verse numbers in about 140
 * chapters: Malachi 3:19-24 is English 4:1-6, Joel 4 is English 3, and every
 * psalm with a title counts that title as verse 1 in Hebrew while the English
 * packs fold it into verse 1. A Strong's hit read off the Hebrew text has to be
 * moved to the English numbering before the reader can jump to it.
 *
 * Source: STEPBible's TVTMS file (CC BY 4.0), the condensed section between
 * #DataStart(Condensed) and #DataEnd(Condensed). Each "$" block names its own
 * columns, either on the "$" line itself or on a later "BIBLES" line. The
 * English side is the "EngTitleMerged" column when a block has one (that is how
 * every shipped English pack prints psalm titles), otherwise "English KJV".
 *
 * Every mapping is then checked against the packs on disk, and the report must
 * show 0 unmapped Hebrew verses.
 *
 * Also written here, because they come from the packs rather than TVTMS:
 *   byz      BYZ prints the Romans doxology (16:25-27) inside 14:23
 *   web      WEB prints it as 14:24-26
 *   lxxShift   the Greek Septuagint against lxx2012, chapter by chapter
 *   lxxHebrew  Septuagint chapters numbered like the Hebrew
 *   lxx2012  lxx2012 chapters (outside Psalms) whose verses don't line up with
 *            the English, so they have no English counterpart
 *
 * Output: apps/pwa-polished/src/data/versification.json, read by
 * lib/versification.ts. Only chapters that differ are listed. A listed chapter
 * holds every verse of that chapter as runs:
 *   "3-9>3:2"        verses 3-9 are 3:2-8 (in order)
 *   "1>3:1t"         verse 1 is the title part of 3:1 (b = the body part)
 *   "23>14:23,16:25" one verse that is several
 *   "5>"             no counterpart
 * Whenever a run lands in chapter N, chapter N of the same book is listed too,
 * so a reverse lookup never has to guess at identity.
 *
 * Usage: node scripts/build-versification.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const repoRoot = path.resolve('.');
const TVTMS = path.join(
  repoRoot,
  'data-sources/stepbible/STEPBible-Data-master',
  'TVTMS - Translators Versification Traditions with Methodology for Standardisation for Eng+Heb+Lat+Grk+Others - STEPBible.org CC BY.txt',
);
const PACKS = path.join(repoRoot, 'packs');
const outPath = path.join(repoRoot, 'apps/pwa-polished/src/data/versification.json');

const SOURCE =
  'Verse numbering from STEPBible TVTMS (Translators Versification Traditions with Methodology for Standardisation), STEPBible.org, CC BY 4.0';

// TVTMS (SIL/UBS) book codes → the app's book names. Books outside the 66 are
// left out on purpose; nothing here maps them.
const BOOKS = {
  Gen: 'Genesis', Exo: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deu: 'Deuteronomy',
  Jos: 'Joshua', Jdg: 'Judges', Rut: 'Ruth', '1Sa': '1 Samuel', '2Sa': '2 Samuel',
  '1Ki': '1 Kings', '2Ki': '2 Kings', '1Ch': '1 Chronicles', '2Ch': '2 Chronicles',
  Ezr: 'Ezra', Neh: 'Nehemiah', Est: 'Esther', Job: 'Job', Psa: 'Psalms', Pro: 'Proverbs',
  Ecc: 'Ecclesiastes', Sng: 'Song of Solomon', Isa: 'Isaiah', Jer: 'Jeremiah',
  Lam: 'Lamentations', Ezk: 'Ezekiel', Dan: 'Daniel', Hos: 'Hosea', Jol: 'Joel', Amo: 'Amos',
  Oba: 'Obadiah', Jon: 'Jonah', Mic: 'Micah', Nam: 'Nahum', Hab: 'Habakkuk',
  Zep: 'Zephaniah', Hag: 'Haggai', Zec: 'Zechariah', Mal: 'Malachi',
  Mat: 'Matthew', Mrk: 'Mark', Luk: 'Luke', Jhn: 'John', Act: 'Acts', Rom: 'Romans',
  '1Co': '1 Corinthians', '2Co': '2 Corinthians', Gal: 'Galatians', Eph: 'Ephesians',
  Php: 'Philippians', Col: 'Colossians', '1Th': '1 Thessalonians', '2Th': '2 Thessalonians',
  '1Ti': '1 Timothy', '2Ti': '2 Timothy', Tit: 'Titus', Phm: 'Philemon', Heb: 'Hebrews',
  Jas: 'James', '1Pe': '1 Peter', '2Pe': '2 Peter', '1Jn': '1 John', '2Jn': '2 John',
  '3Jn': '3 John', Jud: 'Jude', Rev: 'Revelation',
};

// ── Packs ──────────────────────────────────────────────────────────────────

function open(file) {
  const p = path.join(PACKS, file);
  if (!fs.existsSync(p)) {
    console.error(`Missing pack: ${p}`);
    process.exit(1);
  }
  return new Database(p, { readonly: true });
}

/** book → chapter → sorted verse numbers. */
function verseIndex(db, where = '', params = []) {
  const idx = new Map();
  const rows = db
    .prepare(`SELECT book, chapter, verse FROM verses ${where} ORDER BY book, chapter, verse`)
    .all(...params);
  for (const r of rows) {
    let chs = idx.get(r.book);
    if (!chs) idx.set(r.book, (chs = new Map()));
    let vs = chs.get(r.chapter);
    if (!vs) chs.set(r.chapter, (vs = []));
    vs.push(r.verse);
  }
  return idx;
}

const has = (idx, book, ch, v) => !!idx.get(book)?.get(ch)?.includes(v);
const lastVerse = (idx, book, ch) => {
  const vs = idx.get(book)?.get(ch);
  return vs ? vs[vs.length - 1] : 0;
};

const ancient = open('consolidated/ancient-languages.sqlite');
const translations = open('consolidated/translations.sqlite');
const OSHB = verseIndex(ancient, 'WHERE translation_id = ?', ['hebrew-oshb']);
const BYZ = verseIndex(ancient, 'WHERE translation_id = ?', ['byz']);
const LXX = verseIndex(ancient, 'WHERE translation_id = ?', ['lxx']);
const LXX2012 = verseIndex(translations, 'WHERE translation_id = ?', ['lxx2012']);
const KJV = verseIndex(open('kjv.sqlite'));
const BSB = verseIndex(open('bsb.sqlite'));
const NET = verseIndex(open('net.sqlite'));
const WEB = verseIndex(open('web.sqlite'));

// ── TVTMS ──────────────────────────────────────────────────────────────────

const problems = [];
const unknownBooks = new Set();

/**
 * One TVTMS cell → { refs, mergedInto }.
 * refs: [{ book, ch, v, title }] expanded; mergedInto: the "[=X]" of an Absent.
 */
function parseCell(cell, side) {
  const raw = (cell ?? '').trim();
  if (!raw) return { refs: [], absent: true, mergedInto: null };
  const absent = /^(Absent|NoVerse|Empty)\b/i.test(raw);
  const bracket = raw.match(/\[=\+?([^\]]+)\]/);
  if (absent) {
    const into = bracket ? parseRefs(bracket[1], side) : [];
    return { refs: [], absent: true, mergedInto: into[0] ?? null };
  }
  const head = raw.replace(/\[.*$/, '').trim();
  return { refs: parseRefs(head, side), absent: false, mergedInto: null };
}

/**
 * "Psa.3:2-8", "Rev.12:18-13:1", "Psa.3:Title", "Gen.5:31.1", "Rev.12:17a",
 * and lists that carry the book forward: "Num.25:19; 26:1".
 */
function parseRefs(text, side) {
  const parts = text.split(';').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const book = parts[0].match(/^[^.]+\./)?.[0] ?? '';
    return parts.flatMap((p, n) => parseRefs(n && !/^[^.]+\./.test(p) ? book + p : p, side));
  }
  const m = text.trim().match(/^([1-3]?[A-Za-z][A-Za-z0-9]{1,2})\.(\d+):(Title|\d+)(?:[.a-z]\w*)?(?:-(?:(\d+):)?(\d+)(?:[.a-z]\w*)?)?$/);
  if (!m) {
    problems.push(`unparsed ref "${text}"`);
    return [];
  }
  const book = BOOKS[m[1]];
  if (!book) {
    unknownBooks.add(m[1]);
    return [];
  }
  const ch = Number(m[2]);
  if (m[3] === 'Title') return [{ book, ch, v: 0, title: true }];
  const v = Number(m[3]);
  if (m[5] === undefined) return [{ book, ch, v, title: false }];
  const ch2 = m[4] ? Number(m[4]) : ch;
  const v2 = Number(m[5]);
  const idx = side === 'hebrew' ? OSHB : KJV;
  const out = [];
  for (let c = ch; c <= ch2; c++) {
    const from = c === ch ? v : 1;
    const to = c === ch2 ? v2 : lastVerse(idx, book, c);
    for (let x = from; x <= to; x++) out.push({ book, ch: c, v: x, title: false });
  }
  return out;
}

const lines = fs.readFileSync(TVTMS, 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith('#DataStart(Condensed)'));
const end = lines.findIndex((l) => l.startsWith('#DataEnd(Condensed)'));
if (start < 0 || end < 0) {
  console.error('TVTMS: condensed data markers not found');
  process.exit(1);
}

const ENGLISH_COLUMN = /^English( KJV|-KJV)?( \(.*\))?$/;

/** "Book ch:v" (Hebrew) → [{ ch, v, part }] (English). */
const hebToEng = new Map();
/** English verses with no Hebrew verse of their own: { into: Hebrew ref, eng }. */
const foldedIn = [];
const key = (book, ch, v) => `${book} ${ch}:${v}`;
let blocks = 0;
let usedBlocks = 0;
let rowsRead = 0;
let duplicates = 0;

let columns = null;
for (let i = start + 1; i < end; i++) {
  const line = lines[i];
  if (!line.trim() || line.startsWith('#') || line.startsWith("'")) continue;
  const cells = line.split('\t');
  const first = cells[0].trim();

  if (first.startsWith('$')) {
    blocks++;
    const named = cells.slice(1).map((c) => c.trim());
    columns = named.some(Boolean) ? named : null;
    continue;
  }
  if (first === 'BIBLES') {
    columns = cells.slice(1).map((c) => c.trim());
    continue;
  }
  if (!columns || line.includes('TEST:') || first === ',' || !cells[1]?.trim()) continue;

  const hebCol = columns.indexOf('Hebrew');
  let engCol = columns.indexOf('EngTitleMerged');
  if (engCol < 0) engCol = columns.findIndex((c) => ENGLISH_COLUMN.test(c));
  if (hebCol < 0 || engCol < 0) continue;
  const kjvCol = columns.findIndex((c) => ENGLISH_COLUMN.test(c));

  const heb = parseCell(cells[1 + hebCol], 'hebrew');
  const eng = parseCell(cells[1 + engCol], 'english');
  if (heb.absent) {
    // An English verse the Hebrew prints inside one of its own verses.
    if (heb.mergedInto) {
      for (const e of eng.refs) if (!e.title) foldedIn.push({ into: heb.mergedInto, eng: e });
    }
    continue;
  }
  if (!heb.refs.length) continue;
  rowsRead++;
  if (rowsRead === 1 || columns.__counted !== true) {
    columns.__counted = true;
    usedBlocks++;
  }

  // A psalm title that the English prints inside verse 1.
  const titleRow = kjvCol >= 0 && /:Title\b/.test(cells[1 + kjvCol] ?? '');

  // Hebrew subverses (Gen.5:31.1) collapse onto their verse.
  const hebVerses = [...new Map(heb.refs.map((r) => [key(r.book, r.ch, r.v), r])).values()];

  const assign = (h, targets) => {
    const k = key(h.book, h.ch, h.v);
    const prev = hebToEng.get(k);
    const next = targets.map((t) => ({ book: t.book, ch: t.ch, v: t.v, part: t.part ?? 'w' }));
    if (prev) {
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        // Subverse rows (Gen.5:31.1 and .2) arrive as two rows for one verse.
        for (const t of next) {
          if (!prev.some((p) => p.ch === t.ch && p.v === t.v)) prev.push(t);
        }
      } else duplicates++;
      return;
    }
    hebToEng.set(k, next);
  };

  if (eng.absent) {
    if (!eng.mergedInto) {
      for (const h of hebVerses) assign(h, []);
      continue;
    }
    const part = titleRow ? 't' : 'w';
    for (const h of hebVerses) assign(h, [{ ...eng.mergedInto, part }]);
    continue;
  }

  const engVerses = [...new Map(eng.refs.filter((r) => !r.title).map((r) => [key(r.book, r.ch, r.v), r])).values()];
  if (!engVerses.length) continue;
  if (engVerses.length === hebVerses.length) {
    hebVerses.forEach((h, n) => assign(h, [engVerses[n]]));
  } else if (engVerses.length === 1) {
    for (const h of hebVerses) assign(h, [engVerses[0]]);
  } else if (hebVerses.length === 1) {
    assign(hebVerses[0], engVerses);
  } else {
    problems.push(`line ${i + 1}: ${hebVerses.length} Hebrew verses against ${engVerses.length} English`);
  }
}

// An English verse the Hebrew folds into a neighbor joins that neighbor's
// targets, but only when it sits right next to them: TVTMS also marks a few
// verses (Neh 7:68) that the Hebrew simply lacks, and those stay unreached.
const adjacent = (book, a, b) =>
  (a.ch === b.ch && Math.abs(a.v - b.v) === 1) ||
  (b.ch === a.ch + 1 && b.v === 1 && a.v === lastVerse(KJV, book, a.ch)) ||
  (a.ch === b.ch + 1 && a.v === 1 && b.v === lastVerse(KJV, book, b.ch));
const notFolded = [];
for (const { into, eng } of foldedIn) {
  const k = key(into.book, into.ch, into.v);
  const ts = hebToEng.get(k) ?? [{ book: into.book, ch: into.ch, v: into.v, part: 'w' }];
  if (ts.some((t) => t.ch === eng.ch && t.v === eng.v)) continue;
  if (ts.some((t) => adjacent(into.book, t, eng))) {
    ts.push({ book: eng.book, ch: eng.ch, v: eng.v, part: 'w' });
    ts.sort((x, y) => x.ch - y.ch || x.v - y.v);
    hebToEng.set(k, ts);
  } else notFolded.push(`${eng.book} ${eng.ch}:${eng.v}`);
}

// A verse that shares its English verse with a title is the body of that verse.
const titled = new Set();
for (const ts of hebToEng.values()) for (const t of ts) if (t.part === 't') titled.add(key(t.book, t.ch, t.v));
for (const ts of hebToEng.values()) {
  for (const t of ts) if (t.part === 'w' && titled.has(key(t.book, t.ch, t.v))) t.part = 'b';
}

/** Hebrew verse → English targets, TVTMS first, else the same number. */
function hebrewTargets(book, ch, v) {
  return hebToEng.get(key(book, ch, v)) ?? [{ book, ch, v, part: 'w' }];
}

// ── Encoding ───────────────────────────────────────────────────────────────

const isIdentity = (ch, v, ts) =>
  ts.length === 1 && ts[0].ch === ch && ts[0].v === v && ts[0].part === 'w';

const fmt = (t) => `${t.ch}:${t.v}${t.part === 'w' ? '' : t.part}`;

/**
 * Encode a scheme: every verse of `index` (book → ch → verses) through
 * `targetsOf`. Lists only chapters that differ, plus the chapters they land in.
 */
function encodeScheme(index, targetsOf, books = [...index.keys()]) {
  const listed = new Map(); // book → Set(ch)
  for (const book of books) {
    for (const [ch, vs] of index.get(book) ?? []) {
      if (vs.some((v) => !isIdentity(ch, v, targetsOf(book, ch, v)))) {
        if (!listed.has(book)) listed.set(book, new Set());
        listed.get(book).add(ch);
      }
    }
  }
  // Close over landing chapters so reverse lookups stay exact.
  let grew = true;
  while (grew) {
    grew = false;
    for (const [book, chs] of listed) {
      for (const ch of [...chs]) {
        for (const v of index.get(book)?.get(ch) ?? []) {
          for (const t of targetsOf(book, ch, v)) {
            if (!chs.has(t.ch) && index.get(book)?.has(t.ch)) {
              chs.add(t.ch);
              grew = true;
            }
          }
        }
      }
    }
  }

  const out = {};
  for (const [book, chs] of listed) {
    out[book] = {};
    for (const ch of [...chs].sort((a, b) => a - b)) {
      const runs = [];
      let run = null;
      for (const v of index.get(book).get(ch)) {
        const ts = targetsOf(book, ch, v);
        const simple = ts.length === 1 && ts[0].part === 'w';
        if (simple && run && run.end === v - 1 && run.tch === ts[0].ch && run.tv + (v - run.start) === ts[0].v) {
          run.end = v;
          continue;
        }
        if (run) runs.push(run.text());
        if (simple) {
          const r = { start: v, end: v, tch: ts[0].ch, tv: ts[0].v };
          r.text = () => `${r.start === r.end ? r.start : `${r.start}-${r.end}`}>${r.tch}:${r.tv}`;
          run = r;
        } else {
          const text = `${v}>${ts.map(fmt).join(',')}`;
          runs.push(text);
          run = null;
        }
      }
      if (run) runs.push(run.text());
      out[book][ch] = runs;
    }
  }
  return out;
}

/** The reader side of the format, for checking the file we just wrote. */
function decode(scheme, book, ch, v) {
  const runs = scheme[book]?.[ch];
  if (!runs) return [{ ch, v, part: 'w' }];
  for (const r of runs) {
    const [src, dst] = r.split('>');
    const [a, b = a] = src.split('-').map(Number);
    if (v < a || v > b) continue;
    if (!dst) return [];
    return dst.split(',').map((t) => {
      const m = t.match(/^(\d+):(\d+)([tb]?)$/);
      return { ch: Number(m[1]), v: Number(m[2]) + (v - a), part: m[3] || 'w' };
    });
  }
  return [];
}

// ── Hebrew ─────────────────────────────────────────────────────────────────

const otBooks = [...OSHB.keys()];
const hebrew = encodeScheme(OSHB, hebrewTargets, otBooks);

// ── BYZ and WEB: the Romans doxology ───────────────────────────────────────

const byzText = ancient
  .prepare("SELECT text FROM verses WHERE translation_id='byz' AND book='Romans' AND chapter=14 AND verse=23")
  .get()?.text ?? '';
const byzDoxologyIn1423 = ['(16:25)', '(16:26)', '(16:27)'].every((m) => byzText.includes(m));
if (!byzDoxologyIn1423) problems.push('BYZ Rom 14:23 no longer carries the doxology markers');
const byz = encodeScheme(
  BYZ,
  (book, ch, v) =>
    book === 'Romans' && ch === 14 && v === 23 && byzDoxologyIn1423
      ? [14, 16, 16, 16].map((c, n) => ({ ch: c, v: n ? 24 + n : 23, part: 'w' }))
      : [{ ch, v, part: 'w' }],
  ['Romans'],
);

const webMoved = [24, 25, 26].every((v) => has(WEB, 'Romans', 14, v));
if (!webMoved) problems.push('WEB no longer has Romans 14:24-26');
const web = encodeScheme(
  WEB,
  (book, ch, v) => {
    if (book !== 'Romans' || !webMoved) return [{ ch, v, part: 'w' }];
    if (ch === 14 && v >= 24) return [{ ch: 16, v: v + 1, part: 'w' }];
    // WEB 16:25 is a note saying where the doxology went, not the doxology.
    if (ch === 16 && v >= 25) return [];
    return [{ ch, v, part: 'w' }];
  },
  ['Romans'],
);

// ── Septuagint ─────────────────────────────────────────────────────────────

// Mirrors lib/lxxPsalms.ts mtToLxxPsalm's chapter rule, inverted: LXX 10-145
// run one behind the Hebrew, LXX 9 holds MT 9 and 10, LXX 146-147 split MT 147.
function lxxToMtChapter(ch) {
  if (ch <= 8 || ch >= 148) return ch;
  if (ch >= 10 && ch <= 145) return ch + 1;
  return null;
}

/** Hebrew title verses in an MT psalm: how many Hebrew verses feed "t". */
function titleVerses(mtCh) {
  let n = 0;
  for (const v of OSHB.get('Psalms')?.get(mtCh) ?? []) {
    if (hebrewTargets('Psalms', mtCh, v).some((t) => t.part === 't')) n++;
  }
  return n;
}

const sameVerses = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** lxx2012 chapters (outside Psalms) whose verses don't line up with English. */
const lxx2012Unmapped = {};
for (const [book, chs] of LXX2012) {
  if (book === 'Psalms' || !KJV.has(book)) continue;
  for (const [ch, vs] of chs) {
    if (!sameVerses(vs, KJV.get(book).get(ch))) (lxx2012Unmapped[book] ??= []).push(ch);
  }
}
const lxx2012Maps = (book, ch) => KJV.has(book) && !lxx2012Unmapped[book]?.includes(ch);

/**
 * The Greek Septuagint against lxx2012, chapter by chapter. Unlisted: the same
 * verses. A number: the Greek counts that many psalm-title verses, which
 * lxx2012 folds into its verse 1. null: the verses don't line up.
 */
const lxxShift = {};
/**
 * Greek Septuagint chapters numbered like the Hebrew (at the MT chapter for
 * Psalms). Used for English only where lxx2012 has no English counterpart.
 */
const lxxHebrew = {};
const lxxTally = { same: 0, shift: 0, none: 0, english: 0, viaHebrew: 0 };
for (const [book, chs] of LXX) {
  for (const [ch, vs] of chs) {
    const other = LXX2012.get(book)?.get(ch);
    // LXX 9 is MT 9 and 10 run together; its title is MT 9's.
    const mt = book === 'Psalms' ? (ch === 9 ? 9 : lxxToMtChapter(ch)) : ch;
    const titles = book === 'Psalms' && mt ? titleVerses(mt) : 0;
    let shift;
    if (sameVerses(vs, other)) shift = 0;
    else if (other && titles > 0 && vs.length - other.length === titles) shift = titles;
    else shift = null;
    if (shift === 0) lxxTally.same++;
    else {
      (lxxShift[book] ??= {})[ch] = shift;
      lxxTally[shift === null ? 'none' : 'shift']++;
    }

    const englishViaLxx2012 = shift !== null && (book === 'Psalms' || lxx2012Maps(book, ch));
    if (englishViaLxx2012) {
      lxxTally.english++;
    } else if (ch !== 9 && mt && sameVerses(vs, OSHB.get(book)?.get(mt))) {
      (lxxHebrew[book] ??= []).push(ch);
      lxxTally.viaHebrew++;
    }
  }
}

// ── Checks ─────────────────────────────────────────────────────────────────

let oshbVerses = 0;
const unmapped = [];
const reached = new Set();
for (const book of otBooks) {
  for (const [ch, vs] of OSHB.get(book)) {
    for (const v of vs) {
      oshbVerses++;
      const ts = decode(hebrew, book, ch, v);
      const good = ts.filter((t) => has(KJV, book, t.ch, t.v));
      if (!good.length) unmapped.push(`${book} ${ch}:${v} → ${ts.map(fmt).join(',') || 'nothing'}`);
      for (const t of ts) reached.add(key(book, t.ch, t.v));
    }
  }
}

function unreached(idx) {
  const out = [];
  for (const book of otBooks) {
    for (const [ch, vs] of idx.get(book) ?? []) {
      for (const v of vs) if (!reached.has(key(book, ch, v))) out.push(`${book} ${ch}:${v}`);
    }
  }
  return out;
}

const spot = [
  ['hebrew', 'Malachi', 3, 19, '4:1'],
  ['hebrew', 'Joel', 4, 1, '3:1'],
  ['hebrew', 'Psalms', 3, 1, '3:1t'],
  ['hebrew', 'Psalms', 3, 2, '3:1b'],
  ['hebrew', 'Psalms', 51, 3, '51:1b'],
  ['hebrew', 'Genesis', 32, 1, '31:55'],
  ['web', 'Romans', 14, 25, '16:26'],
  ['byz', 'Romans', 14, 23, '14:23,16:25,16:26,16:27'],
];
const schemes = { hebrew, byz, web };
const spotResults = spot.map(([s, book, ch, v, want]) => {
  const got = decode(schemes[s], book, ch, v).map(fmt).join(',');
  return { label: `${s} ${book} ${ch}:${v} → ${want}`, ok: got === want, got };
});

// ── Write ──────────────────────────────────────────────────────────────────

const out = { source: SOURCE, hebrew, byz, web, lxxShift, lxxHebrew, lxx2012Unmapped };
fs.writeFileSync(outPath, JSON.stringify(out) + '\n');

console.log(`TVTMS: ${blocks} blocks, ${rowsRead} Hebrew/English rows, ${duplicates} duplicate rows dropped`);
console.log(`Hebrew: ${hebToEng.size} verses differ, ${Object.values(hebrew).reduce((n, b) => n + Object.keys(b).length, 0)} chapters listed`);
console.log(`OSHB verses: ${oshbVerses}, unmapped: ${unmapped.length}`);
for (const u of unmapped.slice(0, 30)) console.log(`  ${u}`);
for (const [name, idx] of [['KJV', KJV], ['BSB', BSB], ['NET', NET]]) {
  const list = unreached(idx);
  console.log(`${name} OT verses no Hebrew verse reaches: ${list.length}${list.length ? ` — ${list.join(', ')}` : ''}`);
}
console.log(`LXX chapters against lxx2012: ${lxxTally.same} same, ${lxxTally.shift} psalm-title shift, ${lxxTally.none} not lined up`);
console.log(`LXX chapters with English: ${lxxTally.english} through lxx2012, ${lxxTally.viaHebrew} through the Hebrew numbering, ${lxxTally.same + lxxTally.shift + lxxTally.none - lxxTally.english - lxxTally.viaHebrew} none`);
console.log(`lxx2012 chapters with no English counterpart (outside Psalms): ${Object.values(lxx2012Unmapped).reduce((n, l) => n + l.length, 0)}`);
if (notFolded.length) console.log(`English verses the Hebrew lacks (left unreached): ${notFolded.join(', ')}`);
if (unknownBooks.size) console.log(`Book codes skipped (outside the 66): ${[...unknownBooks].sort().join(', ')}`);
console.log(`Problems: ${problems.length}`);
for (const p of problems.slice(0, 30)) console.log(`  ${p}`);
console.log('Spot checks:');
for (const r of spotResults) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.label}${r.ok ? '' : ` (got ${r.got})`}`);
console.log(`Wrote ${path.relative(repoRoot, outPath)} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);

if (unmapped.length || spotResults.some((r) => !r.ok)) process.exit(1);
