/**
 * Parallel-passage index — build script.
 *
 * Emits apps/pwa-polished/src/data/parallel-index.json from two sources that
 * already ship: the BSB publisher's own parallel markers, carried inline in
 * verse text, and the Robertson-Broadus gospel harmony. Nothing is downloaded
 * and no pack changes, so there is no manifest to regenerate.
 *
 * Why a plain JSON file rather than a pack: the result is ~450 KB raw and ~46 KB
 * over the wire, against book-introductions.json's 778 KB, which the app already
 * imports this way. A pack would mean a manifest regen, a download, an install
 * step and an "is it installed?" branch in the reader, for a file half the size
 * of one that ships as a plain import today.
 *
 * The BSB markers are read from BSB specifically, not from whatever translation
 * happens to be current: only BSB carries them (kjv, web and lxx2012 have
 * none). That is fine, because what gets emitted is plain verse references, so
 * the shipped index works whatever translation a pane is showing.
 *
 * Run: node scripts/build-parallel-index.mjs
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const TRANSLATIONS_PACK = resolve(ROOT, 'packs/consolidated/translations.sqlite');
const ROBERTSON_JSON = resolve(ROOT, 'apps/pwa-polished/src/data/robertson-harmony.json');
const OUT_PATH = resolve(ROOT, 'apps/pwa-polished/src/data/parallel-index.json');

/** Terminates a parallel-reference run in BSB verse text. */
const PARALLEL_END = '\u0015';

// ---------------------------------------------------------------------------
// Verse counts — needed to resolve any range whose end is open
// ---------------------------------------------------------------------------

// Sourced from core rather than re-derived, so this script and the app agree on
// how long a chapter is. dist, because core is compiled and this is plain node.
const { VERSE_COUNTS } = require(resolve(ROOT, 'packages/core/dist/BibleMetadata.js'));

function chapterLength(book, chapter) {
  const counts = VERSE_COUNTS[book];
  if (!counts) throw new Error(`No verse counts for book "${book}"`);
  const n = counts[chapter - 1];
  if (!n) throw new Error(`No verse count for ${book} ${chapter}`);
  return n;
}

// ---------------------------------------------------------------------------
// Book names
// ---------------------------------------------------------------------------

// BSB's reference text uses the same canonical book names as the pack's own
// book column, with exactly one exception across all 2,032 references, so a
// full alias table would be dead weight. Anything unresolved is reported rather
// than guessed at — a silently dropped reference is the failure mode here.
const BOOK_ALIASES = {
  Song: 'Song of Solomon',
};

function normalizeBook(raw) {
  const name = BOOK_ALIASES[raw] ?? raw;
  return VERSE_COUNTS[name] ? name : null;
}

// ---------------------------------------------------------------------------
// Reference parsing
// ---------------------------------------------------------------------------

// Both dash forms matter. 2,014 of the references are "Book c:v–v" with an
// en-dash (U+2013); the 5 cross-chapter ones use an em-dash (U+2014), and an
// en-dash-only parser drops them without saying so.
const DASH = '[\u2013\u2014-]';

const RE_CHAPTER_VERSE_RANGE = new RegExp(`^(\\d+):(\\d+)${DASH}(\\d+):(\\d+)$`); // 15:29—16:3
const RE_VERSE_RANGE = new RegExp(`^(\\d+):(\\d+)${DASH}(\\d+)$`); //             1:1–5
const RE_SINGLE_VERSE = /^(\d+):(\d+)$/; //                                       11:4
const RE_CHAPTER_RANGE = new RegExp(`^(\\d+)${DASH}(\\d+)$`); //                  4—9
const RE_SINGLE_CHAPTER = /^(\d+)$/; //                                           4

/**
 * Parse one reference, e.g. "Matthew 13:1–9" or "Genesis 4—9".
 * Returns a passage, or null if the shape is not one we recognise.
 */
