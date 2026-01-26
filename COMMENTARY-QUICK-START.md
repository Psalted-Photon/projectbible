# Commentary Pack - Quick Start Guide

This guide walks you through downloading, parsing, and building your first commentary pack.

---

## Prerequisites

- Node.js 18+ installed
- ~5GB free disk space (for source files + pack)
- Internet connection for downloads

---

## Step 1: Install Sword Tools

### Windows (Recommended: Scoop)

```powershell
# Install Scoop package manager (if not already installed)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex

# Install Sword CLI tools
scoop install sword
```

### Alternative: Manual Download

1. Visit http://www.crosswire.org/sword/software/
2. Download "Sword Command Line Tools for Windows"
3. Extract to `C:\Program Files\Sword`
4. Add to PATH: `C:\Program Files\Sword\bin`

### Verify Installation

```bash
mod2osis --help
# Should show usage information
```

---

## Step 2: Download Commentary Modules

### Sync Module Repository

```bash
installmgr -sc
installmgr -r CrossWire
```

### Download Priority Commentaries

```bash
# Matthew Henry's Complete Commentary (~40MB download → ~400MB in pack)
installmgr -ri CrossWire MHC

# Jamieson-Fausset-Brown (~15MB download → ~150MB in pack)
installmgr -ri CrossWire JFB

# Barnes' Notes on the Bible (~20MB download → ~200MB in pack)
installmgr -ri CrossWire Barnes

# Keil & Delitzsch OT Commentary (~30MB download → ~300MB in pack)
installmgr -ri CrossWire KD
```

**Expected Total:** ~105MB download → ~1.05GB in pack (leaves room for 3-5 more commentaries)

### Optional: Additional Commentaries

```bash
# John Gill's Exposition (~25MB → ~250MB)
installmgr -ri CrossWire Gill

# Adam Clarke's Commentary (~20MB → ~200MB)
installmgr -ri CrossWire Clarke

# John Wesley's NT Notes (~5MB → ~50MB)
installmgr -ri CrossWire Wesley
```

---

## Step 3: Export to OSIS XML

Modules are installed to:
- **Windows:** `C:\Users\<YourName>\.sword\modules\comments\rawcom\`
- **Linux/Mac:** `~/.sword/modules/comments/rawcom/`

Export each module to OSIS XML:

```bash
# Navigate to project root
cd C:\Users\Marlowe\Desktop\ProjectBible

# Create directory structure
mkdir -p data-sources\commentaries\raw\matthew-henry
mkdir -p data-sources\commentaries\raw\jfb
mkdir -p data-sources\commentaries\raw\barnes
mkdir -p data-sources\commentaries\raw\keil-delitzsch

# Export modules
mod2osis MHC > data-sources\commentaries\raw\matthew-henry\MHC.osis.xml
mod2osis JFB > data-sources\commentaries\raw\jfb\JFB.osis.xml
mod2osis Barnes > data-sources\commentaries\raw\barnes\Barnes.osis.xml
mod2osis KD > data-sources\commentaries\raw\keil-delitzsch\KD.osis.xml
```

**Expected Output:**
- `MHC.osis.xml` (~80MB)
- `JFB.osis.xml` (~30MB)
- `Barnes.osis.xml` (~40MB)
- `KD.osis.xml` (~60MB)

**Total:** ~210MB OSIS XML files

---

## Step 4: Parse Commentary Sources

Run the parser to convert OSIS XML → unified NDJSON:

```bash
node scripts/parse-commentary-sources.mjs
```

**Expected Output:**

```
Commentary Parser - Starting...

Parsing OSIS: data-sources\commentaries\raw\matthew-henry\MHC.osis.xml
  Found 31,103 entries
  Size: 80.45 MB

Parsing OSIS: data-sources\commentaries\raw\jfb\JFB.osis.xml
  Found 23,145 entries
  Size: 30.12 MB

Parsing OSIS: data-sources\commentaries\raw\barnes\Barnes.osis.xml
  Found 18,567 entries
  Size: 40.23 MB

Parsing OSIS: data-sources\commentaries\raw\keil-delitzsch\KD.osis.xml
  Found 15,432 entries
  Size: 60.01 MB

