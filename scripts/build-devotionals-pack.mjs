#!/usr/bin/env node

/**
 * Build Devotionals Pack
 *
 * Three public-domain daily devotionals in one pack:
 *   - C. H. Spurgeon, Morning and Evening (morning + evening, 366 days)
 *   - C. H. Spurgeon, Faith's Checkbook (one reading a day, 366 days)
 *   - Jonathan Bagster, Daily Light on the Daily Path (morning + evening, all Scripture)
 *
 * Tables:
 *   metadata   key/value pack info
 *   works      one row per devotional
 *   readings   one row per (work, month, day, slot)
 *
 * key_refs_json holds the headline verse(s). For Spurgeon it is the text the
 * reading opens with, and kjvText is his own King James wording of it. For
 * Daily Light it is every fragment in order: Bagster's text in `fragment`, the
 * passage it comes from, and `para`, the paragraph it sits in. The source only
 * lists each half's references in one block at the bottom, so each fragment is
 * matched to its passage here against the KJV text, and the build fails if any
 * fragment is left without one.
 *
 * Data sources (download to data-sources/devotionals/, gitignored):
 *   - SME.zip   https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/SME.zip   (zLD, OSIS)
 *   - Daily.zip https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Daily.zip (RawLD, ThML)
 *   - checkbook.xml https://www.ccel.org/ccel/s/spurgeon/checkbook.xml (CCEL ThML)
 *   - data-sources/KJV.json, to match Daily Light's fragments to their passages
 *
 * Usage:
 *   node scripts/build-devotionals-pack.mjs
 */

import Database from 'better-sqlite3';
import zlib from 'zlib';
import { readFileSync, existsSync, copyFileSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'data-sources/devotionals');
const SME = resolve(SRC, 'sme/modules/lexdict/zld/devotionals/sme/sme');
const DAILY = resolve(SRC, 'daily/modules/lexdict/rawld/devotionals/daily/daily');
const CHECKBOOK = resolve(SRC, 'checkbook.xml');
const KJV = resolve(ROOT, 'data-sources/KJV.json');
const PACK_OUTPUT = resolve(ROOT, 'packs/consolidated/devotionals.sqlite');

for (const f of [SME + '.zdt', DAILY + '.dat', CHECKBOOK, KJV]) {
  if (!existsSync(f)) {
    console.error(`❌ Missing source: ${f}\n   See the header of this script for where to download it.`);
    process.exit(1);
  }
}

// OSIS book code -> canonical book name (matches build-isbe-pack.mjs / bibleData.ts).
const OSIS_TO_BOOK = {
  Gen: 'Genesis', Exod: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deut: 'Deuteronomy',
  Josh: 'Joshua', Judg: 'Judges', Ruth: 'Ruth', '1Sam': '1 Samuel', '2Sam': '2 Samuel',
  '1Kgs': '1 Kings', '2Kgs': '2 Kings', '1Chr': '1 Chronicles', '2Chr': '2 Chronicles',
  Ezra: 'Ezra', Neh: 'Nehemiah', Esth: 'Esther', Job: 'Job', Ps: 'Psalms', Prov: 'Proverbs',
  Eccl: 'Ecclesiastes', Song: 'Song of Solomon', Isa: 'Isaiah', Jer: 'Jeremiah',
  Lam: 'Lamentations', Ezek: 'Ezekiel', Dan: 'Daniel', Hos: 'Hosea', Joel: 'Joel',
  Amos: 'Amos', Obad: 'Obadiah', Jonah: 'Jonah', Mic: 'Micah', Nah: 'Nahum', Hab: 'Habakkuk',
  Zeph: 'Zephaniah', Hag: 'Haggai', Zech: 'Zechariah', Mal: 'Malachi', Matt: 'Matthew',
  Mark: 'Mark', Luke: 'Luke', John: 'John', Acts: 'Acts', Rom: 'Romans',
  '1Cor': '1 Corinthians', '2Cor': '2 Corinthians', Gal: 'Galatians', Eph: 'Ephesians',
  Phil: 'Philippians', Col: 'Colossians', '1Thess': '1 Thessalonians', '2Thess': '2 Thessalonians',
  '1Tim': '1 Timothy', '2Tim': '2 Timothy', Titus: 'Titus', Phlm: 'Philemon', Heb: 'Hebrews',
  Jas: 'James', '1Pet': '1 Peter', '2Pet': '2 Peter', '1John': '1 John', '2John': '2 John',
  '3John': '3 John', Jude: 'Jude', Rev: 'Revelation',
};
const BOOK_TO_OSIS = Object.fromEntries(Object.entries(OSIS_TO_BOOK).map(([o, b]) => [b, o]));