function parseReference(raw) {
  const text = raw.trim().replace(/\s+/g, ' ');
  // Book names run up to the first digit, and may carry a numeric prefix of
  // their own ("1 Chronicles"), so the leading number is only part of the book
  // when a letter follows it.
  const m = text.match(/^((?:[123]\s+)?[A-Za-z][A-Za-z ]*?)\s+([\d:\u2013\u2014 -]+)$/);
  if (!m) return null;

  const book = normalizeBook(m[1]);
  if (!book) return null;
  const ref = m[2].replace(/\s+/g, '');

  let startChapter, startVerse, endChapter, endVerse;

  let g;
  if ((g = ref.match(RE_CHAPTER_VERSE_RANGE))) {
    [startChapter, startVerse, endChapter, endVerse] = g.slice(1).map(Number);
  } else if ((g = ref.match(RE_VERSE_RANGE))) {
    startChapter = Number(g[1]);
    startVerse = Number(g[2]);
    endChapter = startChapter;
    endVerse = Number(g[3]);
  } else if ((g = ref.match(RE_SINGLE_VERSE))) {
    startChapter = endChapter = Number(g[1]);
    startVerse = endVerse = Number(g[2]);
  } else if ((g = ref.match(RE_CHAPTER_RANGE))) {
    // A whole-chapter span: "Genesis 4—9" means all of chapter 4 through all of
    // chapter 9, so the end verse comes from the chapter-length table.
    startChapter = Number(g[1]);
    startVerse = 1;
    endChapter = Number(g[2]);
    endVerse = chapterLength(book, endChapter);
  } else if ((g = ref.match(RE_SINGLE_CHAPTER))) {
    startChapter = endChapter = Number(g[1]);
    startVerse = 1;
    endVerse = chapterLength(book, startChapter);
  } else {
    return null;
  }

  // A backwards range means the parse went wrong, not that the data is odd.
  if (endChapter < startChapter) return null;
  if (endChapter === startChapter && endVerse < startVerse) return null;

  return finishPassage({ book, startChapter, startVerse, endChapter, endVerse });
}

/**
 * Fill in the derived fields the follower's targeting needs on every scroll
 * tick: the total verse count, and the per-chapter spans for a passage that
 * crosses a chapter break. Precomputed here because working them out at runtime
 * means a chapter-length lookup per scroll event, in a view running four
 * readers — and the chapter-length table is the one thing the app would
 * otherwise have to consult to know how long a passage is.
 *
 * chapterSpans is emitted only when the passage actually crosses a chapter
 * break, which is 20 passages out of ~3,600. For the rest the single span is
 * exactly the passage's own start and end, so storing it would be repeating
 * three fields the object already has — 112 KB of the file to say nothing new.
 * parallelIndex.ts reconstructs it for the common case.
 */
function finishPassage(p) {
  const chapterSpans = [];
  let verseCount = 0;

  for (let ch = p.startChapter; ch <= p.endChapter; ch++) {
    const from = ch === p.startChapter ? p.startVerse : 1;
    const to = ch === p.endChapter ? p.endVerse : chapterLength(p.book, ch);
    const count = to - from + 1;
    if (count <= 0) continue;
    chapterSpans.push({ ch, from, count });
    verseCount += count;
  }

  const out = { ...p, verseCount };
  if (chapterSpans.length > 1) out.chapterSpans = chapterSpans;
  return out;
}

// ---------------------------------------------------------------------------
// Source 1 — Robertson-Broadus harmony
// ---------------------------------------------------------------------------

function loadRobertsonGroups() {
  const sections = JSON.parse(readFileSync(ROBERTSON_JSON, 'utf8'));
  const groups = [];
  const skipped = [];

  for (const section of sections) {
    const passages = [];

    for (const raw of section.passages ?? []) {
      const book = normalizeBook(raw.book);
      if (!book) {
        skipped.push(`§${section.section} ${raw.label} (unknown book)`);
        continue;
      }
      // endVerse is nullable in HarmonySection and means "to end of chapter".
      const endChapter = raw.endChapter ?? raw.startChapter;
      const endVerse = raw.endVerse ?? chapterLength(book, endChapter);
      passages.push(
        finishPassage({
          book,
          startChapter: raw.startChapter,
          startVerse: raw.startVerse,
          endChapter,
          endVerse,
        }),
      );
    }

    if (passages.length === 0) continue;

    groups.push({
      id: groups.length,
      source: 'robertson',
      title: section.title,
      robertsonSection: section.section,
      part: section.part,
      part_title: section.part_title,
      // A section only one Gospel carries is not a parallel, but it is the whole
      // point of the "only in Luke" marking and of the contents list, so it is
      // kept and flagged rather than dropped.
      ...(passages.length === 1 ? { soloRobertson: true } : {}),
      passages,
    });
  }

  return { groups, skipped };
}

