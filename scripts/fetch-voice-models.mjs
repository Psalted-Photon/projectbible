#!/usr/bin/env node
/**
 * Fetch the Voice Control model files into packs/consolidated/, ready for the
 * packs release.
 *
 * The same pinned files the Voice Control lab downloads (worker.js FILES),
 * renamed with a voice- prefix so they sit together on the release, and
 * checked against the same SHA-256s. A file already here with the right hash
 * is left alone. Run generate-manifest.mjs afterwards.
 *
 * All Apache-2.0 (Cactus's Whistle, Needle 3 and their engine; sherpa-onnx's
 * punctuation model) or MIT (Silero voice detector), so they may be passed on.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'packs/consolidated');

const HF = 'https://huggingface.co/';
const NEEDLE = HF + 'Cactus-Compute/needle3/resolve/d6c7d6a2e9655505e0f8e23339356dd1705900eb/';
const PUNCT = HF + 'brady-pplx/sherpa-onnx-online-punct-en-2024-08-06/resolve/29a49a07620ef067e6fa40580da620c11db07b83/';

export const VOICE_FILES = [
  { file: 'voice-needle.js', url: NEEDLE + 'wasm/needle.js', sha256: 'a675c66f506a1b6f922d852c0cc0b82a843ce9d0fab6a80a408106f516df126f' },
  { file: 'voice-needle.wasm', url: NEEDLE + 'wasm/needle.wasm', sha256: '7b73d09c17923bf81d6bdb82e19b3c343b8994f83d512ddec52eec9f6b029802' },
  { file: 'voice-whistle.cact', url: HF + 'Cactus-Compute/whistle/resolve/741118687e1f008f06d1351a402a731274789790/whistle.cact', sha256: 'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb' },
  { file: 'voice-needle3.cact', url: NEEDLE + 'needle3.cact', sha256: 'c9d915eca282ed42d1a09b143b592adb4cc6744ffe2d294adf5cfc5548170c38' },
  { file: 'voice-punct.int8.onnx', url: PUNCT + 'model.int8.onnx', sha256: '9d611f445fe4a46186080fe161be6059d87d72eb88d3a8cb00c1a06e83a6067e' },
  { file: 'voice-punct.vocab', url: PUNCT + 'bpe.vocab', sha256: 'e118b7ad88c54db562517df49e1cffd4836d166c34fb190fd311d7f34eb238f5' },
  { file: 'voice-vad.onnx', url: HF + 'onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx', sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808' },
];

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  for (const f of VOICE_FILES) {
    const path = join(OUT_DIR, f.file);
    if (existsSync(path) && sha(readFileSync(path)) === f.sha256) {
      console.log(`✓ ${f.file} already here`);
      continue;
    }
    process.stdout.write(`↓ ${f.file} … `);
    const res = await fetch(f.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`${f.file}: ${res.status} ${res.statusText}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = sha(bytes);
    if (got !== f.sha256) throw new Error(`${f.file}: checksum ${got} is not the pinned ${f.sha256}`);
    writeFileSync(path, bytes);
    console.log(`${(bytes.length / 1048576).toFixed(2)} MB, checksum matches`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
