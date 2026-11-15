#!/usr/bin/env node

/**
 * Build Story Mode's data file from the hand-written sources in scripts/stories/.
 *
 * Each source file is one book:
 *
 *   book: Genesis
 *
 *   ## In the Beginning          <- a bigger story; starts where its first smaller story starts
 *   1:1   The Creation           <- a smaller story; runs until the next one begins
 *   2:4   Man and Woman in the Garden
 *
 * Optional extras, for books that want them (Psalms uses all four):
 *
 *   card: How Psalms Is Built    <- a collapsed card at the top of the book;
 *   - Book I (1–41) · ...           "- " lines are its list rows ("Label · text"),
 *   > From cries to praise: ...      "> " lines its paragraphs
 *   === Book I                   <- a divider label before the next bigger story;
 *                                   its chapters are worked out like a story's
 *   3:1   Deliver Me | David · Cry for help   <- "| " adds an info line
 *         -> 2 Samuel 15:13–17:22             <- a story link under the story above;
 *         -> 2 Chronicles 10:1–19 | Also told in   "| " gives its label (default "Written when")
 *
 * Lines starting with "#" (one hash and a space) are comments. A story ends
 * where the next begins, so the first smaller story must start at 1:1 and
 * every verse after it is covered by construction. The chapter range each
 * story shows in brackets is worked out here from those starts, never typed
 * by hand.
 *
 * Checks (the build fails on any of them): the book name is real, every
 * reference exists, starts are strictly in order, the book opens at 1:1, every
 * bigger story holds at least one smaller story, no title is empty, and every
 * verse of the book lands in exactly one smaller story.
 *
 * Output: apps/pwa-polished/public/stories.json, one line per book:
 *   { v: 1, books: { Genesis: [ { t, c, v, e, s: [ { t, c, v, e } ] } ] }, cards: { Psalms: { t, p } } }
 * where c:v is the first verse and e is the last chapter the story touches.
 * A bigger story after a divider also has d (its label) and de (the last
 * chapter before the next divider). A smaller story may have i (its info
 * line) and l: { b, c, v, t, n? } (the link's book, first verse, printed text
 * and label, when it isn't "Written when").
 * A link's whole range is checked, end included.
 *
 * Psalms is also checked for its info lines: every psalm's opening story has
 * one, "Author · Kind", with the kind from the fixed list below.
 *
 * Usage:
 *   node scripts/build-stories.mjs              build + check every source file
 *   node scripts/build-stories.mjs --show Mark  also print a book's outline for review
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { VERSE_COUNTS } from '../packages/core/dist/BibleMetadata.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(repoRoot, 'scripts', 'stories');
const OUTPUT = join(repoRoot, 'apps', 'pwa-polished', 'public', 'stories.json');
const BOOK_ORDER = Object.keys(VERSE_COUNTS);

const args = process.argv.slice(2);
const showIdx = args.indexOf('--show');
const showBooks = showIdx >= 0 ? args.slice(showIdx + 1) : [];

const errors = [];
const fail = (file, line, msg) => errors.push(`${file}${line ? `:${line}` : ''}  ${msg}`);

/** The kinds a psalm's info line may name, in plain words. */
const PSALM_KINDS = ['Cry for help', 'Praise', 'Thanks', 'Trust', 'Wisdom', 'The King', 'History', 'Pilgrim song', 'Confession', 'Mixed'];

/** "2 Samuel 11:1–12:25", "1 Samuel 21:10–15" or "Psalm 18:1": checked whole, end included. */
function parseLink(file, n, whole) {
  const [text, label, extra] = whole.split('|').map((x) => x.trim());
  if (label === '') fail(file, n, 'empty link label after "|"');
  if (extra !== undefined) fail(file, n, 'more than one "|" on a link');
  const m = text.match(/^(.+?)\s+(\d+):(\d+)(?:\s*[–-]\s*(?:(\d+):)?(\d+))?$/);
  if (!m) { fail(file, n, `can't read this link: "${text}"`); return null; }
  const b = m[1];
  const counts = VERSE_COUNTS[b];
  if (!counts) { fail(file, n, `unknown book "${b}" in link`); return null; }
  const c = +m[2], v = +m[3];
  const ec = m[4] ? +m[4] : c, ev = m[5] ? +m[5] : v;
  const real = (ch, vs) => ch >= 1 && ch <= counts.length && vs >= 1 && vs <= counts[ch - 1];
  if (!real(c, v)) fail(file, n, `link ${b} ${c}:${v} doesn't exist`);
  if (!real(ec, ev)) fail(file, n, `link end ${b} ${ec}:${ev} doesn't exist`);
  if (ec < c || (ec === c && ev < v)) fail(file, n, `link ${text} ends before it starts`);
  return { b, c, v, t: text, ...(label ? { n: label } : {}) };
}

