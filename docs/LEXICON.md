# Lexicon and Strong's Dictionary System

## Overview

The lexicon system provides comprehensive word study capabilities, including:

- **Strong's Concordance** entries (Greek and Hebrew)
- **Morphological parsing** for biblical languages
- **Word occurrence tracking** across all Scripture
- **Pronunciation data** (IPA, phonetic, audio)

## Architecture

### Core Interfaces

Located in `packages/core/src/interfaces.ts`:

```typescript
interface StrongEntry {
  id: string; // "G25" or "H1"
  lemma: string; // Root word form
  transliteration?: string; // Romanized form
  definition: string; // Full definition
  shortDefinition?: string; // Brief gloss
  partOfSpeech: string; // "noun", "verb", etc.
  language: "greek" | "hebrew" | "aramaic";
  derivation?: string; // Etymology
  kjvUsage?: string; // KJV translation notes
  occurrences?: number; // Total uses in Bible
}

interface MorphologyInfo {
  word: string; // Actual word form
  lemma: string; // Dictionary form
  strongsId?: string; // Strong's reference
  parsing: MorphologyParsing; // Grammatical details
  gloss?: string; // English meaning
  language: "greek" | "hebrew" | "aramaic";
}

interface MorphologyParsing {
  pos: string; // Part of speech
  person?: string; // 1st, 2nd, 3rd
  number?: string; // Singular, plural
  gender?: string; // Masculine, feminine, neuter
  case?: string; // Nominative, genitive, etc.
  tense?: string; // Present, aorist, etc.
  voice?: string; // Active, passive, middle
  mood?: string; // Indicative, subjunctive, etc.
  state?: string; // Hebrew: absolute, construct
  stem?: string; // Hebrew: Qal, Piel, Hiphil, etc.
}

interface WordOccurrence {
  book: string;
  chapter: number;
  verse: number;
  wordPosition: number; // 1-indexed position in verse
  word: string; // Original language word
  translation?: string; // Pack ID if available
}

interface Pronunciation {
  ipa?: string; // International Phonetic Alphabet
  phonetic?: string; // Simplified pronunciation
  audioUrl?: string; // Audio file reference
  syllables?: string[]; // Syllable breakdown
  stress?: number; // Which syllable is stressed (1-indexed)
}
```

### LexiconStore Interface

```typescript
interface LexiconStore {
  // Get Strong's entry by number
  getStrong(strongsId: string): Promise<StrongEntry | null>;

  // Find entries by lemma (root word)
  getByLemma(
    lemma: string,
    language?: "greek" | "hebrew" | "aramaic"
  ): Promise<StrongEntry[]>;

  // Search definitions
  searchDefinition(
    searchTerm: string,
    language?: "greek" | "hebrew" | "aramaic"
  ): Promise<StrongEntry[]>;

  // Get morphology for specific word
  getMorphology(
    book: string,
    chapter: number,
    verse: number,
    wordPosition: number
  ): Promise<MorphologyInfo | null>;

  // Get all occurrences of a Strong's number
  getOccurrences(strongsId: string, limit?: number): Promise<WordOccurrence[]>;

  // Get pronunciation data
  getPronunciation(strongsId: string): Promise<Pronunciation | null>;
}
```

### IndexedDB Implementation

**Database Version:** 3

**Object Stores:**

1. **strongs_entries** (keyPath: `id`)

   - Indexes: `language`, `lemma`
   - Stores: Strong's dictionary entries

2. **pronunciations** (keyPath: `id`)

   - No indexes
   - Stores: Pronunciation data linked to Strong's IDs

3. **morphology** (keyPath: `id`, autoIncrement)

   - Indexes: `book_chapter_verse_word`, `strongsId`
   - Stores: Morphological parsing for each word

4. **word_occurrences** (keyPath: `id`, autoIncrement)
   - Indexes: `strongsId`, `book_chapter_verse`
   - Stores: Every occurrence of every Strong's number

## Usage Examples

### Get Strong's Entry

```typescript
import { IndexedDBLexiconStore } from "./adapters";

const lexicon = new IndexedDBLexiconStore();

// Get Greek word for "love" (agape)
const agape = await lexicon.getStrong("G26");
console.log(agape?.definition);
console.log(agape?.partOfSpeech); // "noun"
console.log(agape?.occurrences); // 116
```

### Search Definitions

```typescript
// Find all entries related to "love"
const loveEntries = await lexicon.searchDefinition("love", "greek");

for (const entry of loveEntries) {
  console.log(`${entry.id}: ${entry.lemma} - ${entry.shortDefinition}`);
}
```

### Get Morphology

