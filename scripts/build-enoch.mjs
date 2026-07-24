// build-enoch.mjs
// -----------------------------------------------------------------------------
// Generates the bundled reading text for the Book of Enoch (1 Enoch) used by the
// Commentary panel (see apps/pwa-polished/src/lib/enochBooks.ts).
//
// Outputs, into apps/pwa-polished/src/data/ :
//   book-of-enoch-charles.json   — R. H. Charles (1917), from Wikisource
//   book-of-enoch-laurence.json  — Richard Laurence (1821/1883), from Global Grey
//
// Both translations are in the public domain. Text is fetched verbatim; only
// editorial apparatus is stripped (Charles' ⌈ ⌉ restoration brackets; Laurence's
// footnote reference markers and page numbers). Charles is a clean 1–108 chapter
// sequence; Laurence's original numbering has genuine gaps (no XI/XXXVI/CI) so
// chapters are given sequential positions while preserving the printed label.
//
// Usage:
//   node scripts/build-enoch.mjs                 # fetch both
//   REUSE_CHARLES=1 node scripts/build-enoch.mjs # reuse existing Charles JSON
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../apps/pwa-polished/src/data');
const UA = { 'User-Agent': 'ProjectBible-Enoch-Builder/1.0 (personal Bible app)' };

// ---------- shared helpers ----------
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
const collapse = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();
async function getText(url) {
  for (let a = 0; a < 5; a++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return await r.text(); }
    catch (e) {}
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error('fetch failed: ' + url);
}

