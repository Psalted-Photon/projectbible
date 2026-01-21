# ProjectBible Pack Standard v1.0

**Status:** Canonical  
**Effective Date:** January 20, 2026  
**Schema Version:** 1.0.0  

---

## 1. Overview

This document defines the canonical pack format for ProjectBible. All pack builders, importers, and runtime consumers MUST conform to this standard to ensure interoperability.

### 1.1 Design Principles

1. **Explicit over Implicit** - No guessing required; every classification field is mandatory
2. **Type-Based Detection** - Packs are classified by `type` field, not heuristics
3. **Language Routing** - Every text pack declares its language explicitly
4. **Future-Proof** - Schema versioning enables migration paths
5. **Validation-First** - Packs can be validated before import

---

## 2. Core Pack Metadata

Every pack MUST contain a `metadata` table with these fields:

### 2.1 Required Metadata Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | TEXT | Unique pack identifier (kebab-case) | `translations.en` |
| `type` | TEXT | Pack classification (see §3) | `text` |
| `version` | TEXT | Semantic version | `1.0.0` |
| `schemaVersion` | TEXT | Pack schema version | `1.0` |
| `name` | TEXT | Human-readable name | `English Translations Pack` |

### 2.2 Optional Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | TEXT | Pack description |
| `language` | TEXT | Primary language (ISO 639-1/639-3) |
| `license` | TEXT | License identifier (SPDX) |
| `attribution` | TEXT | Copyright/attribution text |
| `minAppVersion` | TEXT | Minimum app version required |

### 2.3 Metadata Table Schema

```sql
CREATE TABLE metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Example rows
INSERT INTO metadata (key, value) VALUES
  ('id', 'translations.en'),
  ('type', 'text'),
  ('version', '1.0.0'),
  ('schemaVersion', '1.0'),
  ('name', 'English Translations Pack'),
  ('language', 'en');
```

---

## 3. Pack Types

Packs are classified by the `type` metadata field.

### 3.1 Canonical Pack Types

