#!/usr/bin/env node

/**
 * Build the Bubbles' data file from the NET in packs/starter.sqlite.
 *
 * The Bubbles (BubbleView.svelte) and the book word clouds (WordCloudView,
 * MiniWordCloud) are drawn from the NET for everyone, so the map is the same
 * whatever you read. This writes what they need and nothing more:
 *
 *   - each book's word count, and each chapter's word count and verses, which
 *     size the circles and place the verse dots;
 *   - each book's most used words with how often it uses them, for its cloud.
 *
 * The text is cleaned the way the book picture lab cleans it (extractHeading,
 * then cleanVersePreviewText), and the cloud words are counted with the lab's
 * countCloudWords, so the app and the lab agree word for word. Words are
 * counted as Repeats counts them (normalizeRepeatWord), with filler words left
 * out (lib/fillerWords.ts).
 *
 * Output: apps/pwa-polished/src/lib/bookPicture/bubbleData.json, loaded by the
 * app only when the Bubbles or a cloud opens (lib/bookPicture/bubbleData.ts).
 *
 *   { "v": 1, "books": [ { "b": "Genesis", "w": 38262,
 *       "c": [ [chapter, words, verses], ... ],
 *       "cloud": [ ["God", 230], ... ] }, ... ] }
 *
 * `verses` is a count when the chapter runs 1..n with no gaps, or the list of
 * its verse numbers when it skips any (a verse the NET leaves out).
 *
 * Usage: npx tsx scripts/build-bubble-data.mjs
 * Rerun after the starter pack's NET changes.
 */

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BIBLE_BOOKS, normalizeBookName } from '../apps/pwa-polished/src/lib/bibleData.ts';
import { cleanVersePreviewText, extractHeading } from '../apps/pwa-polished/src/lib/verseRendering.ts';
import { normalizeRepeatWord } from '../apps/pwa-polished/src/stores/repeatsStore.ts';
import { FILLER_WORDS } from '../apps/pwa-polished/src/lib/fillerWords.ts';
import { countCloudWords } from '../apps/pwa-polished/src/lib/bookPicture/cloud.ts';

/** The most cloud words kept per book: enough for the full-screen cloud. */
const CLOUD_WORDS = 160;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(root, 'apps/pwa-polished/src/lib/bookPicture/bubbleData.json');
const db = new Database(join(root, 'packs/starter.sqlite'), { readonly: true });

const packNames = new Map();
for (const { book } of db.prepare("SELECT DISTINCT book FROM verses WHERE translation_id = 'net'").all()) {
  packNames.set(normalizeBookName(String(book)), String(book));
}
const versesOf = db.prepare(
  "SELECT chapter, verse, text FROM verses WHERE translation_id = 'net' AND book = ? ORDER BY chapter, verse",
);

const books = [];
let total = 0;
for (const info of BIBLE_BOOKS) {
  const packName = packNames.get(info.name);
  if (!packName) throw new Error(`No NET text for ${info.name}`);
  const tokens = [];
  /** chapter → { words, verses: number[] } */
  const chapters = new Map();
  for (const row of versesOf.all(packName)) {
    const clean = cleanVersePreviewText(extractHeading(String(row.text)).textWithoutHeading);
    if (!clean) continue;
    const words = clean.split(' ').filter(Boolean);
    if (!words.length) continue;
    let ch = chapters.get(row.chapter);
    if (!ch) chapters.set(row.chapter, (ch = { words: 0, verses: [] }));
    ch.words += words.length;
    ch.verses.push(Number(row.verse));
    tokens.push(...words);
  }
  const c = [...chapters].map(([chapter, { words, verses }]) => {
    const runs = verses.every((v, i) => v === i + 1);
    return [Number(chapter), words, runs ? verses.length : verses];
  });
  const cloud = countCloudWords(tokens, normalizeRepeatWord, FILLER_WORDS)
    .slice(0, CLOUD_WORDS)
    .map((w) => [w.text, w.count]);
  books.push({ b: info.name, w: tokens.length, c, cloud });
  total += tokens.length;
}

// One book a line, so a rebuild's diff shows which books changed.
writeFileSync(OUTPUT, `{"v":1,"books":[\n${books.map((b) => JSON.stringify(b)).join(',\n')}\n]}\n`);
const gaps = books.flatMap((b) => b.c.filter((c) => Array.isArray(c[2])).map((c) => `${b.b} ${c[0]}`));
console.log(`Wrote ${OUTPUT}`);
console.log(`${books.length} books, ${total.toLocaleString()} words; chapters with skipped verses: ${gaps.length ? gaps.join(', ') : 'none'}`);
