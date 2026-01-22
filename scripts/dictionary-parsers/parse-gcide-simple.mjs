// parse-gcide-simple.mjs
// Simple GCIDE parser using regex instead of XML parser

import fs from "fs";
import { normalizeLemma } from "./helpers/normalize.js";
import { OutputWriter } from "./helpers/output.js";

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node parse-gcide-simple.mjs <gcide.xml>");
  process.exit(1);
}

console.log('📖 Parsing GCIDE entries...');

const writer = new OutputWriter("gcide-historic.ndjson");

// Read the entire file
const content = fs.readFileSync(inputFile, 'utf8');

// Split into paragraphs and filter for entries
const paragraphs = content.split('<p>');
let entryCount = 0;

for (const para of paragraphs) {
  // Check if this paragraph contains an entry
  const entMatch = para.match(/<ent>([^<]+)<\/ent>/);
  if (!entMatch) continue;

  // Extract headword
  const hwMatch = para.match(/<hw>([^<]+)<\/hw>/);
  if (!hwMatch) continue;
  
  const lemma = normalizeLemma(hwMatch[1]);
  if (!lemma) continue;

  // Extract part of speech
  const posMatch = para.match(/<pos>([^<]+)<\/pos>/);
  const pos = posMatch ? normalizePos(posMatch[1]) : "unknown";

  // Extract all definitions (can have multiple <def> tags)
  const defRegex = /<def>([^<]+(?:<[^/][^>]*>[^<]*<\/[^>]+>)*[^<]*)<\/def>/g;
  const definitions = [];
  let defMatch;
  
  while ((defMatch = defRegex.exec(para)) !== null) {
    let definition = defMatch[1]
      .replace(/<[^>]+>/g, '') // Strip remaining tags
      .replace(/\s+/g, ' ')
      .trim();
    
    if (definition && definition.length > 5) {
      definitions.push(definition);
    }
  }

  // If no <def> tags, try extracting text between tags
  if (definitions.length === 0) {
    // Look for numbered definitions
    const numberedDefs = para.match(/<sn>(\d+[a-z]?)\.<\/sn>\s*([^<]+)/g);
    if (numberedDefs) {
      for (const numDef of numberedDefs) {
        const defText = numDef.replace(/<[^>]+>/g, '').trim();
        if (defText && defText.length > 5) {
          definitions.push(defText);
        }
      }
    }
  }

  // Write each definition
  definitions.forEach((defText, idx) => {
    writer.write({
      word: lemma,
      pos: pos,
      definition_order: idx + 1,
      definition_text: defText
    });
    entryCount++;
  });

  if (entryCount % 10000 === 0) {
    console.log(`   Processed ${entryCount} definitions...`);
  }
}

writer.close();
console.log(`✅ GCIDE parsing complete!`);
console.log(`   Total definitions: ${entryCount}`);

function normalizePos(pos) {
  const normalized = pos.toLowerCase().replace(/[.,]/g, "").trim();
  
  if (normalized.includes("noun") || normalized === "n") return "noun";
  if (normalized.includes("verb") || normalized === "v") return "verb";
  if (normalized.includes("adj") || normalized === "a") return "adjective";
  if (normalized.includes("adv")) return "adverb";
  if (normalized.includes("prep")) return "preposition";
  if (normalized.includes("conj")) return "conjunction";
  if (normalized.includes("pron")) return "pronoun";
  if (normalized.includes("interj")) return "interjection";
  
  return normalized;
}
