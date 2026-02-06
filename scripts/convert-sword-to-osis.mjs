#!/usr/bin/env node
/**
 * Convert Sword Commentary Modules to OSIS XML
 * Reads Sword module directories and extracts commentary data to OSIS format
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
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

console.log('========================================');
console.log('Sword Module to OSIS Converter');
console.log('========================================\n');

// Check if Python is available (we'll use a Python library to read Sword modules)
try {
  await execAsync('python --version');
  console.log('✓ Python found\n');
} catch (error) {
  console.error('✗ Python not found. Please install Python 3.x');
  process.exit(1);
}

// Install pysword if not already installed
console.log('Installing pysword library...');
try {
  await execAsync('python -m pip install -q pysword');
  console.log('✓ pysword installed\n');
} catch (error) {
  console.warn('Warning: Could not install pysword:', error.message);
}

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Get all module directories
const moduleDirs = fs.readdirSync(RAW_DIR, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

console.log(`Found ${moduleDirs.length} module directories\n`);

// Create Python script to convert each module
const pythonScript = `
import sys
import os
import json
from pysword.modules import SwordModules

def convert_module_to_osis(module_path, module_id, author_name, output_path):
    """Convert a Sword module to OSIS XML format"""
    
    print(f"Processing {module_id}...")
    
    # Initialize Sword module reader with the module directory
    try:
        modules = SwordModules(module_path)
        
        # Check if module exists
        if not hasattr(modules, module_id.lower()):
            print(f"  ✗ Module {module_id} not found in {module_path}")
            return False
        
        module = getattr(modules, module_id.lower())
        
        # Create OSIS XML structure
        osis_content = []
        osis_content.append('<?xml version="1.0" encoding="UTF-8"?>')
        osis_content.append('<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">')
        osis_content.append('<osisText osisIDWork="' + module_id + '" osisRefWork="Bible">')
        osis_content.append('<header>')
        osis_content.append('  <work osisWork="' + module_id + '">')
        osis_content.append('    <title>' + author_name + '</title>')
        osis_content.append('    <creator role="author">' + author_name + '</creator>')
        osis_content.append('  </work>')
        osis_content.append('</header>')
        osis_content.append('<div type="book">')
        
        entry_count = 0
        
        # Iterate through all books
        for book in module.books:
            for chapter in book.chapters:
                for verse in chapter.verses:
                    text = verse.text
                    if text and text.strip():
                        verse_id = f"{book.name}.{chapter.number}.{verse.number}"
                        osis_content.append(f'  <div type="commentary" osisID="{verse_id}">')
                        # Escape XML special characters
                        text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                        osis_content.append(f'    <p>{text}</p>')
                        osis_content.append('  </div>')
                        entry_count += 1
        
        osis_content.append('</div>')
        osis_content.append('</osisText>')
        osis_content.append('</osis>')
        
        # Write to file
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\\n'.join(osis_content))
        
        print(f"  ✓ Converted {entry_count} entries to {output_path}")
        return True
        
    except Exception as e:
        print(f"  ✗ Error converting {module_id}: {e}")
        return False

if __name__ == "__main__":
    module_path = sys.argv[1]
    module_id = sys.argv[2]
    author_name = sys.argv[3]
    output_path = sys.argv[4]
    
    success = convert_module_to_osis(module_path, module_id, author_name, output_path)
    sys.exit(0 if success else 1)
`;

// Save Python script
const pythonScriptPath = path.join(__dirname, 'convert_sword_module.py');
fs.writeFileSync(pythonScriptPath, pythonScript);

let successCount = 0;
let failedModules = [];

// Convert each module
for (const moduleDir of moduleDirs) {
  // Skip sample directories
  if (moduleDir.includes('sample')) continue;
  
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
  
  // Get module ID from conf filename (e.g., "barnes.conf" -> "Barnes")
  const moduleId = path.basename(confFiles[0], '.conf');
  const moduleIdCapitalized = moduleId.charAt(0).toUpperCase() + moduleId.slice(1);
  
  // Get author name
  const authorName = MODULE_AUTHORS[moduleIdCapitalized] || MODULE_AUTHORS[moduleId] || 'Unknown';
  
  // Output OSIS file path
  const osisOutputPath = path.join(OUTPUT_DIR, `${moduleIdCapitalized}.osis.xml`);
  
  console.log(`[${moduleIdCapitalized}] Converting... (Author: ${authorName})`);
  
  try {
    await execAsync(`python "${pythonScriptPath}" "${modulePath}" "${moduleId}" "${authorName}" "${osisOutputPath}"`);
    successCount++;
  } catch (error) {
    console.error(`[${moduleIdCapitalized}] ✗ Conversion failed:`, error.message);
    failedModules.push(moduleIdCapitalized);
  }
  
  console.log('');
}

// Cleanup
fs.unlinkSync(pythonScriptPath);

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