// Daily Light's reference abbreviations -> OSIS. "Jud" is Judges here (Jude is
// written out), "So"/"Ca" are Song of Solomon (Canticles), "EPh" is a typo.
const DAILY_ABBR = {
  Ge: 'Gen', Ex: 'Exod', Le: 'Lev', Nu: 'Num', De: 'Deut', Jos: 'Josh', Jud: 'Judg', Ru: 'Ruth',
  '1Sa': '1Sam', '2Sa': '2Sam', '1Ki': '1Kgs', '2Ki': '2Kgs', '1Ch': '1Chr', '2Ch': '2Chr',
  Ezr: 'Ezra', Ne: 'Neh', Neh: 'Neh', Es: 'Esth', Job: 'Job', Ps: 'Ps', Psa: 'Ps', Pr: 'Prov',
  Ec: 'Eccl', So: 'Song', Ca: 'Song', Is: 'Isa', Isa: 'Isa', Je: 'Jer', Jer: 'Jer', La: 'Lam',
  Lam: 'Lam', Eze: 'Ezek', Da: 'Dan', Ho: 'Hos', Hos: 'Hos', Joe: 'Joel', Am: 'Amos', Ob: 'Obad',
  Jon: 'Jonah', Mi: 'Mic', Mic: 'Mic', Na: 'Nah', Hab: 'Hab', Zep: 'Zeph', Hag: 'Hag',
  Zec: 'Zech', Mal: 'Mal', Mt: 'Matt', Mr: 'Mark', Lu: 'Luke', Joh: 'John', Ac: 'Acts',
  Ro: 'Rom', '1Co': '1Cor', '2Co': '2Cor', Ga: 'Gal', Eph: 'Eph', EPh: 'Eph', Php: 'Phil',
  Col: 'Col', Co: 'Col', '1Th': '1Thess', '2Th': '2Thess', '1Ti': '1Tim', '2Ti': '2Tim',
  Tit: 'Titus', Phm: 'Phlm', He: 'Heb', Heb: 'Heb', Jas: 'Jas', '1Pe': '1Pet', '2Pe': '2Pet',
  '1Jo': '1John', '1Joh': '1John', '2Jo': '2John', '3Jo': '3John', Jude: 'Jude', Re: 'Rev',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const MONTH_ABBR = { Jan: 1, Feb: 2, March: 3, April: 4, May: 5, June: 6, July: 7, Aug: 8, Sept: 9, Oct: 10, Nov: 11, Dec: 12 };

/* --------------------------------------------------------------------------- *
 * SWORD readers
 * ------------------------------------------------------------------------- */

/** zLD: .idx -> .dat record "KEY\n" + block number + entry number; .zdx -> zlib block in .zdt. */
function readZLD(base) {
  const idx = readFileSync(base + '.idx'), dat = readFileSync(base + '.dat');
  const zdx = readFileSync(base + '.zdx'), zdt = readFileSync(base + '.zdt');
  const blocks = new Map();
  const block = (n) => {
    if (!blocks.has(n)) {
      const off = zdx.readUInt32LE(n * 8), size = zdx.readUInt32LE(n * 8 + 4);
      blocks.set(n, zlib.inflateSync(zdt.subarray(off, off + size)));
    }
    return blocks.get(n);
  };
  const out = [];
  for (let i = 0; i + 8 <= idx.length; i += 8) {
    const off = idx.readUInt32LE(i), size = idx.readUInt32LE(i + 4);
    const rec = dat.subarray(off, off + size);
    const nl = rec.indexOf(10);
    const key = rec.subarray(0, nl).toString('utf8').replace(/\r$/, '');
    const bn = rec.readUInt32LE(nl + 1), en = rec.readUInt32LE(nl + 5);
    const b = block(bn);
    const eo = b.readUInt32LE(4 + en * 8), es = b.readUInt32LE(4 + en * 8 + 4);
    out.push({ key, text: b.subarray(eo, eo + es).toString('utf8').replace(/\0+$/, '') });
  }
  return out;
}

/** RawLD: .idx holds 6-byte records (4-byte offset, 2-byte size); each .dat record is "KEY\n" + text. */
function readRawLD(base) {
  const idx = readFileSync(base + '.idx'), dat = readFileSync(base + '.dat');
  const out = [];
  for (let i = 0; i + 6 <= idx.length; i += 6) {
    const off = idx.readUInt32LE(i), size = idx.readUInt16LE(i + 4);
    const rec = dat.subarray(off, off + size).toString('utf8');
    const nl = rec.indexOf('\n');
    out.push({ key: rec.slice(0, nl).replace(/\r$/, ''), text: rec.slice(nl + 1) });
  }
  return out;
}

/* --------------------------------------------------------------------------- *
 * Shared helpers
 * ------------------------------------------------------------------------- */

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plainOf(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/g, ' ').replace(/<\/(p|blockquote)>/g, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').trim();
}

/** "Bible:John.3.16" / "John.3.16" / "Bible:Phil.3.13 Bible:Phil.3.14" -> { osis, book, chapter, verseStart, verseEnd } */
function parseOsis(raw) {
  const parts = raw.split(/\s+/).map((p) => p.replace(/^Bible:/, '')).filter(Boolean);
  const first = parts[0].split('-')[0].match(/^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/);
  if (!first) return null;
  const [, code, ch, vs] = first;
  if (!OSIS_TO_BOOK[code]) return null;
  let verseEnd = vs ? +vs : null;
  const last = parts[parts.length - 1].split('-').pop().match(/^(?:[1-3]?[A-Za-z]+\.)?(\d+)(?:\.(\d+))?$/);
  if (vs && last && last[2] && +last[1] === +ch) verseEnd = Math.max(+vs, +last[2]);
  return makeRef(code, +ch, vs ? +vs : null, verseEnd);
}

function makeRef(code, chapter, verseStart, verseEnd) {
  const osis = verseStart == null
    ? `${code}.${chapter}`
    : `${code}.${chapter}.${verseStart}${verseEnd && verseEnd !== verseStart ? `-${code}.${chapter}.${verseEnd}` : ''}`;
  return { book: OSIS_TO_BOOK[code], chapter, verseStart, verseEnd: verseStart == null ? null : (verseEnd ?? verseStart), osis };
}

function refLabel(r) {
  if (r.verseStart == null) return `${r.book} ${r.chapter}`;
  if (r.verses) {
    // Runs of consecutive verses joined with a dash, runs separated by commas: "17:1, 20-21".
    const runs = [];
    for (const v of r.verses) {
      const last = runs[runs.length - 1];
      if (last && v === last[1] + 1) last[1] = v; else runs.push([v, v]);
    }
    return `${r.book} ${r.chapter}:${runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}`;
  }
  return `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd !== r.verseStart ? `-${r.verseEnd}` : ''}`;
}

function refLink(r, text) {
  return `<a class="devo-ref" data-osis="${r.osis}">${escapeHtml(text)}</a>`;
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'upon', 'with']);
function titleCase(s) {
  return s.toLowerCase().replace(/[a-z][a-z']*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
}

/* --------------------------------------------------------------------------- *
 * Spurgeon, Morning and Evening (OSIS)
 * ------------------------------------------------------------------------- */

const warnings = [];
let smeRefFixes = 0;

/** A <reference> whose visible text says Jude but whose osisRef says Judges (the source's Jud/Jude mix-up). */
function smeRef(osisRef, shown) {
  let r = parseOsis(osisRef);
  if (/^Jude\b/.test(shown.trim()) && r && r.book === 'Judges') {
    const v = shown.match(/(\d+)\s*$/);
    r = makeRef('Jude', 1, v ? +v[1] : 1, v ? +v[1] : 1);
    smeRefFixes++;
  }
  return r;
}

function smeToHtml(osis) {
  let h = osis
    .replace(/<reference osisRef="([^"]+)">([^<]*)<\/reference>/g, (_, o, shown) => {
      const r = smeRef(o, shown);
      if (!r) { warnings.push(`SME ref unresolved: ${o}`); return escapeHtml(shown); }
      return refLink(r, decodeEntities(shown));
    })
    .replace(/<hi type="italic">/g, '<em>').replace(/<hi type="small-caps">/g, '<span class="sc">')
    .replace(/<hi type="bold">/g, '<strong>')
    .replace(/<\/hi>/g, '§HI§')
    .replace(/<lg>/g, '<blockquote>').replace(/<\/lg>/g, '</blockquote>')
    .replace(/\s*<l>/g, '').replace(/<\/l>/g, '<br>')
    .replace(/<lb\/>/g, '<br>')
    .replace(/<br><\/blockquote>/g, '</blockquote>');
  // Close each <hi> with the tag it opened as.
  const stack = [];
  h = h.replace(/<em>|<span class="sc">|<strong>|§HI§/g, (t) => {
    if (t !== '§HI§') { stack.push(t === '<em>' ? '</em>' : t === '<strong>' ? '</strong>' : '</span>'); return t; }
    return stack.pop() || '';
  });
  // Spurgeon's small caps sit hard against the next word's space in the source ("rejoice</hi> :").
  return h.replace(/<\/span> ([:;,.])/g, '</span>$1').replace(/<\/em> ([:;,.])/g, '</em>$1');
}

