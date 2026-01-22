// debug-wiktionary.mjs - Show sample Wiktionary pages to understand structure
import { createReadStream } from "fs";
import sax from "sax";

const inputFile = process.argv[2] || "../../data/processed/enwiktionary.xml";
const targetWords = ["gospel", "love", "faith", "word", "grace"];
const foundPages = new Map();

let currentPage = null;
let currentText = "";
let inText = false;
let pagesProcessed = 0;

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
    pagesProcessed++;
    
    if (currentPage?.title && targetWords.includes(currentPage.title.toLowerCase())) {
      foundPages.set(currentPage.title, currentPage.text);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Found: ${currentPage.title} (page ${pagesProcessed})`);
      console.log(`${'='.repeat(80)}\n`);
      console.log(currentPage.text.substring(0, 2000)); // First 2000 chars
      console.log(`\n... (${currentPage.text.length} total characters)\n`);
      
      if (foundPages.size >= targetWords.length) {
        console.log(`\n✅ Found all ${targetWords.length} target words. Exiting.\n`);
        process.exit(0);
      }
    }
    
    if (pagesProcessed % 10000 === 0) {
      console.log(`Processed ${(pagesProcessed/1000).toFixed(0)}k pages, found ${foundPages.size}/${targetWords.length} targets...`);
    }
    
    currentPage = null;
  }
});

parser.on("end", () => {
  console.log(`\n✅ Scan complete. Processed ${pagesProcessed.toLocaleString()} pages.`);
  console.log(`   Found ${foundPages.size}/${targetWords.length} target words.\n`);
});

createReadStream(inputFile).pipe(parser);
