# Cross-References Implementation

## ✅ Current Status

We have successfully implemented a **curated cross-references database** with 74 bidirectional references covering the most important biblical connections.

### Quick Start

```bash
# Build the cross-references database
npm run build:cross-refs

# Test it
node scripts/test-cross-references.mjs
```

### Database Location
`packs/cross-references.sqlite` (16KB)

### What's Included

**38 source references** × 2 (bidirectional) = **74 total entries**

#### Categories Covered:
1. **Creation Narratives**
   - Genesis 1:1 ↔ John 1:1 (In the beginning)
   - Genesis 1:26 ↔ John 1:14 (Image of God / Word made flesh)

2. **Messianic Prophecies**
   - Isaiah 7:14 → Matthew 1:23 (Virgin birth)
   - Isaiah 53 → 1 Peter, Matthew, Acts (Suffering servant)
   - Psalm 22 → Matthew 27, John 20 (Crucifixion details)

3. **God's Love & Salvation**
   - John 3:16 ↔ Romans 5:8, 1 John 4:9-10

4. **Greatest Commandments**
   - Matthew 22:37-39 ↔ Deuteronomy 6:5, Leviticus 19:18

5. **Faith & Righteousness**
   - Romans 1:17, 4:3 ↔ Genesis 15:6, Habakkuk 2:4

6. **Resurrection**
   - 1 Corinthians 15:4 ↔ Psalm 16:10, Hosea 6:2

7. **New Covenant**
   - Hebrews 8:8, 1 Corinthians 11:25 ↔ Jeremiah 31:31

8. **Second Coming**
   - Matthew 24:30, Revelation 1:7 ↔ Daniel 7:13

## Database Schema

```sql
CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE cross_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_book TEXT NOT NULL,
  from_chapter INTEGER NOT NULL,
  from_verse INTEGER NOT NULL,
  to_book TEXT NOT NULL,
  to_chapter INTEGER NOT NULL,
  to_verse_start INTEGER NOT NULL,
  to_verse_end INTEGER,
  votes INTEGER DEFAULT 0,
  source TEXT DEFAULT 'curated',
  description TEXT,
  UNIQUE(from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end)
);

-- Indexes for fast lookup
CREATE INDEX idx_cross_refs_from 
  ON cross_references(from_book, from_chapter, from_verse);

CREATE INDEX idx_cross_refs_to 
  ON cross_references(to_book, to_chapter, to_verse_start);
```

## Usage Example

```javascript
import Database from 'better-sqlite3';

const db = new Database('packs/cross-references.sqlite', { readonly: true });

// Find cross-references FOR a verse
const refs = db.prepare(`
  SELECT * FROM cross_references 
  WHERE from_book = ? AND from_chapter = ? AND from_verse = ?
`).all('John', 3, 16);

// Find cross-references TO a verse
const backRefs = db.prepare(`
  SELECT * FROM cross_references 
  WHERE to_book = ? AND to_chapter = ? AND to_verse_start = ?
`).all('Genesis', 1, 1);
```

## Future Expansion

### Phase 2: OSIS/SWORD Integration

**📖 See detailed instructions: [SWORD-INTEGRATION.md](./SWORD-INTEGRATION.md)**

**Quick version once you have SWORD installed:**

```bash
# 1. Install NET Bible module (has excellent cross-refs)
installmgr -ri CrossWire NET

# 2. Extract to OSIS XML
mod2osis NET > data-sources/cross-references/NET.xml

# 3. Parse and import cross-references
node scripts/extract-osis-refs.mjs data-sources/cross-references/NET.xml
```

**Result:** Adds 60,000+ cross-references to your database! 🎉

The plan is to expand this database with more cross-references from OSIS XML sources:

#### Primary Sources:
1. **CrossWire SWORD Modules**
   - https://crosswire.org/sword/modules/
   - Modules with cross-references:
     - KJV (with TSK references)
     - NET Bible (comprehensive notes + cross-refs)
     - NASB (study Bible editions)

2. **OSIS XML Structure**
   ```xml
   <verse osisID="John.3.16">
     <note type="crossReference">
       <reference osisRef="Rom.5.8">Romans 5:8</reference>
       <reference osisRef="1John.4.9">1 John 4:9</reference>
     </note>
   </verse>
   ```

3. **Parser Tool**
   - Located at: `packages/packtools/src/parsers/osis-crossref-parser.mjs`
   - Parses `<note type="crossReference">` elements
   - Extracts osisRef attributes
   - Normalizes book names
   - Outputs to TSV for import

#### Download SWORD Modules:

```bash
# Install SWORD tools
# On Windows: Download from https://crosswire.org/sword/software/

# List available modules
installmgr -l

# Install KJV with cross-references
installmgr -i KJV

# Modules typically installed to:
# Windows: C:\Program Files\CrossWire\SWORD\mods.d\
```

#### Parse OSIS Files:

```javascript
import { parseOSISDirectory, exportToTSV } from './packages/packtools/src/parsers/osis-crossref-parser.mjs';

// Parse all OSIS files in a directory
const crossRefs = await parseOSISDirectory('./osis-files/');

// Export to TSV
exportToTSV(crossRefs, './data-sources/cross-references/osis-refs.tsv');
```

### Phase 3: Community Contributions

Allow users to contribute additional cross-references via:
- Pull requests with curated references
- Submissions through a web form
- Voting system for relevance

### Phase 4: TSK Integration

When the full Treasury of Scripture Knowledge becomes available:
- 500,000+ cross-references
- Download from: https://github.com/scrollmapper/bible_databases (when accessible)
- Parse TSV format
- Import into database

## Quality Assurance

All curated cross-references are:
- Theologically sound
- Well-documented with descriptions
- Bidirectional (searchable both ways)
- Indexed for fast lookup
- Public domain / freely usable

## Contributing

To add more curated cross-references:

1. Edit `scripts/build-cross-references.mjs`
2. Add entries to `CURATED_CROSS_REFERENCES` array
3. Run `npm run build:cross-refs`
4. Test with `node scripts/test-cross-references.mjs`
5. Submit a pull request

Format:
```javascript
{
  from: 'Book Chapter:Verse',
  to: 'Book Chapter:Verse',
  description: 'Brief explanation of the connection'
}
```
