#!/usr/bin/env node
/**
 * extract-wj-spans-bsb.mjs
 *
 * Parses BSB USJ (JSON format) files from data-sources/bsb-usj/ and extracts
 * character-level \wj spans (Jesus' spoken words) for every verse that contains them.
 *
 * Output: data/processed/wj-spans-bsb.json
 * Format: { "LUK:23:3": [{ text: "\"You have said so,\"" }], ... }
 *
 * Keys use USFM 3-letter book codes (MAT, MRK, LUK, JHN, REV, etc.).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const USJ_DIR = join(repoRoot, 'data-sources', 'bsb-usj');
const OUT_DIR = join(repoRoot, 'data', 'processed');
const OUT_PATH = join(OUT_DIR, 'wj-spans-bsb.json');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
if (!existsSync(USJ_DIR)) { console.error(`❌ Not found: ${USJ_DIR}`); process.exit(1); }

// ── Book code mapping (USJ uses standard USFM codes directly) ─────────────────

// NT books that can contain Jesus's words
const NT_BOOKS = new Set([
  'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH','PHP','COL',
  '1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS','1PE','2PE',
  '1JN','2JN','3JN','JUD','REV',
]);

// ── USJ walker ────────────────────────────────────────────────────────────────

/**
 * Recursively collect all text from a USJ node's content array.
 * Descends into char nodes, ignores non-text markers (notes, refs, etc.)
 * except wj content which is handled by the caller.
 */
function collectText(content) {
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const node of content) {
    if (typeof node === 'string') {
      text += node;
    } else if (node && node.content) {
      // Descend into inline char nodes (e.g. wj may nest rb, w, etc.)
      // But skip notes and cross-references
      const skip = ['note', 'ref'];
      if (!skip.includes(node.type)) {
        text += collectText(node.content);
      }
    }
  }
  return text;
}

/**
 * Walk inside a wj node's content, splitting at verse boundaries.
 * Updates state.curV when a verse marker is found.
 * Emits spans per verse segment.
 */
function collectWjSegments(content, state, bookCode, spans) {
  let currentText = '';

  function flush() {
    const trimmed = currentText.trim();
    currentText = '';
    if (!trimmed || state.curCh <= 0 || state.curV <= 0) return;
    const key = `${bookCode}:${state.curCh}:${state.curV}`;
    if (!spans[key]) spans[key] = [];
    spans[key].push({ text: trimmed });
  }

  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (typeof node === 'string') {
        currentText += node;
      } else if (node.type === 'verse') {
        // Verse boundary inside wj — flush current segment then advance verse
        flush();
        state.curV = parseInt(node.number, 10);
      } else if (node.content && node.type !== 'note') {
        walk(node.content);
      }
    }
  }

  walk(content);
  flush();
}


function walkUsj(content, bookCode, spans) {
  if (!Array.isArray(content)) return;
  let curCh = 0;
  let curV = 0;

  for (const node of content) {
    if (typeof node === 'string') continue;

    if (node.type === 'chapter') {
      curCh = parseInt(node.number, 10);
      curV = 0;
      continue;
    }

    if (node.type === 'verse') {
      curV = parseInt(node.number, 10);
      continue;
    }

    // Recurse into para/table/row/cell nodes (these contain verses and chars)
    if (node.content && node.type !== 'note') {
      // First walk the children to pick up chapter/verse markers and nested wj
      walkUsjChildren(node.content, bookCode, spans, { curCh, curV });
    }
  }
}

/**
 * Walk children of a para/char/etc. node, updating ch/v state as we go.
 */
function walkUsjChildren(content, bookCode, spans, state) {
  if (!Array.isArray(content)) return;

  for (const node of content) {
    if (typeof node === 'string') continue;

    if (node.type === 'chapter') {
      state.curCh = parseInt(node.number, 10);
      state.curV = 0;
      continue;
    }

    if (node.type === 'verse') {
      state.curV = parseInt(node.number, 10);
      continue;
    }

    if (node.type === 'char' && node.marker === 'wj') {
      if (state.curCh > 0 && state.curV > 0) {
        // Use segment-aware collection so verse markers inside wj are honoured
        collectWjSegments(node.content || [], state, bookCode, spans);
      }
      continue; // Don't recurse further — already handled above
    }

    // Recurse into other char/para nodes (but not notes)
    if (node.content && node.type !== 'note') {
      walkUsjChildren(node.content, bookCode, spans, state);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`📖 Reading BSB USJ files from ${USJ_DIR}...`);

const files = readdirSync(USJ_DIR).filter(f => f.endsWith('.usj'));
console.log(`   Found ${files.length} files`);

const allSpans = {};
let totalFiles = 0;

for (const file of files.sort()) {
  const bookCode = file.replace('.usj', '');
  // Only process NT books (OT has no Jesus words)
  if (!NT_BOOKS.has(bookCode)) continue;

  const usj = JSON.parse(readFileSync(join(USJ_DIR, file), 'utf8'));
  const bookSpans = {};

  walkUsjChildren(usj.content || [], bookCode, bookSpans, { curCh: 0, curV: 0 });

  for (const [key, spanList] of Object.entries(bookSpans)) {
    allSpans[key] = spanList;
  }
  totalFiles++;
  if (Object.keys(bookSpans).length > 0) {
    console.log(`   ${bookCode}: ${Object.keys(bookSpans).length} verses`);
  }
}

const verseCount = Object.keys(allSpans).length;
const spanCount = Object.values(allSpans).reduce((sum, arr) => sum + arr.length, 0);

console.log(`\n✅ Extracted ${spanCount} spans from ${verseCount} verses across ${totalFiles} NT books`);

// Spot-check
const checks = ['LUK:23:3', 'JHN:3:16', 'MAT:5:3', 'REV:1:8', 'LUK:23:34'];
console.log('\n🔬 Spot checks:');
for (const k of checks) {
  const s = allSpans[k];
  if (s) {
    for (const sp of s) console.log(`   ${k}: "${sp.text.slice(0, 80)}${sp.text.length > 80 ? '...' : ''}"`);
  } else {
    console.log(`   ${k}: (not found)`);
  }
}

writeFileSync(OUT_PATH, JSON.stringify(allSpans, null, 2));
console.log(`\n📄 Written: ${OUT_PATH}`);