function buildSpurgeonME() {
  const rows = [];
  for (const e of readZLD(SME)) {
    const km = e.key.match(/^(\d\d)\.(\d\d)$/);
    if (!km) continue;
    const month = +km[1], day = +km[2];
    for (const sec of e.text.matchAll(/<div type="section" osisID="[^"]*\.(am|pm)"><title>([^<]*)<\/title>([\s\S]*?)<\/div>/g)) {
      const slot = sec[1] === 'am' ? 'morning' : 'evening';
      const body = sec[3];
      const head = body.match(/^<p><hi type="italic">([\s\S]*?)<\/hi><lb\/><reference osisRef="([^"]+)">([^<]*)<\/reference><\/p>/);
      if (!head) { warnings.push(`SME ${e.key} ${slot}: headline not found`); continue; }
      const ref = smeRef(head[2], head[3]);
      if (!ref) { warnings.push(`SME ${e.key} ${slot}: headline ref ${head[2]} unresolved`); continue; }
      const kjvText = decodeEntities(head[1]).replace(/^[“"]\s*|\s*[”"]$/g, '').trim();
      const bodyHtml = smeToHtml(body.slice(head[0].length)).trim();
      rows.push({
        work_id: 'spurgeon-me', month, day, slot,
        title: sec[2],
        body_html: bodyHtml,
        key_refs: [{ ...ref, kjvText }],
      });
    }
  }
  return rows;
}

