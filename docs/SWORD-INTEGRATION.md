# SWORD Module Integration Guide

## Quick Start

Once you have SWORD modules with cross-references, run:

```bash
# Extract cross-references from a single OSIS file
node scripts/extract-osis-refs.mjs data-sources/cross-references/KJV.xml

# Or from a directory of OSIS files
node scripts/extract-osis-refs.mjs data-sources/cross-references/osis-modules/
```

This will:
1. Parse all `<note type="crossReference">` elements
2. Export to TSV file
3. Import into `packs/cross-references.sqlite`
4. Update the database automatically

---

## Detailed Instructions

### 1. Install SWORD Tools

#### Windows
```bash
# Download from CrossWire
Invoke-WebRequest -Uri "https://crosswire.org/ftpmirror/pub/sword/utils/WIN32/sword-utils.exe" -OutFile "sword-utils.exe"

# Run installer
.\sword-utils.exe
```

#### Linux/Mac
```bash
# Ubuntu/Debian
sudo apt-get install libsword-utils

# macOS
brew install sword
```

### 2. Download SWORD Modules

#### Method A: Using installmgr (Recommended)

```bash
# Initialize SWORD
installmgr -init

# Sync available modules
installmgr -sc

# List available modules
installmgr -r CrossWire  # Use CrossWire repository
installmgr -rl CrossWire  # List all modules

# Install modules with cross-references
# (These typically have cross-reference notes)
installmgr -ri CrossWire KJV           # King James Version
installmgr -ri CrossWire NASB          # New American Standard Bible
installmgr -ri CrossWire NET           # NET Bible (best cross-refs)
installmgr -ri CrossWire ESV           # English Standard Version
installmgr -ri CrossWire TSK           # Treasury of Scripture Knowledge
```

Modules install to:
- **Windows**: `C:\Program Files\CrossWire\SWORD\mods.d\`
- **Linux**: `~/.sword/mods.d/`
- **macOS**: `~/Library/Application Support/Sword/mods.d/`

#### Method B: Direct Download from FTP

```bash
# Browse available modules
# URL: ftp://ftp.crosswire.org/pub/sword/raw/

# Download specific modules
Invoke-WebRequest -Uri "ftp://ftp.crosswire.org/pub/sword/raw/KJV.zip" -OutFile "KJV.zip"
Expand-Archive -Path "KJV.zip" -DestinationPath "data-sources/cross-references/KJV"
```

#### Method C: GitHub Sources

Some OSIS files are available on GitHub:

```bash
# NET Bible
git clone https://github.com/STEPBible/STEPBible-Data data-sources/cross-references/stepbible

# Open English Bible
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/openenglishbible/Open-English-Bible/master/source/osis/OEB.xml" -OutFile "data-sources/cross-references/OEB.xml"
```

### 3. Extract OSIS XML from Modules

SWORD modules use compressed formats. Extract to OSIS XML:

```bash
# Using mod2osis (part of SWORD utils)
mod2osis KJV > data-sources/cross-references/KJV.xml
mod2osis NET > data-sources/cross-references/NET.xml
mod2osis TSK > data-sources/cross-references/TSK.xml

# For all installed modules
for module in KJV NET NASB ESV TSK; do
  mod2osis $module > "data-sources/cross-references/${module}.xml"
done
```

### 4. Parse and Import Cross-References

```bash
# Single file
node scripts/extract-osis-refs.mjs data-sources/cross-references/KJV.xml

# Multiple files in a directory
node scripts/extract-osis-refs.mjs data-sources/cross-references/
```

The script will:
- ✅ Parse `<note type="crossReference">` elements
- ✅ Extract all `<reference osisRef="...">` links
- ✅ Normalize book names
- ✅ Export to TSV for backup
- ✅ Import into SQLite database
- ✅ Deduplicate (won't add duplicates)
- ✅ Update metadata

### 5. Verify Results

```bash
# Test the updated database
node scripts/test-cross-references.mjs

