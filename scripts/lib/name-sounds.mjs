/**
 * What the Name Lab's scripts share: the app's own text-to-sounds step run in
 * Node, how often the Bible uses a word, and reading the fixes the lab copies
 * out (scripts/name-fixes.txt).
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { stripFootnotes, stripHtml } from './clean-text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = join(root, 'apps', 'pwa-polished');
const TTS_DIR = join(app, 'public', 'tts');
const VENDOR = join(app, 'src', 'lib', 'tts', 'vendor', 'piper-phonemize.js');
const FIXES_FILE = join(root, 'scripts', 'name-fixes.txt');

// ─── sounds ─────────────────────────────────────────────────────────────────

// The vendored module is an Emscripten build that expects a CommonJS-ish global
// scope when it detects Node, the same setup as scripts/phonemize-probe.mjs.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = TTS_DIR;
globalThis.__filename = join(TTS_DIR, 'piper-phonemize.js');
const { createPiperPhonemize } = await import(pathToFileURL(VENDOR).href);

const BATCH = 50;

/**
 * Each input object prints one line. In batches, because a long input overruns
 * the module's memory, and with a fresh module per batch, because one aborts
 * after a few calls. The app starts a fresh one per call too.
 */
export async function soundsFor(words, accent, batchSize = BATCH) {
  const out = [];
  for (let at = 0; at < words.length; at += batchSize) {
    const batch = words.slice(at, at + batchSize);
    const printed = [];
    const phonemizer = await createPiperPhonemize({
      print: (line) => printed.push(line),
      printErr: (line) => console.error(line),
      locateFile: (file) => join(TTS_DIR, file),
    });
    phonemizer.callMain([
      '-l', accent,
      '--input', JSON.stringify(batch.map((text) => ({ text }))),
      '--espeak_data', '/espeak-ng-data',
    ]);
    if (printed.length !== batch.length) {
      throw new Error(`Asked for ${batch.length} words in ${accent} and got ${printed.length}`);
    }
    out.push(...printed.map((line) => JSON.parse(line).phonemes.join('')));
  }
  return out;
}

// ─── counts ─────────────────────────────────────────────────────────────────

/** The KJV, WEB, BSB and NET verses, without notes or tags. */
export function bibleVerses() {
  const packs = join(root, 'packs');
  const tx = new Database(join(packs, 'consolidated', 'translations.sqlite'), { readonly: true });
  const net = new Database(join(packs, 'net.sqlite'), { readonly: true });
  const clean = ({ text }) => stripHtml(stripFootnotes(text)).replace(/[\x00-\x1f]/g, ' ');
  const verses = ['kjv', 'web', 'bsb'].flatMap((t) =>
    tx.prepare('SELECT text FROM verses WHERE translation_id = ?').all(t).map(clean),
  );
  verses.push(...net.prepare('SELECT text FROM verses').all().map(clean));
  tx.close();
  net.close();
  return verses;
}

const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

/** How often each word is used, as written. Possessives count for the name, and capitals ("JEHOVAH") read as the name. */
export function bibleWordCounts(verses = bibleVerses()) {
  const counts = new Map();
  for (const text of verses) {
    for (const m of text.matchAll(WORD_RE)) {
      const bare = m[0].replace(/['’]s?$/, '');
      const word = /^[A-Z]/.test(bare) && bare === bare.toUpperCase() ? bare[0] + bare.slice(1).toLowerCase() : bare;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return counts;
}

// ─── the lab's fixes ────────────────────────────────────────────────────────

/**
 * The fixes, one per name; a later line for a name replaces an earlier one, so
 * a new paste can simply go on the end. Everything but fix lines is skipped.
 */
export function readNameFixes() {
  const fixes = new Map();
  for (const line of readFileSync(FIXES_FILE, 'utf8').split(/\r?\n/)) {
    if (!line.includes(' | ') || line.startsWith('#')) continue;
    const [name, ...parts] = line.split(' | ').map((p) => p.trim());
    const fix = { name, hear: [] };
    for (const part of parts) {
      const [, key, value] = part.match(/^(\w+): (.*)$/) ?? [];
      if (key === 'spell') fix.spell = value;
      else if (key === 'strong') fix.strong = Number(value.split(' of ')[0]);
      else if (key === 'says') [fix.saysUs, fix.saysUk = fix.saysUs] = value.split(' / ');
      else if (key === 'hear') fix.hear = value.split(', ');
      else throw new Error(`Can't read "${part}" in the fix for ${name}`);
    }
    fixes.set(name, fix);
  }
  return [...fixes.values()];
}
