# ProjectBible Technical Specification

**Last Updated:** January 25, 2026  
**Schema Version:** v18  
**Pack Standard:** v1.0  

---

## Authority Statement

**This document is the authoritative specification for ProjectBible.**

All architectural decisions, data models, invariants, and constraints defined here are canonical. Do not contradict, revert, or reinterpret anything in this file. All future work must align with this specification unless this file is explicitly updated.

When starting a session, use this command:

```
Use PROJECT_SPEC.md as the authoritative description of the system.
Do not contradict or revert anything documented here.
```

---

## System Vocabulary

These terms have precise, canonical meanings. Do not rename, redefine, or substitute them.

### Core Terms

**pack**  
A SQLite database file (`.sqlite`) containing Bible data (text, lexicon, maps, audio, etc.). Every pack includes a `metadata` table with required fields (`id`, `type`, `version`, `schemaVersion`, `name`).

**manifest**  
A JSON file (`manifest.json`) listing all available packs with download URLs, SHA-256 hashes, sizes, and metadata. Hosted on GitHub Releases CDN, proxied via `/api/packs/manifest.json`.

**bootstrap pack**  
A minimal 208KB SQLite database bundled with the app containing book metadata, chapter counts, and navigation tables. Enables instant startup (<100ms) with zero network requests. Located at `/bootstrap.sqlite`.

**consolidated pack**  
A multi-resource pack combining related data (e.g., `translations.sqlite` contains KJV + WEB + BSB + NET + LXX2012). Optimized for distribution, respects 2GB SQLite mobile limit.

**pack provenance**  
Machine-readable attribution and source manifest pointer embedded in pack metadata. Ensures licensing compliance and traceable data lineage.

### Reading Plans

**BCV reference**  
Book-Chapter-Verse reference. Core type: `{ book: string, chapter: number, verse: number }`. Used throughout the system for verse addressing.

**reading plan overlay**  
User-specific modifications (catch-up adjustments, pauses, completions) stored separately from plan definitions. Enables non-destructive plan customization.

**catchUpAdjustment**  
A temporary overlay stored in `plan_metadata.catchUpAdjustment` that modifies the reading plan schedule without mutating the underlying plan. Contains either `spread` mode (distributes missed chapters across future days) or `dedicated` mode (creates catch-up days).

### Navigation & Search

**translation tree**  
Search results organized hierarchically by translation when multiple translations are searched. Single translation → flat list. Multiple translations → expandable tree with per-translation result counts.

**2-dropdown navigation**  
Current navigation system using two dropdowns: (1) Translation selector, (2) Book/Chapter tree. Replaced earlier 4-dropdown system (Translation → Book → Chapter → Verse).

---

## 1. Purpose & Scope

### What ProjectBible Is

ProjectBible is an **offline-first Bible study platform** with advanced features:

