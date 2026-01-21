#!/bin/bash

# Complete dictionary harvesting pipeline
# Runs all steps from download to pack build

set -e  # Exit on error

echo "🌾 Dictionary Data Harvest Pipeline"
echo "===================================="
echo ""

# Step 0: Check dependencies
echo "📋 Checking dependencies..."
command -v node >/dev/null 2>&1 || { echo "❌ node not found"; exit 1; }
command -v bunzip2 >/dev/null 2>&1 || { echo "⚠️  bunzip2 not found (decompression will be slower)"; }
command -v tar >/dev/null 2>&1 || { echo "❌ tar not found"; exit 1; }
echo "✅ Dependencies OK"
echo ""

# Step 1: Download sources
if [ "$1" != "--skip-download" ]; then
  echo "📥 Step 1: Download sources"
  echo "-------------------------"
  node download-sources.mjs
  echo ""
else
  echo "⏭️  Skipping download (--skip-download)"
  echo ""
fi

# Step 2: Parse Wiktionary
if [ "$1" != "--skip-wiktionary" ]; then
  echo "📖 Step 2: Parse Wiktionary"
  echo "-------------------------"
  node parse-wiktionary.mjs ../../data/processed/enwiktionary.xml
  echo ""
else
  echo "⏭️  Skipping Wiktionary (--skip-wiktionary)"
  echo ""
fi

# Step 3: Parse GCIDE
if [ "$1" != "--skip-gcide" ]; then
  echo "📚 Step 3: Parse GCIDE"
  echo "-------------------------"
  node parse-gcide.mjs ../../data/processed/gcide.xml
  echo ""
else
  echo "⏭️  Skipping GCIDE (--skip-gcide)"
  echo ""
fi

# Step 4: Seed word mappings
echo "🧬 Step 4: Seed word mappings"
echo "-------------------------"
node seed-english-words.mjs
echo ""

# Step 5: Build pack
echo "🏛️  Step 5: Build pack"
echo "-------------------------"
node build-pack.mjs
echo ""

# Step 6: Run tests (if test script exists)
if [ -f "test-pack.mjs" ]; then
  echo "🧪 Step 6: Run tests"
  echo "-------------------------"
  node test-pack.mjs
  echo ""
fi

echo "✅ Dictionary harvest complete!"
echo ""
echo "📦 Pack location: ../../packs/consolidated/dictionary-en.sqlite"
echo ""
echo "📝 Next steps:"
echo "   1. Test the pack in your app"
echo "   2. Compress: cd ../../packs/consolidated && zip dictionary-en-v1.0.0.zip dictionary-en.sqlite"
echo "   3. Compute checksum: shasum -a 256 dictionary-en-v1.0.0.zip"
echo "   4. Upload to GitHub Releases"
echo ""
