# @projectbible/packtools

CLI tools for building and validating ProjectBible data packs.

## Installation

From the monorepo root:

```bash
npm install
```

## Commands

### Build a pack

Build a SQLite pack from a source manifest:

```bash
npm run packtools -- build <manifest.json> -o <output.sqlite>
```

Example:

```bash
npm run packtools -- build data-manifests/samples/kjv-sample.json -o packs/kjv-sample.sqlite
```

### Validate a manifest

Validate a source manifest against the schema:

```bash
npm run packtools -- validate <manifest.json>
```

Example:

```bash
npm run packtools -- validate data-manifests/samples/kjv-sample.json
```

## Pack Types

### Text Packs

Text packs contain Bible verses. The manifest should include:

- `translationId`: Short ID (e.g., "KJV", "WEB")
- `translationName`: Full name (e.g., "King James Version")
- `sourceData`: Array of verse objects with `book`, `chapter`, `verse`, `text`

Example:

```json
{
  "id": "kjv-sample",
  "version": "1.0.0",
  "type": "text",
  "translationId": "KJV",
  "translationName": "King James Version",
  "license": "Public Domain",
  "sourceData": [
    {
      "book": "Genesis",
      "chapter": 1,
      "verse": 1,
      "text": "In the beginning God created..."
    }
  ]
}
```

### Lexicon Packs

Lexicon packs contain Strong's concordance and dictionary data.

## Development

Build TypeScript:

```bash
npm run build
```

Watch mode:

```bash
npm run dev
```

Run directly with tsx:

```bash
npm run cli -- build <manifest.json>
```

## Pack Schema

The SQLite schema for text packs:

**metadata table:**

- `key` (TEXT PRIMARY KEY)
- `value` (TEXT NOT NULL)

**verses table:**

- `book` (TEXT NOT NULL)
- `chapter` (INTEGER NOT NULL)
- `verse` (INTEGER NOT NULL)
- `text` (TEXT NOT NULL)
- PRIMARY KEY: `(book, chapter, verse)`

Indexes:

- `idx_verses_book` on `book`
- `idx_verses_book_chapter` on `(book, chapter)`
