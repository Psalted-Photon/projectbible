// parse-wordset.mjs
// Wordset JSON → english_definitions_wordset rows (NDJSON)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeLemma, normalizePOS } from "./helpers/normalize.js";
import { OutputWriter } from "./helpers/output.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.argv[2] || path.join(__dirname, "../../data-sources/wordset/data");

if (!fs.existsSync(DATA_DIR)) {
  console.error(`Usage: node parse-wordset.mjs [wordset-data-dir]`);
  console.error(`Directory not found: ${DATA_DIR}`);
  process.exit(1);
}

const writer = new OutputWriter("wordset.ndjson");

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith(".json"))
  .sort();

let totalWords = 0;
let totalDefs = 0;

for (const file of files) {
  const filePath = path.join(DATA_DIR, file);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

  for (const entry of Object.values(data)) {
    if (!entry.word || !Array.isArray(entry.meanings)) continue;

    const lemma = normalizeLemma(entry.word);
    if (!lemma) continue;

    totalWords++;

    entry.meanings.forEach((meaning, i) => {
      if (!meaning.def) return;

      writer.write({
        word: lemma,
        pos: normalizePOS(meaning.speech_part) || "unknown",
        sense_number: null,
        definition_order: i + 1,
        definition_text: meaning.def.trim(),
        example: meaning.example ? meaning.example.trim() : null,
        source: "wordset",
        source_url: null
      });

      totalDefs++;
    });
  }
}

writer.close();
console.log(`Wordset parsing complete: ${totalWords} words, ${totalDefs} definitions → wordset.ndjson`);
