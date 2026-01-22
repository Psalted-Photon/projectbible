// clean-wiktionary.mjs
import fs from "fs";
import readline from "readline";

// Input and output files
const inputFile = process.argv[2];
const outputFile = process.argv[3] || "wiktionary-modern-clean.ndjson";

if (!inputFile) {
  console.error("Usage: node clean-wiktionary.mjs <input.ndjson> [output.ndjson]");
  process.exit(1);
}

// Regex to detect quote-only templates
const quoteTemplatePattern = /\{\{(?:quote|RQ:)\b/i;

// Regex to strip leftover templates like {{...}}
const templateStripper = /\{\{[^}]+\}\}/g;

// Regex to remove wiki links while keeping text
const linkStripper = /\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g;

// Regex to detect lines that are just bullets after cleaning
const bulletOnlyPattern = /^\s*[*#:]+\s*$/;

let kept = 0;
let dropped = 0;

const rl = readline.createInterface({
  input: fs.createReadStream(inputFile),
  crlfDelay: Infinity
});

const out = fs.createWriteStream(outputFile);

rl.on("line", (line) => {
  if (!line.trim()) return;

  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return; // skip malformed lines
  }

  let def = obj.definition_text || "";

  // Skip quote-only definitions
  if (quoteTemplatePattern.test(def)) {
    dropped++;
    return;
  }

  // Strip leftover templates and markup
  def = def
    .replace(templateStripper, "")
    .replace(linkStripper, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Remove leading list/quote markers that can survive cleanup
  def = def.replace(/^\s*[#*:\-]+\s*/, "");

  // Skip if empty or bullet-only after cleaning
  if (!def || bulletOnlyPattern.test(def)) {
    dropped++;
    return;
  }

  // Skip if no meaningful characters remain
  if (!/[A-Za-z0-9]/.test(def)) {
    dropped++;
    return;
  }

  // Save cleaned definition
  obj.definition_text = def;
  out.write(JSON.stringify(obj) + "\n");
  kept++;
});

rl.on("close", () => {
  console.log("Cleanup complete.");
  console.log("Kept:", kept);
  console.log("Dropped:", dropped);
  console.log("Output:", outputFile);
});
