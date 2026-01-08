# ProjectBible Data Packs

This directory contains the consolidated SQLite data packs for ProjectBible.

## 📦 Final Pack Structure

### Translation Packs (User-Facing Bible Texts)

#### **greek.sqlite** (16.06 MB)
All Greek original texts in one pack with edition selector:
- **LXX** - Septuagint (Greek Old Testament) - 30,302 verses
- **byz** - Byzantine Majority Text (Greek NT) - 6,221 verses  
- **tr** - Textus Receptus (Greek NT) - 6,229 verses
- **opengnt** - OpenGNT with morphology (Greek NT) - 7,941 verses

**Total: 50,693 verses across 4 editions**

Usage: Import this pack to get all Greek texts. Select edition in UI.

#### **hebrew.sqlite** (7.81 MB)
All Hebrew original texts with morphological analysis:
- **wlc** - Westminster Leningrad Codex - 23,213 verses

Usage: Import for Hebrew Old Testament with full morphology.

#### **web.sqlite** (6.49 MB)
World English Bible - Modern English translation
- **Total: 31,104 verses** (complete Bible)
- License: Public Domain
- Features: Modern language, inclusive

#### **kjv.sqlite** (6.64 MB)
King James Version - Traditional English translation
- **Total: 31,102 verses** (complete Bible)
- License: Public Domain (personal use; Crown copyright considerations for distribution)
- Features: Classic English, traditional

---

### Feature/Data Packs (Support Translation Features)

#### **places.sqlite** (0.05 MB)
Biblical geography with comprehensive place data:
- Place coordinates and modern equivalents
- Historical names in Hebrew, Greek, Aramaic
- Place appearances across time periods
- Events and people associations
- **Place name linking** - Click any place name in Bible text

Sample places: Bethel, Jerusalem, Mount Sinai (3 detailed examples)

#### **maps.sqlite** (0.04 MB)
Historical map layers for time-slider visualization:
- 11 historical periods (Patriarchs → Early Church)
- GeoJSON boundary data (placeholders ready for data)
- Journey routes (Paul's journeys, Exodus)
- Empire boundaries (Assyrian, Babylonian, Persian, Roman)

#### **cross-references.sqlite** (0.04 MB)
Treasury of Scripture Knowledge cross-references
- Verse-to-verse connections
- Curated biblical cross-references

---

## 🔨 Building Packs

### Build All Packs at Once
```bash
npm run build:all-packs
```

### Build Individual Packs
```bash
# Translation packs
npm run build:greek     # Greek: LXX, Byzantine, TR, OpenGNT
npm run build:hebrew    # Hebrew: WLC with morphology
npm run build:web       # World English Bible
npm run build:kjv       # King James Version

# Feature packs
npm run build:places    # Biblical geography
npm run build:maps      # Historical map layers
npm run build:cross-refs # Cross-references
```

## 📊 Pack Comparison

| Pack | Size | Verses | Type | Features |
|------|------|--------|------|----------|
| **greek.sqlite** | 16.06 MB | 50,693 | Multi-edition | 4 Greek editions, morphology |
| **hebrew.sqlite** | 7.81 MB | 23,213 | Original language | Morphology, cantillation |
| **web.sqlite** | 6.49 MB | 31,104 | English translation | Modern language |
| **kjv.sqlite** | 6.64 MB | 31,102 | English translation | Traditional language |
| **places.sqlite** | 0.05 MB | - | Geography | Place linking, maps |
| **maps.sqlite** | 0.04 MB | - | Historical layers | Time slider, boundaries |
| **cross-references.sqlite** | 0.04 MB | - | References | Verse connections |

**Total: ~37 MB** for complete library

## 🎯 Recommended Import Strategy

### Minimal Setup (English reader)
1. **web.sqlite** OR **kjv.sqlite**
2. **cross-references.sqlite**

**Total: ~6.5 MB**

### Bible Student (original languages)
1. **greek.sqlite**
2. **hebrew.sqlite**
3. **web.sqlite**
4. **cross-references.sqlite**
5. **places.sqlite**

**Total: ~30.5 MB**

### Complete Scholar Pack (everything)
1. All translation packs (greek, hebrew, web, kjv)
2. All feature packs (places, maps, cross-references)

**Total: ~37 MB**

## 🔍 Querying Packs

### Greek Pack (Multi-Edition)
```sql
-- List available editions
SELECT * FROM editions;

-- Get LXX verse
SELECT text FROM verses 
WHERE edition='lxx' AND book='Genesis' AND chapter=1 AND verse=1;

-- Get all NT editions of same verse
SELECT edition, text FROM verses 
WHERE book='Matthew' AND chapter=1 AND verse=1;
```

### Hebrew Pack
```sql
-- Get Hebrew text
SELECT text FROM verses 
WHERE edition='wlc' AND book='Genesis' AND chapter=1 AND verse=1;
```

### Places Pack
```sql
-- Find place by name
SELECT * FROM place_name_links WHERE normalized_word='bethel';

-- Get place details
SELECT * FROM places WHERE id='bethel';
```

### Maps Pack
```sql
-- List time periods
SELECT display_name, period FROM historical_layers ORDER BY year_start;

-- Get Roman Empire layer
SELECT * FROM historical_layers WHERE id='roman-empire-30ad';
```

## 📝 Pack Schema

### Multi-Edition Packs (greek.sqlite, hebrew.sqlite)
```sql
CREATE TABLE metadata (key TEXT, value TEXT);
CREATE TABLE editions (id TEXT, name TEXT, testament TEXT, description TEXT);
CREATE TABLE verses (edition TEXT, book TEXT, chapter INTEGER, verse INTEGER, text TEXT);
```

### Single-Edition Packs (web.sqlite, kjv.sqlite)
```sql
CREATE TABLE metadata (key TEXT, value TEXT);
CREATE TABLE verses (book TEXT, chapter INTEGER, verse INTEGER, text TEXT);
```

## 🗂️ Old Packs (Can Be Removed)

These packs have been consolidated and are no longer needed:
- `byz-full.sqlite` → now in `greek.sqlite` (edition: byz)
- `tr-full.sqlite` → now in `greek.sqlite` (edition: tr)
- `lxx-greek.sqlite` → now in `greek.sqlite` (edition: lxx)
- `opengnt-morphology.sqlite` → now in `greek.sqlite` (edition: opengnt)
- `hebrew-oshb.sqlite` → now in `hebrew.sqlite` (edition: wlc)
- `wlc-full.sqlite` → now in `hebrew.sqlite` (edition: wlc)
- `web-full.sqlite` → renamed to `web.sqlite`
- `kjv-full.sqlite` → renamed to `kjv.sqlite`
- `maps-biblical.sqlite` → renamed to `maps.sqlite`
- `places-biblical.sqlite` → renamed to `places.sqlite`
- `web-sample-dev.sqlite` → sample/dev pack

## License Information

- **Greek LXX, OpenGNT**: CC BY-SA 4.0
- **Greek Byzantine, TR**: Public Domain / Various
- **Hebrew WLC**: CC BY 4.0 (OSHB Project)
- **WEB**: Public Domain
- **KJV**: Public Domain (personal use)
- **Places**: CC BY 4.0 (OpenBible.info + custom)
- **Maps**: CC BY 4.0 (various open sources)
- **Cross-references**: Public Domain

See individual pack metadata for detailed attribution.
