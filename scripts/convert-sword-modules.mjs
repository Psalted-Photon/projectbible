#!/usr/bin/env node
/**
 * Convert Sword Commentary Modules to OSIS XML using swordjs
 * Reads Sword module directories and extracts commentary data to OSIS format
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sword from 'swordjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAW_DIR = path.join(__dirname, '../data-sources/commentaries/raw');
const OUTPUT_DIR = path.join(__dirname, '../data-sources/commentaries/osis');

// Module ID to Author Name mapping
const MODULE_AUTHORS = {
  'Abbott': 'Abbott',
  'Barnes': 'Albert Barnes',
  'Burkitt': 'William Burkitt',
  'CalvinCommentaries': 'John Calvin',
  'Catena': 'Thomas Aquinas (Catena Aurea)',
  'Clarke': 'Adam Clarke',
  'DTN': 'John Nelson Darby',
  'Family': 'Family Bible Notes',
  'Geneva': 'Geneva Bible Annotators',
  'Gill': 'John Gill',
  'JFB': 'Jamieson-Fausset-Brown',
  'KingComments': 'KingComments',
  'Lightfoot': 'John Lightfoot',
  'Luther': 'Martin Luther',
  'MHC': 'Matthew Henry',
  'MHCC': 'Matthew Henry',
  'NETnotesfree': 'NET Bible Translators',
  'Personal': 'Personal',
  'Poole': 'Matthew Poole',
  'QuotingPassages': 'Quoting Passages',
  'RWP': 'A.T. Robertson',
  'Scofield': 'C.I. Scofield',
  'TFG': 'J.W. McGarvey & P.Y. Pendleton',
  'TSK': 'Treasury of Scripture Knowledge',
  'Wesley': 'John Wesley'
};

// OSIS book abbreviations
const OSIS_BOOKS = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov',
  'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
  'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb',
  'Jas', '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev'
];

console.log('========================================');
console.log('Sword Module to OSIS Converter (swordjs)');
console.log('========================================\n');

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Get all module directories
const moduleDirs = fs.readdirSync(RAW_DIR, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .filter(dirent => !dirent.name.includes('sample'))
  .map(dirent => dirent.name);

console.log(`Found ${moduleDirs.length} module directories\n`);

let successCount = 0;
let failedModules = [];

// Convert each module
for (const moduleDir of moduleDirs) {
  const modulePath = path.join(RAW_DIR, moduleDir);
  
  // Find module ID from mods.d/*.conf file
  const modsPath = path.join(modulePath, 'mods.d');
  if (!fs.existsSync(modsPath)) {
    console.log(`[${moduleDir}] ✗ No mods.d directory found`);
    failedModules.push(moduleDir);
    continue;
  }
  
  const confFiles = fs.readdirSync(modsPath).filter(f => f.endsWith('.conf'));
  if (confFiles.length === 0) {
    console.log(`[${moduleDir}] ✗ No .conf file found`);
    failedModules.push(moduleDir);
    continue;
  }
  
  // Get module ID from conf filename
  const moduleId = path.basename(confFiles[0], '.conf');
  const moduleIdCapitalized = moduleId.charAt(0).toUpperCase() + moduleId.slice(1);
  
  // Get author name
  const authorName = MODULE_AUTHORS[moduleIdCapitalized] || MODULE_AUTHORS[moduleId.toUpperCase()] || moduleIdCapitalized;
  
  console.log(`[${moduleIdCapitalized}] Converting... (Author: ${authorName})`);
  
  try {
    // Initialize Sword module
    const swordModule = new sword.SwordModule(modulePath);
    
    // Create OSIS XML structure
    const osisLines = [];
    osisLines.push('<?xml version="1.0" encoding="UTF-8"?>');
    osisLines.push('<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">');
    osisLines.push(`<osisText osisIDWork="${moduleIdCapitalized}" osisRefWork="Bible">`);
    osisLines.push('<header>');
    osisLines.push(`  <work osisWork="${moduleIdCapitalized}">`);
    osisLines.push(`    <title>${authorName}</title>`);
    osisLines.push(`    <creator role="author">${authorName}</creator>`);
    osisLines.push('  </work>');
    osisLines.push('</header>');
    osisLines.push('<div type="commentary">');
    
    let entryCount = 0;
    
    // Iterate through all books and verses
    for (const osisBook of OSIS_BOOKS) {
      // Try to get commentary for this book
      try {
        const bookData = swordModule.getBook(osisBook);
        if (bookData && bookData.length > 0) {
          bookData.forEach(verse => {
            if (verse.text && verse.text.trim()) {
              const verseId = `${osisBook}.${verse.chapter}.${verse.verse}`;
              // Escape XML special characters
              const text = verse.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
              
              osisLines.push(`  <div type="entry" osisID="${verseId}">`);
              osisLines.push(`    <p>${text}</p>`);
              osisLines.push('  </div>');
              entryCount++;
            }
          });
        }
      } catch (err) {
        // Book not available in this module, skip
      }
    }
    
    osisLines.push('</div>');
    osisLines.push('</osisText>');
    osisLines.push('</osis>');
    
    // Write to file
    const osisOutputPath = path.join(OUTPUT_DIR, `${moduleIdCapitalized}.osis.xml`);
    fs.writeFileSync(osisOutputPath, osisLines.join('\n'), 'utf-8');
    
    console.log(`  ✓ Converted ${entryCount} entries`);
    console.log(`  ✓ Saved to ${osisOutputPath}\n`);
    successCount++;
    
  } catch (error) {
    console.error(`  ✗ Conversion failed: ${error.message}\n`);
    failedModules.push(moduleIdCapitalized);
  }
}

console.log('========================================');
console.log('Conversion Summary');
console.log('========================================');
console.log(`Successfully converted: ${successCount} modules`);
if (failedModules.length > 0) {
  console.log(`Failed modules: ${failedModules.join(', ')}`);
}
console.log(`\nOSIS files saved to: ${OUTPUT_DIR}`);
console.log('\nNext steps:');
console.log('1. Run: node scripts/parse-commentary-sources.mjs');
console.log('2. Run: node scripts/build-commentary-pack.mjs');
console.log('========================================');
