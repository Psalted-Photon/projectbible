// parse-wiktionary.mjs
// Streaming Wiktionary XML → english_definitions_modern rows with content safety filtering

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createReadStream } from "fs";
import sax from "sax";
import { normalizeLemma, normalizePOS } from "./helpers/normalize.js";
import { OutputWriter } from "./helpers/output.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load blocklist
const blocklistFile = path.join(__dirname, 'blocked-tags.json');
if (!fs.existsSync(blocklistFile)) {
  console.error('❌ Error: blocked-tags.json not found');
  console.error('   Run filter-questionable-tags.mjs first\n');
  process.exit(1);
}

const blocklist = JSON.parse(fs.readFileSync(blocklistFile, 'utf8'));
const blockedTags = new Set(blocklist.blocked.map(t => t.toLowerCase()));

console.log(`🛡️  Loaded ${blockedTags.size} blocked tags for content filtering`);

let definitionsBlocked = 0;
let definitionsExtracted = 0;
let pagesProcessed = 0;

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
    pagesProcessed++;
    
    // Log progress every 1000 pages
    if (pagesProcessed % 1000 === 0) {
      console.log(`Processed ${(pagesProcessed/1000).toFixed(0)}k pages, extracted ${definitionsExtracted.toLocaleString()} (blocked ${definitionsBlocked.toLocaleString()})...`);
    }
    
    currentPage = null;
  }
});

function processPage(page) {
  if (!page.title || !page.text) return;

  const lemma = normalizeLemma(page.title);
  const lines = page.text.split("\n");

  // Find English section (permissive)
  let inEnglish = false;
  let currentPOS = null;
  let currentEtymology = null;
  let definitionOrder = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect English section (allow whitespace)
    if (line.match(/^==\s*English\s*==/i)) {
      inEnglish = true;
      continue;
    }

    // Exit English section on next level-2 header
    if (inEnglish && line.match(/^==\s*[^=]/)) {
      if (!line.match(/^==\s*English\s*==/i)) {
        inEnglish = false;
        continue;
      }
    }

    if (!inEnglish) continue;

    // Extract POS sections (allow level-3 or level-4 headers)
    const posMatch = line.match(/^====?=\s*([A-Za-z ][A-Za-z -]*?)\s*====?=/);
    if (posMatch) {
      const rawPOS = posMatch[1].trim();
      const posLower = rawPOS.toLowerCase();
      if (
        posLower.includes("noun") ||
        posLower.includes("verb") ||
        posLower.includes("adjective") ||
        posLower.includes("adverb") ||
        posLower.includes("pronoun") ||
        posLower.includes("preposition") ||
        posLower.includes("conjunction") ||
        posLower.includes("interjection") ||
        posLower.includes("determiner") ||
        posLower.includes("article") ||
        posLower.includes("participle") ||
        posLower.includes("proper noun") ||
        posLower.includes("numeral") ||
        posLower.includes("particle") ||
        posLower.includes("prefix") ||
        posLower.includes("suffix") ||
        posLower.includes("letter") ||
        posLower.includes("symbol") ||
        posLower.includes("initialism") ||
        posLower.includes("acronym") ||
        posLower.includes("abbreviation") ||
        posLower.includes("contraction") ||
        posLower.includes("phrase") ||
        posLower.includes("proverb") ||
        posLower.includes("idiom")
      ) {
        currentPOS = normalizePOS(rawPOS);
        definitionOrder = 0;
      }
      continue;
    }

    // Extract Etymology (permissive)
    if (line.match(/^==+\s*Etymology.*?==+/i)) {
      currentEtymology = "";
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().match(/^===/) && !lines[j].trim().match(/^==/)) {
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
    const defMatch = line.match(/^#+\s*(.*)$/);
    if (currentPOS && defMatch) {
      // Skip examples and nested items
      if (line.match(/^##[:#*]/)) continue;

      const defText = defMatch[1];
      
      // Extract tags BEFORE cleaning (templates contain tag info)
      const tags = extractTags(defText);
      
      // Check for blocked tags - skip this definition if found
      if (hasBlockedTag(tags)) {
        definitionsBlocked++;
        continue;
      }
      
      const cleaned = cleanWikiMarkup(defText);

      if (cleaned.length === 0) continue;
      if (/^[\s:*]+$/.test(cleaned)) continue;
      if (!/[A-Za-z]/.test(cleaned)) continue;

      definitionOrder++;
      definitionsExtracted++;

      const sourceUrl = page.title
        ? `https://en.wiktionary.org/wiki/${encodeURIComponent(page.title)}`
        : null;

      writer.write({
        word: lemma,
        pos: currentPOS,
        definition_order: definitionOrder,
        definition_text: cleaned,
        etymology: currentEtymology || "",
        tags: tags.length > 0 ? tags : undefined,
        source: "wiktionary",
        source_url: sourceUrl
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
  
  // {{label|en|tag1|tag2|...}} or {{lb|en|...}}
  const labelPattern = /\{\{(?:label|lb|lbl)\|en\|([^}]+)\}\}/gi;
  let match;
  while ((match = labelPattern.exec(text)) !== null) {
    const params = match[1].split('|').map(s => s.trim());
    tags.push(...params.filter(p => p && !p.startsWith('_')));
  }
  
  // {{q|tag}}, {{qualifier|tag}}, {{i|tag}}
  const qualifierPattern = /\{\{(?:q|qualifier|i)\|([^}]+)\}\}/gi;
  while ((match = qualifierPattern.exec(text)) !== null) {
    tags.push(match[1].trim());
  }
  
  // {{context|tag}} or {{cx|tag}}
  const contextPattern = /\{\{(?:context|cx)\|([^}]+)\}\}/gi;
  while ((match = contextPattern.exec(text)) !== null) {
    const params = match[1].split('|').map(s => s.trim());
    tags.push(...params.filter(p => p && !p.startsWith('_')));
  }
  
  // Parenthetical tags (tag) - only short ones that look like usage labels
  const parenPattern = /\(([^)]{1,40})\)/g;
  while ((match = parenPattern.exec(text)) !== null) {
    const tag = match[1].trim();
    // Skip if it looks like an example or explanation
    if (!tag.includes('see') && !tag.includes('example') && tag.split(' ').length <= 3) {
      tags.push(tag);
    }
  }
  
  return tags.map(t => t.toLowerCase().trim());
}

// Check if any tag is in the blocklist
function hasBlockedTag(tags) {
  return tags.some(tag => blockedTags.has(tag));
}

parser.on("end", () => {
  writer.close();
  
  const totalDefinitions = definitionsExtracted + definitionsBlocked;
  const blockRate = totalDefinitions > 0 ? (definitionsBlocked / totalDefinitions * 100).toFixed(2) : 0;
  
  console.log(`\n✅ Wiktionary parsing complete!`);
  console.log(`   Pages processed: ${pagesProcessed.toLocaleString()}`);
  console.log(`   Definitions extracted: ${definitionsExtracted.toLocaleString()}`);
  console.log(`   Definitions blocked: ${definitionsBlocked.toLocaleString()}`);
  console.log(`   Block rate: ${blockRate}%`);
  console.log(`   Output: wiktionary-modern.ndjson\n`);
});

createReadStream(inputFile).pipe(parser);
