/**
 * Print what a verse will actually sound like, without launching the app.
 *
 * Runs the PWA's own bundled espeak-ng phonemizer — the same binary the reader
 * uses — so what this prints is what the voice will be fed. Written for the
 * original-language work: Greek pronunciation is chosen by an espeak language
 * code, and any future Hebrew grapheme-to-phoneme rules can be checked here in
 * a second rather than by installing a 60 MB voice and listening.
 *
 * Usage:
 *   node scripts/phonemize-probe.mjs                     # the built-in cases
 *   node scripts/phonemize-probe.mjs el "Ἐν ἀρχῇ ἦν"     # one language + text
 *
 * A "DROPPED" line means the phonemizer emitted a symbol the shared Piper id
 * table has no entry for, so the voice would never hear it.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TTS_DIR = resolve(HERE, '../apps/pwa-polished/public/tts');
const VENDOR = resolve(HERE, '../apps/pwa-polished/src/lib/tts/vendor/piper-phonemize.js');

// The vendored module is an Emscripten build that expects a CommonJS-ish global
// scope when it detects Node. Give it one before importing.
globalThis.require = createRequire(import.meta.url);
globalThis.__dirname = TTS_DIR;
globalThis.__filename = `${TTS_DIR}/piper-phonemize.js`;

const { createPiperPhonemize } = await import(pathToFileURL(VENDOR).href);

function phonemize(text, lang) {
  return new Promise((resolvePromise, reject) => {
    let out = '';
    let err = '';
    createPiperPhonemize({
      print: (m) => { out += m; },
      printErr: (m) => { err += `${m}\n`; },
      locateFile: (file) => `${TTS_DIR}/${file}`,
    })
      .then((mod) => {
        mod.callMain([
          '-l', lang,
          '--input', JSON.stringify([{ text: text.trim() }]),
          '--espeak_data', '/espeak-ng-data',
        ]);
        // callMain is synchronous but the module writes through a print hook;
        // give the runtime a tick to flush before reading it.
        setTimeout(() => resolvePromise({ out, err }), 400);
      })
      .catch(reject);
  });
}

async function report(lang, label, text) {
  const { out, err } = await phonemize(text, lang);
  let parsed = null;
  try { parsed = JSON.parse(out); } catch { /* not JSON — printed raw below */ }

  console.log(`\n### [${lang}] ${label}`);
  console.log(`  in : ${text}`);
  if (!parsed) {
    console.log(`  raw: ${out.slice(0, 400)}`);
    if (err) console.log(`  err: ${err.slice(0, 300)}`);
    return;
  }
  const phonemes = parsed.phonemes ?? [];
  const ids = parsed.phoneme_ids ?? [];
  console.log(`  out: ${phonemes.join('')}`);
  // Piper's id stream is "^ _ p _ p _ … _ $", so a full run is always 2n+3.
  const expected = phonemes.length * 2 + 3;
  console.log(`  ids: ${ids.length}${ids.length === expected ? '' : `  *** DROPPED (expected ${expected}) ***`}`);
}

const [langArg, textArg] = process.argv.slice(2);

if (langArg && textArg) {
  await report(langArg, 'argv', textArg);
} else {
  const GREEK = 'Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν';
  const HEBREW = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ';
  await report('el', 'Greek, modern/liturgical', GREEK);
  await report('grc', 'Greek, reconstructed Koine', GREEK);
  await report('en-us', 'English, for comparison', 'In the beginning was the Word');
  // espeak has no working Hebrew letter-to-sound rules: this reads out the
  // NAMES of the letters and points. Kept as the reference for why Hebrew
  // needs its own rules rather than the built-in "he" voice.
  await report('he', 'Hebrew via espeak (known broken)', HEBREW);
  await report('eo', 'Hebrew via transliteration', 'bereŝit bara elohim et haŝamajim veet harets');
}
