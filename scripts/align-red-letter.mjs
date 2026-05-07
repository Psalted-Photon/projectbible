#!/usr/bin/env node
/**
 * align-red-letter.mjs
 *
 * Aligns the WEB <wj> spans (from extract-wj-spans.mjs) to each translation
 * in the pack (WEB, BSB, KJV, NET) and outputs a single static JSON for the PWA.
 *
 * Key insight: the USFX (WEB 2025 edition) and WEB.json (older edition) have
 * different wording. So instead of text-matching the span text, we use:
 *
 *   1. Normalised substring match  (fast path, works when text is close)
 *   2. Quote-region by index + word-overlap (main path)
 *      - Find all quoted regions in WEB.json verse text
 *      - Match each USFX <wj> span to a WEB.json quote region by word overlap
 *      - Map to same-indexed quote region in target translation
 *   3. First-3 / last-3 significant-word sequence scan  (KJV fallback)
 *
 * Never guesses — if no strategy succeeds, the span is omitted.
 *
 * Output: apps/pwa-polished/public/red-letter-spans.json
 * Format: { "web": { "MAT:3:15": [{s,e}], ... }, "bsb": {...}, ... }
 * s/e are byte offsets in the CLEAN verse text (footnote markers stripped).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const WJ_SPANS_PATH = join(repoRoot, 'data', 'processed', 'wj-spans-web.json');
const WEB_JSON_PATH = join(repoRoot, 'data-sources', 'WEB.json');
const KJV_JSON_PATH = join(repoRoot, 'data-sources', 'KJV.json');
const PACKS_DIR = join(repoRoot, 'packs');
const OUT_PATH = join(repoRoot, 'apps', 'pwa-polished', 'public', 'red-letter-spans.json');

// ── Book name mapping ─────────────────────────────────────────────────────────
const USFM_TO_BOOK_NAMES = {
  GEN:['Genesis'],EXO:['Exodus'],LEV:['Leviticus'],NUM:['Numbers'],DEU:['Deuteronomy'],
  JOS:['Joshua'],JDG:['Judges'],RUT:['Ruth'],
  '1SA':['I Samuel','1 Samuel'],'2SA':['II Samuel','2 Samuel'],
  '1KI':['I Kings','1 Kings'],'2KI':['II Kings','2 Kings'],
  '1CH':['I Chronicles','1 Chronicles'],'2CH':['II Chronicles','2 Chronicles'],
  EZR:['Ezra'],NEH:['Nehemiah'],EST:['Esther'],JOB:['Job'],PSA:['Psalms','Psalm'],
  PRO:['Proverbs'],ECC:['Ecclesiastes'],SNG:['Song of Solomon','Song of Songs'],
  ISA:['Isaiah'],JER:['Jeremiah'],LAM:['Lamentations'],EZK:['Ezekiel'],DAN:['Daniel'],
  HOS:['Hosea'],JOL:['Joel'],AMO:['Amos'],OBA:['Obadiah'],JON:['Jonah'],
  MIC:['Micah'],NAM:['Nahum'],HAB:['Habakkuk'],ZEP:['Zephaniah'],
  HAG:['Haggai'],ZEC:['Zechariah'],MAL:['Malachi'],
  MAT:['Matthew'],MRK:['Mark'],LUK:['Luke'],JHN:['John'],ACT:['Acts'],ROM:['Romans'],
  '1CO':['I Corinthians','1 Corinthians'],'2CO':['II Corinthians','2 Corinthians'],
  GAL:['Galatians'],EPH:['Ephesians'],PHP:['Philippians'],COL:['Colossians'],
  '1TH':['I Thessalonians','1 Thessalonians'],'2TH':['II Thessalonians','2 Thessalonians'],
  '1TI':['I Timothy','1 Timothy'],'2TI':['II Timothy','2 Timothy'],
  TIT:['Titus'],PHM:['Philemon'],HEB:['Hebrews'],JAS:['James'],
  '1PE':['I Peter','1 Peter'],'2PE':['II Peter','2 Peter'],
  '1JN':['I John','1 John'],'2JN':['II John','2 John'],'3JN':['III John','3 John'],
  JUD:['Jude'],REV:['Revelation of John','Revelation'],
};

const BOOK_NAME_TO_USFM = {};
for (const [code, names] of Object.entries(USFM_TO_BOOK_NAMES)) {
  for (const n of names) BOOK_NAME_TO_USFM[n.toUpperCase()] = code;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function stripFootnotes(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : ' ';
    if (ch === '+' && (prev === ' ' || prev === '\n' || prev === '\t' || i === 0)) {
      const end = text.indexOf('\x01', i + 1);
      if (end >= 0) { i = end + 1; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Length-preserving quote normalisation (curly → straight). */
function normalizeQuotes(text) {
  return text
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");
}

/** Broader normalisation for search (may change length). */
function normalizeForSearch(text) {
  return normalizeQuotes(text)
    .replace(/\u2014|\u2015/g, '--')
    .replace(/\u2013/g, '-')
    .toLowerCase();
}

