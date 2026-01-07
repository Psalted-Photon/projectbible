# Cross-References Implementation Guide

Complete documentation for the cross-reference system backend implementation.

## Overview

The cross-reference system allows linking related Bible verses together. Users can discover connected passages, see prophecy fulfillments, find parallel accounts, and explore thematic connections.

## Architecture

**Core Interface**: `CrossReferenceStore` in `packages/core/src/interfaces.ts`  
**PWA Implementation**: `IndexedDBCrossReferenceStore` in `apps/pwa/src/adapters/CrossReferenceStore.ts`  
**Database**: IndexedDB store `cross_references` with indexes  
**Pack Builder**: `scripts/build-cross-references.mjs`

## Quick Start

```typescript
import { IndexedDBCrossReferenceStore } from "./adapters";

const store = new IndexedDBCrossReferenceStore();

// Get all cross-references FROM John 3:16
const refs = await store.getCrossReferences({
  book: "John",
  chapter: 3,
  verse: 16,
});

// Get all cross-references TO John 3:16
const backRefs = await store.getReferencesToVerse({
  book: "John",
  chapter: 3,
  verse: 16,
});
```

## API Reference

### getCrossReferences(reference: BCV)

Returns all cross-references originating FROM the specified verse.

**Parameters:**

- `reference`: The source verse { book, chapter, verse }

**Returns:** `Promise<CrossReference[]>` sorted by votes (highest first)

**Example:**

```typescript
const refs = await store.getCrossReferences({
  book: "Genesis",
  chapter: 1,
  verse: 1,
});
// Returns references from Gen 1:1 to John 1:1, etc.
```

### getReferencesToVerse(reference: BCV)

Returns all cross-references pointing TO the specified verse.

**Parameters:**

- `reference`: The target verse { book, chapter, verse }

**Returns:** `Promise<CrossReference[]>` sorted by votes

**Example:**

```typescript
const backRefs = await store.getReferencesToVerse({
  book: "Isaiah",
  chapter: 53,
  verse: 5,
});
// Returns verses that reference Isaiah 53:5 (e.g., 1 Peter 2:24)
```

### saveCrossReference(crossRef)

Create a new cross-reference (typically user-created).

**Parameters:**

- `crossRef`: CrossReference without id
  - `from`: BCV (source verse)
  - `to`: { book, chapter, verseStart, verseEnd? }
  - `description`: Optional explanation
  - `source`: 'user' | 'curated' | 'ai'
  - `votes`: Optional initial vote count

**Returns:** `Promise<CrossReference>` with generated id

**Example:**

```typescript
const ref = await store.saveCrossReference({
  from: { book: "Psalms", chapter: 23, verse: 1 },
  to: {
    book: "John",
    chapter: 10,
    verseStart: 11,
  },
  description: "The Good Shepherd theme",
  source: "user",
  votes: 0,
});
```

### deleteCrossReference(id)

Remove a cross-reference by ID.

**Parameters:**

- `id`: The cross-reference ID to delete

**Returns:** `Promise<void>`

**Example:**

```typescript
await store.deleteCrossReference("abc123");
```

### voteCrossReference(id, delta)

Vote on a cross-reference's relevance.

**Parameters:**

- `id`: The cross-reference ID
- `delta`: +1 for upvote, -1 for downvote

**Returns:** `Promise<void>`

**Example:**

```typescript
// Upvote
await store.voteCrossReference(refId, 1);

// Downvote
await store.voteCrossReference(refId, -1);
```

## Data Model

```typescript
interface CrossReference {
  id: string;
  from: BCV;
  to: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd?: number; // For ranges like "Luke 6:20-23"
  };
  description?: string;
  source: "curated" | "user" | "ai";
  votes?: number;
}
```

## Building Packs

Generate a cross-references pack:

```bash
node scripts/build-cross-references.mjs
```

This creates `packs/cross-references.sqlite` with:

- 75+ curated cross-references
- Bidirectional links (auto-creates reverse references)
- Descriptions for each connection
- SQLite schema compatible with pack import

**Curated Categories:**

- Creation (Genesis 1 ↔ John 1)
- Salvation (John 3:16 ↔ Romans 5:8)
- Messianic prophecies (Isaiah ↔ Gospels)
- Law and grace (Deuteronomy ↔ Matthew)
- Resurrection (Psalms ↔ 1 Corinthians)
- New covenant (Jeremiah ↔ Hebrews)
- Second coming (Daniel ↔ Revelation)