Writing 88,247 entries to data\processed\commentary-unified.ndjson

=== Parsing Complete ===
Total entries: 88,247
Total source size: 210.81 MB
Output file: data\processed\commentary-unified.ndjson
Output size: 125.34 MB

Entries by author:
  Matthew Henry: 31,103
  Jamieson-Fausset-Brown: 23,145
  Albert Barnes: 18,567
  Keil & Delitzsch: 15,432

Top 10 books by entries:
  Genesis: 6,234
  Psalms: 5,891
  Matthew: 4,567
  ...

✅ Ready for pack building
Next: node scripts/build-commentary-pack.mjs
```

**Generated File:** `data/processed/commentary-unified.ndjson` (~125MB)

---

## Step 5: Build Commentary Pack

Run the pack builder to create SQLite pack:

```bash
node scripts/build-commentary-pack.mjs
```

**Expected Output:**

```
Commentary Pack Builder - Starting...

Loading entries from data\processed\commentary-unified.ndjson...
Loaded 88,247 entries

Creating pack: packs\workbench\commentaries.sqlite
Creating schema...
Inserting metadata...
Inserting commentary entries...
  Progress: 10/177 batches (5.6%)
  Progress: 20/177 batches (11.3%)
  ...
  Progress: 177/177 batches (100.0%)
✅ Inserted 88,247 entries

Optimizing database...
Pack size: 456.78 MB (0.45 GB)
Remaining capacity: 1,591.22 MB (77.5% used)

Generating coverage report...
Coverage data: packs\workbench\commentary-coverage.json

=== Build Complete ===
✅ Pack created: packs\workbench\commentaries.sqlite
✅ Size: 456.78 MB
✅ Entries: 88,247
✅ Authors: 4
✅ Books covered: 66/66

Next: Import pack into pwa-polished app
```

**Generated Files:**
- `packs/workbench/commentaries.sqlite` (~457MB)
- `packs/workbench/commentary-report.md` (coverage stats)
- `packs/workbench/commentary-coverage.json` (machine-readable stats)

---

## Step 6: Import Pack into App

### Start Development Server

```bash
npm run dev:polished
```

### Import via UI

1. Open browser: http://localhost:5174
2. Navigate to any verse (e.g., John 3:16)
3. Open browser DevTools (F12)
4. Go to **Application** → **IndexedDB** → **projectbible**
5. Upload pack via file input (if import UI exists) OR use DevTools to manually import

### Manual Import (DevTools Console)

```javascript
// Import pack file
const input = document.createElement('input');
input.type = 'file';
input.accept = '.sqlite';
input.onchange = async (e) => {
  const file = e.target.files[0];
  const { importPackFromSQLite } = await import('./adapters/pack-import.js');
  await importPackFromSQLite(file);
  console.log('✅ Pack imported successfully');
};
input.click();
```

---

## Step 7: Test Commentary Feature

1. Navigate to **Romans 5:1**
2. **Long-press** (mobile) or **click** the verse number
3. Selection toast appears
4. Click **"Commentary"** button
5. Commentary modal opens showing entries from:
   - Matthew Henry
   - Jamieson-Fausset-Brown
   - Albert Barnes
   - Keil & Delitzsch (if NT, only first 3 will have content)

**Expected Result:**

```
Commentary: Romans 5:1

[Author Filter Dropdown: All Authors (3)]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Matthew Henry

Therefore being justified by faith...
[Commentary text here]

— Matthew Henry's Complete Commentary (1706)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Jamieson-Fausset-Brown

Therefore being justified by faith, we have peace...
[Commentary text here]

— Commentary Critical and Explanatory (1871)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Albert Barnes

Therefore, being justified by faith...
[Commentary text here]

— Barnes' Notes on the Bible (1834)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Troubleshooting

### Parser Errors

**Error:** `Input file not found`
- Verify OSIS XML files exist in `data-sources/commentaries/raw/<commentary>/`
- Check file paths match exactly (case-sensitive on Linux/Mac)

**Error:** `Unknown OSIS book: <abbrev>`
- Add missing abbreviation to `OSIS_BOOK_MAP` in parser
- Example: `'1Jn': '1 John'`