/**
 * Find all quoted double-quote regions (straight or curly) in text.
 * Uses alternating-open/close logic; unclosed last quote extends to end.
 * Returns [{s, e}] in original text coordinates (normalizeQuotes is length-preserving).
 */
function getQuotedRegions(text) {
  const normed = normalizeQuotes(text);
  const regions = [];
  let inQuote = false;
  let openIdx = -1;
  for (let i = 0; i < normed.length; i++) {
    if (normed[i] === '"') {
      if (!inQuote) { openIdx = i; inQuote = true; }
      else { regions.push({ s: openIdx, e: i + 1 }); inQuote = false; }
    }
  }
  if (inQuote && openIdx >= 0) regions.push({ s: openIdx, e: text.length });
  return regions;
}

/** Fraction of significant 3+-letter words in text1 also present in text2. */
function wordOverlap(text1, text2) {
  const w1 = new Set((text1.match(/\b[a-zA-Z]{3,}\b/g) || []).map(w => w.toLowerCase()));
  if (w1.size === 0) return 0;
  const w2 = new Set((text2.match(/\b[a-zA-Z]{3,}\b/g) || []).map(w => w.toLowerCase()));
  let n = 0;
  for (const w of w1) if (w2.has(w)) n++;
  return n / w1.size;
}

// ── Core alignment ─────────────────────────────────────────────────────────────