## Importing Packs

Cross-reference packs import like other packs, but extract to the cross_references store:

```typescript
import { importPackFromSQLite } from "./adapters";

// After user selects cross-references.sqlite
await importPackFromSQLite(file);
```

**Note:** The pack import logic needs to be updated to recognize and handle cross-reference packs. This involves:

1. Detecting pack type from metadata
2. Reading from `cross_references` table
3. Storing in IndexedDB `cross_references` store

## IndexedDB Schema

**Store:** `cross_references`  
**Key path:** `id`

**Indexes:**

- `from_verse`: [fromBook, fromChapter, fromVerse] - Find refs FROM a verse
- `to_verse`: [toBook, toChapter, toVerseStart] - Find refs TO a verse
- `source`: source - Filter by source type

**Record structure:**

```typescript
{
  id: string;
  fromBook: string;
  fromChapter: number;
  fromVerse: number;
  toBook: string;
  toChapter: number;
  toVerseStart: number;
  toVerseEnd?: number;
  description?: string;
  source: 'curated' | 'user' | 'ai';
  votes: number;
}
```

## Integration Example

Complete example showing verse display with cross-references:

```typescript
import { IndexedDBTextStore, IndexedDBCrossReferenceStore } from "./adapters";

const textStore = new IndexedDBTextStore();
const crossRefStore = new IndexedDBCrossReferenceStore();

async function showVerseWithCrossRefs(
  book: string,
  chapter: number,
  verse: number
) {
  const ref = { book, chapter, verse };

  // Get verse text
  const text = await textStore.getVerse("KJV", book, chapter, verse);

  console.log(`${book} ${chapter}:${verse}`);
  console.log(`"${text}"`);
  console.log();

  // Get cross-references FROM this verse
  const refsFrom = await crossRefStore.getCrossReferences(ref);

  if (refsFrom.length > 0) {
    console.log("📖 See also:");
    for (const xref of refsFrom) {
      const to = xref.to;
      const range = to.verseEnd
        ? `${to.verseStart}-${to.verseEnd}`
        : `${to.verseStart}`;

      console.log(`  → ${to.book} ${to.chapter}:${range}`);
      if (xref.description) {
        console.log(`    "${xref.description}"`);
      }
      if (xref.votes && xref.votes > 0) {
        console.log(`    ↑${xref.votes} votes`);
      }
    }
  }

  // Get cross-references TO this verse
  const refsTo = await crossRefStore.getReferencesToVerse(ref);

  if (refsTo.length > 0) {
    console.log();
    console.log("📌 Referenced by:");
    for (const xref of refsTo) {
      const from = xref.from;
      console.log(`  ← ${from.book} ${from.chapter}:${from.verse}`);
    }
  }
}

// Example: John 3:16 with all its connections
await showVerseWithCrossRefs("John", 3, 16);
```

**Sample Output:**

```
John 3:16
"For God so loved the world, that he gave his only begotten Son..."

📖 See also:
  → Romans 5:8
    "God demonstrates his love"
    ↑12 votes
  → 1 John 4:9
    "God sent his Son"
    ↑8 votes
  → 1 John 4:10
    "Propitiation for sins"
    ↑5 votes

📌 Referenced by:
  ← Romans 5:8
  ← Ephesians 2:8-9
```

## Next Steps (Implementation)

To complete the cross-reference system:

1. **Update pack import** to handle cross-reference packs
2. **Build initial pack** with curated references
3. **Add UI** to display cross-references in reader
4. **Add creation UI** for user-generated references
5. **Implement voting UI** with up/down buttons
6. **Add filtering** by source type

## Testing

```bash
# Build the pack
node scripts/build-cross-references.mjs

# Test queries
node scripts/test-cross-references.mjs
```

The test script verifies:

- Pack creation
- Metadata
- Bidirectional references
- Query performance

## Status

✅ **Core interface** defined  
✅ **IndexedDB adapter** implemented  
✅ **Database schema** created  
✅ **Build script** ready  
⚠️ **Pack import** needs update to handle cross-refs  
⏳ **UI integration** pending  
⏳ **User creation** pending  
⏳ **Voting system** pending

The backend is complete and ready to integrate!
