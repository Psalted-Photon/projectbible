#!/usr/bin/env node
// Merges commentary-unified.ndjson + commentary-imp.ndjson → commentary-final.ndjson
// Uses Node.js streams to avoid PowerShell UTF-8 BOM issues
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '../data/processed');

const inputs = [
  join(BASE, 'commentary-unified.ndjson'),
  join(BASE, 'commentary-imp.ndjson'),
];
const output = join(BASE, 'commentary-final.ndjson');

const out = createWriteStream(output, { encoding: 'utf-8' });
let total = 0;

async function appendFile(filePath) {
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) { out.write(line + '\n'); total++; }
  }
}

for (const f of inputs) {
  process.stdout.write(`Appending ${f}...\n`);
  await appendFile(f);
}

await new Promise((res, rej) => { out.end(); out.on('finish', res); out.on('error', rej); });
console.log(`Done: ${total.toLocaleString()} entries → ${output}`);
