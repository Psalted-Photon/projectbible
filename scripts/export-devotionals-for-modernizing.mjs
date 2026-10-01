#!/usr/bin/env node

/**
 * Export Spurgeon's readings for the modern-English rewrite
 *
 * Reads Morning and Evening and Faith's Checkbook out of the built devotionals
 * pack and writes one file per work per month, each reading split into numbered
 * blocks (see devotional-blocks.mjs for the markup). The modern text in
 * data-sources/devotionals-modern/ is written against these numbers: one entry
 * per block, in the same order, null for a poem.
 *
 * Output (gitignored, rebuilt at any time):
 *   data-sources/devotionals/modernize-export/<workId>-<MM>.md
 *
 * Usage:
 *   node scripts/export-devotionals-for-modernizing.mjs         (every month)
 *   node scripts/export-devotionals-for-modernizing.mjs 1       (January only)
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { splitBlocks, htmlToMarked } from './devotional-blocks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PACK = resolve(ROOT, 'packs/consolidated/devotionals.sqlite');
const OUT = resolve(ROOT, 'data-sources/devotionals/modernize-export');

const WORKS = ['spurgeon-me', 'faiths-checkbook'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

if (!existsSync(PACK)) {
  console.error(`❌ No pack at ${PACK}. Run: node scripts/build-devotionals-pack.mjs`);
  process.exit(1);
}

const only = process.argv[2] ? +process.argv[2] : null;
if (only !== null && !(only >= 1 && only <= 12)) {
  console.error('❌ Month must be 1-12.');
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const db = new Database(PACK, { readonly: true });
const rows = db.prepare(`
  SELECT * FROM readings WHERE work_id = ? AND month = ?
  ORDER BY day, CASE slot WHEN 'morning' THEN 0 WHEN 'day' THEN 1 ELSE 2 END
`);

mkdirSync(OUT, { recursive: true });
let files = 0, readings = 0, blocks = 0;

for (const workId of WORKS) {
  for (let month = 1; month <= 12; month++) {
    if (only !== null && month !== only) continue;
    const out = [`# ${workId} — ${MONTHS[month - 1]}`, ''];
    for (const r of rows.all(workId, month)) {
      const key = `${pad(r.month)}-${pad(r.day)}:${r.slot}`;
      const bs = splitBlocks(r.body_html);
      const head = JSON.parse(r.key_refs_json)[0];
      const poems = bs.map((b, i) => (b.kind === 'poem' ? i + 1 : 0)).filter(Boolean);
      out.push(`## ${key} — ${r.title}`);
      out.push(`${bs.length} block${bs.length === 1 ? '' : 's'}${poems.length ? `; poem${poems.length === 1 ? '' : 's'} (null): ${poems.join(', ')}` : ''}`);
      out.push(`Text: ${head.label} — ${head.kjvText}`, '');
      bs.forEach((b, i) => {
        out.push(`[${i + 1}]${b.kind === 'poem' ? ' poem' : ''}`);
        const marked = htmlToMarked(b.html);
        out.push(b.kind === 'poem' ? marked.split('\n').map((l) => `> ${l.trim()}`).join('\n') : marked, '');
      });
      readings++;
      blocks += bs.length;
    }
    writeFileSync(resolve(OUT, `${workId}-${pad(month)}.md`), out.join('\n'));
    files++;
  }
}

db.close();
console.log(`✅ ${readings} readings, ${blocks} blocks, ${files} files → ${OUT}`);