// ---------------------------------------------------------------------------
// Source 2 — BSB parallel markers
// ---------------------------------------------------------------------------

function loadBsbGroups(startId) {
  const Database = require('better-sqlite3');
  const db = new Database(TRANSLATIONS_PACK, { readonly: true });

  const rows = db
    .prepare(
      `select book, chapter, verse, text from verses
       where translation_id = 'bsb' and text like '%' || char(21) || '%'
       order by rowid`,
    )
    .all();

  const groups = [];
  const unparsed = [];
  let refCount = 0;

  // Where the next marker in the same chapter falls, which is how far an anchor
  // reaches — see anchorEnd below.
  const markersByChapter = new Map();
  for (const row of rows) {
    const key = `${row.book}|${row.chapter}`;
    if (!markersByChapter.has(key)) markersByChapter.set(key, []);
    markersByChapter.get(key).push(row.verse);
  }
  for (const list of markersByChapter.values()) list.sort((a, b) => a - b);

  /**
   * How far the anchor verse's own passage runs.
   *
   * BSB hangs its markers on a single verse, so taken literally every anchor is
   * one verse long while its targets run to twenty. That asymmetry would break
   * the follower's targeting outright: the fraction of the way through a
   * passage is verse index over verse count, so a one-verse master sits at 0
   * forever and the followers never move, however far you scroll.
   *
   * The marker opens a section rather than pointing at a line — the median gap
   * between consecutive markers in a chapter is 7 verses, against the ~9-verse
   * average of the ranges they point to. So an anchor runs to the verse before
   * the next marker, or to the end of its chapter if it is the last one.
   *
   * That end is then capped to the mean length of this group's own targets,
   * because a chapter with a single marker would otherwise hand its anchor the
   * whole chapter — up to 66 verses — and line a 5-verse parallel up against
   * it. The targets are the best available statement of how long the passage
   * actually is.
   */
  function anchorEnd(book, chapter, verse, targets) {
    const markers = markersByChapter.get(`${book}|${chapter}`) ?? [];
    const next = markers.find((v) => v > verse);
    const chapterEnd = next ? next - 1 : chapterLength(book, chapter);

    const mean = Math.round(
      targets.reduce((a, t) => a + t.verseCount, 0) / targets.length,
    );
    return Math.max(verse, Math.min(chapterEnd, verse + mean - 1));
  }

  for (const row of rows) {
    // A verse can carry more than one run, and can carry footnotes as well, so
    // each run is found from its terminator backwards to the '+' that opened
    // it. Footnotes always close before a parallel run opens, so the nearest
    // preceding '+' is always this run's own.
    let end = -1;
    while ((end = row.text.indexOf(PARALLEL_END, end + 1)) !== -1) {
      const open = row.text.lastIndexOf('+', end);
      if (open === -1) {
        unparsed.push(`${row.book} ${row.chapter}:${row.verse} (no opening marker)`);
        continue;
      }

      const passages = [];
      for (const part of row.text.slice(open + 1, end).split(';')) {
        if (!part.trim()) continue;
        refCount++;
        const passage = parseReference(part);
        if (passage) passages.push(passage);
        else unparsed.push(`${row.book} ${row.chapter}:${row.verse} -> "${part.trim()}"`);
      }

      if (passages.length === 0) continue;

      // The anchor verse is a member of its own group: the pane showing the
      // anchor has to know where it sits, the same as every other pane.
      groups.push({
        id: startId + groups.length,
        source: 'bsb',
        passages: [
          finishPassage({
            book: row.book,
            startChapter: row.chapter,
            startVerse: row.verse,
            endChapter: row.chapter,
            endVerse: anchorEnd(row.book, row.chapter, row.verse, passages),
          }),
          ...passages,
        ],
      });
    }
  }

  db.close();
  return { groups, unparsed, refCount };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** A passage's identity for duplicate detection. */
function passageKey(p) {
  return `${p.book}|${p.startChapter}:${p.startVerse}-${p.endChapter}:${p.endVerse}`;
}

/**
 * Drop BSB groups that duplicate a Robertson one. Robertson wins: it is
 * hand-curated and carries a title, a section number and a part.
 *
 * Exact passage equality would catch almost nothing, because the two sources
 * chose their ranges independently. What actually marks a duplicate is that the
 * same books are being lined up over overlapping verses, so that is the test:
 * same set of books, and every shared book's ranges overlapping.
 */
function isDuplicate(bsbGroup, robertsonGroups) {
  const books = new Set(bsbGroup.passages.map((p) => p.book));

  for (const rg of robertsonGroups) {
    const rBooks = new Set(rg.passages.map((p) => p.book));
    if (rBooks.size !== books.size) continue;
    if (![...books].every((b) => rBooks.has(b))) continue;

    const allOverlap = bsbGroup.passages.every((p) => {
      const rp = rg.passages.find((x) => x.book === p.book);
      if (!rp) return false;
      return (
        compareRef(p.startChapter, p.startVerse, rp.endChapter, rp.endVerse) <= 0 &&
        compareRef(rp.startChapter, rp.startVerse, p.endChapter, p.endVerse) <= 0
      );
    });
    if (allOverlap) return true;
  }
  return false;
}

function compareRef(aCh, aV, bCh, bV) {
  return aCh !== bCh ? aCh - bCh : aV - bV;
}

// ---------------------------------------------------------------------------
// Chapter buckets
// ---------------------------------------------------------------------------

/**
 * Every chapter a group touches maps to that group, so a lookup at runtime is a
 * bucket read plus a range test over a handful of candidates rather than a scan
 * of every group.
 */
function buildByChapter(groups) {
  const byChapter = {};
  for (const group of groups) {
    for (const p of group.passages) {
      for (let ch = p.startChapter; ch <= p.endChapter; ch++) {
        (byChapter[`${p.book}|${ch}`] ??= []).push(group.id);
      }
    }
  }
  for (const key of Object.keys(byChapter)) {
    byChapter[key] = [...new Set(byChapter[key])].sort((a, b) => a - b);
  }
  return byChapter;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(TRANSLATIONS_PACK)) {
    console.error(`Missing ${TRANSLATIONS_PACK} — build the consolidated packs first.`);
    process.exit(1);
  }

  const robertson = loadRobertsonGroups();
  const bsb = loadBsbGroups(robertson.groups.length);

  const kept = bsb.groups.filter((g) => !isDuplicate(g, robertson.groups));
  const dropped = bsb.groups.length - kept.length;

  // Renumber so ids stay dense after the merge, then bucket.
  const groups = [...robertson.groups, ...kept].map((g, i) => ({ ...g, id: i }));
  const byChapter = buildByChapter(groups);

  const out = { version: 1, groups, byChapter };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out));

  const solo = robertson.groups.filter((g) => g.soloRobertson).length;
  const bytes = Buffer.byteLength(JSON.stringify(out));

  console.log('Parallel index');
  console.log(`  Robertson sections   ${robertson.groups.length} (${solo} solo)`);
  console.log(`  BSB references       ${bsb.refCount} in ${bsb.groups.length} groups`);
  console.log(`  Dropped as duplicate ${dropped}`);
  console.log(`  Groups written       ${groups.length}`);
  console.log(`  Chapter buckets      ${Object.keys(byChapter).length}`);
  console.log(`  Size                 ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`  -> ${OUT_PATH}`);

  // Anything unparsed is a silently missing parallel, so it is always shown.
  const problems = [...robertson.skipped, ...bsb.unparsed];
  if (problems.length) {
    console.log(`\n  ${problems.length} unparsed:`);
    for (const p of problems.slice(0, 40)) console.log(`    ${p}`);
    if (problems.length > 40) console.log(`    … and ${problems.length - 40} more`);
  } else {
    console.log('\n  No unparsed references.');
  }
}

main();
