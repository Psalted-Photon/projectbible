// extract-wiktionary-slice.mjs
// Create a small, valid XML slice with the first N pages for quick parser validation.

import fs from "fs";
import sax from "sax";

const inputFile = process.argv[2];
const outputFile = process.argv[3];
const limit = parseInt(process.argv[4] || "10000", 10);

if (!inputFile || !outputFile || Number.isNaN(limit)) {
  console.error("Usage: node extract-wiktionary-slice.mjs <input.xml> <output.xml> [limit]");
  process.exit(1);
}

function escapeXml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const output = fs.createWriteStream(outputFile, { encoding: "utf8" });
output.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
output.write("<mediawiki>\n");

let currentPage = null;
let currentText = "";
let inText = false;
let pagesWritten = 0;
let done = false;

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
  if (name === "page" && currentPage && !done) {
    const title = currentPage.title || "";
    const text = currentPage.text || "";

    output.write("  <page>\n");
    output.write(`    <title>${escapeXml(title)}</title>\n`);
    output.write("    <revision>\n");
    output.write(`      <text>${escapeXml(text)}</text>\n`);
    output.write("    </revision>\n");
    output.write("  </page>\n");

    pagesWritten++;
    currentPage = null;

    if (pagesWritten >= limit) {
      done = true;
      finalize();
    }
  }
});

parser.on("error", (err) => {
  console.error("Parser error:", err.message);
  finalize(1);
});

function finalize(exitCode = 0) {
  if (done && output.writableEnded) return;
  output.write("</mediawiki>\n");
  output.end(() => {
    console.log(`✅ Wrote ${pagesWritten.toLocaleString()} pages to ${outputFile}`);
    process.exit(exitCode);
  });
}

fs.createReadStream(inputFile).pipe(parser);
