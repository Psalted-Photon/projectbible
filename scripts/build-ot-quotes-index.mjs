/**
 * Old-Testament-quotes index — build script.
 *
 * Emits apps/pwa-polished/src/data/ot-quotes-index.json from the "Quoting
 * Passages" rows already shipping inside packs/consolidated/commentaries.sqlite,
 * where they sit as one commentator among eighteen. Nothing is downloaded and no
 * pack changes, so there is no manifest to regenerate.
 *
 * Why a plain JSON file rather than a pack: the result is well under 200 KB,
 * against book-introductions.json's 778 KB, which the app already imports this
 * way. The argument in build-parallel-index.mjs's docblock applies unchanged.
 *
 * The index is keyed by verse only — no character offsets and no per-translation
 * data — because the mark it drives sits in the verse gutter beside the verse
 * number and nothing is ever drawn onto the verse text. That is what makes the
 * feature identical in every translation, and it is why no pack, sentinel or
 * verse-text byte is touched anywhere in this feature.
 *
 * Run: node scripts/build-ot-quotes-index.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const COMMENTARIES_PACK = resolve(ROOT, 'packs/consolidated/commentaries.sqlite');
const TRANSLATIONS_PACK = resolve(ROOT, 'packs/consolidated/translations.sqlite');
const OUT_PATH = resolve(ROOT, 'apps/pwa-polished/src/data/ot-quotes-index.json');

// Sourced from core rather than re-derived, so this script and the app agree on
// how long a chapter is and on what order the books come in. dist, because core
// is compiled and this is plain node.
const { VERSE_COUNTS } = require(resolve(ROOT, 'packages/core/dist/BibleMetadata.js'));

// VERSE_COUNTS is in canonical order, so the testament split is an index test
// rather than a second list to keep in step with the first.
const BOOK_ORDER = Object.keys(VERSE_COUNTS);
const FIRST_NT_INDEX = BOOK_ORDER.indexOf('Matthew');
if (FIRST_NT_INDEX < 0) throw new Error('Matthew missing from VERSE_COUNTS');

const isNewTestament = (book) => BOOK_ORDER.indexOf(book) >= FIRST_NT_INDEX;
const isOldTestament = (book) => {
  const i = BOOK_ORDER.indexOf(book);
  return i >= 0 && i < FIRST_NT_INDEX;
};

function chapterLength(book, chapter) {
  const counts = VERSE_COUNTS[book];
  if (!counts) throw new Error(`No verse counts for book "${book}"`);
  const n = counts[chapter - 1];
  if (!n) throw new Error(`No verse count for ${book} ${chapter}`);
  return n;
}

// ---------------------------------------------------------------------------
// Book abbreviations
// ---------------------------------------------------------------------------

// The source module uses its own short forms — 62 of them across the whole
// table. They are listed out in full rather than fuzzy-matched, because a
// near-miss here is a reference pointing at the wrong book, which nothing
// downstream could detect. Anything unresolved fails the build.
//
// "Exekiel" is a typo in the source data, not in this table. It is aliased
// explicitly for the same reason: a fuzzy matcher that "fixes" it would also
// quietly fix things that are not typos.
const BOOK_ALIASES = {
  Gen: 'Genesis',
  Exod: 'Exodus',
  Lev: 'Leviticus',
  Num: 'Numbers',
  Deut: 'Deuteronomy',
  Josh: 'Joshua',
  Judg: 'Judges',
  Ruth: 'Ruth',
  '1Sam': '1 Samuel',
  '2Sam': '2 Samuel',
  '1Kgs': '1 Kings',
  '2Kgs': '2 Kings',
  '1Chr': '1 Chronicles',
  '2Chr': '2 Chronicles',
  Ezra: 'Ezra',
  Neh: 'Nehemiah',
  Esth: 'Esther',
  Job: 'Job',
  Ps: 'Psalms',
  Prov: 'Proverbs',
  Eccl: 'Ecclesiastes',
  Song: 'Song of Solomon',
  Isa: 'Isaiah',
  Jer: 'Jeremiah',
  Lam: 'Lamentations',
  Ezek: 'Ezekiel',
  Exekiel: 'Ezekiel', // sic — typo in the source module
  Dan: 'Daniel',
  Hos: 'Hosea',
  Joel: 'Joel',
  Amos: 'Amos',
  Obad: 'Obadiah',
  Jonah: 'Jonah',
  Mic: 'Micah',
  Nah: 'Nahum',
  Hab: 'Habakkuk',
  Zeph: 'Zephaniah',
  Hag: 'Haggai',
  Zech: 'Zechariah',
  Mal: 'Malachi',
  Matt: 'Matthew',
  Mark: 'Mark',
  Luke: 'Luke',
  John: 'John',
  Acts: 'Acts',
  Rom: 'Romans',
  '1Cor': '1 Corinthians',
  '2Cor': '2 Corinthians',
  Gal: 'Galatians',
  Eph: 'Ephesians',
  Phil: 'Philippians',
  Col: 'Colossians',
  '1Thess': '1 Thessalonians',
  '2Thess': '2 Thessalonians',
  '1Tim': '1 Timothy',
  '2Tim': '2 Timothy',
  Titus: 'Titus',
  Phlm: 'Philemon',
  Heb: 'Hebrews',
  Jas: 'James',
  '1Pet': '1 Peter',
  '2Pet': '2 Peter',
  '1John': '1 John',
  '2John': '2 John',
  '3John': '3 John',
  Jude: 'Jude',
  Rev: 'Revelation',
};

/**
 * The pack's own spelling of a book, which is the plural "Psalms" — not
 * bibleData.ts's singular canonical "Psalm". The index emits pack form and the
 * consumer normalises, because every lookup this index feeds goes to a pack.
 * Getting this backwards would silently drop the single largest OT source, so
 * the build asserts a non-zero Psalms count before writing.
 */