function parseFile(file) {
  const text = readFileSync(join(SOURCE_DIR, file), 'utf8').replace(/^﻿/, '');
  let book = null;
  let card = null;
  let divider = null;
  const bigger = [];
  const lastSmaller = () => bigger[bigger.length - 1]?.s.at(-1);
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || /^#(\s|$)/.test(line)) return;
    let m;
    if ((m = line.match(/^book:\s*(.+)$/))) {
      if (book) fail(file, n, 'second "book:" line');
      book = m[1].trim();
      if (!VERSE_COUNTS[book]) fail(file, n, `unknown book "${book}"`);
    } else if ((m = line.match(/^card:\s*(.*)$/))) {
      if (card) fail(file, n, 'second "card:" line');
      if (bigger.length) fail(file, n, 'the card goes before the first bigger story');
      card = { t: m[1].trim(), p: [], line: n };
      if (!card.t) fail(file, n, 'card has no title');
    } else if ((m = line.match(/^([->])\s+(.*)$/)) && card && !bigger.length) {
      card.p.push(m[1] === '-' ? `- ${m[2].trim()}` : m[2].trim());
    } else if ((m = line.match(/^===\s*(.*)$/))) {
      if (divider) fail(file, n, 'two dividers in a row');
      divider = { t: m[1].trim(), line: n };
      if (!divider.t) fail(file, n, 'divider has no label');
    } else if ((m = line.match(/^##\s+(.*)$/))) {
      const t = m[1].trim();
      if (!t) fail(file, n, 'bigger story has no title');
      bigger.push({ t, line: n, s: [], d: divider?.t });
      divider = null;
    } else if ((m = line.match(/^->\s*(.+)$/))) {
      const s = lastSmaller();
      if (!s) { fail(file, n, 'link before any smaller story'); return; }
      if (s.l) fail(file, n, 'second link on one story');
      const l = parseLink(file, n, m[1].trim());
      if (l) s.l = l;
    } else if ((m = line.match(/^(\d+):(\d+)\s+(.*)$/))) {
      const [title, info, extra] = m[3].split('|').map((x) => x.trim());
      if (!title) fail(file, n, 'smaller story has no title');
      if (info === '') fail(file, n, 'empty info line after "|"');
      if (extra !== undefined) fail(file, n, 'more than one "|" on a line');
      if (!bigger.length) { fail(file, n, 'smaller story before any "## bigger story"'); return; }
      const s = { t: title ?? '', c: +m[1], v: +m[2], line: n };
      if (info) s.i = info;
      bigger[bigger.length - 1].s.push(s);
    } else {
      fail(file, n, `can't read this line: "${line}"`);
    }
  });
  if (!book) fail(file, 0, 'missing "book:" line');
  if (divider) fail(file, divider.line, 'divider with no bigger story after it');
  if (card && !card.p.length) fail(file, card.line, 'card has no lines');
  return { book, bigger, card };
}

/** Every psalm opens with a story that carries "Author · Kind". */
function checkPsalms(file, bigger) {
  const opening = new Map();
  for (const b of bigger) for (const s of b.s) if (s.v === 1) opening.set(s.c, s);
  for (let c = 1; c <= VERSE_COUNTS.Psalms.length; c++) {
    const s = opening.get(c);
    if (!s) { fail(file, 0, `Psalm ${c} has no story starting at verse 1`); continue; }
    const parts = s.i?.split(' · ');
    if (!parts || parts.length !== 2 || !parts[0]) {
      fail(file, s.line, `Psalm ${c} needs an info line "Author · Kind"`);
    } else if (!PSALM_KINDS.includes(parts[1])) {
      fail(file, s.line, `Psalm ${c}: "${parts[1]}" isn't one of the kinds (${PSALM_KINDS.join(', ')})`);
    }
  }
}

