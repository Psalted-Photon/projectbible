# English Lexical Data Packs - Implementation Plan

## Overview
This document outlines the implementation of English dictionary, thesaurus, and grammar data packs for ProjectBible's offline study system.

## Data Sources Evaluated

### ✅ 1. IPA Dictionary (open-dict-data/ipa-dict)
- **License**: MIT
- **Size**: English (US) ~140k words, English (UK) ~120k words
- **Format**: Tab-delimited text, JSON, CSV, XML
- **Content**: Word + IPA pronunciation
- **Example**: `hello\thəˈloʊ`
- **Download**: https://github.com/open-dict-data/ipa-dict/releases
- **Use Case**: Pronunciation lookup, phonetic search
- **Status**: ✅ Ready to integrate

### ✅ 2. English Words List (dwyl/english-words)
- **License**: Unlicense (Public Domain)
- **Size**: 479k words
- **Format**: Plain text (newline-delimited), JSON dictionary
- **Content**: Wordlist only (no definitions)
- **Files**:
  - `words_alpha.txt` - 370k alpha-only words
  - `words_dictionary.json` - JSON format with all words as keys
- **Download**: https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt
- **Use Case**: Spell-check, word validation, autocomplete
- **Status**: ✅ Ready to integrate

### ✅ 3. Moby Thesaurus (words/moby)
- **License**: Public Domain
- **Size**: Largest English thesaurus (30k+ root words, 2.5M+ synonyms)
- **Format**: Plain text (comma-separated synonyms per line)
- **Content**: Root word + comma-separated synonyms
- **Example**: `ecstasy,abiosis,abstraction,abulia,animation,beatitude,bliss...`
- **Download**: https://github.com/words/moby (packaged as npm module)
- **Use Case**: Synonym search, semantic clustering
- **Status**: ✅ Ready to integrate (includes Open Office thesaurus data)

### 🔧 4. Webster's 1913 Dictionary (via Wiktionary)
- **License**: Public Domain
- **Size**: ~110k entries with definitions, etymologies
- **Format**: XML/SQL (various mirrors)
- **Content**: Definitions, parts of speech, etymology, quotations
- **Download**: Multiple sources via Wiktionary exports
- **Use Case**: Historical definitions, rich etymologies
- **Status**: 🔧 Needs extraction from Wiktionary dumps

### 🔧 5. WordNet 3.1 (Princeton)
- **License**: WordNet License (free for research/commercial)
- **Size**: 155k words organized in 117k synsets
- **Format**: Database files (converted to SQLite easily)
- **Content**: Semantic relationships, synsets, glosses, POS tags
- **Download**: https://wordnet.princeton.edu/download
- **Use Case**: Semantic search, word relationships, POS tagging
- **Status**: 🔧 Needs conversion to SQLite

## Pack Architecture

### Dictionary Pack (`english-dictionary-v1.sqlite`)
**Tables**:
```sql
-- Core dictionary table
CREATE TABLE words (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL UNIQUE,
  pos TEXT, -- part of speech: noun, verb, adjective, etc.
  definition TEXT,
  etymology TEXT,
  ipa_us TEXT, -- IPA pronunciation (US)
  ipa_uk TEXT  -- IPA pronunciation (UK)
);

CREATE INDEX idx_word ON words(word);
CREATE INDEX idx_pos ON words(pos);

-- Example entries table (usage examples)
CREATE TABLE examples (
  id INTEGER PRIMARY KEY,
  word_id INTEGER,
  example TEXT,
  source TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);
```

**Size Estimate**: ~50MB (compressed ~15MB)

### Thesaurus Pack (`english-thesaurus-v1.sqlite`)
**Tables**:
```sql
-- Synonym relationships
CREATE TABLE synonyms (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL,
  synonym TEXT NOT NULL,
  strength REAL DEFAULT 1.0 -- semantic similarity score
);

CREATE INDEX idx_word_syn ON synonyms(word);
CREATE INDEX idx_synonym ON synonyms(synonym);

-- Antonym relationships
CREATE TABLE antonyms (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL,
  antonym TEXT NOT NULL
);

CREATE INDEX idx_word_ant ON antonyms(word);
```

**Size Estimate**: ~80MB (compressed ~25MB)