function resolveBook(raw) {
  const name = BOOK_ALIASES[raw];
  if (!name) return null;
  return VERSE_COUNTS[name] ? name : null;
}

// ---------------------------------------------------------------------------
// Reference parsing
// ---------------------------------------------------------------------------

// Both dash forms appear in this source as well, so the parser takes either
// rather than dropping the em-dash ones without saying so.
const DASH = '[–—-]';

const RE_VERSE_RANGE = new RegExp(`^(\\d+):(\\d+)${DASH}(\\d+)$`); // 34:8-10
const RE_SINGLE_VERSE = /^(\d+):(\d+)$/; //                           24:43
const RE_SINGLE_CHAPTER = /^(\d+)$/; //                               7

/**
 * Parse one reference from a "Refs:"-style line, e.g. "Ezek 34:8-10".
 *
 * "Isa 8:8, 10" — a verse list — arrives here already split on the comma by the
 * caller, so this only ever sees a single contiguous reference.
 *
 * Returns null on a shape we do not recognise, which the caller reports; a
 * silently dropped reference is the failure mode this whole script guards
 * against.
 */
function parseReference(raw, contextChapter) {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return null;

  // A bare "10" continues the previous reference's book and chapter — that is
  // what the comma form means. Anything else names its own book.
  if (RE_SINGLE_VERSE.test(text) === false && /^\d+$/.test(text) && contextChapter) {
    return {
      book: contextChapter.book,
      chapter: contextChapter.chapter,
      verse: Number(text),
      endVerse: Number(text),
    };
  }

  const m = text.match(/^((?:[1-4]\s*)?[A-Za-z][A-Za-z]*)\s+([\d:,–— -]+)$/);
  if (!m) return null;

  const book = resolveBook(m[1].replace(/\s+/g, ''));
  if (!book) return { unresolvedBook: m[1] };

  const ref = m[2].replace(/\s+/g, '');

  let g;
  if ((g = ref.match(RE_VERSE_RANGE))) {
    const chapter = Number(g[1]);
    const verse = Number(g[2]);
    const endVerse = Number(g[3]);
    // A backwards range means the parse went wrong, not that the data is odd.
    if (endVerse < verse) return null;
    return { book, chapter, verse, endVerse };
  }
  if ((g = ref.match(RE_SINGLE_VERSE))) {
    const chapter = Number(g[1]);
    const verse = Number(g[2]);
    return { book, chapter, verse, endVerse: verse };
  }
  if ((g = ref.match(RE_SINGLE_CHAPTER))) {
    // "Dan 7" means the whole chapter. The card shows the first verse and the
    // range records how far it runs.
    const chapter = Number(g[1]);
    if (!VERSE_COUNTS[book]?.[chapter - 1]) return null;
    return { book, chapter, verse: 1, endVerse: chapterLength(book, chapter) };
  }
  return null;
}