# Check the count
node -e "
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')('packs/cross-references.sqlite', { readonly: true });
const count = db.prepare('SELECT COUNT(*) as count FROM cross_references').get();
console.log(\`Total cross-references: \${count.count}\`);
db.close();
"
```

---

## Expected Results

### KJV Module
- **Cross-references**: ~8,000-10,000
- **Source**: Traditional cross-references
- **Coverage**: Primarily important passages

### NET Bible
- **Cross-references**: 60,000+
- **Source**: Scholarly annotations
- **Coverage**: Comprehensive OT/NT
- **Best choice for maximum coverage**

### TSK (Treasury of Scripture Knowledge)
- **Cross-references**: 500,000+
- **Source**: R.A. Torrey's classic work
- **Coverage**: Exhaustive
- **Most comprehensive option**

---

## OSIS Cross-Reference Format

SWORD modules store cross-references like this:

```xml
<verse osisID="John.3.16">
  For God so loved the world...
  <note type="crossReference">
    <reference osisRef="Rom.5.8">Rom 5:8</reference>
    <reference osisRef="1John.4.9-1John.4.10">1 John 4:9-10</reference>
  </note>
</verse>
```

The parser extracts:
- `osisRef` attribute → Target verse(s)
- Handles ranges: `Gen.1.1-Gen.1.3`
- Normalizes book names: `1John` → `1 John`
- Creates bidirectional links (optional)

---

## Troubleshooting

### "No cross-references found"

Some OSIS files don't include cross-reference notes. Check:

```bash
# Search for cross-reference notes in the OSIS file
Select-String -Path "data-sources/cross-references/KJV.xml" -Pattern 'type="crossReference"'

# If nothing found, the module doesn't have cross-refs
# Try a different module like NET or TSK
```

### Module not in OSIS format

Some modules use other formats (.imp, .dat). Convert:

```bash
# Use mod2osis to convert to OSIS XML
mod2osis ModuleName > ModuleName.xml
```

### Permission denied installing modules

On Windows, run PowerShell as Administrator:

```powershell
# Right-click PowerShell → "Run as Administrator"
installmgr -ri CrossWire KJV
```

---

## Advanced: Batch Processing

Process multiple modules at once:

```powershell
# Create a batch script: extract-all-modules.ps1

$modules = @('KJV', 'NET', 'NASB', 'ESV', 'TSK')
$outputDir = "data-sources/cross-references"

foreach ($module in $modules) {
    Write-Host "Processing $module..." -ForegroundColor Cyan
    
    # Extract to OSIS
    mod2osis $module > "$outputDir/$module.xml"
    
    # Parse cross-references
    node scripts/extract-osis-refs.mjs "$outputDir/$module.xml"
    
    Write-Host "✓ $module complete" -ForegroundColor Green
}

Write-Host "`n✅ All modules processed!" -ForegroundColor Green
```

Run it:
```powershell
.\scripts\extract-all-modules.ps1
```

---

## Database Management

### View Statistics

```bash
node -e "
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')('packs/cross-references.sqlite', { readonly: true });

console.log('Cross-References Database Statistics:\n');

const total = db.prepare('SELECT COUNT(*) as count FROM cross_references').get();
console.log(\`Total references: \${total.count}\`);

const bySrc = db.prepare('SELECT source, COUNT(*) as count FROM cross_references GROUP BY source').all();
console.log('\nBy source:');
bySrc.forEach(s => console.log(\`  \${s.source}: \${s.count}\`));

db.close();
"
```

### Export All Data

```bash
# Export to CSV for external use
node -e "
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')('packs/cross-references.sqlite', { readonly: true });

const refs = db.prepare('SELECT * FROM cross_references').all();
const csv = 'from_book,from_chapter,from_verse,to_book,to_chapter,to_verse_start,to_verse_end,source\n' +
  refs.map(r => \`\${r.from_book},\${r.from_chapter},\${r.from_verse},\${r.to_book},\${r.to_chapter},\${r.to_verse_start},\${r.to_verse_end},\${r.source}\`).join('\n');

writeFileSync('cross-references-export.csv', csv);
console.log('Exported to cross-references-export.csv');
db.close();
"
```

### Rebuild from Scratch

```bash
# Delete existing database
Remove-Item packs/cross-references.sqlite

# Rebuild with curated data
npm run build:cross-refs

# Re-import OSIS data
node scripts/extract-osis-refs.mjs data-sources/cross-references/
```

---

## Summary

**Simplest workflow:**

1. Install SWORD: Download from CrossWire
2. Install module: `installmgr -ri CrossWire NET`
3. Extract OSIS: `mod2osis NET > NET.xml`
4. Parse refs: `node scripts/extract-osis-refs.mjs NET.xml`
5. Done! ✅

The database now has thousands (or hundreds of thousands) of cross-references ready to use in your app!
