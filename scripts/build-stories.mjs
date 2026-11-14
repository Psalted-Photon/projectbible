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
 *   { v: 1, books: { Genesis: [ { t, c, v, e, s: [ { t, c, v, e } ] } ] } }
 * where c:v is the first verse and e is the last chapter the story touches.
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

function parseFile(file) {
  const text = readFileSync(join(SOURCE_DIR, file), 'utf8').replace(/^﻿/, '');
  let book = null;
  const bigger = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (!line || /^#(\s|$)/.test(line)) return;
    let m;
    if ((m = line.match(/^book:\s*(.+)$/))) {
      if (book) fail(file, n, 'second "book:" line');
      book = m[1].trim();
      if (!VERSE_COUNTS[book]) fail(file, n, `unknown book "${book}"`);
    } else if ((m = line.match(/^##\s+(.*)$/))) {
      const t = m[1].trim();
      if (!t) fail(file, n, 'bigger story has no title');
      bigger.push({ t, line: n, s: [] });
    } else if ((m = line.match(/^(\d+):(\d+)\s+(.*)$/))) {
      const t = m[3].trim();
      if (!t) fail(file, n, 'smaller story has no title');
      if (!bigger.length) { fail(file, n, 'smaller story before any "## bigger story"'); return; }
      bigger[bigger.length - 1].s.push({ t, c: +m[1], v: +m[2], line: n });
    } else {
      fail(file, n, `can't read this line: "${line}"`);
    }
  });
  if (!book) fail(file, 0, 'missing "book:" line');
  return { book, bigger };
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

  const out = bigger.filter((b) => b.s.length).map((b) => ({
    t: b.t,
    c: b.s[0].c,
    v: b.s[0].v,
    e: b.s[b.s.length - 1].e,
    s: b.s.map(({ t, c, v, e }) => ({ t, c, v, e })),
  }));
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
    console.log(`  ${b.t} (${range(b.c, b.e)})`);
    for (const s of b.s) {
      const n = verseSpan(book, s, flat[k + 1]);
      k++;
      console.log(`      ${`${s.c}:${s.v}`.padEnd(6)} ${s.t} (${range(s.c, s.e)})  · ${n} verses`);
    }
  }
}

const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.txt')).sort();
const books = {};
const summary = [];
for (const file of files) {
  const parsed = parseFile(file);
  if (!parsed.book || !VERSE_COUNTS[parsed.book]) continue;
  if (books[parsed.book]) { fail(file, 0, `${parsed.book} is already in another file`); continue; }
  const built = buildBook(file, parsed);
  if (!built) { fail(file, 0, 'no stories'); continue; }
  books[parsed.book] = built.out;
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
writeFileSync(OUTPUT, `{"v":1,"books":{\n${lines.join(',\n')}\n}}\n`);

console.log(`Stories OK — ${ordered.length}/66 books`);
console.log(summary.join('\n'));
for (const b of showBooks) {
  const name = BOOK_ORDER.find((x) => x.toLowerCase() === b.toLowerCase());
  if (name && books[name]) show(name, books[name]);
  else console.log(`\n(no stories for "${b}")`);
}
console.log(`\nWrote ${OUTPUT.replace(repoRoot + '\\', '').replace(repoRoot + '/', '')}`);