/* --------------------------------------------------------------------------- *
 * Spurgeon, Faith's Checkbook (CCEL ThML)
 * ------------------------------------------------------------------------- */

function thmlToHtml(s) {
  return s
    .replace(/<scripRef[^>]*osisRef="([^"]+)"[^>]*>([\s\S]*?)<\/scripRef>/g, (_, o, shown) => {
      const r = parseOsis(o);
      if (!r) { warnings.push(`Checkbook ref unresolved: ${o}`); return shown; }
      return refLink(r, decodeEntities(shown.replace(/<[^>]+>/g, '')));
    })
    .replace(/<verse[^>]*>/g, '<blockquote>').replace(/<\/verse>/g, '</blockquote>')
    .replace(/<l[^>]*>/g, '').replace(/<\/l>/g, '<br>')
    .replace(/<br>\s*<\/blockquote>/g, '</blockquote>')
    .replace(/<p[^>]*>/g, '<p>')
    .replace(/<(\/?)i>/g, '<$1em>').replace(/<(\/?)b>/g, '<$1strong>')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

function buildCheckbook() {
  const xml = readFileSync(CHECKBOOK, 'utf8')
    // March 31's promise is tagged as the whole chapter, with its verses left outside the tag.
    .replace(/osisRef="Bible:Prov\.3"([^>]*)>Prov\. 3<\/scripRef>: 25,26/, 'osisRef="Bible:Prov.3.25 Bible:Prov.3.26"$1>Prov. 3:25, 26</scripRef>');
  const bodyStart = xml.indexOf('title="The Month of January"');
  const bodyEnd = xml.indexOf('title="Indexes"');
  const body = xml.slice(bodyStart, bodyEnd);
  const rows = [];
  const days = body.split(/<p class="Date"[^>]*>/).slice(1);
  for (const d of days) {
    const dm = d.match(/^([A-Za-z]+)\.?\s+(\d+)<\/p>/);
    if (!dm || !MONTH_ABBR[dm[1]]) { warnings.push(`Checkbook: bad date ${d.slice(0, 20)}`); continue; }
    const month = MONTH_ABBR[dm[1]], day = +dm[2];
    const h3 = d.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const vq = d.match(/<p class="VerseQuote"[^>]*>([\s\S]*?)<scripRef[^>]*osisRef="([^"]+)"[^>]*>[\s\S]*?<\/scripRef>\s*<\/p>/);
    if (!h3 || !vq) { warnings.push(`Checkbook ${month}/${day}: title or promise not found`); continue; }
    const ref = parseOsis(vq[2]);
    if (!ref) { warnings.push(`Checkbook ${month}/${day}: promise ref ${vq[2]} unresolved`); continue; }
    const kjvText = decodeEntities(vq[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().replace(/^["“]\s*|\s*["”]$/g, '');
    let rest = d.slice(d.indexOf(vq[0]) + vq[0].length);
    rest = rest.replace(/<\/div1>[\s\S]*$/, '').replace(/<div1[^>]*>[\s\S]*?<h1[^>]*>[\s\S]*?<\/h1>/g, '');
    rows.push({
      work_id: 'faiths-checkbook', month, day, slot: 'day',
      title: titleCase(decodeEntities(h3[1].replace(/<[^>]+>/g, '')).trim()),
      body_html: thmlToHtml(rest),
      key_refs: [{ ...ref, kjvText }],
    });
  }
  return rows;
}

/* --------------------------------------------------------------------------- *
 * Daily Light (ThML) — fragments matched to their passages
 * ------------------------------------------------------------------------- */

const norm = (n) => n.replace(/^III /, '3 ').replace(/^II /, '2 ').replace(/^I /, '1 ').replace('Revelation of John', 'Revelation');
const KJV_VERSES = new Map();
for (const b of JSON.parse(readFileSync(KJV, 'utf8')).books) {
  for (const c of b.chapters) for (const v of c.verses) KJV_VERSES.set(`${norm(b.name)} ${c.chapter}:${v.verse}`, v.text);
}

/**
 * Content words: lowercase, straight apostrophes, hyphens and brackets gone
 * ("Jehovah–nissi" = "Jehovahnissi"), and a final s dropped from longer words
 * so this edition's "always" meets the KJV's "alway".
 */
function words(s) {
  return s.toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/([a-z])[-–—]([a-z])/g, '$1$2')
    .replace(/[[\]]/g, '')
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
    .filter((w) => w.length > 2)
    .map((w) => (w.length > 4 ? w.replace(/s$/, '') : w));
}

