# Dictionary Parser & Build Pipeline

Complete pipeline for harvesting Wiktionary + GCIDE into a production dictionary pack.

## Files

### Parsers

- **parse-wiktionary.mjs** — Streaming Wiktionary XML parser → modern definitions
- **parse-gcide.mjs** — GCIDE TEI/XML parser → historic definitions
- **helpers/normalize.js** — Lemma/POS normalization utilities
- **helpers/output.js** — Buffered NDJSON writer

### Pipeline Scripts

- **download-sources.mjs** — Downloads & decompresses Wiktionary + GCIDE dumps
- **seed-english-words.mjs** — Creates word_mapping table (lemma → word_id)
- **build-pack.mjs** — Builds final SQLite pack from NDJSON
- **harvest-all.sh** — Complete end-to-end pipeline

## Quick Start

### One-Command Harvest

```bash
./harvest-all.sh
```

This runs the complete pipeline:

1. Downloads Wiktionary (~500 MB) + GCIDE (~30 MB)
2. Parses both sources to NDJSON
3. Seeds word mappings
4. Builds dictionary-en.sqlite
5. Runs integrity checks

**Estimated time**: 2-4 hours (mostly download + parsing)  
**Output**: `../../packs/consolidated/dictionary-en.sqlite` (1.4-1.7 GB)

### Manual Steps

#### Step 1: Download Sources

```bash
node download-sources.mjs
```

Downloads to `../../data/raw/`, extracts to `../../data/processed/`

#### Step 2: Parse Wiktionary

```bash
node parse-wiktionary.mjs ../../data/processed/enwiktionary.xml
```

Outputs: `wiktionary-modern.ndjson` (~6M rows)

#### Step 3: Parse GCIDE

```bash
node parse-gcide.mjs ../../data/processed/gcide.xml
```

Outputs: `gcide-historic.ndjson` (~200K rows)

#### Step 4: Seed Word Mappings

```bash
node seed-english-words.mjs
```

Creates `word_mapping` table with unique lemmas

#### Step 5: Build Pack

```bash
node build-pack.mjs
```

Inserts all definitions into SQLite with proper word_id references

## Output Format

### Parser NDJSON Schema

**Modern (Wiktionary)**:

```json
{
  "word": "example",
  "pos": "noun",
  "definition_order": 1,
  "definition_text": "A thing serving to illustrate...",
  "etymology": "From Latin exemplum",
  "tags": ["formal"]
}
```

**Historic (GCIDE)**:

```json
{
  "word": "example",
  "pos": "noun",
  "definition_order": 1,
  "definition_text": "One or a portion taken to show..."
}
```

### Final SQLite Schema

See `/docs/DICTIONARY-PACK-IMPLEMENTATION.md` for complete schema (DB v13)

**Tables**:

- `pack_metadata` — Pack info (id, version, sources)
- `word_mapping` — Lemma → word_id mapping
- `english_definitions_modern` — Wiktionary definitions
- `english_definitions_historic` — GCIDE definitions

## Testing

After building, test the pack:

```bash
# Copy to public directory
cp ../../packs/consolidated/dictionary-en.sqlite ../../apps/pwa-polished/public/

# Start dev server and test lookup in LexicalModal
cd ../../apps/pwa-polished
npm run dev
```

## Publishing

```bash
# Compress
cd ../../packs/consolidated
zip dictionary-en-v1.0.0.zip dictionary-en.sqlite

# Checksum
shasum -a 256 dictionary-en-v1.0.0.zip > dictionary-en-v1.0.0.sha256

# Upload to GitHub Releases
gh release create dictionary-v1.0.0 \
  dictionary-en-v1.0.0.zip \
  dictionary-en-v1.0.0.sha256 \
  --title "English Dictionary Pack v1.0.0" \
  --notes "6M+ definitions from Wiktionary + Webster 1913"
```

## Skip Options

```bash
# Skip already-completed steps
./harvest-all.sh --skip-download     # Use existing downloads
./harvest-all.sh --skip-wiktionary   # Skip Wiktionary parsing
./harvest-all.sh --skip-gcide        # Skip GCIDE parsing
```

## Troubleshooting

**Download fails**: Check internet connection, Wikimedia mirrors may be slow  
**Parser crashes**: Increase Node memory: `NODE_OPTIONS=--max-old-space-size=8192`  
**word_mapping empty**: Run `seed-english-words.mjs` before `build-pack.mjs`  
**Orphaned definitions**: Check integrity warnings in build output