```typescript
// Get grammatical details for a specific word
const morph = await lexicon.getMorphology("John", 3, 16, 1);
console.log(morph?.word); // Original Greek word
console.log(morph?.lemma); // Dictionary form
console.log(morph?.strongsId); // "G3779"
console.log(morph?.parsing.pos); // "adverb"
console.log(morph?.gloss); // "so, thus"
```

### Find Word Occurrences

```typescript
// Get all uses of "agape" (G26)
const occurrences = await lexicon.getOccurrences("G26", 50);

for (const occ of occurrences) {
  console.log(`${occ.book} ${occ.chapter}:${occ.verse} - ${occ.word}`);
}
```

### Get Pronunciation

```typescript
const pron = await lexicon.getPronunciation("G26");
console.log(pron?.ipa); // /aˈɡa.pe/
console.log(pron?.phonetic); // "ah-GAH-pay"
console.log(pron?.syllables); // ["a", "ga", "pe"]
console.log(pron?.stress); // 2
```

## Data Sources

### Strong's Concordance

- **Greek:** Based on STEPBible Strong's data
- **Hebrew/Aramaic:** Based on STEPBible Strong's data
- **License:** Creative Commons (CC BY 4.0)
- **Source:** https://github.com/STEPBible/STEPBible-Data

### Morphology

- **Greek NT:** OpenGNT and MorphGNT projects
  - Morphological tagging for every word
  - Strong's number mapping
  - Lemma forms
- **Hebrew OT:** Open Scriptures Hebrew Bible (OSHB)
  - Westminster Leningrad Codex
  - Morphological tagging
  - Strong's mapping (where available)
- **Septuagint (LXX):** CCAT LXX morphology

### Pronunciation

- **Greek:** KoineGreek.com pronunciation database
  - IPA transcriptions
  - Reconstructed Koine pronunciation
  - Syllable breakdowns
- **Hebrew:** ETCBC BHSA (Biblia Hebraica Stuttgartensia Amstelodamensis)
  - Phonological transcriptions
  - Masoretic vowel points
  - Cantillation marks

## Pack Building

Lexicon data is distributed as SQLite packs for offline use:

### Strongs Pack

```bash
# Build Strong's dictionary pack
node scripts/build-strongs-pack.mjs
```

Outputs: `strongs-greek.pack`, `strongs-hebrew.pack`

### Morphology Pack

```bash
# Build morphology data (per translation)
node scripts/build-morphology-packs.mjs
```

Outputs: `morph-opengnt.pack`, `morph-oshb.pack`, etc.

### Pronunciation Pack

```bash
# Build pronunciation data
node scripts/build-pronunciation-pack.mjs
```

Outputs: `pronunciation-greek.pack`, `pronunciation-hebrew.pack`

## Pack Import

The PWA can import lexicon packs using `importPackFromSQLite`:

```typescript
import { importPackFromSQLite, IndexedDBLexiconStore } from "./adapters";

// Import Strong's dictionary
const strongsFile = await fetch("/packs/strongs-greek.pack");
const strongsBuffer = await strongsFile.arrayBuffer();
await importPackFromSQLite(strongsBuffer);

// Import morphology
const morphFile = await fetch("/packs/morph-opengnt.pack");
const morphBuffer = await morphFile.arrayBuffer();
await importPackFromSQLite(morphBuffer);

// Now lexicon is ready
const lexicon = new IndexedDBLexiconStore();
```

## Future Enhancements

1. **Lexical Relationships**

   - Synonyms and antonyms
   - Word families and cognates
   - Semantic domains

2. **Advanced Parsing**

   - Parsing code explanations
   - Grammar references
   - Syntax diagrams

3. **Etymology**

   - Word origin trees
   - Historical usage
   - Cognates in other languages

4. **Audio Pronunciation**

   - Native speaker recordings
   - Reconstructed ancient pronunciation
   - Multiple pronunciation traditions

5. **Usage Statistics**
   - Testament distribution (OT vs NT)
   - Book-by-book breakdown
   - Temporal usage patterns

## Performance Notes

- **Indexes:** Critical for word lookup performance

  - `strongsId` index enables fast occurrence retrieval
  - `book_chapter_verse_word` enables fast morphology lookup
  - `lemma` index enables dictionary form searches

- **Batch Operations:** Use `batchWriteTransaction` for pack imports

- **Caching:** Consider caching frequently accessed Strong's entries in memory

- **Lazy Loading:** Load pronunciation data on-demand (not critical for basic word study)

## Related Documentation

- [MORPHOLOGY-PACKS-STATUS.md](./MORPHOLOGY-PACKS-STATUS.md) - Build script status
- [CROSS-REFERENCES.md](./CROSS-REFERENCES.md) - Related verse linking
- [USER-DATA.md](./USER-DATA.md) - User annotations
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system design