### Grammar Pack (`english-grammar-v1.sqlite`)
**Tables**:
```sql
-- Part-of-speech tagged words
CREATE TABLE pos_tags (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL,
  pos TEXT NOT NULL, -- noun, verb, adjective, etc.
  frequency INTEGER, -- corpus frequency
  UNIQUE(word, pos)
);

CREATE INDEX idx_word_pos ON pos_tags(word);
CREATE INDEX idx_pos_type ON pos_tags(pos);

-- Verb conjugations
CREATE TABLE verb_forms (
  id INTEGER PRIMARY KEY,
  base_form TEXT NOT NULL,
  present TEXT,
  past TEXT,
  past_participle TEXT,
  present_participle TEXT
);

-- Noun plurals
CREATE TABLE noun_plurals (
  id INTEGER PRIMARY KEY,
  singular TEXT NOT NULL UNIQUE,
  plural TEXT NOT NULL
);
```

**Size Estimate**: ~40MB (compressed ~10MB)

## Implementation Phases

### Phase 1: Core Wordlist + IPA (IMMEDIATE) ✅
- [x] Download IPA dict (en_US.txt, en_UK.txt)
- [x] Download english-words (words_alpha.txt)
- [ ] Create `build-english-wordlist-pack.mjs`
- [ ] Combine into single SQLite pack
- [ ] Test search integration

### Phase 2: Moby Thesaurus (WEEK 1) 🔄
- [ ] Install moby npm package
- [ ] Create `build-english-thesaurus-pack.mjs`
- [ ] Parse synonym data into SQLite
- [ ] Add reverse lookups
- [ ] Test synonym search UI

### Phase 3: WordNet Integration (WEEK 2) 🔄
- [ ] Download WordNet 3.1 data files
- [ ] Create `build-wordnet-pack.mjs`
- [ ] Extract POS tags, synsets, relationships
- [ ] Merge with existing dictionary pack
- [ ] Add semantic search capabilities

### Phase 4: Webster's 1913 (WEEK 3) 🔄
- [ ] Download Wiktionary dump or OPTED source
- [ ] Create extraction script
- [ ] Parse definitions + etymologies
- [ ] Merge into dictionary pack
- [ ] Add etymology search

### Phase 5: Grammar Engine (WEEK 4) 🔄
- [ ] Extract POS patterns from corpus
- [ ] Build verb conjugation tables
- [ ] Build noun plural rules
- [ ] Create grammar query API
- [ ] Integrate with Power Search

## Power Search Integration

### English Morphology Controls (UI)
```typescript
// searchConfig.ts extension
interface EnglishMorphologyFilter {
  pos?: 'noun' | 'verb' | 'adjective' | 'adverb' | 'pronoun' | 
        'preposition' | 'conjunction' | 'interjection' | 'article';
  tense?: 'present' | 'past' | 'future';
  number?: 'singular' | 'plural';
}

// New search capabilities:
// - "Find all nouns in Genesis"
// - "Find all past tense verbs in John"
// - "Find all adjectives describing 'love'"
```

### Synonym Search
- User searches "love" → automatically include charity, affection, devotion
- Toggle: "Include synonyms" checkbox
- Slider: Semantic distance (1-5)

### Etymology Search
- Filter by word origin: Greek, Hebrew, Latin, Germanic
- Show historical word development
- Cross-reference with Strong's numbers

## File Sizes & Performance

| Pack | Uncompressed | Compressed | Load Time | Search Speed |
|------|--------------|------------|-----------|--------------|
| Wordlist + IPA | 25 MB | 8 MB | 200ms | <10ms |
| Thesaurus | 80 MB | 25 MB | 400ms | <20ms |
| Dictionary | 50 MB | 15 MB | 300ms | <15ms |
| Grammar | 40 MB | 10 MB | 250ms | <12ms |
| **TOTAL** | **195 MB** | **58 MB** | **1.15s** | **<60ms** |

## Offline-First Architecture
- All data stored in IndexedDB
- No external API calls required
- Progressive enhancement:
  1. Basic wordlist loads first
  2. Dictionary loads on demand
  3. Thesaurus loads when synonym search used
  4. Grammar loads when morphology search used

## Next Steps
1. ✅ Document resources in README
2. Create `build-english-wordlist-pack.mjs`
3. Download source files to `data-sources/english-lexical/`
4. Build first pack (wordlist + IPA)
5. Test in Power Search
6. Iterate through remaining phases

## License Compliance
- IPA Dict: MIT ✅
- English Words: Unlicense (Public Domain) ✅
- Moby Thesaurus: Public Domain ✅
- WordNet: WordNet License (free) ✅
- Webster's 1913: Public Domain ✅

All data sources are freely licensed for offline use, redistribution, and commercial applications.
