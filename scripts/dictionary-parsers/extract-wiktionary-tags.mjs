#!/usr/bin/env node

/**
 * extract-wiktionary-tags.mjs
 * 
 * Scans Wiktionary XML dump and extracts ALL usage labels/tags
 * for subsequent filtering and manual review.
 * 
 * Usage:
 *   node extract-wiktionary-tags.mjs <path-to-wiktionary.xml>
 * 
 * Output: all-wiktionary-tags.json (sorted unique array of all tags found)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🏷️  Wiktionary Tag Extractor\n');

// Process command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node extract-wiktionary-tags.mjs <path-to-wiktionary.xml>\n');
  process.exit(1);
}

const inputFile = args[0];
if (!fs.existsSync(inputFile)) {
  console.error(`❌ Error: File not found: ${inputFile}\n`);
  process.exit(1);
}

// Use Map to track tags and their counts (more memory efficient than large Set)
const tagsMap = new Map();
let linesProcessed = 0;
let inEnglishSection = false;
let textBuffer = '';
const tempOutputFile = path.join(__dirname, 'all-wiktionary-tags-temp.txt');

// Tag patterns to match
const labelPattern = /\{\{(?:label|lb|lbl)\|en\|([^}]+)\}\}/gi;
const qualifierPattern = /\{\{(?:q|qualifier|i)\|([^}]+)\}\}/gi;
const contextPattern = /\{\{(?:context|cx)\|([^}]+)\}\}/gi;
const parentheticalPattern = /\(([^)]+)\)/g;

/**
 * Extract tags from wikitext content
 */
function extractTags(text) {
  const tags = [];
  
  // {{label|en|tag1|tag2|...}}
  let match;
  const labelPattern = /\{\{(?:label|lb|lbl)\|en\|([^}]+)\}\}/gi;
  while ((match = labelPattern.exec(text)) !== null) {
    const params = match[1].split('|').map(s => s.trim());
    tags.push(...params.filter(p => p && !p.startsWith('_')));
  }
  
  // {{q|tag}}, {{qualifier|tag}}
  const qualifierPattern = /\{\{(?:q|qualifier|i)\|([^}]+)\}\}/gi;
  while ((match = qualifierPattern.exec(text)) !== null) {
    const tag = match[1].trim();
    if (tag && !tag.startsWith('_')) {
      tags.push(tag);
    }
  }
  
  // {{context|tag}}
  const contextPattern = /\{\{(?:context|cx)\|([^}]+)\}\}/gi;
  while ((match = contextPattern.exec(text)) !== null) {
    const params = match[1].split('|').map(s => s.trim());
    tags.push(...params.filter(p => p && !p.startsWith('_')));
  }
  
  // Parenthetical tags at start of definitions: (tag)
  const defMatch = text.match(/^#\s*\(([^)]+)\)/);
  if (defMatch) {
    const tag = defMatch[1].trim();
    if (tag && tag.length < 50 && !tag.includes('see')) {
      tags.push(tag);
    }
  }
  
  return tags;
}

/**
 * Process a single line
 */
function processLine(line) {
  linesProcessed++;
  
  // Track English section
  if (line.includes('==English==')) {
    inEnglishSection = true;
    textBuffer = '';
    return;
  }
  
  // End of English section
  if (inEnglishSection && line.match(/^==(?!English)[A-Z]/)) {
    inEnglishSection = false;
    textBuffer = '';
    return;
  }
  
  // Accumulate English content
  if (inEnglishSection) {
    // Extract tags from definitions
    if (line.startsWith('#')) {
      const tags = extractTags(line);
      tags.forEach(tag => {
        const count = tagsMap.get(tag) || 0;
        tagsMap.set(tag, count + 1);
      });
    }
    
    // Extract from templates
    if (line.includes('{{')) {
      const tags = extractTags(line);
      tags.forEach(tag => {
        const count = tagsMap.get(tag) || 0;
        tagsMap.set(tag, count + 1);
      });
    }
  }
  
  // Progress indicator & periodic memory cleanup
  if (linesProcessed % 100000 === 0) {
    console.log(`   Processed ${(linesProcessed / 1000000).toFixed(1)}M lines, found ${tagsMap.size} unique tags...`);
    
    // Every 10M lines, force garbage collection if available
    if (linesProcessed % 10000000 === 0 && global.gc) {
      global.gc();
    }
  }
}

// Main execution
console.log(`📂 Input: ${path.basename(inputFile)}`);
console.log(`⏳ Scanning for tags...\n`);

const startTime = Date.now();

const rl = createInterface({
  input: createReadStream(inputFile),
  crlfDelay: Infinity
});

rl.on('line', processLine);

rl.on('close', () => {
  const elapsedMs = Date.now() - startTime;
  const elapsedMin = (elapsedMs / 60000).toFixed(1);
  
  console.log(`\n✅ Scan complete!`);
  console.log(`   Lines processed: ${linesProcessed.toLocaleString()}`);
  console.log(`   Unique tags found: ${tagsMap.size}`);
  console.log(`   Processing time: ${elapsedMin} minutes\n`);
  
  // Sort tags by count (descending) then alphabetically
  const allTags = [...tagsMap.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // By count descending
      return a[0].localeCompare(b[0]); // Then alphabetically
    })
    .map(([tag]) => tag);
  
  // Show sample
  console.log(`📋 Sample tags (first 30 most common):`);
  allTags.slice(0, 30).forEach((tag, i) => {
    const count = tagsMap.get(tag);
    console.log(`   ${i + 1}. "${tag}" (${count.toLocaleString()} occurrences)`);
  });
  if (allTags.length > 30) {
    console.log(`   ... and ${allTags.length - 30} more\n`);
  }
  
  // Save output
  const outputFile = path.join(__dirname, 'all-wiktionary-tags.json');
  const output = {
    generated: new Date().toISOString(),
    source: path.basename(inputFile),
    lines_processed: linesProcessed,
    total_tags: allTags.length,
    processing_time_minutes: parseFloat(elapsedMin),
    tags: allTags
  };
  
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  
  console.log(`💾 Saved: ${outputFile}\n`);
  console.log(`📝 Next step: Run filter-questionable-tags.mjs to identify unsafe tags\n`);
});

rl.on('error', (error) => {
  console.error('❌ Error reading file:', error.message);
  process.exit(1);
});