// Rare words count for more: "Jehovahnissi" says Exodus 17:15 far louder than "banner" says Psalm 60:4.
const DF = new Map();
for (const t of KJV_VERSES.values()) for (const w of new Set(words(t))) DF.set(w, (DF.get(w) || 0) + 1);
const idf = (w) => Math.log(KJV_VERSES.size / (DF.get(w) || 1)) || 0.01;

/** One reference list ("Ps 37:23,24 73:23,24 Ro 8:38,39") -> passages, each with its verses. */
function parseDailyRefs(str, where) {
  const out = [];
  let code = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok) continue;
    if (/^\d?[A-Za-z]+$/.test(tok)) {
      code = DAILY_ABBR[tok];
      if (!code) warnings.push(`Daily ${where}: unknown book "${tok}"`);
      continue;
    }
    if (!code) continue;
    // "142.3" is a typo for "142:3"; a bare number is a one-chapter book's verse.
    const cv = tok.replace(/^(\d+)\.(\d+)/, '$1:$2');
    let [c, vs] = cv.split(':');
    if (vs === undefined) { vs = c; c = '1'; }
    const verses = [];
    for (const p of vs.split(',').filter(Boolean)) {
      const [a, b] = p.split('-').map(Number);
      // "Eph 2:7,9" quotes verse 8 too: a gap of one or two verses is filled for matching,
      // and narrowVerses() then keeps only the verses the fragment really uses.
      const prev = verses[verses.length - 1];
      if (prev && a > prev + 1 && a - prev <= 3) for (let x = prev + 1; x < a; x++) verses.push(x);
      for (let x = a; x <= (b || a); x++) verses.push(x);
    }
    const book = OSIS_TO_BOOK[code];
    const vw = verses.map((v) => ({ v, words: new Set(words(KJV_VERSES.get(`${book} ${+c}:${v}`) || '')) }));
    if (vw.every((x) => x.words.size === 0)) warnings.push(`Daily ${where}: no KJV text for ${code} ${tok}`);
    out.push({ code, chapter: +c, verses: vw, all: new Set(vw.flatMap((x) => [...x.words])) });
  }
  return out;
}

/**
 * Best passage for a piece of text: the rarity-weighted share of its words found
 * in the passage. Bagster lists his references in the order he quotes them, so
 * among near-ties the passage at or just after `after` (the previous fragment's) wins.
 */
function bestPassage(text, passages, after = -1) {
  const w = words(text);
  if (!w.length) return { idx: -1, score: 0 };
  const total = w.reduce((s, x) => s + idf(x), 0);
  const scores = passages.map((p) => w.reduce((s, x) => s + (p.all.has(x) ? idf(x) : 0), 0) / total);
  const best = Math.max(...scores);
  if (best <= 0) return { idx: -1, score: 0 };
  let idx = scores.indexOf(best);
  if (after >= 0 && idx < after) {
    let fwd = -1;
    scores.forEach((s, i) => { if (i >= after && (fwd < 0 || s > scores[fwd])) fwd = i; });
    if (fwd >= 0 && scores[fwd] >= best - 0.12) idx = fwd;
  }
  return { idx, score: scores[idx] };
}

/**
 * The verses of a passage this text actually quotes, by rare-word overlap:
 * a verse counts when the text carries a good share of the verse's own words,
 * or the verse carries a good share of the text's. Falls back to the verse that
 * shares the most. Verses that don't run on ("John 17:1, 20") are kept as a list.
 */