function buildBook(file, { book, bigger }) {
  const counts = VERSE_COUNTS[book];
  const lastChapter = counts.length;
  const flat = [];
  for (const b of bigger) {
    if (!b.s.length) fail(file, b.line, `bigger story "${b.t}" has no smaller stories`);
    flat.push(...b.s);
  }
  if (!flat.length) return null;

  // Every reference exists, starts strictly in order, book opens at 1:1.
  for (const [i, s] of flat.entries()) {
    if (s.c < 1 || s.c > lastChapter || s.v < 1 || s.v > counts[s.c - 1]) {
      fail(file, s.line, `${book} ${s.c}:${s.v} doesn't exist`);
    }
    if (i > 0) {
      const p = flat[i - 1];
      if (s.c < p.c || (s.c === p.c && s.v <= p.v)) {
        fail(file, s.line, `${s.c}:${s.v} is not after ${p.c}:${p.v}`);
      }
    }
  }
  if (flat[0].c !== 1 || flat[0].v !== 1) fail(file, flat[0].line, `${book} must open at 1:1`);

  // Last chapter each smaller story touches: the chapter of the verse just
  // before the next story starts.
  flat.forEach((s, i) => {
    const next = flat[i + 1];
    s.e = !next ? lastChapter : next.v === 1 ? next.c - 1 : next.c;
  });

  // Every verse lands in exactly one smaller story.
  const hits = new Map();
  let total = 0;
  flat.forEach((s, i) => {
    const next = flat[i + 1];
    for (let c = s.c; c <= lastChapter; c++) {
      for (let v = c === s.c ? s.v : 1; v <= counts[c - 1]; v++) {
        if (next && (c > next.c || (c === next.c && v >= next.v))) return;
        const key = `${c}:${v}`;
        hits.set(key, (hits.get(key) ?? 0) + 1);
      }
    }
  });
  counts.forEach((n, ci) => {
    total += n;
    for (let v = 1; v <= n; v++) {
      const h = hits.get(`${ci + 1}:${v}`) ?? 0;
      if (h !== 1) fail(file, 0, `${book} ${ci + 1}:${v} is in ${h} stories`);
    }
  });

  if (book === 'Psalms') checkPsalms(file, bigger);

  const out = bigger.filter((b) => b.s.length).map((b) => ({
    t: b.t,
    c: b.s[0].c,
    v: b.s[0].v,
    e: b.s[b.s.length - 1].e,
    ...(b.d ? { d: b.d } : {}),
    s: b.s.map(({ t, c, v, e, i, l }) => ({ t, c, v, e, ...(i ? { i } : {}), ...(l ? { l } : {}) })),
  }));
  // A divider's chapters run to the last bigger story before the next divider.
  out.forEach((b, k) => {
    if (!b.d) return;
    let j = k;
    while (out[j + 1] && !out[j + 1].d) j++;
    b.de = out[j].e;
  });
  if (out.some((b) => b.d) && !out[0].d) fail(file, bigger[0].line, 'a book with dividers needs one before its first bigger story');
  return { out, total, verses: hits.size };
}

const range = (c, e) => (c === e ? `${c}` : `${c}–${e}`);

function verseSpan(book, s, next) {
  const counts = VERSE_COUNTS[book];
  let n = 0;
  for (let c = s.c; c <= counts.length; c++) {
    for (let v = c === s.c ? s.v : 1; v <= counts[c - 1]; v++) {
      if (next && (c > next.c || (c === next.c && v >= next.v))) return n;
      n++;
    }
  }
  return n;
}

function show(book, out) {
  console.log(`\n${book}`);
  const flat = out.flatMap((b) => b.s);
  let k = 0;
  for (const b of out) {
    if (b.d) console.log(`  — ${b.d} · ${range(b.c, b.de)} —`);
    console.log(`  ${b.t} (${range(b.c, b.e)})`);
    for (const s of b.s) {
      const n = verseSpan(book, s, flat[k + 1]);
      k++;
      console.log(`      ${`${s.c}:${s.v}`.padEnd(6)} ${s.t} (${range(s.c, s.e)})  · ${n} verses${s.i ? `  [${s.i}]` : ''}${s.l ? `  → ${s.l.t}` : ''}`);
    }
  }
}

const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.txt')).sort();
const books = {};
const cards = {};
const summary = [];
for (const file of files) {
  const parsed = parseFile(file);
  if (!parsed.book || !VERSE_COUNTS[parsed.book]) continue;
  if (books[parsed.book]) { fail(file, 0, `${parsed.book} is already in another file`); continue; }
  const built = buildBook(file, parsed);
  if (!built) { fail(file, 0, 'no stories'); continue; }
  books[parsed.book] = built.out;
  if (parsed.card) cards[parsed.book] = { t: parsed.card.t, p: parsed.card.p };
  const small = built.out.reduce((n, b) => n + b.s.length, 0);
  summary.push(`  ${parsed.book.padEnd(16)} ${String(built.out.length).padStart(3)} bigger  ${String(small).padStart(4)} smaller  ${built.verses}/${built.total} verses`);
}

if (errors.length) {
  console.error(`Story check failed (${errors.length}):`);
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}

const ordered = BOOK_ORDER.filter((b) => books[b]);
const lines = ordered.map((b) => `${JSON.stringify(b)}:${JSON.stringify(books[b])}`);
const cardLines = BOOK_ORDER.filter((b) => cards[b]).map((b) => `${JSON.stringify(b)}:${JSON.stringify(cards[b])}`);
writeFileSync(OUTPUT, `{"v":1,"books":{\n${lines.join(',\n')}\n},"cards":{\n${cardLines.join(',\n')}\n}}\n`);

console.log(`Stories OK — ${ordered.length}/66 books`);
console.log(summary.join('\n'));
for (const b of showBooks) {
  const name = BOOK_ORDER.find((x) => x.toLowerCase() === b.toLowerCase());
  if (name && books[name]) show(name, books[name]);
  else console.log(`\n(no stories for "${b}")`);
}
console.log(`\nWrote ${OUTPUT.replace(repoRoot + '\\', '').replace(repoRoot + '/', '')}`);
