// analyze-wiktionary-slice.mjs
// Summarize stats from wiktionary-modern.ndjson and show safe samples.

import fs from "fs";
import readline from "readline";
import sax from "sax";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ndjsonFile = process.argv[2] || "./wiktionary-modern.ndjson";
const sliceXml = process.argv[3] || "../../data/processed/enwiktionary-slice-10k.xml";
const blockedLimit = parseInt(process.argv[4] || "5", 10);

const blocklistFile = path.join(__dirname, "blocked-tags.json");
const blocklist = JSON.parse(fs.readFileSync(blocklistFile, "utf8"));
const blockedTags = new Set(blocklist.blocked.map(t => t.toLowerCase()));

function cleanWikiMarkup(text) {
  let cleaned = text;
  cleaned = cleaned.replace(/\{\{[^{}]*\}\}/g, "");
  cleaned = cleaned.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, "$1");
  cleaned = cleaned.replace(/'{2,}/g, "");
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

function extractTags(text) {
  const tags = [];
  const labelPattern = /\{\{(?:label|lb|lbl)\|en\|([^}]+)\}\}/gi;
  let match;
  while ((match = labelPattern.exec(text)) !== null) {
    const params = match[1].split("|").map(s => s.trim());
    tags.push(...params.filter(p => p && !p.startsWith("_")));
  }

  const qualifierPattern = /\{\{(?:q|qualifier|i)\|([^}]+)\}\}/gi;
  while ((match = qualifierPattern.exec(text)) !== null) {
    tags.push(match[1].trim());
  }

  const contextPattern = /\{\{(?:context|cx)\|([^}]+)\}\}/gi;
  while ((match = contextPattern.exec(text)) !== null) {
    const params = match[1].split("|").map(s => s.trim());
    tags.push(...params.filter(p => p && !p.startsWith("_")));
  }

  const parenPattern = /\(([^)]{1,40})\)/g;
  while ((match = parenPattern.exec(text)) !== null) {
    const tag = match[1].trim();
    if (!tag.includes("see") && !tag.includes("example") && tag.split(" ").length <= 3) {
      tags.push(tag);
    }
  }

  return tags.map(t => t.toLowerCase().trim());
}

function hasBlockedTag(tags) {
  return tags.some(tag => blockedTags.has(tag));
}

async function analyzeNdjson() {
  const posCounts = new Map();
  const tagCounts = new Map();
  const samples = [];
  let total = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(ndjsonFile, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    const item = JSON.parse(line);

    if (item.pos) {
      posCounts.set(item.pos, (posCounts.get(item.pos) || 0) + 1);
    }

    if (Array.isArray(item.tags)) {
      for (const tag of item.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    if (samples.length < 5 && item.definition_text) {
      const snippet = item.definition_text.length > 140
        ? item.definition_text.slice(0, 140) + "…"
        : item.definition_text;
      samples.push({ word: item.word, pos: item.pos, snippet, tags: item.tags || [] });
    }
  }

  const topPos = Array.from(posCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return { total, topPos, topTags, samples };
}

async function findBlockedExamples() {
  const blocked = [];

  if (!fs.existsSync(sliceXml)) {
    return blocked;
  }

  let currentPage = null;
  let currentText = "";
  let inText = false;

  const parser = sax.createStream(true, { trim: true });

  parser.on("opentag", (node) => {
    if (node.name === "page") currentPage = { title: null, text: null };
    if (node.name === "title" && currentPage) currentPage._readingTitle = true;
    if (node.name === "text" && currentPage) {
      inText = true;
      currentText = "";
    }
  });

  parser.on("text", (text) => {
    if (currentPage?._readingTitle) currentPage.title = text;
    if (inText) currentText += text;
  });

  parser.on("closetag", (name) => {
    if (name === "title" && currentPage) currentPage._readingTitle = false;
    if (name === "text" && currentPage) {
      inText = false;
      currentPage.text = currentText;
    }
    if (name === "page" && currentPage && blocked.length < blockedLimit) {
      const lemma = currentPage.title || "";
      const lines = (currentPage.text || "").split("\n");
      let inEnglish = false;
      let currentPOS = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.match(/^==\s*English\s*==/i)) {
          inEnglish = true;
          continue;
        }
        if (inEnglish && line.match(/^==\s*[^=]/)) {
          if (!line.match(/^==\s*English\s*==/i)) {
            inEnglish = false;
            continue;
          }
        }
        if (!inEnglish) continue;

        const posMatch = line.match(/^====?=\s*([A-Za-z ][A-Za-z -]*?)\s*====?=/);
        if (posMatch) {
          currentPOS = posMatch[1].trim();
          continue;
        }

        const defMatch = line.match(/^#+\s*(.*)$/);
        if (currentPOS && defMatch) {
          if (line.match(/^##[:#*]/)) continue;
          const defText = defMatch[1];
          const tags = extractTags(defText);
          if (hasBlockedTag(tags)) {
            const cleaned = cleanWikiMarkup(defText);
            blocked.push({
              word: lemma,
              pos: currentPOS,
              tags,
              preview: cleaned.length > 120 ? cleaned.slice(0, 120) + "…" : cleaned
            });
            if (blocked.length >= blockedLimit) break;
          }
        }
      }
      currentPage = null;
    }
  });

  await new Promise((resolve, reject) => {
    parser.on("end", resolve);
    parser.on("error", reject);
    fs.createReadStream(sliceXml).pipe(parser);
  });

  return blocked;
}

(async () => {
  const stats = await analyzeNdjson();
  const blocked = await findBlockedExamples();

  console.log("\n📊 Slice stats");
  console.log(`Total definitions: ${stats.total.toLocaleString()}`);

  console.log("\nTop POS:");
  for (const [pos, count] of stats.topPos) {
    console.log(`  ${pos}: ${count.toLocaleString()}`);
  }

  console.log("\nTop tags:");
  for (const [tag, count] of stats.topTags) {
    console.log(`  ${tag}: ${count.toLocaleString()}`);
  }

  console.log("\n✅ Sample extracted definitions (safe):");
  for (const sample of stats.samples) {
    console.log(`  ${sample.word} (${sample.pos}) — ${sample.snippet}`);
  }

  console.log("\n⛔ Blocked examples (redacted):");
  if (blocked.length === 0) {
    console.log("  None found in slice.");
  } else {
    for (const item of blocked) {
      console.log(`  ${item.word} (${item.pos}) — tags: ${item.tags.join(", ")}`);
      console.log("  definition: [redacted]");
    }
  }
})();