function narrowVerses(text, p) {
  const w = new Set(words(text));
  const fTotal = [...w].reduce((s, x) => s + idf(x), 0) || 1;
  const scored = p.verses.filter((x) => x.words.size).map((x) => {
    const shared = [...x.words].filter((t) => w.has(t));
    return { v: x.v, shared, weight: shared.reduce((s, t) => s + idf(t), 0), vTotal: [...x.words].reduce((s, t) => s + idf(t), 0) };
  }).sort((a, b) => b.weight - a.weight);
  // Greedy: the best verse first, then only verses that bring words the chosen ones don't already
  // explain, so "I am the LORD who sanctify you" stays Lev 20:8 and doesn't pull in 20:24 and 20:26.
  const covered = new Set();
  let hit = [];
  for (const x of scored) {
    if (x.weight <= 0) break;
    const fresh = x.shared.filter((t) => !covered.has(t)).reduce((s, t) => s + idf(t), 0);
    if (hit.length && fresh / fTotal < 0.2 && fresh / x.vTotal < 0.45) continue;
    hit.push(x.v);
    for (const t of x.shared) covered.add(t);
  }
  if (!hit.length) hit = p.verses.map((x) => x.v);
  hit.sort((a, b) => a - b);
  const ref = makeRef(p.code, p.chapter, hit[0], hit[hit.length - 1]);
  const contiguous = hit.every((v, i) => i === 0 || v === hit[i - 1] + 1);
  if (!contiguous) ref.verses = hit;
  return ref;
}

// Hand-checked answers for fragments the word overlap can't place, keyed "MM.DD slot|start of fragment".
const DAILY_OVERRIDES = {
  // The KJV spells it "stablisheth", so 1 Pet 5:10's shared common words outscore it.
  '01.15 evening|He who establisheth us with you in Chris': '2Cor.1.21',
};

const WHOLE_OK = 0.9;   // a fragment scoring this well against one passage is never split
const MIN_SCORE = 0.3;  // below this a fragment needs an override
const weakMatches = [];

