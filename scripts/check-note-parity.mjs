/**
 * Note parity check.
 *
 * Reworking how notes are stored has to leave the *base* text -- the verse with
 * its notes lifted out -- byte for byte as it was, because saved word
 * highlights, public/red-letter-spans.json and the read-aloud glow are all
 * anchored to character offsets in it. This parses each source with the current
 * parsers and diffs the result against the shipped pack.
 *
 * It also counts what came out, by kind, so a note that used to be dropped on
 * the floor shows up as a gain rather than as silence.
 *
 *   node scripts/check-note-parity.mjs [bsb|kjv|web|lxx2012]
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import {
  parseUSFM, processVerses, cleanUSFMMarkup,
  NOTE_END, XREF_END, PARALLEL_END, ANCHOR_SEP, REF_OPEN, NOTE_I_OPEN,
} from '../packages/packtools/src/parsers/usfm-scanner.mjs';
import { parseUSFX } from '../packages/packtools/src/parsers/usfx-parser.mjs';
import { parseUSFMDirectory } from '../packages/packtools/src/parsers/usfm-parser.mjs';
import { enrichNotes, readUsjNotes, usjCodeFor } from '../packages/packtools/src/parsers/usj-notes.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = join(repoRoot, 'packs/consolidated/translations.sqlite');

/** USFX/USJ book codes to the names the packs store. */
const CODE_TO_NAME = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea', JOL: 'Joel',
  AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah', NAM: 'Nahum', HAB: 'Habakkuk',
  ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi', MAT: 'Matthew',
  MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians',
  '2CO': '2 Corinthians', GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians',
  COL: 'Colossians', '1TH': '1 Thessalonians', '2TH': '2 Thessalonians',
  '1TI': '1 Timothy', '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews',
  JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
  '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

/** The 66 books the packs carry; the sources also ship deuterocanon. */
const CANON = new Set(Object.keys(CODE_TO_NAME));

/** Every note run, whichever of the three terminators closes it. */
const ENDERS = NOTE_END + XREF_END + PARALLEL_END;
const NOTE_RE = new RegExp('\\s*\\+\\s*[^' + ENDERS + ']*[' + ENDERS + ']', 'g');

const stripNotes = (s) => s.replace(NOTE_RE, ' ').replace(/ {2,}/g, ' ').trim();

function tally(rows) {
  const n = { footnote: 0, crossref: 0, parallel: 0, anchored: 0, tagged: 0, italic: 0 };
  for (const text of rows.values()) {
    for (const m of text.matchAll(NOTE_RE)) {
      const run = m[0];
      const end = run[run.length - 1];
      if (end === NOTE_END) n.footnote++;
      else if (end === XREF_END) n.crossref++;
      else n.parallel++;
      if (run.includes(ANCHOR_SEP)) n.anchored++;
      if (run.includes(REF_OPEN)) n.tagged++;
      if (run.includes(NOTE_I_OPEN)) n.italic++;
    }
  }
  return n;
}

function compare(id, rows) {
  const db = new Database(PACK, { readonly: true });
  const want = new Map();
  for (const r of db.prepare('select book,chapter,verse,text from verses where translation_id=?').all(id)) {
    want.set(r.book + '|' + r.chapter + '|' + r.verse, r.text);
  }
  db.close();

  let same = 0, diff = 0, gone = 0, added = 0;
  const examples = [];
  for (const [key, text] of rows) {
    const before = want.get(key);
    if (before === undefined) { added++; continue; }
    if (stripNotes(before) === stripNotes(text)) same++;
    else {
      diff++;
      if (examples.length < 6) {
        examples.push(
          key +
          '\n      was: ' + JSON.stringify(stripNotes(before).slice(0, 140)) +
          '\n      now: ' + JSON.stringify(stripNotes(text).slice(0, 140))
        );
      }
    }
  }
  for (const key of want.keys()) if (!rows.has(key)) gone++;

  const n = tally(rows);
  console.log('\n' + id.toUpperCase());
  console.log(`  base text : ${same} identical, ${diff} differing, ${gone} verses gone, ${added} new`);
  console.log(`  notes     : ${n.footnote} footnotes, ${n.crossref} cross-refs, ${n.parallel} parallel-passage`);
  console.log(`  detail    : ${n.anchored} anchored, ${n.tagged} with a tagged target, ${n.italic} with italics`);
  if (id === 'bsb') console.log(`  usj graft : ${grafted} notes enriched, ${ungrafted} left as USFM wrote them`);
  examples.forEach((e) => console.log('    ' + e));
  return diff === 0;
}

let grafted = 0;
let ungrafted = 0;

function bsbRows() {
  // BIBLE_BOOKS is a plain const inside the build script; lift the name/file
  // pairs out of its source rather than keeping a second copy of the list here.
  const books = [...readFileSync(join(repoRoot, 'scripts/build-bsb-pack.mjs'), 'utf-8')
    .matchAll(/\{ name: '([^']+)',[^}]*file: '([^']+)' \}/g)]
    .map(([, name, file]) => ({ name, file }));
  const rows = new Map();
  for (const book of books) {
    const p = join(repoRoot, 'data-sources/bsb_usfm/bsb_usfm', book.file);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8').replace(/\r/g, '');
    const verses = processVerses(parseUSFM(content));
    // The same USJ graft the build does, so the gate covers it.
    const usjPath = join(repoRoot, 'data-sources/bsb-usj', usjCodeFor(book.file) + '.usj');
    if (existsSync(usjPath)) {
      const graft = enrichNotes(verses, readUsjNotes(usjPath));
      grafted += graft.enriched;
      ungrafted += graft.skipped;
    }
    for (const v of verses) {
      rows.set(book.name + '|' + v.chapter + '|' + v.verse, cleanUSFMMarkup(v.text));
    }
  }
  return rows;
}

function usfxRows(sourcePath) {
  const rows = new Map();
  const { books } = parseUSFX(join(repoRoot, sourcePath));
  for (const b of books) {
    if (!CANON.has(b.code)) continue;
    for (const v of b.verses) {
      rows.set(CODE_TO_NAME[b.code] + '|' + v.chapter + '|' + v.verse, v.text);
    }
  }
  return rows;
}

function lxxRows() {
  const rows = new Map();
  const { verses } = parseUSFMDirectory(join(repoRoot, 'data-sources/osis/eng-lxx2012_usfm'));
  for (const v of verses) {
    rows.set(v.book + '|' + v.chapter + '|' + v.verse, v.text);
  }
  return rows;
}

const SOURCES = {
  bsb: bsbRows,
  kjv: () => usfxRows('data-sources/kjv-usfx/eng-kjv_usfx.xml'),
  web: () => usfxRows('data-sources/web-usfx/eng-web_usfx.xml'),
  lxx2012: lxxRows,
};

const only = process.argv[2];
let ok = true;
for (const [id, build] of Object.entries(SOURCES)) {
  if (only && only !== id) continue;
  ok = compare(id, build()) && ok;
}
console.log(ok ? '\nBase text unchanged.' : '\nBase text moved -- see the diffs above.');
process.exit(ok ? 0 : 1);