// ---------- CHARLES (Wikisource) ----------
function cleanCharlesInline(s) {
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^>]*\/>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1');
  s = s.replace(/'''/g, '').replace(/''/g, '');
  s = s.replace(/[⌈⌉⌊⌋]/g, ''); // ⌈ ⌉ ⌊ ⌋ editorial brackets
  s = s.replace(/<[^>]+>/g, '');
  return s;
}
// find " num. " verse marker at/after `from`; returns index of the digit or -1
function findVerse(s, num, from) {
  const re = new RegExp('(?:^|[^0-9A-Za-z])(' + num + ')\\.\\s', 'g');
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? m.index + m[0].indexOf(String(num)) : -1;
}
function parseCharlesChapter(raw, chNum) {
  raw = raw.replace(/\{\{header[\s\S]*?\n\}\}/, '');
  const headings = [];
  for (const ln of raw.split('\n')) {
    const m = ln.match(/^\s*=+\s*(.+?)\s*=+\s*$/);
    if (m) { const h = cleanCharlesInline(m[1]).trim(); if (h) headings.push(h); }
  }
  let body = raw;
  const cm = raw.match(/CHAPTER\s+[IVXLCDM]+\.?/i);
  if (cm) body = raw.slice(raw.indexOf(cm[0]) + cm[0].length);
  body = body.replace(/^\s*=+.*=+\s*$/gm, '');
  body = cleanCharlesInline(body);

  const verses = [];
  let idx = findVerse(body, 1, 0);
  if (idx < 0) {
    const t = collapse(body);
    if (t) verses.push({ n: 1, text: t });
    return { chapter: chNum, label: 'Chapter ' + chNum, headings, verses };
  }
  let n = 1;
  while (true) {
    const next = findVerse(body, n + 1, idx + String(n).length + 1);
    const start = idx + String(n).length + 1;
    const seg = next < 0 ? body.slice(start) : body.slice(start, next);
    const text = collapse(seg);
    if (text) verses.push({ n, text });
    if (next < 0) break;
    n += 1; idx = next;
  }
  return { chapter: chNum, label: 'Chapter ' + chNum, headings, verses };
}
async function buildCharles() {
  const chapters = [];
  for (let i = 1; i <= 108; i++) {
    const pad = String(i).padStart(2, '0');
    const raw = await getText('https://en.wikisource.org/w/index.php?title=' +
      encodeURIComponent('The Book of Enoch (Charles)/Chapter ' + pad) + '&action=raw');
    chapters.push(parseCharlesChapter(raw, i));
    await new Promise((r) => setTimeout(r, 120));
    if (i % 20 === 0) console.log('  ...charles ch ' + i);
  }
  return {
    id: 'enoch-charles',
    title: 'The Book of Enoch',
    translator: 'Robert Henry Charles',
    year: 1917,
    source: 'R. H. Charles (1917), transcribed at Wikisource — public domain.',
    chapters,
  };
}

// ---------- LAURENCE (Global Grey) ----------
function stripLaurence(html) {
  html = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ''); // footnote ref links + inner marker
  html = html.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '');
  html = html.replace(/<[^>]+>/g, '');
  return collapse(html);
}
function buildLaurence(html) {
  const start = html.search(/<p>\s*<strong>\s*CHAP\s+I\b/i);
  const endM = html.search(/<footer\b|<h3>\s*Footnotes/i);
  const slice = html.slice(start, endM > start ? endM : undefined);

  const blocks = slice.match(/<(p|h2)\b[\s\S]*?<\/\1>/gi) || [];
  const chapters = [];
  let cur = null, seq = 0, vnum = 0;

  for (const b of blocks) {
    if (/^<h2/i.test(b)) continue; // group nav headers
    const isHeading = /<strong>[\s\S]*?CHAP/i.test(b);
    const text = stripLaurence(b);
    if (!text) continue;

    if (isHeading) {
      if (/^\(?\s*No\b/i.test(text) || /No\s+CHAP/i.test(text)) continue; // "(No CHAP. XI.)"
      const cm = text.match(/CHAP\.?\s+([IVXLCDM]+)/i);
      if (!cm) continue;
      seq += 1; vnum = 0;
      const headings = [];
      const sm = text.match(/SECT\.?\s+([IVXLCDM]+)/i);
      if (sm) headings.push('Section ' + sm[1].toUpperCase());
      cur = { chapter: seq, label: 'Chapter ' + cm[1].toUpperCase(), headings, verses: [] };
      chapters.push(cur);
      continue;
    }
    if (!cur) continue; // skip front matter
    if (/^\(?\s*No\s+CHAP/i.test(text)) continue;
    if (/^THE END$/i.test(text)) continue;
    const vm = text.match(/^(\d+)\.\s*/);
    let n, t;
    if (vm) { n = parseInt(vm[1], 10); t = text.slice(vm[0].length).trim(); }
    else { n = vnum + 1; t = text; }
    vnum = n;
    if (t) cur.verses.push({ n, text: t });
  }
  return {
    id: 'enoch-laurence',
    title: 'The Book of Enoch the Prophet',
    translator: 'Richard Laurence',
    year: 1821,
    source: 'Richard Laurence (1821; 1883 ed.), transcribed at Global Grey — public domain.',
    chapters,
  };
}

// ---------- run ----------
const CHARLES_PATH = path.join(OUT_DIR, 'book-of-enoch-charles.json');
let charles;
if (process.env.REUSE_CHARLES && fs.existsSync(CHARLES_PATH)) {
  console.log('Reusing existing Charles JSON...');
  charles = JSON.parse(fs.readFileSync(CHARLES_PATH, 'utf-8'));
} else {
  console.log('Fetching Charles (108 chapters from Wikisource)...');
  charles = await buildCharles();
}
console.log('Fetching Laurence (Global Grey)...');
const lhtml = await getText('https://www.globalgreyebooks.com/online-ebooks/richard-laurence_book-of-enoch-the-prophet_complete-text.html');
const laurence = buildLaurence(lhtml);

fs.writeFileSync(CHARLES_PATH, JSON.stringify(charles));
fs.writeFileSync(path.join(OUT_DIR, 'book-of-enoch-laurence.json'), JSON.stringify(laurence));

// ---------- validation report ----------
function report(name, book) {
  const chs = book.chapters;
  const totalV = chs.reduce((a, c) => a + c.verses.length, 0);
  console.log(`\n=== ${name}: ${chs.length} chapters, ${totalV} verses ===`);
  const empty = chs.filter((c) => c.verses.length === 0).map((c) => c.label);
  if (empty.length) console.log('  EMPTY chapters:', empty.join(', '));
  for (const c of chs) {
    const nums = c.verses.map((v) => v.n);
    const bad = nums.some((v, i) => i > 0 && v !== nums[i - 1] + 1) || (nums[0] !== undefined && nums[0] !== 1);
    if (bad) console.log(`  ${c.label} verse-nums: [${nums.join(',')}]`);
  }
  console.log(`  ${chs[0].label} v1: ${chs[0].verses[0].text.slice(0, 90)}`);
  const last = chs[chs.length - 1];
  console.log(`  last=${last.label} (${last.verses.length}v)`);
}
report('CHARLES', charles);
report('LAURENCE', laurence);
console.log('\nWrote JSON to', OUT_DIR);
