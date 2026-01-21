// parse-wiktionary.mjs
// Streaming Wiktionary XML → english_definitions_modern rows
// This is scaffolding. Claude will fill in the TODO sections.

import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import sax from "sax";
import { normalizeLemma, normalizePOS } from "./helpers/normalize.js";
import { OutputWriter } from "./helpers/output.js";

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node parse-wiktionary.mjs <wiktionary.xml>");
  process.exit(1);
}

const writer = new OutputWriter("wiktionary-modern.ndjson");

let currentPage = null;
let currentText = "";
let inText = false;

const parser = sax.createStream(true, { trim: true });

parser.on("opentag", (node) => {
  if (node.name === "page") {
    currentPage = { title: null, text: null };
  }
  if (node.name === "title" && currentPage) {
    currentPage._readingTitle = true;
  }
  if (node.name === "text" && currentPage) {
    inText = true;
    currentText = "";
  }
});

parser.on("text", (text) => {
  if (currentPage?._readingTitle) {
    currentPage.title = text;
  }
  if (inText) {
    currentText += text;
  }
});

parser.on("closetag", (name) => {
  if (name === "title" && currentPage) {
    currentPage._readingTitle = false;
  }
  if (name === "text" && currentPage) {
    inText = false;
    currentPage.text = currentText;
  }
  if (name === "page") {
    processPage(currentPage);
    currentPage = null;
  }
});

function processPage(page) {
  if (!page.title || !page.text) return;

  const lemma = normalizeLemma(page.title);
  const lines = page.text.split("\n");

  // Find English section
  let inEnglish = false;
  let currentPOS = null;
  let currentEtymology = null;
  let definitionOrder = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect English section
    if (line === "==English==") {
      inEnglish = true;
      continue;
    }

    // Exit English section
    if (inEnglish && line.startsWith("==") && line !== "==English==") {
      inEnglish = false;
      continue;
    }

    if (!inEnglish) continue;

    // Extract POS sections
    const posMatch = line.match(/^===\s*(Noun|Verb|Adjective|Adverb|Pronoun|Preposition|Conjunction|Interjection|Determiner|Article|Participle|Proper noun)\s*===/i);
    if (posMatch) {
      currentPOS = normalizePOS(posMatch[1]);
      definitionOrder = 0;
      continue;
    }

    // Extract Etymology
    if (line.match(/^===\s*Etymology/i)) {
      currentEtymology = "";
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("===") && !lines[j].trim().startsWith("==")) {
        const etymLine = lines[j].trim();
        if (etymLine && !etymLine.startsWith("#") && !etymLine.startsWith("*")) {
          currentEtymology += cleanWikiMarkup(etymLine) + " ";
        }
        j++;
      }
      currentEtymology = currentEtymology.trim();
      continue;
    }

    // Extract senses (definitions)
    if (currentPOS && line.match(/^#+\s+/)) {
      // Skip examples and nested items
      if (line.match(/^##[:#]/)) continue;

      const defText = line.replace(/^#+\s*/, "");
      const cleaned = cleanWikiMarkup(defText);

      if (cleaned.length === 0) continue;

      // Extract tags
      const tags = extractTags(cleaned);

      definitionOrder++;

      writer.write({
        word: lemma,
        pos: currentPOS,
        definition_order: definitionOrder,
        definition_text: cleaned,
        etymology: currentEtymology || "",
        tags: tags
      });
    }
  }
}

function cleanWikiMarkup(text) {
  let cleaned = text;

  // Remove templates (simplified - just strip {{...}})
  cleaned = cleaned.replace(/\{\{[^}]*\}\}/g, "");

  // Remove links but keep text: [[link|text]] -> text, [[link]] -> link
  cleaned = cleaned.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, "$1");

  // Remove bold/italic
  cleaned = cleaned.replace(/'{2,}/g, "");

  // Remove HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

function extractTags(text) {
  const tags = [];
  const tagPatterns = [
    /\b(archaic|obsolete)\b/i,
    /\b(slang|colloquial)\b/i,
    /\b(dated|old-fashioned)\b/i,
    /\b(formal|literary)\b/i,
    /\b(informal|casual)\b/i,
    /\b(vulgar|offensive)\b/i,
    /\b(poetic|rare)\b/i
  ];

  for (const pattern of tagPatterns) {
    const match = text.match(pattern);
    if (match) {
      tags.push(match[1].toLowerCase());
    }
  }

  return tags;
}

parser.on("end", () => {
  writer.close();
  console.log("Wiktionary parsing complete.");
});

createReadStream(inputFile).pipe(parser);