| Type | Purpose | Example |
|------|---------|---------|
| `text` | Bible text (translations or original languages) | KJV, WEB, LXX, Hebrew |
| `lexicon` | Lexical resources (Strong's, dictionaries) | Hebrew Lexicon, Greek Lexicon |
| `audio` | Audio files embedded in pack | BSB Audio |
| `maps` | Geographic data and map tiles | Biblical Geography |
| `study` | Study resources (cross-refs, chronological) | Study Tools Pack |
| `morphology` | Morphological analysis data | Greek Morphology |

### 3.2 Type-Specific Requirements

Each pack type has additional schema requirements (see §4-§9).

---

## 4. Text Pack Standard

Text packs contain Bible verses and MUST follow this structure.

### 4.1 Multi-Translation Packs

Consolidated packs containing multiple translations MUST include a `translations` table.

#### 4.1.1 Translations Table Schema

```sql
CREATE TABLE translations (
  id           TEXT PRIMARY KEY,  -- Translation ID (uppercase, e.g., 'KJV')
  name         TEXT NOT NULL,     -- Full name
  language     TEXT NOT NULL,     -- ISO 639 code ('en', 'grc', 'heb')
  abbreviation TEXT,              -- Short abbreviation
  description  TEXT,              -- Optional description
  year         INTEGER            -- Publication year
);
```

#### 4.1.2 Verses Table Schema (Multi-Translation)

```sql
CREATE TABLE verses (
  translationId TEXT NOT NULL,   -- MUST match translations.id
  book          TEXT NOT NULL,
  chapter       INTEGER NOT NULL,
  verse         INTEGER NOT NULL,
  text          TEXT NOT NULL,
  heading       TEXT,             -- Optional section heading
  PRIMARY KEY (translationId, book, chapter, verse)
);

CREATE INDEX idx_verses_translation ON verses(translationId);
CREATE INDEX idx_verses_book ON verses(book, chapter, verse);
```

### 4.2 Single-Translation Packs

Single-translation packs MAY omit the `translations` table and set:

- `metadata.translation_id` = Translation ID
- `metadata.translation_name` = Translation name
- `metadata.language` = Language code

Verses table schema (single-translation):

```sql
CREATE TABLE verses (
  book    TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse   INTEGER NOT NULL,
  text    TEXT NOT NULL,
  heading TEXT,
  PRIMARY KEY (book, chapter, verse)
);
```

### 4.3 Importer Contract for Text Packs

When importing a multi-translation pack, the importer MUST:

1. **Read `translations` table** to enumerate all translations
2. **Create one pack entry per translation** with these fields:
   ```typescript
   {
     id: `${packId}-${translationId}`,
     type: 'text',                    // CANONICAL
     translationId: row.id,           // From translations table
     translationName: row.name,
     language: row.language,          // REQUIRED for routing
     version: metadata.version,
     installedAt: Date.now()
   }
   ```
3. **Import verses** from `verses` table using `translationId` column

### 4.4 Runtime Contract for Text Packs

Apps MUST detect text packs using:

```typescript
const textPacks = packs.filter(p => p.type === 'text');
```

**NOT:**
```typescript
// ❌ DEPRECATED - Do not use heuristics
const textPacks = packs.filter(p => p.translationId);
```

---

## 5. Lexicon Pack Standard

### 5.1 Lexicon Entries Table Schema

```sql
CREATE TABLE lexicon_entries (
  strongs       TEXT PRIMARY KEY,  -- Strong's number (e.g., 'H1234', 'G5485')
  lemma         TEXT NOT NULL,     -- Original language lemma
  transliteration TEXT,
  pronunciation TEXT,
  short_def     TEXT,              -- Brief gloss
  long_def      TEXT,              -- Extended definition
  language      TEXT NOT NULL,     -- 'heb' or 'grc'
  part_of_speech TEXT
);

CREATE INDEX idx_lexicon_language ON lexicon_entries(language);
```

### 5.2 Metadata Requirements

```
type = 'lexicon'
language = 'heb' | 'grc' | 'en'
```

---

## 6. Audio Pack Standard

### 6.1 Audio Files Table Schema

```sql
CREATE TABLE audio_files (
  book         TEXT NOT NULL,
  chapter      INTEGER NOT NULL,
  file_path    TEXT NOT NULL,     -- Relative path or BLOB reference
  file_data    BLOB,               -- Embedded MP3 data
  duration_ms  INTEGER,
  narrator     TEXT,
  PRIMARY KEY (book, chapter)
);
```

### 6.2 Metadata Requirements

```
type = 'audio'
language = primary narration language
```

### 6.3 Storage Strategy

Audio packs SHOULD embed MP3 files as BLOBs for offline support.

---

## 7. Maps Pack Standard

### 7.1 Places Table Schema

```sql
CREATE TABLE places (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  latitude     REAL NOT NULL,
  longitude    REAL NOT NULL,
  place_type   TEXT,              -- 'city', 'mountain', 'region', etc.
  certainty    TEXT,              -- 'certain', 'probable', 'possible'
  description  TEXT
);
```

### 7.2 Metadata Requirements

```
type = 'maps'
```

---

## 8. Study Pack Standard

### 8.1 Cross-References Table Schema

```sql
CREATE TABLE cross_references (
  from_book     TEXT NOT NULL,
  from_chapter  INTEGER NOT NULL,
  from_verse    INTEGER NOT NULL,
  to_book       TEXT NOT NULL,
  to_chapter    INTEGER NOT NULL,
  to_verse_start INTEGER NOT NULL,
  to_verse_end  INTEGER,
  source        TEXT,              -- 'curated', 'user', 'ai'
  description   TEXT,
  PRIMARY KEY (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start)
);
```

### 8.2 Chronological Order Table Schema

```sql
CREATE TABLE chronological_order (
  sequence      INTEGER PRIMARY KEY,
  book          TEXT NOT NULL,
  chapter_start INTEGER NOT NULL,
  chapter_end   INTEGER NOT NULL,
  event         TEXT,
  year_bce      INTEGER
);
```

### 8.3 Metadata Requirements

```
type = 'study'
```

---

## 9. Morphology Pack Standard

### 9.1 Words Table Schema

```sql
CREATE TABLE words (
  book         TEXT NOT NULL,
  chapter      INTEGER NOT NULL,
  verse        INTEGER NOT NULL,
  word_order   INTEGER NOT NULL,
  text         TEXT NOT NULL,     -- Original language word
  lemma        TEXT,
  morph_code   TEXT,              -- Parsing code
  strongs      TEXT,              -- Strong's number
  gloss_en     TEXT,              -- English gloss
  transliteration TEXT,
  PRIMARY KEY (book, chapter, verse, word_order)
);
```

### 9.2 Metadata Requirements

```
type = 'morphology'
language = 'grc' | 'heb'
```

---

## 10. Importer Responsibilities

All pack importers MUST:

1. **Validate metadata** - Check required fields exist
2. **Set canonical type** - Never copy blindly; classify explicitly
3. **Extract language** - For text packs, extract from `translations` table
4. **Create indexed entries** - Populate runtime indices (e.g., verse lookups)
5. **Log classification** - Debug output should show type, language, translationId

### 10.1 Validation Checklist

Before importing, verify:

- ✅ `metadata.id` exists
- ✅ `metadata.type` is a valid pack type
- ✅ `metadata.schemaVersion` is compatible
- ✅ Required tables exist for pack type
- ✅ Foreign key integrity (e.g., verses.translationId → translations.id)

---

## 11. Runtime Detection Contract

Apps MUST detect packs using **type-based filtering**, not field presence heuristics.

### 11.1 Canonical Detection Rules

```typescript
// ✅ CORRECT
const textPacks = packs.filter(p => p.type === 'text');
const lexiconPacks = packs.filter(p => p.type === 'lexicon');
const audioPacks = packs.filter(p => p.type === 'audio');

// ❌ INCORRECT - Do not use heuristics
const textPacks = packs.filter(p => p.translationId);
const lexiconPacks = packs.filter(p => p.lexiconId);
```

### 11.2 Translation Enumeration

To list available translations:

```typescript
const translations = textPacks.map(p => ({
  id: p.translationId,
  name: p.translationName,
  language: p.language
}));
```

---

## 12. Schema Versioning & Migration

### 12.1 Schema Version Format

`schemaVersion` follows `MAJOR.MINOR` format:

- **MAJOR** - Breaking changes (incompatible with older apps)
- **MINOR** - Backward-compatible additions

Current version: **1.0**

### 12.2 Migration Strategy

When `schemaVersion` changes:

1. Apps SHOULD check compatibility before import
2. Apps MAY provide migration adapters for older schemas
3. Packs SHOULD document breaking changes in `description`

### 12.3 Forward Compatibility

Apps MUST ignore unknown metadata fields to support future extensions.

---

## 13. Pack Distribution & Manifests

### 13.1 Manifest Schema

Pack distribution manifests MUST include:

```json
{
  "version": "1.0.0",
  "schemaVersion": "1.0",
  "packs": [
    {
      "id": "translations.en",
      "type": "text",
      "name": "English Translations",
      "description": "KJV, WEB, BSB, NET, LXX2012",
      "version": "1.0.0",
      "schemaVersion": "1.0",
      "size": 35405824,
      "sha256": "fb397fd037f93a6a...",
      "downloadUrl": "https://cdn.example.com/translations.en.sqlite",
      "dependencies": []
    }
  ]
}
```

### 13.2 Integrity Verification

Manifests MUST include SHA-256 checksums for integrity verification.

---

## 14. Pack Builder Guidelines

### 14.1 File Naming Convention

- Use `.sqlite` extension
- Use kebab-case: `translations-en.sqlite`, `hebrew-lexicon.sqlite`
- Avoid version numbers in filename (use metadata instead)

### 14.2 Compression

- Enable SQLite compression: `PRAGMA page_size = 4096; VACUUM;`
- Do NOT gzip `.sqlite` files (SQLite is already optimized)

### 14.3 Size Optimization

- Remove unused indices before distribution
- Use `INTEGER` instead of `TEXT` where possible
- Normalize repeated strings into lookup tables

---

## 15. Validation Tools

### 15.1 Pack Validator (Future)

A validation tool SHOULD check:

- ✅ Metadata completeness
- ✅ Schema conformance
- ✅ Foreign key integrity
- ✅ Index presence
- ✅ File size vs. declared size

### 15.2 SQL Schema Validation

```sql
-- Verify metadata table exists
SELECT name FROM sqlite_master WHERE type='table' AND name='metadata';

-- Verify required metadata keys
SELECT key FROM metadata WHERE key IN ('id', 'type', 'version', 'schemaVersion', 'name');

-- Verify translations table (for text packs)
SELECT name FROM sqlite_master WHERE type='table' AND name='translations';

-- Verify foreign key integrity (verses → translations)
SELECT COUNT(*) FROM verses v
LEFT JOIN translations t ON v.translationId = t.id
WHERE t.id IS NULL;
```

---

## 16. Compatibility Matrix

| App Version | Schema Version | Status |
|-------------|----------------|--------|
| 1.0.x | 1.0 | ✅ Full support |
| 0.9.x | 1.0 | ⚠️ Requires migration layer |
| Future | 1.1 | ✅ Forward-compatible |

---

## 17. Examples

### 17.1 Minimal Text Pack (Single Translation)

```sql
-- Metadata
INSERT INTO metadata VALUES ('id', 'kjv');
INSERT INTO metadata VALUES ('type', 'text');
INSERT INTO metadata VALUES ('version', '1.0.0');
INSERT INTO metadata VALUES ('schemaVersion', '1.0');
INSERT INTO metadata VALUES ('name', 'King James Version');
INSERT INTO metadata VALUES ('translation_id', 'KJV');
INSERT INTO metadata VALUES ('language', 'en');

-- Verses
CREATE TABLE verses (
  book TEXT, chapter INTEGER, verse INTEGER, text TEXT,
  PRIMARY KEY (book, chapter, verse)
);
INSERT INTO verses VALUES ('Genesis', 1, 1, 'In the beginning...');
```

### 17.2 Consolidated Text Pack (Multiple Translations)

```sql
-- Metadata
INSERT INTO metadata VALUES ('id', 'translations.en');
INSERT INTO metadata VALUES ('type', 'text');
INSERT INTO metadata VALUES ('version', '1.0.0');
INSERT INTO metadata VALUES ('schemaVersion', '1.0');
INSERT INTO metadata VALUES ('name', 'English Translations Pack');

-- Translations
CREATE TABLE translations (
  id TEXT PRIMARY KEY, name TEXT, language TEXT, description TEXT
);
INSERT INTO translations VALUES ('kjv', 'King James Version', 'en', 'KJV 1769');
INSERT INTO translations VALUES ('web', 'World English Bible', 'en', 'WEB 2020');

-- Verses
CREATE TABLE verses (
  translationId TEXT, book TEXT, chapter INTEGER, verse INTEGER, text TEXT,
  PRIMARY KEY (translationId, book, chapter, verse)
);
INSERT INTO verses VALUES ('kjv', 'Genesis', 1, 1, 'In the beginning...');
INSERT INTO verses VALUES ('web', 'Genesis', 1, 1, 'In the beginning...');
```

---

## 18. Change Log

### v1.0 (January 20, 2026)

- Initial canonical specification
- Defined 6 core pack types
- Established metadata standard
- Defined importer and runtime contracts
- Added validation guidelines

---

## 19. License

This specification is released under CC0 1.0 (Public Domain).

---

**End of Pack Standard v1.0**