- **Multi-translation reading** (KJV, WEB, BSB, NET, LXX2012, Hebrew, Greek)
- **Word-level study tools** (Strong's lexicons, morphology, IPA pronunciation)
- **Historical maps** (12,606 biblical places, 38 map layers spanning 2000+ years)
- **Reading plans** (whole Bible, NT-only, custom selections, catch-up adjustments)
- **Cross-references** (340k+ curated references with voting system)
- **Audio narration** (BSB audio for all 1,189 chapters, 3.41GB embedded MP3s)
- **Power search** (regex support, translation tree results, English morphology filters)

### What ProjectBible Is Not

- Not a cloud-dependent app (works fully offline after first load)
- Not a proprietary data silo (uses open datasets with explicit licenses)
- Not a single-translation reader (designed for multi-translation comparison)
- Not a mobile-first app (optimized for both desktop and mobile)

### Current State (January 2026)

**Production App:** `apps/pwa-polished` (Svelte 5, deployed to Vercel)  
**Development App:** `apps/pwa` (Vanilla TS, dev tools, pack promotion pipeline)  
**Desktop App:** `apps/electron` (planned, not implemented)  

**Status:** Production-ready with 6 consolidated packs (3.87GB total), instant bootstrap startup, GitHub Releases CDN distribution.

---

## 2. Architecture Overview

### 2.1 Dual PWA Strategy

**apps/pwa** (Development Workbench)
- **Port:** 5173
- **Framework:** Vanilla TypeScript + Vite
- **Purpose:** Development, testing, pack promotion
- **Features:** DevTools panel (bottom-right), pack management UI, IndexedDB stats
- **Build:** `npm run dev:pwa`

**apps/pwa-polished** (Production)
- **Port:** 5174  
- **Framework:** Svelte 5 + Vite
- **Purpose:** Production app with streamlined UX
- **Features:** 2-dropdown navigation, gesture-based mobile UI, no pack management (bundled at build)
- **Build:** `npm run build:polished`
- **Deploy:** Vercel static output to `apps/pwa-polished/dist`

### 2.2 Monorepo Structure

**Root:** npm workspaces (`package.json` defines `apps/*` and `packages/*`)

**packages/core**  
Shared UI + domain logic. Platform-agnostic (no IndexedDB, no filesystem, no browser APIs). Exports: `Reader`, `ReadingPlanEngine`, `BibleMetadata`, `PackLoader`, `SearchConfig`, type definitions.

**packages/packtools**  
CLI tools for building and validating packs. Uses `better-sqlite3` for direct SQLite file creation. Scripts: `build`, `validate`.

**Key Scripts:**
- `scripts/build-all-packs.mjs` - Builds all packs from source data
- `scripts/build-bootstrap-pack.mjs` - Creates 208KB bootstrap pack
- `scripts/build-consolidated-packs.mjs` - Merges packs into 6 bundles
- `scripts/generate-manifest.mjs` - Creates manifest.json for CDN
- `scripts/publish-packs-release.mjs` - Uploads to GitHub Releases

### 2.3 Core Platform Abstraction

**Design Principle** (from [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

> "The core must only speak to platform interfaces. Platform adapters implement those interfaces using either PWA (IndexedDB + Cache API + service worker) or Electron (filesystem + SQLite + worker threads)."

**Interfaces** (defined in [packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):
- `PackManager` - List, install, remove packs
- `TextStore` - Verse retrieval, translation/book listing
- `SearchIndex` - Full-text search, Strong's search
- `LexiconStore` - Strong's entries, morphology, occurrences

**PWA Implementation** ([apps/pwa-polished/src/adapters/db.ts](apps/pwa-polished/src/adapters/db.ts)):
- IndexedDB database: `projectbible` (version 18)
- sql.js WASM for SQLite pack reading
- Single global SQLite worker (no main thread blocking)

### 2.4 Bootstrap → Lazy Loading Pipeline

**Startup Sequence:**

1. **Bootstrap Load** (<100ms)
   - Load 208KB `/bootstrap.sqlite` (bundled with app)
   - Contains: book metadata, chapter counts, navigation tables
   - Enables UI rendering immediately (no network required)

2. **Pack Discovery**
   - Fetch `/api/packs/manifest.json` (proxies to GitHub Releases)
   - Check IndexedDB for already-installed packs
   - Display available packs in UI

3. **Lazy Pack Loading** (on-demand)
   - Download packs as needed (user clicks "Install" or "Download")
   - Stream with progress bars (shows MB downloaded / total)
   - 3-attempt retry with exponential backoff (1s, 2s, 4s)
   - SHA-256 validation before extraction
   - Extract to IndexedDB using sql.js worker

4. **Persistent Storage**
   - Request `navigator.storage.persist()` permission
   - All packs cached in IndexedDB
   - Works fully offline after first load

### 2.5 Single Global SQLite Worker

**Problem Solved:** Earlier versions created multiple WASM instances, blocking main thread during initialization.

**Solution:** Single worker thread manages all SQLite operations.

**Implementation** ([packages/core/src/services/SQLiteWorkerPool.ts](packages/core/src/services/SQLiteWorkerPool.ts)):
- Worker pool with 1 persistent worker
- Message-based API (request/response)
- Main thread never blocks
- 50-70% faster SQLite operations

### 2.6 Vercel Deployment

**Configuration** ([vercel.json](vercel.json)):

```json
{
  "buildCommand": "node scripts/ensure-bundled-packs.mjs && node scripts/build-bootstrap-pack.mjs && NODE_ENV=production npm run build --workspace=@projectbible/core && cd apps/pwa-polished && NODE_ENV=production npm run build",
  "outputDirectory": "apps/pwa-polished/dist",
  "installCommand": "npm install --workspaces=false && npm install --workspace=@projectbible/core && npm install --workspace=@projectbible/pwa-polished",
  "framework": null
}
```

**Build Sequence:**
1. Ensure bundled packs exist (`ensure-bundled-packs.mjs`)
2. Build 208KB bootstrap pack (`build-bootstrap-pack.mjs`)
3. Build `packages/core` library
4. Build `apps/pwa-polished` app
5. Output to `apps/pwa-polished/dist`

**Headers** (automatic via Vercel):
- `Cache-Control: public, max-age=31536000, immutable` (bootstrap pack)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`

**Pack Hosting:**
- Packs hosted on **GitHub Releases** (free CDN, unlimited bandwidth)
- Manifest at `/api/packs/manifest.json` proxies to GitHub
- Vercel only serves app shell + bootstrap pack

### 2.7 Offline-First Behavior

**Service Worker:** VitePWA auto-generates service worker, caches app shell and assets.

**Cache Strategy:**
- App shell: Cache-first
- Bootstrap pack: Cache-first (immutable)
- Pack downloads: Network-first, cache on success
- API calls: Network-only

**IndexedDB Persistence:**
- Database name: `projectbible`
- Current version: 18
- Stores: 40+ object stores (see §3 Data Models)
- Size: 3-5GB typical (with all packs installed)

---

## 3. Data Models

All data models are organized by domain. Each model includes: TypeScript definition, field meanings, invariants, lifecycle rules, and examples.

### 3.1 Packs

#### PackInfo (Installed Pack Metadata)

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface PackInfo {
  id: string;
  version: string;
  type: 'text' | 'lexicon' | 'places' | 'map' | 'cross-references' | 'morphology' | 'audio';
  translationId?: string;       // For text packs only
  translationName?: string;     // For text packs only
  license: string;
  size?: number;                // Bytes
  installedAt?: Date;
  description?: string;
  attribution?: string;
}
```

**Field Meanings:**

- `id` - Unique pack identifier (kebab-case, e.g., `translations.en`)
- `version` - Semantic version (e.g., `1.0.0`)
- `type` - Pack classification (determines which tables/schema to expect)
- `translationId` - Translation code (e.g., `KJV`, `WEB`) - only for text packs
- `translationName` - Human-readable translation name - only for text packs
- `license` - SPDX license identifier or custom license text
- `size` - Pack file size in bytes
- `installedAt` - Installation timestamp
- `description` - Pack description (optional)
- `attribution` - Copyright/attribution text (required for compliance)

**Invariants:**

- Pack `id` must be unique across all installed packs
- Pack `type` determines schema requirements (see [docs/PACK-STANDARD-V1.md](docs/PACK-STANDARD-V1.md))
- Text packs MUST include `translationId` and `translationName`
- All packs MUST include `license` (licensing compliance)

**Lifecycle:**

1. Created during pack installation
2. Stored in IndexedDB `packs` object store
3. Never modified after installation (immutable)
4. Deleted only when pack is uninstalled

**Example:**

```typescript
{
  id: "translations.en",
  version: "1.0.0",
  type: "text",
  translationId: "KJV",
  translationName: "King James Version",
  license: "Public Domain",
  size: 5242880,
  installedAt: new Date("2026-01-20T10:30:00Z"),
  description: "King James Version (1611)",
  attribution: "Public Domain"
}
```

#### DBPack (IndexedDB Storage)

**Type Definition** ([apps/pwa-polished/src/adapters/db.ts](apps/pwa-polished/src/adapters/db.ts)):

```typescript
interface DBPack {
  id: string;
  version: string;
  type: 'text' | 'lexicon' | 'dictionary' | 'places' | 'map' | 'cross-references' | 'morphology' | 'audio' | 'original-language';
  translationId?: string;
  translationName?: string;
  license: string;
  attribution?: string;
  size: number;
  installedAt: number;          // Unix timestamp
  description?: string;
}
```

**Storage Details:**

- Object store: `packs`
- Key path: `id`
- Indexes: `type`, `translationId`

### 3.2 Bible Content

#### Verse

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface Verse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  heading?: string | null;      // Section heading before this verse
}
```

**Field Meanings:**

- `book` - Canonical book name (e.g., `Genesis`, `Romans`, `Revelation`)
- `chapter` - 1-based chapter number
- `verse` - 1-based verse number
- `text` - Verse text (plain text, no markup)
- `heading` - Optional section heading (e.g., "The Creation", "Paul's Greeting")

**Invariants:**

- Book names must match canonical list (66 books)
- Chapter/verse numbers must be valid for the book
- Text is plain text (no HTML, no markdown)
- Headings appear before the verse they describe

**Example:**

```typescript
{
  book: "John",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  heading: null
}
```

#### DBVerse (IndexedDB Storage)

**Type Definition** ([apps/pwa-polished/src/adapters/db.ts](apps/pwa-polished/src/adapters/db.ts)):

```typescript
interface DBVerse {
  id: string;                   // `${translationId}:${book}:${chapter}:${verse}`
  translationId: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  heading?: string | null;
}
```

**Storage Details:**

- Object store: `verses`
- Key path: `id`
- Indexes: `translationId`, `[translationId, book, chapter]` (composite)

**Example:**

```typescript
{
  id: "KJV:John:3:16",
  translationId: "KJV",
  book: "John",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world...",
  heading: null
}
```

### 3.3 User Data

#### UserNote

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface UserNote {
  id: string;
  reference: BCV;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Field Meanings:**

- `id` - Unique note identifier (UUID)
- `reference` - Verse reference (book, chapter, verse)
- `text` - Note content (markdown supported)
- `createdAt` - Creation timestamp
- `updatedAt` - Last modification timestamp

**Invariants:**

- Notes are mutable (can be edited)
- `updatedAt` must be >= `createdAt`
- Multiple notes allowed per verse

**Lifecycle:**

1. Created when user adds note
2. Updated when user edits note
3. Synced to cloud (if sync enabled)
4. Never deleted automatically (user must delete)

#### UserHighlight

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface UserHighlight {
  id: string;
  reference: BCV;
  color: string;                // Hex color code
  createdAt: Date;
}
```

**Field Meanings:**

- `id` - Unique highlight identifier (UUID)
- `reference` - Verse reference
- `color` - Highlight color (hex format, e.g., `#ffeb3b`)
- `createdAt` - Creation timestamp

**Invariants:**

- One highlight per verse (updating changes color)
- Color must be valid hex code
- Common colors: `#ffeb3b` (yellow), `#4caf50` (green), `#2196f3` (blue), `#e91e63` (pink), `#ff9800` (orange)

#### UserBookmark

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface UserBookmark {
  id: string;
  reference: BCV;
  label?: string;
  createdAt: Date;
}
```

**Special Bookmark:**

The reading position feature uses a special bookmark with key `reading-position`. This bookmark tracks where the user last read and is automatically updated.

### 3.4 Reading Plans

#### ReadingProgressEntry (with catchUpAdjustment)

**Type Definition** ([apps/pwa-polished/src/stores/ReadingProgressStore.ts](apps/pwa-polished/src/stores/ReadingProgressStore.ts)):

```typescript
interface ReadingProgressEntry {
  id: string;                   // "planId-dayNumber"
  planId: string;
  dayNumber: number;
  completed: boolean;
  createdAt: number;            // Unix timestamp
  completedAt?: number;         // Unix timestamp
  startedReadingAt?: number;    // Unix timestamp
  chaptersRead: ChapterProgress[];
  catchUpAdjustment?: CatchUpAdjustment;
}

interface ChapterProgress {
  book: string;
  chapter: number;
  actions: ChapterAction[];
}

interface ChapterAction {
  type: "checked" | "unchecked";
  timestamp: number;            // Unix timestamp
}

interface CatchUpAdjustment {
  originalDayNumber: number;
  addedChapters: Array<{ book: string; chapter: number }>;
}
```

**Field Meanings:**

- `id` - Composite key: `${planId}-${dayNumber}`
- `planId` - Reading plan identifier
- `dayNumber` - Day number in plan (1-based)
- `completed` - Whether all chapters for this day are checked
- `createdAt` - When progress entry was created
- `completedAt` - When all chapters were marked complete
- `startedReadingAt` - When user first started reading this day
- `chaptersRead` - Array of chapters with check/uncheck history
- `catchUpAdjustment` - **OVERLAY** applied to this day (see invariants below)

**Invariants (Critical - Do Not Change):**

1. **catchUpAdjustment is an overlay, not a mutation**
   - Stored in `ReadingProgressEntry.catchUpAdjustment`
   - Does NOT modify the underlying reading plan
   - Can be removed without altering plan history
   - Contains added chapters from missed days (spread mode)

2. **ChapterProgress is append-only**
   - Actions are never deleted, only appended
   - Latest action determines current state (checked/unchecked)
   - Enables full history replay

3. **Completion is computed, not set**
   - `completed` is recomputed after every chapter action
   - `completedAt` is set when all chapters become checked
   - If any chapter becomes unchecked, `completed` becomes `false` and `completedAt` is cleared

**Lifecycle:**

1. Created when user first views a day in the plan
2. Updated when user checks/unchecks chapters
3. `catchUpAdjustment` added when user falls behind and chooses "spread" catch-up mode
4. Synced to cloud (if enabled)
5. Never deleted (even after plan completion)

**Example (with catchUpAdjustment):**

```typescript
{
  id: "whole-bible-2026-15",
  planId: "whole-bible-2026",
  dayNumber: 15,
  completed: false,
  createdAt: 1706140800000,
  chaptersRead: [
    {
      book: "Genesis",
      chapter: 15,
      actions: [
        { type: "checked", timestamp: 1706140900000 }
      ]
    },
    {
      book: "Genesis",
      chapter: 16,
      actions: [
        { type: "checked", timestamp: 1706141000000 },
        { type: "unchecked", timestamp: 1706141100000 }  // Latest = unchecked
      ]
    },
    // Catch-up chapters added via overlay
    {
      book: "Genesis",
      chapter: 10,  // Missed from day 12
      actions: []   // Not yet read
    }
  ],
  catchUpAdjustment: {
    originalDayNumber: 12,
    addedChapters: [
      { book: "Genesis", chapter: 10 }
    ]
  }
}
```

#### DBReadingProgressEntry (IndexedDB Storage)

**Type Definition** ([apps/pwa-polished/src/adapters/db.ts](apps/pwa-polished/src/adapters/db.ts)):

```typescript
interface DBReadingProgressEntry {
  id: string;                   // "planId-dayNumber"
  planId: string;
  dayNumber: number;
  completed: number;            // 0 or 1 (SQLite boolean)
  createdAt: number;
  completedAt?: number;
  startedReadingAt?: number;
  chaptersRead: string;         // JSON string of ChapterProgress[]
  catchUpAdjustment?: string;   // JSON string of CatchUpAdjustment
}
```

**Storage Details:**

- Object store: `reading_progress`
- Key path: `id`
- Indexes: `planId`, `[planId, dayNumber]` (composite)

### 3.5 Geography

#### PlaceInfo

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface PlaceInfo {
  id: string;
  name: string;
  altNames?: string[];
  
  // Location
  latitude?: number;
  longitude?: number;
  modernCity?: string;
  modernCountry?: string;
  region?: string;              // Biblical region (Judea, Galilee, etc.)
  
  // Historical context
  historicalNames?: PlaceHistoricalName[];
  appearances?: PlaceAppearance[];
  
  // Biblical references
  verses?: BCV[];
  firstMention?: BCV;
  significance?: string;
  
  // Related entities
  events?: string[];
  people?: string[];
  
  // Additional data
  type?: 'city' | 'region' | 'mountain' | 'river' | 'sea' | 'wilderness' | 'country';
  elevation?: number;
  description?: string;
}
```

**Data Source:**

- **Pleiades** ancient places gazetteer (open data)
- 41,480 total places → filtered to 12,606 biblical region
- Geographic bounds: 20-50°E, 20-42°N
- Archaeological-grade coordinates

**Verse Linking:**

- 2,047 verses linked to 153 unique places
- Intelligent place name matching with false positive filtering
- Filters out survey areas, common words, uncertain names

**Top Linked Places:**

- Babylon: 260 verses
- Jordan River: 180 verses
- Moab: 160 verses
- Samaria: 116 verses
- Assyria: 115 verses

### 3.6 Audio

#### DBPackAudioChapter (IndexedDB Storage)

**Type Definition** ([apps/pwa-polished/src/adapters/db.ts](apps/pwa-polished/src/adapters/db.ts)):

```typescript
interface DBPackAudioChapter {
  id: string;                   // `${translationId}:${book}:${chapter}`
  translationId: string;
  book: string;
  chapter: number;
  filePath: string;             // Relative path to audio file
  format: string;               // 'mp3', 'webm', 'ogg'
}
```

**Audio Packs:**

- **bsb-audio-pt1.sqlite** (1.76 GB) - Genesis–Psalms (628 chapters)
- **bsb-audio-pt2.sqlite** (1.65 GB) - Proverbs–Revelation (549 chapters)
- Total: 3.41 GB, 1,177 chapters
- Format: MP3 embedded as BLOBs in pack
- Narration: Berean Study Bible audio

**Storage Details:**

- Object store: `audio_chapters`
- Key path: `id`
- Indexes: `translationId`, `[translationId, book]` (composite)

### 3.7 Lexical Resources

#### StrongEntry

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface StrongEntry {
  id: string;                   // e.g., "G25" or "H1"
  lemma: string;                // Original language word
  transliteration?: string;     // Romanized form
  pronunciation?: Pronunciation;
  definition: string;
  shortDefinition?: string;
  partOfSpeech: string;         // noun, verb, adjective, etc.
  language: 'greek' | 'hebrew' | 'aramaic';
  derivation?: string;          // Etymology
  kjvUsage?: string;            // How KJV translates it
  occurrences?: number;         // Times used in Bible
}

interface Pronunciation {
  ipa?: string;                 // International Phonetic Alphabet
  phonetic?: string;            // Simplified phonetic
  audioUrl?: string;
  syllables?: string[];
  stress?: number;              // Which syllable is stressed (0-indexed)
}
```

**Lexical Pack Contents:**

- Greek Strong's: 5,624 entries
- Hebrew Strong's: 8,674 entries
- English words: 470k+ with IPA pronunciation
- Thesaurus: 1.1M+ synonym/antonym pairs

#### MorphologyInfo

**Type Definition** ([packages/core/src/interfaces.ts](packages/core/src/interfaces.ts)):

```typescript
interface MorphologyInfo {
  word: string;                 // Actual word form
  lemma: string;                // Dictionary form
  strongsId?: string;
  parsing: MorphologyParsing;
  gloss?: string;               // English gloss
  language: 'greek' | 'hebrew' | 'aramaic';
}

interface MorphologyParsing {
  pos: string;                  // Part of speech (detailed)
  person?: '1' | '2' | '3';
  number?: 'singular' | 'plural';
  gender?: 'masculine' | 'feminine' | 'neuter';
  case?: 'nominative' | 'genitive' | 'dative' | 'accusative' | 'vocative';
  tense?: 'present' | 'imperfect' | 'future' | 'aorist' | 'perfect' | 'pluperfect';
  voice?: 'active' | 'middle' | 'passive';
  mood?: 'indicative' | 'subjunctive' | 'optative' | 'imperative' | 'infinitive' | 'participle';
  state?: 'absolute' | 'construct';  // Hebrew
  stem?: string;                     // Hebrew verb stems (Qal, Piel, Hiphil, etc.)
}
```

**Ancient Languages Pack:**

- Hebrew OT (OSHB): 305,507 word entries with morphology
- Greek NT (Byzantine, Textus Receptus)
- Greek LXX (Septuagint)

---

## 4. Features (Canonical Behavior)

This section describes how the system **currently works**, not how it was originally planned or might work in the future.

### 4.1 Navigation System

**Current Implementation:** 2-dropdown system (streamlined from earlier 4-dropdown)

**Components:**

1. **Translation Dropdown**
   - Lists all installed translations
   - Shows translation abbreviation (KJV, WEB, BSB, etc.)
   - Remembers last selection

2. **Book/Chapter Tree Dropdown**
   - Displays all 66 books in canonical order
   - Clicking book expands to show chapters in grid layout
   - Clicking chapter navigates to that chapter (always verse 1)
   - Tree-style navigation matches mental model

**User Flow:**

1. Select translation → persists in localStorage
2. Click reference dropdown → tree of books
3. Click book → expands chapters in grid
4. Click chapter → navigates to chapter
5. No verse dropdown (always starts at verse 1)

**Mobile Gestures:**

- Swipe right → previous chapter
- Swipe left → next chapter
- Auto-scroll to top on chapter change

**Implementation Reference:** [docs/NAVIGATION-IMPLEMENTATION.md](docs/NAVIGATION-IMPLEMENTATION.md)

### 4.2 Consolidated Packs System

**Current Pack Structure:** 6 consolidated packs (total: 3.87 GB)

1. **translations.sqlite** (33.69 MB)
   - KJV, WEB, BSB, NET, LXX2012
   - 152,682 verses total
   - Multi-translation schema (see Pack Standard v1.0)

2. **ancient-languages.sqlite** (67 MB)
   - Hebrew OT (OSHB with morphology)
   - Greek NT (Byzantine, Textus Receptus)
   - Greek LXX (Septuagint)
   - 305,507 Hebrew word entries with parsing

3. **lexical.sqlite** (365.32 MB)
   - Greek Strong's: 5,624 entries
   - Hebrew Strong's: 8,674 entries
   - English words: 470k+ with IPA
   - Thesaurus: 1.1M+ synonym/antonym pairs
   - English grammar POS data

4. **study-tools.sqlite** (3.57 MB)
   - Maps, cross-references, chronology
   - 340k+ cross-references
   - 31,102 chronological verses
   - Geographic data

5. **bsb-audio-pt1.sqlite** (1.76 GB)
   - Genesis–Psalms (628 chapters)
   - MP3 BLOBs embedded

6. **bsb-audio-pt2.sqlite** (1.65 GB)
   - Proverbs–Revelation (549 chapters)
   - MP3 BLOBs embedded

**Pack Loading Strategy:**

- Bootstrap pack (208KB) loads instantly on startup
- Other packs load on-demand when feature is accessed
- Progress bars show download status
- All packs cached in IndexedDB for offline use

**Implementation Reference:** [docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md](docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md)

### 4.3 Reading Plans with Catch-Up Adjustments

**Plan Types:**

- Whole Bible (365 days, ~3 chapters/day)
- NT only (90 days)
- Custom book selections
- Multipliers (read Psalms 3x)
- Excluded weekdays (skip Sundays)
- Chronological ordering

**Catch-Up Adjustment System:**

**Problem:** User falls behind on reading plan.

**Solution:** Two catch-up modes (user chooses):

1. **Spread Mode** (default)
   - Distributes missed chapters across future days
   - Creates `catchUpAdjustment` overlay on future days
   - Does NOT mutate plan definition
   - Overlay contains: `originalDayNumber`, `addedChapters`

2. **Dedicated Mode**
   - Creates dedicated catch-up days
   - Inserts new days into plan (still as overlay)
   - User can complete catch-up days separately

**Invariant (Critical):**

> catchUpAdjustment is stored in `plan_metadata.catchUpAdjustment` and `reading_progress.catchUpAdjustment`. It must never mutate the underlying reading plan. It must be removable without altering plan history.

**Progress Tracking:**

- Each day stored in `reading_progress` object store
- Append-only chapter actions (checked/unchecked)
- Latest action determines current state
- Full history replay possible

**Plan Lifecycle:**

1. Created (stored in `reading_plans` and `plan_metadata`)
2. Activated (sets `plan_metadata.activatedAt`)
3. In progress (updates `reading_progress` daily)
4. Paused (sets `plan_metadata.pausedAt`)
5. Completed (sets `plan_metadata.completedAt`)
6. Archived (sets `plan_metadata.archivedAt`)

**Implementation Reference:** [docs/READING-PLANS.md](docs/READING-PLANS.md)

### 4.4 Translation Tree Search

**Search Modes:**

1. **Single Translation Search**
   - Returns flat list of results
   - Format: "John 3:16 - For God so loved the world..."
   - Up to 100 results (expandable to 1,000, then unlimited)

2. **Multiple Translation Search**
   - Returns translation tree (hierarchical)
   - Format: "KJV (45) WEB (52) BSB (48)"
   - Click translation → expands to show results
   - Result caps: 100 → 1,000 → unlimited per translation

**Regex Safety:**

- Volume estimation prevents catastrophic searches
- Detects ultra-common words ("the", "and", "a")
- Complexity scoring (0-100)
- Orange warning banners for dangerous patterns
- Warns: "This pattern might match 10,000+ verses"

**English Morphology Filters (Placeholder):**

- Ready for dictionary pack integration
- Filters: noun/verb/adjective/adverb
- Tense: present/past/future
- Number: singular/plural
- Not yet implemented (awaiting English morphology pack)

**Implementation Reference:** [docs/POWER-SEARCH-SESSION-2026-01-15.md](docs/POWER-SEARCH-SESSION-2026-01-15.md)

### 4.5 Historical Maps

**Map System:**

- Interactive Leaflet maps
- 12,606 biblical places (Pleiades dataset)
- 2,330 verse-place correlations
- 38 historical map layers

**Map Layers (11 historical periods):**

1. Patriarchs (2000-1500 BC)
2. Exodus & Conquest (1500-1200 BC)
3. Judges (1200-1050 BC)
4. United Kingdom (1050-930 BC)
5. Divided Kingdom (930-722 BC)
6. Exile (722-539 BC)
7. Persian Period (539-332 BC)
8. Greek Period (332-63 BC)
9. Roman Period (63 BC - 135 AD)
10. Early Church (30-100 AD)
11. Modern (present day)

**Journey Routes:**

- Exodus route (Egypt → Sinai → Canaan)
- Paul's missionary journeys (1st, 2nd, 3rd)
- Jesus in Galilee

**Points of Interest:**

- 10 POIs with events (Jerusalem, Bethlehem, Nazareth, etc.)
- Click place name in text → show on map
- Click map marker → show verse references

**Implementation Reference:** [docs/ENHANCED-MAPS-SUMMARY.md](docs/ENHANCED-MAPS-SUMMARY.md)

### 4.6 Cross-References

**Data:**

- 340k+ curated cross-references
- Bidirectional links (A→B also shows B→A)
- Vote system (upvote/downvote)
- User-created references
- AI-suggested references (planned)

**Categories:**

- Creation (Genesis 1 ↔ John 1)
- Salvation (John 3:16 ↔ Romans 5:8)
- Messianic prophecies (Isaiah ↔ Gospels)
- Law and grace (Deuteronomy ↔ Matthew)
- Resurrection (Psalms ↔ 1 Corinthians)
- New covenant (Jeremiah ↔ Hebrews)
- Second coming (Daniel ↔ Revelation)

**API:**

```typescript
// Get references FROM John 3:16
const refs = await store.getCrossReferences({
  book: "John", chapter: 3, verse: 16
});

// Get references TO John 3:16
const backRefs = await store.getReferencesToVerse({
  book: "John", chapter: 3, verse: 16
});
```

**Implementation Reference:** [docs/CROSS-REFERENCES-IMPLEMENTATION.md](docs/CROSS-REFERENCES-IMPLEMENTATION.md)

### 4.7 Word Study Tools

**Features:**

- Tap word → morphology lookup
- Strong's dictionary integration
- Greek/Hebrew lexicon
- English word pronunciation (IPA)
- Thesaurus integration
- Word occurrence tracking

**Word Menu Actions:**

1. **Definition** - Show Strong's entry with short/long definitions
2. **Occurrences** - List all verses using this word
3. **Lemma** - Show dictionary form (lemma)
4. **Original Language** - Show Hebrew/Greek word
5. **Morphology** - Show parsing (person, number, gender, case, tense, voice, mood)
6. **Pronunciation** - Show IPA pronunciation with audio (planned)

**Morphological Data:**

- Part of speech (noun, verb, etc.)
- Person (1st, 2nd, 3rd)
- Number (singular, plural)
- Gender (masculine, feminine, neuter)
- Case (nominative, genitive, dative, accusative)
- Tense (present, aorist, perfect, etc.)
- Voice (active, passive, middle)
- Mood (indicative, subjunctive, imperative)
- Hebrew: state (absolute, construct), stem (Qal, Piel, Hiphil)

**Implementation Reference:** [docs/LEXICON.md](docs/LEXICON.md)

---

## 5. Constraints & Decisions

These invariants are permanent unless explicitly changed in this file. They are ordered by criticality.

### 5.1 Data Integrity Invariants

#### Invariant: Reading history is append-only

**Do Not Change:**

- `reading_history` object store is append-only
- Chapter actions are never deleted, only appended
- Latest action determines current state (checked/unchecked)
- Enables full history replay and undo functionality
- Deletion would break sync and audit trail

#### Invariant: catchUpAdjustment is an overlay, not a mutation

**Do Not Change:**

- `catchUpAdjustment` is stored in `plan_metadata.catchUpAdjustment`
- It must never mutate the underlying reading plan
- It must be removable without altering plan history
- Contains only added chapters (spread mode) or dedicated days
- Stored separately from plan definition to preserve plan integrity

#### Invariant: Parser must not mutate packs

**Do Not Change:**

- Pack files (`.sqlite`) are read-only after installation
- SQLite queries use `SELECT` only, never `INSERT`/`UPDATE`/`DELETE`
- Packs can be shared across devices without corruption risk
- Enables safe caching and CDN distribution
- Modifications would break SHA-256 validation

#### Invariant: Pack provenance is required

**Do Not Change:**

- Every pack must include `license` field in metadata
- Every pack must include `attribution` field (if not public domain)
- Enables licensing compliance and traceable data lineage
- Protects against copyright violations
- Required for legal distribution

### 5.2 Storage & Performance Invariants

#### Invariant: 2GB SQLite pack size limit

**Do Not Change:**

- Maximum pack size: 2GB (mobile compatibility)
- Larger datasets must be split into multiple packs
- Example: BSB audio split into pt1 (1.76GB) + pt2 (1.65GB)
- SQLite on some mobile browsers crashes above 2GB
- Constraint applies to individual pack files, not total storage

#### Invariant: 208KB bootstrap pack for instant startup

**Do Not Change:**

- Bootstrap pack must remain under 250KB (target: 208KB)
- Contains only: book metadata, chapter counts, navigation tables
- Bundled with app, no network required
- Enables UI rendering in <100ms
- Larger bootstrap would delay startup and increase app bundle size

#### Invariant: Lazy pack loading pipeline

**Do Not Change:**

- Packs are loaded on-demand, not all-at-once
- Bootstrap loads first (instant), other packs load when needed
- Progress bars show download status
- 3-attempt retry with exponential backoff (1s, 2s, 4s)
- SHA-256 validation before extraction
- Changing to eager loading would block startup and consume bandwidth

#### Invariant: Single global SQLite worker

**Do Not Change:**

- Only one SQLite WASM instance per app
- All queries route through single worker thread
- Main thread never blocked by SQLite operations
- Multiple workers would waste memory and slow initialization
- Worker pool pattern with 1 worker is optimal

### 5.3 Deployment Invariants

#### Invariant: GitHub Releases CDN for packs

**Do Not Change:**

- Packs hosted on GitHub Releases (free CDN, unlimited bandwidth)
- Manifest at `/api/packs/manifest.json` proxies to GitHub
- Vercel only serves app shell + bootstrap pack
- Alternative CDNs (S3, Cloudflare) would incur costs
- GitHub Releases provides free, reliable, global CDN

#### Invariant: IndexedDB schema version 18

**Do Not Change:**

- Current schema version: 18
- Schema migrations must increment version number
- Backward-incompatible changes require migration logic
- Downgrades not supported (would corrupt user data)
- Version 18 includes all current object stores and indexes

#### Invariant: Vercel static output deployment

**Do Not Change:**

- Build output: `apps/pwa-polished/dist`
- Framework: none (static HTML/CSS/JS)
- No server-side rendering (SSR)
- No serverless functions except `/api/packs/[name].ts` proxy
- Changing to SSR would break offline-first behavior

### 5.4 Pack Standard Invariants

#### Invariant: Pack metadata table is required

**Do Not Change:**

- Every pack must contain `metadata` table
- Required fields: `id`, `type`, `version`, `schemaVersion`, `name`
- Optional fields: `description`, `language`, `license`, `attribution`, `minAppVersion`
- Packs without metadata table are invalid and rejected
- See [docs/PACK-STANDARD-V1.md](docs/PACK-STANDARD-V1.md) for full specification

#### Invariant: Multi-translation packs use translations table

**Do Not Change:**

- Consolidated text packs must include `translations` table
- Importer reads `translations` table to enumerate all translations
- Creates one `PackInfo` entry per translation
- Imports verses from `verses` table using `translationId` column
- Single-translation packs do not need `translations` table
- See Pack Standard v1.0 §4.1 for schema

---

## 6. TODOs / Future Work

This section is the **only place** where future planning and experimentation is allowed. Everything outside this section is locked.

### 6.1 Planned Features

**Electron Desktop App**
- Native filesystem access (no IndexedDB)
- Native SQLite (better-sqlite3, no WASM overhead)
- Full offline mode (no browser cache limits)
- Status: Directory exists (`apps/electron`), not implemented

**Sync System (Supabase)**
- User data sync (notes, highlights, bookmarks, reading plans)
- Cross-device synchronization
- Conflict resolution (last-write-wins)
- Status: Service implemented (`services/SyncService.ts`), not enabled in UI

**English Morphology Filters**
- Search by part of speech (noun, verb, adjective, adverb)
- Search by tense (present, past, future)
- Search by number (singular, plural)
- Requires English morphology pack (not yet built)
- Status: UI placeholder exists in search config, awaiting pack

**AI-Suggested Cross-References**
- GPT-powered cross-reference suggestions
- User voting system (upvote/downvote)
- Quality filtering (only show high-confidence suggestions)
- Status: Not started, awaiting API integration

**Time-Slider Maps**
- MVP: present-day map + Bible places + "Open in Google Maps/Earth"
- Phase 2: Time slider with 3-5 snapshot layers
- Ancient/BC: CC BY gazetteer + curated polygons labeled "approximate"
- 1500+ CE: OpenHistoricalMap time-tagged boundaries
- Status: MVP complete, time slider not implemented

**IPA Pronunciation Audio**
- Audio files for Hebrew/Greek pronunciations
- Embedded in lexical pack or streamed from CDN
- Status: IPA text exists, audio files not generated

### 6.2 Performance Optimizations

**Bundle Size Reduction**
- Analyze Vite bundle (currently ~2MB)
- Tree-shake unused dependencies
- Code-split large libraries (Leaflet, sql.js)
- Target: <1MB initial bundle

**IndexedDB Query Optimization**
- Add composite indexes for common queries
- Batch reads for chapter loading
- Use cursors for large result sets
- Profile IndexedDB performance with DevTools

**Service Worker Caching**
- Pre-cache critical assets
- Runtime cache for pack downloads
- Stale-while-revalidate for API calls

### 6.3 Open Questions

**Should we support custom pack URLs?**
- Allow users to load packs from arbitrary URLs
- Security concern: malicious packs could inject scripts
- Mitigation: SHA-256 validation, sandboxed pack parsing

**Should we support pack updates?**
- Currently packs are immutable after installation
- Update flow: download new version, migrate user data, delete old
- Complexity: versioning, migration scripts, rollback

**Should we support pack uninstallation?**
- Currently packs can be deleted from UI
- Concern: orphaned data in other object stores
- Mitigation: cascade delete, foreign key constraints (not supported in IndexedDB)

---

## 7. Further Reading

For detailed implementation guides, see these documents:

### Architecture & Design

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture, platform abstraction, core interfaces
- [docs/PACK-STANDARD-V1.md](docs/PACK-STANDARD-V1.md) - Pack format specification, type-specific schemas
- [docs/PACK-SYSTEM-IMPLEMENTATION.md](docs/PACK-SYSTEM-IMPLEMENTATION.md) - Pack loading, validation, importer contracts

### Performance & Optimization

- [OPTIMIZATION-IMPLEMENTATION-COMPLETE.md](OPTIMIZATION-IMPLEMENTATION-COMPLETE.md) - Bootstrap system, SQLite worker, lazy loading, deployment
- [docs/PERFORMANCE-OPTIMIZATION.md](docs/PERFORMANCE-OPTIMIZATION.md) - Performance profiling, optimization strategies
- [docs/OPTIMIZATION-QUICK-REF.md](docs/OPTIMIZATION-QUICK-REF.md) - Quick reference for common optimizations

### Features

- [docs/NAVIGATION-IMPLEMENTATION.md](docs/NAVIGATION-IMPLEMENTATION.md) - 2-dropdown navigation system
- [docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md](docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md) - 6 consolidated packs, multi-translation schema
- [docs/READING-PLANS.md](docs/READING-PLANS.md) - Reading plan engine, catch-up adjustments, progress tracking
- [docs/CROSS-REFERENCES-IMPLEMENTATION.md](docs/CROSS-REFERENCES-IMPLEMENTATION.md) - Cross-reference system, voting, user-created refs
- [docs/LEXICON.md](docs/LEXICON.md) - Strong's lexicons, morphology, word occurrences
- [docs/ENHANCED-MAPS-SUMMARY.md](docs/ENHANCED-MAPS-SUMMARY.md) - Historical maps, Pleiades integration, journey routes
- [docs/POWER-SEARCH-SESSION-2026-01-15.md](docs/POWER-SEARCH-SESSION-2026-01-15.md) - Translation tree search, regex safety, morphology filters

### Data & Storage

- [docs/USER-DATA.md](docs/USER-DATA.md) - Notes, highlights, bookmarks, reading position
- [docs/READING-HISTORY.md](docs/READING-HISTORY.md) - Reading history tracking, append-only model
- [docs/OFFLINE-MAP-TILES.md](docs/OFFLINE-MAP-TILES.md) - Offline map tile storage, caching strategy

### Development

- [docs/DEV.md](docs/DEV.md) - Development setup, running locally, building packs
- [docs/QUICKSTART.md](docs/QUICKSTART.md) - Quick start guide for developers
- [docs/VERCEL-DEPLOYMENT.md](docs/VERCEL-DEPLOYMENT.md) - Vercel deployment, environment variables, build configuration
- [docs/PACK-MANAGEMENT.md](docs/PACK-MANAGEMENT.md) - Pack promotion pipeline, workbench → polished flow

### Integration Guides

- [docs/ENGLISH-LEXICAL-INTEGRATION.md](docs/ENGLISH-LEXICAL-INTEGRATION.md) - English word integration, IPA pronunciation
- [docs/DICTIONARY-PACK-IMPLEMENTATION.md](docs/DICTIONARY-PACK-IMPLEMENTATION.md) - Dictionary pack format, English morphology
- [docs/SWORD-INTEGRATION.md](docs/SWORD-INTEGRATION.md) - SWORD module compatibility (planned)

---

**End of Specification**

For questions or clarifications, refer to the appropriate document in §7 Further Reading or update this specification with explicit decisions.
