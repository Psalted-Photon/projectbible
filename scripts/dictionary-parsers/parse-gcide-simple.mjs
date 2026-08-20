// parse-gcide-simple.mjs
// GCIDE (Webster 1913) XML -> english_definitions_historic rows (NDJSON)
//
// Two bugs used to cost this parse about a third of the dictionary:
//
//   1. It split the file on <p> and kept the first <ent> in each block. Webster
//      spreads one entry over several <p> blocks — head block with <ent>/<hw>/
//      <ety>, then a separate <p> per numbered sense — so entries whose head
//      block carried no <def> came through with an etymology and nothing else.
//      ("Beauty", "Prophet", "Authority" all reached the shipped pack empty.)
//      Fixed upstream in extract-gcide.mjs, which now keeps every paragraph;
//      here we slice on <ent> so trailing sense paragraphs stay with their word.
//
//   2. The <def> regex demanded a closing tag wherever an opening one appeared,
//      so it failed outright on Webster's ordinary nested usage markup
//      (<as>as, ... <ex>word</ex></as>) and returned zero matches for the whole
//      entry. A non-greedy match plus tag stripping recovers those.

import fs from "fs";
import { normalizeLemma } from "./helpers/normalize.js";
import { OutputWriter } from "./helpers/output.js";

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: node parse-gcide-simple.mjs <gcide.xml>");
  process.exit(1);
}

console.log("Parsing GCIDE entries...");

const writer = new OutputWriter("gcide-historic.ndjson");
const content = fs.readFileSync(inputFile, "utf8");

// GCIDE writes accented letters and punctuation as self-closing pseudo-tags.
// Left as-is they surface in the app as "the <ae/sthetic faculty".
const ENTITIES = {
  ae: "\u00e6", AE: "\u00c6", oelig: "\u0153", OElig: "\u0152",
  ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019",
  eacute: "\u00e9", egrave: "\u00e8", ecirc: "\u00ea", euml: "\u00eb",
  aacute: "\u00e1", agrave: "\u00e0", acirc: "\u00e2", auml: "\u00e4",
  aring: "\u00e5", ccedil: "\u00e7", iacute: "\u00ed", icirc: "\u00ee",
  iuml: "\u00ef", oacute: "\u00f3", ocirc: "\u00f4", ouml: "\u00f6",
  oslash: "\u00f8", uacute: "\u00fa", ucirc: "\u00fb", uuml: "\u00fc",
  ntilde: "\u00f1", atilde: "\u00e3", otilde: "\u00f5", yacute: "\u00fd",
  amac: "\u0101", emac: "\u0113", imac: "\u012b", omac: "\u014d",
  umac: "\u016b", sect: "\u00a7", pound: "\u00a3", deg: "\u00b0",
  frac12: "\u00bd", frac14: "\u00bc", times: "\u00d7", minus: "\u2212",
};

/** Turn one <def> body into display text. */
function cleanDefinition(raw) {
  return raw
    // Self-closing pseudo-tags: <ae/ , <umac/ , <br/ , <root/ , <?/ ...
    .replace(/<([a-zA-Z?][a-zA-Z0-9]*)\//g, (m, name) =>
      Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : "")
    // Ordinary markup: keep the text, drop the tags.
    .replace(/<[^>]*>/g, "")
    // Anything left over from a truncated tag.
    .replace(/<[^\s]*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

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

// Entry boundaries: from one <ent> to the next. Sense paragraphs carry no <ent>
// of their own, so they fall inside the block of the headword they belong to.
const starts = [];
const entRe = /<ent>([^<]*)<\/ent>/g;
let match;
while ((match = entRe.exec(content)) !== null) starts.push(match.index);
starts.push(content.length);

let defCount = 0;
let wordCount = 0;
let emptyEntries = 0;

for (let i = 0; i < starts.length - 1; i++) {
  const block = content.slice(starts[i], starts[i + 1]);

  const hwMatch = block.match(/<hw>([^<]+)<\/hw>/);
  const entMatch = block.match(/<ent>([^<]+)<\/ent>/);
  const lemma = normalizeLemma(hwMatch ? hwMatch[1] : entMatch ? entMatch[1] : "");
  if (!lemma) continue;

  const posMatch = block.match(/<pos>([^<]+)<\/pos>/);
  const pos = posMatch ? normalizePos(posMatch[1]) : "unknown";

  // Walk <sn> and <def> together so each definition keeps its printed sense
  // number ("1.", "2a.") rather than a position we invented.
  const tokenRe = /<sn>([^<]*)<\/sn>|<def>([\s\S]*?)<\/def>/g;
  let senseNumber = null;
  let order = 0;
  let token;

  while ((token = tokenRe.exec(block)) !== null) {
    if (token[1] !== undefined) {
      senseNumber = token[1].replace(/\.$/, "").trim() || null;
      continue;
    }
    const definition = cleanDefinition(token[2]);
    if (definition.length <= 5) continue;

    order += 1;
    writer.write({
      word: lemma,
      pos,
      sense_number: senseNumber,
      definition_order: order,
      definition_text: definition,
    });
    defCount += 1;
    senseNumber = null;
  }

  if (order === 0) emptyEntries += 1;
  else wordCount += 1;

  if (defCount && defCount % 25000 === 0) {
    console.log(`   ${defCount} definitions...`);
  }
}

writer.close();
console.log("GCIDE parsing complete.");
console.log(`   Definitions: ${defCount}`);
console.log(`   Entries with at least one definition: ${wordCount}`);
console.log(`   Entries with none (cross-references, variants): ${emptyEntries}`);
