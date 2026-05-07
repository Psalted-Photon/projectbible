#!/usr/bin/env node
/**
 * extract-wj-spans.mjs
 *
 * Parses the WEB USFX XML and extracts character-level <wj>...</wj> spans
 * (Jesus' spoken words) for every NT verse that contains them.
 *
 * Output: data/processed/wj-spans-web.json
 * Format: { "MAT:3:15": [{ text: "...", usfxS: 0, usfxE: 72 }], ... }
 *
 * Keys use USFM 3-letter book codes (MAT, MRK, JHN, REV, etc.).
 * The `text` field is the plain-text content of the <wj> span as extracted
 * from USFX (stripped of <w>, <f>, and other inline tags).
 * usfxS/usfxE are character offsets in that USFX-derived plain text for
 * the verse (used for verification; the align script uses `text` directly).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const USFX_PATH = join(repoRoot, 'data-sources', 'web-usfx', 'eng-web_usfx.xml');
const OUT_DIR = join(repoRoot, 'data', 'processed');
const OUT_PATH = join(OUT_DIR, 'wj-spans-web.json');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

console.log('📖 Loading USFX file...');
const xml = readFileSync(USFX_PATH, 'utf8');
console.log(`   Size: ${(xml.length / 1024 / 1024).toFixed(1)} MB`);

// ── XML tokenizer ─────────────────────────────────────────────────────────────

function* tokenize(xml) {
  const len = xml.length;
  let i = 0;
  let textStart = 0;

  while (i < len) {
    if (xml[i] !== '<') { i++; continue; }

    // Emit accumulated text
    if (i > textStart) {
      yield { type: 'text', content: xml.slice(textStart, i) };
    }

    // Declarations, comments, CDATA
    if (xml[i + 1] === '!') {
      if (xml[i + 2] === '-' && xml[i + 3] === '-') {
        const end = xml.indexOf('-->', i + 4);
        i = end >= 0 ? end + 3 : len;
      } else if (xml.slice(i, i + 9) === '<![CDATA[') {
        const end = xml.indexOf(']]>', i + 9);
        if (end >= 0) {
          yield { type: 'text', content: xml.slice(i + 9, end) };
          i = end + 3;
        } else { i = len; }
      } else {
        const end = xml.indexOf('>', i + 1);
        i = end >= 0 ? end + 1 : len;
      }
      textStart = i;
      continue;
    }

    // Processing instructions
    if (xml[i + 1] === '?') {
      const end = xml.indexOf('?>', i + 2);
      i = end >= 0 ? end + 2 : len;
      textStart = i;
      continue;
    }

    // Find tag end
    const tagEnd = xml.indexOf('>', i + 1);
    if (tagEnd < 0) { i = len; break; }

    const rawTag = xml.slice(i + 1, tagEnd);

    if (rawTag[0] === '/') {
      // Close tag
      yield { type: 'close', name: rawTag.slice(1).trim() };
    } else {
      const selfClose = rawTag[rawTag.length - 1] === '/';
      const inner = selfClose ? rawTag.slice(0, -1).trim() : rawTag.trim();
      const nameEnd = inner.search(/[\s/]/);
      const name = nameEnd >= 0 ? inner.slice(0, nameEnd) : inner;
      const attrsStr = nameEnd >= 0 ? inner.slice(nameEnd + 1) : '';
      const attrs = {};
      const re = /(\w[\w.-]*)=["']([^"']*?)["']/g;
      let m;
      while ((m = re.exec(attrsStr)) !== null) attrs[m[1]] = m[2];
      yield selfClose
        ? { type: 'selfClose', name, attrs }
        : { type: 'open', name, attrs };
    }

    i = tagEnd + 1;
    textStart = i;
  }

  if (textStart < len) {
    yield { type: 'text', content: xml.slice(textStart) };
  }
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ── Main extraction ───────────────────────────────────────────────────────────

const spans = {}; // key: "BOOK:CH:V" → [{text, usfxS, usfxE}]

let currentBCV = null;  // e.g. "MAT.3.15"
let inVerse = false;
let inWj = false;
let footnoteDepth = 0;  // depth of <f> / <fe> / <x> nesting
let verseText = '';
let verseSpans = [];    // {usfxS, usfxE} during verse accumulation
let currentWjStart = -1;

function saveVerseSpans() {
  // Close any still-open wj span at verse end
  if (inWj && currentWjStart >= 0 && verseText.length > currentWjStart) {
    const spanText = verseText.slice(currentWjStart).trim();
    if (spanText.length > 0) {
      verseSpans.push({ text: spanText, usfxS: currentWjStart, usfxE: verseText.length });
    }
    inWj = false;
    currentWjStart = -1;
  }

  if (inVerse && currentBCV && verseSpans.length > 0) {
    const parts = currentBCV.split('.');
    const key = `${parts[0]}:${parts[1]}:${parts[2]}`;
    spans[key] = verseSpans;
  }
}

console.log('🔍 Extracting <wj> spans...');

for (const token of tokenize(xml)) {
  if (token.type === 'selfClose') {
    if (token.name === 'v') {
      // Save previous verse first
      saveVerseSpans();

      // Start new verse
      currentBCV = token.attrs.bcv || null;
      inVerse = !!currentBCV;
      inWj = false;
      footnoteDepth = 0;
      verseText = '';
      verseSpans = [];
      currentWjStart = -1;

    } else if (token.name === 've') {
      // Verse end
      saveVerseSpans();
      inVerse = false;
      inWj = false;
      currentWjStart = -1;
    }
    // <c id="..."> chapter markers — no action needed

  } else if (token.type === 'open') {
    if (token.name === 'wj') {
      if (inVerse && footnoteDepth === 0) {
        // Close any existing open span (shouldn't happen but be safe)
        if (inWj && currentWjStart >= 0 && verseText.length > currentWjStart) {
          const spanText = verseText.slice(currentWjStart).trim();
          if (spanText.length > 0) {
            verseSpans.push({ text: spanText, usfxS: currentWjStart, usfxE: verseText.length });
          }
        }
        currentWjStart = verseText.length;
        inWj = true;
      }
    } else if (token.name === 'f' || token.name === 'fe' || token.name === 'x') {
      // Footnote / cross-ref — if wj was open across a footnote, close and re-open after
      if (inWj && footnoteDepth === 0 && currentWjStart >= 0 && verseText.length > currentWjStart) {
        const spanText = verseText.slice(currentWjStart).trim();
        if (spanText.length > 0) {
          verseSpans.push({ text: spanText, usfxS: currentWjStart, usfxE: verseText.length });
        }
        inWj = false;
        currentWjStart = -1;
      }
      footnoteDepth++;
    }
    // <w>, <nd>, <add>, <q>, etc. — fall through, their text content is included

  } else if (token.type === 'close') {
    if (token.name === 'wj') {
      if (inWj && currentWjStart >= 0 && verseText.length > currentWjStart) {
        const spanText = verseText.slice(currentWjStart).trim();
        if (spanText.length > 0) {
          verseSpans.push({ text: spanText, usfxS: currentWjStart, usfxE: verseText.length });
        }
      }
      inWj = false;
      currentWjStart = -1;
    } else if (token.name === 'f' || token.name === 'fe' || token.name === 'x') {
      footnoteDepth = Math.max(0, footnoteDepth - 1);
      // If we closed a footnote and we're back to depth 0, allow next <wj> to open
    }

  } else if (token.type === 'text') {
    if (inVerse && footnoteDepth === 0) {
      verseText += decodeEntities(token.content);
    }
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

const verseCount = Object.keys(spans).length;
const spanCount = Object.values(spans).reduce((s, arr) => s + arr.length, 0);
const books = [...new Set(Object.keys(spans).map(k => k.split(':')[0]))].sort();

console.log(`\n✅ Extraction complete`);
console.log(`   Verses with red-letter: ${verseCount}`);
console.log(`   Total <wj> spans: ${spanCount}`);
console.log(`   Books: ${books.join(', ')}`);

// Sample output
const sampleKey = Object.keys(spans).find(k => k.startsWith('JHN:3:'));
if (sampleKey) {
  console.log(`\n   Sample (${sampleKey}): ${JSON.stringify(spans[sampleKey][0].text.slice(0, 80))}...`);
}

writeFileSync(OUT_PATH, JSON.stringify(spans, null, 2));
console.log(`\n📁 Written to: ${OUT_PATH}`);