/** Split a fragment that runs two passages together at a sentence or an ellipsis. */
function splitFragment(frag, passages, after) {
  const pieces = frag.split(/(?<=[.?!;:])\s+(?=[A-Z[])|\s*(?=\. \. \.)/).filter((p) => p.trim());
  if (pieces.length < 2) return [frag];
  // A piece too short to place on its own ("We", "Jehovahshammah:") rides with its neighbour.
  const tiny = (p) => words(p).length < 3;
  const merged = [];
  let carry = '';
  for (const piece of pieces) {
    if (tiny(piece) && !merged.length) { carry += piece + ' '; continue; }
    if (tiny(piece)) { merged[merged.length - 1] += ' ' + piece; continue; }
    merged.push(carry + piece);
    carry = '';
  }
  if (carry) {
    if (!merged.length) return [frag];
    merged[merged.length - 1] += ' ' + carry.trim();
  }
  const groups = [];
  let last = after;
  for (const piece of merged) {
    const { idx, score } = bestPassage(piece, passages, last);
    const prev = groups[groups.length - 1];
    if (prev && (idx === prev.idx || idx < 0 || score < 0.5)) prev.text += ' ' + piece;
    else { groups.push({ idx, text: piece }); last = idx; }
  }
  return groups.length > 1 ? groups.map((g) => g.text.trim()) : [frag];
}

let dailyFragments = 0, dailySplits = 0, dailyDropped = 0;

function buildDailyLight() {
  const rows = [];
  for (const e of readRawLD(DAILY)) {
    const km = e.key.match(/^(\d\d)\.(\d\d)$/);
    if (!km) continue;
    const month = +km[1], day = +km[2];
    const halves = e.text.split(/<i>(Morning|Evening)<\/i>:/).slice(1);
    for (let h = 0; h < halves.length; h += 2) {
      const slot = halves[h].toLowerCase();
      const where = `${km[1]}.${km[2]} ${slot}`;
      const body = halves[h + 1];
      const refStr = [...body.matchAll(/<scripRef passage="([^"]*)"/g)].map((m) => m[1]).join(' ');
      const passages = parseDailyRefs(refStr, where);
      const text = decodeEntities(body.replace(/<scripRef[\s\S]*?<\/scripRef>/g, '').replace(/<br \/>\r?\n?/g, '\n'))
        .replace(/\.m-(?=[A-Z])/g, '.--'); // "poison.m-Let your speech" (Oct 30) is a typo for "--"
      const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const keyRefs = [];
      let last = -1;
      paras.forEach((para, pi) => {
        // Fragments are joined with "--"; once with a single dash after a full stop ("for ever.-As in Adam").
        for (let frag of para.split(/\s*--\s*|(?<=[.?!])-(?=\s*[A-Z])/).filter(Boolean)) {
          frag = frag.replace(/^-+|-+$/g, '').trim();
          // A reference that slipped into the text itself ("Hebrews 13:12") is not a fragment.
          if (!frag || /^[1-3]?\s?[A-Z][a-z]+\.? \d+:\d+[\d,:-]*\.?$/.test(frag)) { dailyDropped++; continue; }
          const whole = bestPassage(frag, passages, last);
          const parts = whole.score >= WHOLE_OK ? [frag] : splitFragment(frag, passages, last);
          if (parts.length > 1) dailySplits++;
          for (const part of parts) {
            dailyFragments++;
            const key = `${where}|${part.slice(0, 40)}`;
            let ref;
            if (DAILY_OVERRIDES[key]) {
              ref = parseOsis(DAILY_OVERRIDES[key]);
            } else {
              const { idx, score } = bestPassage(part, passages, last);
              if (idx < 0 || score < MIN_SCORE) {
                warnings.push(`Daily ${where}: no passage for "${part.slice(0, 60)}" (best ${score.toFixed(2)}) — add a DAILY_OVERRIDES entry`);
                continue;
              }
              last = idx;
              ref = narrowVerses(part, passages[idx]);
              if (score < 0.75) weakMatches.push(`${where} ${score.toFixed(2)} ${refLabel(ref)} ← "${part.slice(0, 70)}"`);
            }
            keyRefs.push({ ...ref, kjvText: part, fragment: part, para: pi });
          }
        }
      });
      if (!keyRefs.length) { warnings.push(`Daily ${where}: no fragments`); continue; }
      rows.push({
        work_id: 'daily-light', month, day, slot,
        title: `${slot === 'morning' ? 'Morning' : 'Evening'}, ${MONTHS[month - 1]} ${day}`,
        body_html: '',
        key_refs: keyRefs,
      });
    }
  }
  return rows;
}

/* --------------------------------------------------------------------------- *
 * Build
 * ------------------------------------------------------------------------- */

console.log('📖 Building devotionals pack…');
const me = buildSpurgeonME();
const cb = buildCheckbook();
const dl = buildDailyLight();
const all = [...me, ...cb, ...dl];

if (existsSync(PACK_OUTPUT)) unlinkSync(PACK_OUTPUT);
mkdirSync(dirname(PACK_OUTPUT), { recursive: true });
const db = new Database(PACK_OUTPUT);
db.pragma('journal_mode = DELETE');
db.exec(`
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE works (
    work_id     TEXT PRIMARY KEY,
    title       TEXT,
    short_title TEXT,
    author      TEXT,
    year        INTEGER,
    has_slots   INTEGER,   -- 1 = morning + evening readings, 0 = one a day
    sort_order  INTEGER,
    about       TEXT
  );
  CREATE TABLE readings (
    work_id       TEXT,
    month         INTEGER,
    day           INTEGER,
    slot          TEXT,     -- morning | evening | day
    title         TEXT,
    body_html     TEXT,
    plain_text    TEXT,     -- lowercased, tag-free, for search
    key_refs_json TEXT,     -- [{book, chapter, verseStart, verseEnd, verses?, osis, label, kjvText, fragment?, para?}]
    PRIMARY KEY (work_id, month, day, slot)
  );
`);

const meta = {
  pack_id: 'devotionals',
  pack_type: 'devotionals',
  pack_version: '1.0.0',
  name: 'Devotionals',
  license: 'Public Domain',
  attribution: "C. H. Spurgeon, Morning and Evening (CrossWire SWORD module, from CCEL); C. H. Spurgeon, Faith's Checkbook (Christian Classics Ethereal Library); Jonathan Bagster, Daily Light on the Daily Path (CrossWire SWORD module)",
  description: "Three classic daily devotionals: Spurgeon's Morning and Evening, Spurgeon's Faith's Checkbook, and Bagster's Daily Light on the Daily Path.",
  created_at: new Date().toISOString(),
};
const insMeta = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);