/** Split a reference line's payload into individual references. */
function splitReferences(payload) {
  const out = [];
  let context = null;

  for (const chunk of payload.split(';')) {
    for (const part of chunk.split(',')) {
      const text = part.trim();
      if (!text) continue;
      const parsed = parseReference(text, context);
      out.push({ raw: text, parsed });
      if (parsed && parsed.book) context = { book: parsed.book, chapter: parsed.chapter };
    }
    // A semicolon starts a fresh reference, so a bare number after one is not a
    // continuation of the previous chapter.
    context = null;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

// The source grades its own lines by prefix. "Cited in" is the OT -> NT
// direction: 1,698 rows that would put marks on OT verses pointing forwards,
// which is a different feature. It is counted and dropped here rather than
// mixed in.
const QUOTE_PREFIXES = new Set(['Refs', 'Fulfilled in']);
const ALLUSION_PREFIXES = new Set(['Alludes to', 'Possibly alludes to', 'Related to']);
const REVERSE_PREFIXES = new Set(['Cited in']);

// ---------------------------------------------------------------------------
// Psalms mapping — derived from the shipped pack, then asserted
// ---------------------------------------------------------------------------

// The app's copy of the rule, read straight from the TypeScript source so the
// two can never drift. The file is plain enough to evaluate by extracting the
// numbers it names; requiring it would mean a TS build step in a plain-node
// script.
const MT_PSALM_9_LENGTH = 20;
const LXX_PSALM_146_LENGTH = 11;

/** Mirrors apps/pwa-polished/src/lib/lxxPsalms.ts — asserted against it below. */
function mtToLxxPsalm(chapter, verse) {
  if (chapter < 1 || chapter > 150 || verse < 1) return null;
  if (chapter <= 8) return { chapter, verse };
  if (chapter === 9) return { chapter: 9, verse };
  if (chapter === 10) return { chapter: 9, verse: verse + MT_PSALM_9_LENGTH };
  if (chapter <= 146) return { chapter: chapter - 1, verse };
  if (chapter === 147) {
    return verse <= LXX_PSALM_146_LENGTH
      ? { chapter: 146, verse }
      : { chapter: 147, verse: verse - LXX_PSALM_146_LENGTH };
  }
  return { chapter, verse };
}

/**
 * Check the rule above against lxx2012's own superscriptions, which carry the
 * Hebrew number in parentheses — LXX 103:1 opens "(104)". Every labelled
 * chapter must agree, or the build stops: nobody should be hand-maintaining a
 * numbering table that the shipped data already states.
 *
 * The verse arithmetic for the two chapters that split or merge is checked
 * separately, by verse count, because a superscription only labels a chapter.
 */
function assertPsalmsMapping(db) {
  const rows = db
    .prepare(
      `select chapter, text from verses
       where translation_id = 'lxx2012' and book = 'Psalms' and verse = 1
       order by chapter`,
    )
    .all();

  const mismatches = [];
  let labelled = 0;

  for (const row of rows) {
    const m = row.text.match(/^[\s\S]{0,4}?<i>\s*\((\d+)/);
    if (!m) continue;
    labelled++;
    const mt = Number(m[1]);
    const got = mtToLxxPsalm(mt, 1);
    if (!got || got.chapter !== row.chapter) {
      mismatches.push(`MT ${mt} -> LXX ${got?.chapter ?? 'null'}, but pack labels LXX ${row.chapter}`);
    }
  }

  if (labelled < 100) {
    throw new Error(`Only ${labelled} labelled LXX psalm superscriptions found — pack shape changed?`);
  }
  if (mismatches.length) {
    throw new Error(
      `Psalms mapping does not match lxx2012 superscriptions:\n  ${mismatches.join('\n  ')}`,
    );
  }

  // The merge and the split move verses, not just chapters, so their lengths
  // are checked directly against both packs.
  const count = (translation, chapter) =>
    db
      .prepare(
        `select count(*) c from verses
         where translation_id = ? and book = 'Psalms' and chapter = ?`,
      )
      .get(translation, chapter).c;

  const checks = [
    ['MT 9 length', count('bsb', 9), MT_PSALM_9_LENGTH],
    ['LXX 9 = MT 9 + MT 10', count('lxx2012', 9), count('bsb', 9) + count('bsb', 10)],
    ['LXX 146 length', count('lxx2012', 146), LXX_PSALM_146_LENGTH],
    ['LXX 146 + 147 = MT 147', count('lxx2012', 146) + count('lxx2012', 147), count('bsb', 147)],
  ];

  for (const [label, got, want] of checks) {
    if (got !== want) throw new Error(`Psalms verse arithmetic failed — ${label}: ${got} != ${want}`);
  }

  return { labelled, checks: checks.length };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function main() {
  for (const p of [COMMENTARIES_PACK, TRANSLATIONS_PACK]) {
    if (!existsSync(p)) {
      console.error(`Missing ${p} — build the consolidated packs first.`);
      process.exit(1);
    }
  }

  const Database = require('better-sqlite3');
  const translations = new Database(TRANSLATIONS_PACK, { readonly: true });
  const psalms = assertPsalmsMapping(translations);

  // Which LXX chapters actually exist, so a precomputed coordinate is never a
  // reference into a chapter the pack does not carry.
  const lxxChapters = new Map();
  for (const row of translations
    .prepare(
      `select book, chapter, max(verse) mx from verses
       where translation_id = 'lxx2012' group by book, chapter`,
    )
    .all()) {
    lxxChapters.set(`${row.book}|${row.chapter}`, row.mx);
  }
  translations.close();

  const commentaries = new Database(COMMENTARIES_PACK, { readonly: true });
  const rows = commentaries
    .prepare(
      `select book, chapter, verse_start, text from commentary_entries
       where author = 'Quoting Passages'
       order by id`,
    )
    .all();
  commentaries.close();

  const unparsed = [];
  const unresolvedBooks = new Map();
  const stats = {
    rows: rows.length,
    reverseLines: 0,
    unknownPrefix: new Map(),
    skippedNonNtAnchor: 0,
    skippedNonOtTarget: 0,
    lxxMissing: 0,
  };

  /** anchor key -> { grade, refs } */
  const byVerse = new Map();

  for (const row of rows) {
    // The feature marks Old Testament quotations *in the New Testament*. A
    // handful of these rows hang a forward-looking grade on an OT verse
    // ("Ezekiel 33:30 Fulfilled in: Mark 3:32-35") — true, but the reverse
    // direction, and marking it here would put OT-quote marks on OT verses.
    if (!isNewTestament(row.book)) {
      if (row.text.split('\n').some((l) => !REVERSE_PREFIXES.has(l.trim().split(':')[0]))) {
        stats.skippedNonNtAnchor++;
      }
      continue;
    }

    for (const line of row.text.split('\n')) {
      const text = line.trim();
      if (!text) continue;

      const m = text.match(/^([^:]+):\s*(.*)$/);
      if (!m) {
        unparsed.push(`${row.book} ${row.chapter}:${row.verse_start} (no prefix) "${text}"`);
        continue;
      }

      const prefix = m[1].trim();
      if (REVERSE_PREFIXES.has(prefix)) {
        stats.reverseLines++;
        continue;
      }

      let grade;
      if (QUOTE_PREFIXES.has(prefix)) grade = 'quote';
      else if (ALLUSION_PREFIXES.has(prefix)) grade = 'allusion';
      else {
        stats.unknownPrefix.set(prefix, (stats.unknownPrefix.get(prefix) ?? 0) + 1);
        continue;
      }

      for (const { raw, parsed } of splitReferences(m[2])) {
        if (!parsed) {
          unparsed.push(`${row.book} ${row.chapter}:${row.verse_start} -> "${raw}"`);
          continue;
        }
        if (parsed.unresolvedBook) {
          unresolvedBooks.set(
            parsed.unresolvedBook,
            (unresolvedBooks.get(parsed.unresolvedBook) ?? 0) + 1,
          );
          continue;
        }

        // A New Testament target is a cross-reference between two NT books, not
        // an Old Testament quotation. Dropped for the same reason as the OT
        // anchors above.
        if (!isOldTestament(parsed.book)) {
          stats.skippedNonOtTarget++;
          continue;
        }

        const key = `${row.book}|${row.chapter}|${row.verse_start}`;
        let entry = byVerse.get(key);
        if (!entry) {
          entry = {
            book: row.book,
            chapter: row.chapter,
            verse: row.verse_start,
            grade,
            refs: [],
            seen: new Set(),
          };
          byVerse.set(key, entry);
        }

        // A verse carrying both grades takes the stronger: the mark says
        // "there is an OT quotation somewhere in this verse", and a quotation
        // outranks an allusion in answering that.
        if (grade === 'quote') entry.grade = 'quote';

        const refKey = `${parsed.book}|${parsed.chapter}|${parsed.verse}|${parsed.endVerse}`;
        if (entry.seen.has(refKey)) continue;
        entry.seen.add(refKey);

        entry.refs.push({
          book: parsed.book,
          chapter: parsed.chapter,
          verse: parsed.verse,
          ...(parsed.endVerse !== parsed.verse ? { endVerse: parsed.endVerse } : {}),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Precompute the Septuagint coordinates, so the reader never does
  // versification maths
  // -------------------------------------------------------------------------

  const entries = [];
  const byChapter = {};

  // Canonical reading order, so the file diffs sensibly between rebuilds.
  const sorted = [...byVerse.values()].sort(
    (a, b) =>
      BOOK_ORDER.indexOf(a.book) - BOOK_ORDER.indexOf(b.book) ||
      a.chapter - b.chapter ||
      a.verse - b.verse,
  );

  for (const entry of sorted) {
    const lxx = [];

    for (const ref of entry.refs) {
      let target;
      if (ref.book === 'Psalms') {
        const mapped = mtToLxxPsalm(ref.chapter, ref.verse);
        target = mapped ? { book: 'Psalms', chapter: mapped.chapter, verse: mapped.verse } : null;
      } else {
        target = { book: ref.book, chapter: ref.chapter, verse: ref.verse };
      }

      // Only emit a coordinate the pack can actually answer. lxx2012 does not
      // carry every OT book, and the card's "no Septuagint for this one" line
      // is the honest answer where it does not — never a silent fallback to
      // whatever the reader is currently in.
      const max = target && lxxChapters.get(`${target.book}|${target.chapter}`);
      if (!max || target.verse > max) {
        stats.lxxMissing++;
        lxx.push(null);
        continue;
      }
      lxx.push(target);
    }

    const index = entries.length;
    entries.push({ grade: entry.grade, refs: entry.refs, lxx });
    (byChapter[`${entry.book}|${entry.chapter}`] ??= {})[String(entry.verse)] = index;
  }

  // -------------------------------------------------------------------------
  // Assertions — a silently empty source is the failure this guards against
  // -------------------------------------------------------------------------

  if (unresolvedBooks.size) {
    console.error('\nUnresolved book abbreviations — add them to BOOK_ALIASES:');
    for (const [raw, n] of unresolvedBooks) console.error(`  ${raw} (${n})`);
    process.exit(1);
  }

  const psalmRefs = entries.reduce(
    (n, e) => n + e.refs.filter((r) => r.book === 'Psalms').length,
    0,
  );
  if (psalmRefs === 0) {
    console.error('\nNo Psalms references survived — the Psalm/Psalms spelling has drifted.');
    process.exit(1);
  }
  if (entries.length < 500) {
    console.error(`\nOnly ${entries.length} entries — the source shape has changed.`);
    process.exit(1);
  }

  const out = { version: 1, byChapter, entries };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out));

  const bytes = Buffer.byteLength(JSON.stringify(out));
  const quotes = entries.filter((e) => e.grade === 'quote').length;
  const allusions = entries.length - quotes;
  const refCount = entries.reduce((n, e) => n + e.refs.length, 0);

  console.log('OT quotes index');
  console.log(`  Source rows          ${stats.rows}`);
  console.log(`  Psalms mapping       ${psalms.labelled} superscriptions + ${psalms.checks} verse-count checks, all agree`);
  console.log(`  Reverse lines        ${stats.reverseLines} dropped (Cited in: — OT -> NT)`);
  console.log(`  Non-NT anchors       ${stats.skippedNonNtAnchor} dropped`);
  console.log(`  Non-OT targets       ${stats.skippedNonOtTarget} dropped`);
  console.log(`  Marked verses        ${entries.length} (${quotes} quote, ${allusions} allusion)`);
  console.log(`  References           ${refCount} (${psalmRefs} in Psalms)`);
  console.log(`  Without a Septuagint ${stats.lxxMissing}`);
  console.log(`  Chapter buckets      ${Object.keys(byChapter).length}`);
  console.log(`  Size                 ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`  -> ${OUT_PATH}`);

  if (stats.unknownPrefix.size) {
    console.log('\n  Unknown line prefixes (not graded, not emitted):');
    for (const [p, n] of stats.unknownPrefix) console.log(`    ${p} (${n})`);
  }

  // Anything unparsed is a silently missing quotation, so it is always shown.
  if (unparsed.length) {
    console.log(`\n  ${unparsed.length} unparsed:`);
    for (const u of unparsed.slice(0, 40)) console.log(`    ${u}`);
    if (unparsed.length > 40) console.log(`    … and ${unparsed.length - 40} more`);
  } else {
    console.log('\n  No unparsed references.');
  }

  // The three the plan calls out by name, printed so a rebuild states them
  // rather than needing a JSON dig to confirm.
  console.log('\n  Spot checks:');
  for (const [book, chapter, verse] of [
    ['Hebrews', 1, 7],
    ['Hebrews', 10, 5],
    ['Matthew', 27, 46],
    ['Romans', 3, 14],
  ]) {
    const idx = byChapter[`${book}|${chapter}`]?.[String(verse)];
    if (idx === undefined) {
      console.log(`    ${book} ${chapter}:${verse} -> (no entry)`);
      continue;
    }
    const e = entries[idx];
    const parts = e.refs.map((r, i) => {
      const ref = `${r.book} ${r.chapter}:${r.verse}${r.endVerse ? `-${r.endVerse}` : ''}`;
      const l = e.lxx[i];
      return `${ref} -> ${l ? `LXX ${l.book} ${l.chapter}:${l.verse}` : 'no LXX'}`;
    });
    console.log(`    ${book} ${chapter}:${verse} [${e.grade}] ${parts.join(' | ')}`);
  }
}

main();