### Pack Builder Errors

**Error:** `NDJSON file not found`
- Run parser first: `node scripts/parse-commentary-sources.mjs`

**Error:** `Pack exceeds 2GB limit`
- Remove some commentaries from source directory
- Re-run parser and builder
- Split into multiple packs (e.g., `commentaries-classic.sqlite`, `commentaries-modern.sqlite`)

### Import Errors

**Error:** `Invalid pack: no metadata found`
- Pack is corrupted or incomplete
- Re-run pack builder
- Verify `metadata` table exists: `sqlite3 commentaries.sqlite "SELECT * FROM metadata;"`

**Error:** `IndexedDB version mismatch`
- Clear browser data (Application → IndexedDB → Delete database)
- Refresh page
- Re-import pack

### UI Errors

**Commentary button doesn't appear**
- Verify pack imported successfully (check IndexedDB → `packs` store)
- Check console for errors
- Ensure verse is selected (not just word)

**Modal shows "No commentary available"**
- Commentary pack may not have entries for this verse
- Check coverage report: `cat packs/workbench/commentary-report.md`
- Some OT verses may only have Matthew Henry or Keil & Delitzsch

---

## Adding More Commentaries

Want to fill the 2GB pack? Add more commentaries:

### Option 1: Download More Sword Modules

```bash
# List available commentary modules
installmgr -rl CrossWire | grep -i comment

# Install additional modules
installmgr -ri CrossWire Gill
installmgr -ri CrossWire Clarke
installmgr -ri CrossWire Wesley
installmgr -ri CrossWire PooleCommentary
```

### Option 2: Add Modern Commentaries (PDF/HTML)

1. Download Constable's Notes: https://planobiblechapel.org/constable-notes/
2. Place PDFs in `data-sources/commentaries/raw/constable/`
3. Extend parser with PDF parsing (use `pdf-parse` npm package)
4. Re-run parser and builder

### Option 3: Scrape Online Commentaries

1. Target: Guzik's Enduring Word (https://enduringword.com/)
2. Create HTML scraper script
3. Respect robots.txt and rate limits
4. Output to NDJSON format
5. Merge with existing commentary data

---

## Pack Size Optimization

Current pack: ~457MB (4 commentaries)  
Target: 1.8-2.0GB (maximum)

**Remaining capacity:** ~1.5GB

**Recommendations:**

1. **Add 3-4 more commentaries** (Gill, Clarke, Wesley, Poole) → ~1.2GB total
2. **Add Constable's Notes** (modern, ~100MB) → ~1.3GB total
3. **Add NET Bible Notes** (~50MB) → ~1.35GB total
4. **Final total:** ~1.35GB (leaves 650MB buffer)

**If pack exceeds 2GB:**
- Split into 2 packs:
  - `commentaries-classic.sqlite` (pre-1900): Matthew Henry, JFB, Barnes, Gill, Clarke, Wesley, Poole
  - `commentaries-modern.sqlite` (1970s+): Constable, NET Notes, Guzik

---

## Next Steps

After building your first pack:

1. **Validate coverage:** Review `commentary-report.md` for gaps
2. **Add more commentaries:** Aim for 1.8-2.0GB target
3. **Test thoroughly:** Check OT and NT coverage
4. **Promote to production:** Copy to `apps/pwa-polished/public/packs/` (when ready)
5. **Upload to GitHub Releases:** `node scripts/publish-packs-release.mjs` (when ready)

---

## Resources

- **Commentary Sources:** See [data-sources/commentaries/README.md](data-sources/commentaries/README.md)
- **Pack Standard:** See [docs/PACK-STANDARD-V1.md](docs/PACK-STANDARD-V1.md)
- **Implementation Details:** See [COMMENTARY-PACK-IMPLEMENTATION.md](COMMENTARY-PACK-IMPLEMENTATION.md)

---

**Estimated Time:** 2-4 hours (depending on download speeds)  
**Difficulty:** Intermediate (requires command-line familiarity)  
**Result:** 1.8-2.0GB commentary pack with 10-12 quality commentaries
