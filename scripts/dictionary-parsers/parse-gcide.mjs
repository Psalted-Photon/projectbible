// parse-gcide.mjs
// TEI/XML GCIDE → english_definitions_historic rows

import fs from "fs";
import sax from "sax";
import { normalizeLemma } from "./helpers/normalize.js";
import { OutputWriter } from "./helpers/output.js";

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node parse-gcide.mjs <gcide.xml>");
  process.exit(1);
}

const writer = new OutputWriter("gcide-historic.ndjson");

let currentEntry = null;
let currentText = "";
let inDef = false;
let currentPOS = null;
let inPOS = false;

const parser = sax.createStream(true, { trim: true });

parser.on("opentag", (node) => {
  if (node.name === "entry") {
    currentEntry = { lemma: null, pos: null, senses: [] };
    currentPOS = null;
  }
  if (node.name === "hw" && currentEntry) {
    currentEntry._readingLemma = true;
  }
  if (node.name === "pos" && currentEntry) {
    inPOS = true;
    currentPOS = "";
  }
  if (node.name === "def" && currentEntry) {
    inDef = true;
    currentText = "";
  }
});

parser.on("text", (text) => {
  if (currentEntry?._readingLemma) {
    currentEntry.lemma = text;
  }
  if (inPOS) {
    currentPOS += text;
  }
  if (inDef) {
    currentText += text;
  }
});

parser.on("closetag", (name) => {
  if (name === "hw" && currentEntry) {
    currentEntry._readingLemma = false;
  }
  if (name === "pos" && currentEntry) {
    inPOS = false;
    if (currentPOS) {
      currentEntry.pos = normalizePOSGCIDE(currentPOS.trim());
    }
  }
  if (name === "def" && currentEntry) {
    inDef = false;
    currentEntry.senses.push(currentText.trim());
  }
  if (name === "entry") {
    processEntry(currentEntry);
    currentEntry = null;
  }
});

function normalizePOSGCIDE(pos) {
  const normalized = pos.toLowerCase().replace(/[.,]/g, "").trim();
  
  // Map common GCIDE POS to standard forms
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

function processEntry(entry) {
  if (!entry.lemma) return;

  const lemma = normalizeLemma(entry.lemma);
  const pos = entry.pos || "unknown";

  // Process each sense
  entry.senses.forEach((text, i) => {
    if (!text || text.length === 0) return;

    // Clean XML entities and whitespace
    let cleaned = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    // Extract GCIDE numbering if present (e.g., "1a.", "2b.", etc.)
    const numberMatch = cleaned.match(/^(\d+[a-z]?)\.\s*/);
    let definitionOrder = i + 1;
    
    if (numberMatch) {
      // Remove the numbering from the definition text
      cleaned = cleaned.replace(/^\d+[a-z]?\.\s*/, "");
      
      // Parse the numbering for better ordering
      const num = numberMatch[1];
      const baseNum = parseInt(num.match(/\d+/)[0]);
      const subNum = num.match(/[a-z]/)?.[0] || "";
      
      if (subNum) {
        // Convert "1a" to 1.1, "1b" to 1.2, etc.
        definitionOrder = baseNum + (subNum.charCodeAt(0) - 96) * 0.1;
      } else {
        definitionOrder = baseNum;
      }
    }

    if (cleaned.length === 0) return;

    writer.write({
      word: lemma,
      pos: pos,
      definition_order: Math.round(definitionOrder * 10) / 10, // Keep one decimal
      definition_text: cleaned
    });
  });
}

parser.on("end", () => {
  writer.close();
  console.log("GCIDE parsing complete.");
});

fs.createReadStream(inputFile).pipe(parser);