function alignSpan(spanText, webVerseText, targetText) {
  const span = spanText.trim();
  if (!span || !targetText) return null;

  const nSpan = normalizeForSearch(span);
  const nTarget = normalizeForSearch(targetText);

  // Strategy 1: normalised substring
  let idx = nTarget.indexOf(nSpan);
  if (idx >= 0) return { s: idx, e: idx + nSpan.length };

  // Strategy 2: quote-region word-overlap + index mapping
  {
    const webQuotes = getQuotedRegions(webVerseText);
    const tgtQuotes = getQuotedRegions(targetText);

    if (webQuotes.length > 0) {
      // Find which WEB.json quote region best matches this USFX span
      let bestQIdx = -1, bestOv = 0;
      for (let qi = 0; qi < webQuotes.length; qi++) {
        const regionText = webVerseText.slice(webQuotes[qi].s, webQuotes[qi].e);
        const ov = wordOverlap(span, regionText);
        if (ov > bestOv) { bestOv = ov; bestQIdx = qi; }
      }

      if (bestQIdx >= 0 && bestOv >= 0.35 && tgtQuotes.length > 0 && bestQIdx < tgtQuotes.length) {
        return tgtQuotes[bestQIdx];
      }

      // If 1 web quote and 1 target quote and reasonable overall overlap
      if (webQuotes.length === 1 && tgtQuotes.length === 1 && bestQIdx === 0 && bestOv >= 0.25) {
        return tgtQuotes[0];
      }
      // NOTE: we deliberately do NOT fall back to whole-verse when target has no quotes
      // (would incorrectly include narrator text in translations like KJV)
    }
  }

  // Strategy 3: first-3 / last-3 significant-word sequence scan
  {
    const sigWords = span.match(/\b[a-zA-Z]{3,}\b/g) || [];
    if (sigWords.length >= 4) {
      const fw = sigWords.slice(0, 3).map(w => w.toLowerCase());
      const lw = sigWords.slice(-3).map(w => w.toLowerCase());
      const tgtWords = [];
      const wordRe = /\b[a-zA-Z]{3,}\b/g;
      let wm;
      while ((wm = wordRe.exec(targetText)) !== null) {
        tgtWords.push({ w: wm[0].toLowerCase(), s: wm.index, e: wm.index + wm[0].length });
      }
      let startPos = -1;
      for (let wi = 0; wi <= tgtWords.length - fw.length; wi++) {
        if (fw.every((w, k) => tgtWords[wi + k]?.w === w)) { startPos = tgtWords[wi].s; break; }
      }
      if (startPos >= 0) {
        let endPos = -1;
        for (let wi = tgtWords.length - lw.length; wi >= 0; wi--) {
          if (lw.every((w, k) => tgtWords[wi + k]?.w === w) && tgtWords[wi].s >= startPos) {
            endPos = tgtWords[wi + lw.length - 1].e; break;
          }
        }
        if (endPos > startPos) {
          while (endPos < targetText.length && /[.!?,;:"'\u201D\u2019]/.test(targetText[endPos])) endPos++;
          return { s: startPos, e: endPos };
        }
      }
    }
  }

  return null;
}

// ── Load source data ──────────────────────────────────────────────────────────

console.log('📖 Loading WEB.json...');
const webJson = JSON.parse(readFileSync(WEB_JSON_PATH, 'utf8'));
const webByKey = {};
for (const book of webJson.books) {
  const usfm = BOOK_NAME_TO_USFM[book.name.toUpperCase()];
  if (!usfm) continue;
  for (const ch of book.chapters) {
    for (const v of ch.verses) webByKey[`${usfm}:${ch.chapter}:${v.verse}`] = v.text;
  }
}
console.log(`   ${Object.keys(webByKey).length} WEB verses`);

console.log('📖 Loading KJV.json...');
const kjvJson = JSON.parse(readFileSync(KJV_JSON_PATH, 'utf8'));
const kjvByKey = {};
for (const book of kjvJson.books) {
  const usfm = BOOK_NAME_TO_USFM[book.name.toUpperCase()];
  if (!usfm) continue;
  for (const ch of book.chapters) {
    for (const v of ch.verses) kjvByKey[`${usfm}:${ch.chapter}:${v.verse}`] = v.text;
  }
}

console.log('📖 Loading wj-spans-web.json...');
if (!existsSync(WJ_SPANS_PATH)) { console.error('❌ Run extract-wj-spans.mjs first.'); process.exit(1); }
const wjSpans = JSON.parse(readFileSync(WJ_SPANS_PATH, 'utf8'));
console.log(`   ${Object.keys(wjSpans).length} verses with <wj> spans`);

// ── Verse text getters ────────────────────────────────────────────────────────

function makeVerseGetter(transId, packFile) {
  if (transId === 'web') return key => webByKey[key] ?? null;
  if (transId === 'kjv') return key => kjvByKey[key] ?? null;
  const dbPath = join(PACKS_DIR, packFile);
  if (!existsSync(dbPath)) { console.warn(`   ⚠️  Not found: ${packFile}`); return null; }
  const db = new Database(dbPath, { readonly: true });
  const cache = new Map();
  return key => {
    if (cache.has(key)) return cache.get(key);
    const [usfm, ch, v] = key.split(':');
    for (const bk of (USFM_TO_BOOK_NAMES[usfm] || [])) {
      const row = db.prepare('SELECT text FROM verses WHERE book=? AND chapter=? AND verse=?').get(bk, +ch, +v);
      if (row) { cache.set(key, row.text); return row.text; }
    }
    cache.set(key, null); return null;
  };
}

// ── Run alignment ─────────────────────────────────────────────────────────────

const translations = [
  { id: 'web', getter: makeVerseGetter('web') },
  { id: 'bsb', getter: makeVerseGetter('bsb', 'bsb.sqlite') },
  { id: 'kjv', getter: makeVerseGetter('kjv') },
  { id: 'net', getter: makeVerseGetter('net', 'net.sqlite') },
];

const output = {};

for (const { id, getter } of translations) {
  if (!getter) { output[id] = {}; continue; }
  console.log(`\n🔗 Aligning ${id.toUpperCase()}...`);
  const transOut = {};
  let aligned = 0, skipped = 0;

  for (const [key, spanDefs] of Object.entries(wjSpans)) {
    const webText = webByKey[key];
    if (!webText) continue;
    const storedText = getter(key);
    if (!storedText) continue;
    const cleanText = (id === 'web' || id === 'kjv') ? storedText : stripFootnotes(storedText);

    const results = [];
    for (const spanDef of spanDefs) {
      const r = alignSpan(spanDef.text, webText, cleanText);
      if (r && r.e > r.s) { results.push(r); aligned++; } else skipped++;
    }

    if (results.length > 0) {
      results.sort((a, b) => a.s - b.s);
      const merged = [{ ...results[0] }];
      for (let i = 1; i < results.length; i++) {
        const prev = merged[merged.length - 1];
        if (results[i].s <= prev.e + 3) prev.e = Math.max(prev.e, results[i].e);
        else merged.push({ ...results[i] });
      }
      transOut[key] = merged;
    }
  }

  output[id] = transOut;
  const pct = ((Object.keys(transOut).length / Object.keys(wjSpans).length) * 100).toFixed(1);
  console.log(`   Covered: ${Object.keys(transOut).length}/${Object.keys(wjSpans).length} (${pct}%)`);
  console.log(`   Aligned: ${aligned}, skipped: ${skipped}`);
}

// ── Verification samples ──────────────────────────────────────────────────────

console.log('\n🔬 Verification:');
const verifyKeys = ['MAT:5:3', 'JHN:3:5', 'JHN:3:16', 'JHN:14:6', 'REV:1:8', 'ACT:9:4'];
for (const key of verifyKeys) {
  console.log(`\n  ${key}:`);
  for (const { id, getter } of translations) {
    if (!getter) continue;
    const spans = output[id]?.[key];
    const stored = getter(key) || '';
    const clean = (id === 'web' || id === 'kjv') ? stored : stripFootnotes(stored);
    if (!spans) { console.log(`    ${id}: (no alignment)`); continue; }
    for (const { s, e } of spans) {
      const ex = clean.slice(s, e);
      console.log(`    ${id}[${s},${e}]: "${ex.slice(0, 90)}${ex.length > 90 ? '...' : ''}"`);
    }
  }
}

// ── Write output ─────────────────────────────────────────────────────────────

writeFileSync(OUT_PATH, JSON.stringify(output));
const sizeKB = (Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(1);
console.log(`\n✅ Written: ${OUT_PATH}  (${sizeKB} KB)`);