const insWork = db.prepare('INSERT INTO works VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
insWork.run('spurgeon-me', 'Morning and Evening', 'Morning and Evening', 'C. H. Spurgeon', 1869, 1, 1,
  'Daily readings for every morning and evening of the year, each a short meditation on one verse.');
insWork.run('faiths-checkbook', "Faith's Checkbook", 'Checkbook', 'C. H. Spurgeon', 1888, 0, 2,
  'A promise of God for every day of the year, with a short comment on cashing it by faith.');
insWork.run('daily-light', 'Daily Light on the Daily Path', 'Daily Light', 'Jonathan Bagster', 1875, 1, 3,
  'Morning and evening readings made entirely of Scripture, verses gathered around one theme.');

const insReading = db.prepare('INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
db.transaction(() => {
  for (const r of all) {
    const plain = (r.title + ' ' + r.key_refs.map((k) => k.kjvText).join(' ') + ' ' + plainOf(r.body_html)).toLowerCase().replace(/\s+/g, ' ').trim();
    const keyRefs = r.key_refs.map((k) => ({ ...k, label: refLabel(k) }));
    insReading.run(r.work_id, r.month, r.day, r.slot, r.title, r.body_html, plain, JSON.stringify(keyRefs));
  }
})();

// --- Checks ---
const count = (w, s) => db.prepare(`SELECT COUNT(*) c FROM readings WHERE work_id = ?${s ? ' AND slot = ?' : ''}`).get(...(s ? [w, s] : [w])).c;
const hasFeb29 = (w) => db.prepare('SELECT COUNT(*) c FROM readings WHERE work_id = ? AND month = 2 AND day = 29').get(w).c > 0;
const checks = [
  ['Morning and Evening mornings', count('spurgeon-me', 'morning'), 366],
  ['Morning and Evening evenings', count('spurgeon-me', 'evening'), 366],
  ['Daily Light mornings', count('daily-light', 'morning'), 366],
  ['Daily Light evenings', count('daily-light', 'evening'), 366],
  ["Faith's Checkbook days", count('faiths-checkbook'), 366],
];
let failed = false;
console.log('\n🔎 Checks:');
for (const [label, got, want] of checks) {
  const ok = got === want;
  if (!ok) failed = true;
  console.log(`   ${ok ? '✓' : '✗'} ${label}: ${got}${ok ? '' : ` (expected ${want})`}`);
}
for (const w of ['spurgeon-me', 'faiths-checkbook', 'daily-light']) {
  console.log(`   ${hasFeb29(w) ? '✓' : '!'} ${w} ${hasFeb29(w) ? 'has' : 'has NO'} Feb 29${hasFeb29(w) ? '' : ' (the app falls back to Feb 28)'}`);
}
const emptyBodies = db.prepare("SELECT work_id, month, day, slot FROM readings WHERE work_id != 'daily-light' AND (body_html IS NULL OR body_html = '')").all();
console.log(`   ${emptyBodies.length ? '✗' : '✓'} empty bodies (outside Daily Light): ${emptyBodies.length}`);
if (emptyBodies.length) failed = true;
const badBooks = all.flatMap((r) => r.key_refs).filter((k) => !BOOK_TO_OSIS[k.book]);
console.log(`   ${badBooks.length ? '✗' : '✓'} key-ref books that don't resolve: ${badBooks.length}`);
if (badBooks.length) failed = true;
console.log(`   ✓ Morning and Evening: ${smeRefFixes} Jude references corrected from Judges`);
console.log(`   ✓ Daily Light: ${dailyFragments} fragments, every one with a passage (${dailySplits} split in two, ${dailyDropped} stray references dropped)`);
if (weakMatches.length) {
  console.log(`\n   Daily Light matches under 75% word overlap (${weakMatches.length}), for review:`);
  for (const w of weakMatches) console.log('     ' + w);
}
if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} warning(s):`);
  for (const w of warnings) console.log('   ' + w);
}

console.log('\n📝 Samples:');
for (const w of ['spurgeon-me', 'faiths-checkbook', 'daily-light']) {
  const r = db.prepare('SELECT * FROM readings WHERE work_id = ? AND month = 1 AND day = 1 ORDER BY slot DESC LIMIT 1').get(w);
  const refs = JSON.parse(r.key_refs_json);
  console.log(`   [${w}] ${r.title}`);
  console.log(`      ${refs.length} key ref(s): ${refs.slice(0, 4).map(refLabel).join('; ')}${refs.length > 4 ? '…' : ''}`);
  console.log(`      "${refs[0].kjvText.slice(0, 90)}"`);
  if (r.body_html) console.log(`      ${r.body_html.slice(0, 160)}…`);
}

db.exec('VACUUM;');
db.close();

if (failed || warnings.length) {
  console.error('\n❌ Build checks failed — see above.');
  process.exit(1);
}

const buf = readFileSync(PACK_OUTPUT);
const sha256 = createHash('sha256').update(buf).digest('hex');
const sizeBytes = statSync(PACK_OUTPUT).size;
console.log('\n📊 Devotionals pack summary:');
console.log(`   Readings:         ${all.length}`);
console.log(`   Output:           ${PACK_OUTPUT}`);
console.log(`   Size:             ${(sizeBytes / 1048576).toFixed(2)} MB (${sizeBytes} bytes)`);
console.log(`   sha256:           ${sha256}`);
console.log('\n✅ Devotionals pack built successfully!');
