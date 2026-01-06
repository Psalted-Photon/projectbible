#!/bin/bash

# Build sample packs for development
set -e

echo "Building sample packs..."
echo ""

# Create output directory
mkdir -p packs

# Build KJV sample
echo "📦 Building KJV sample pack..."
npm run packtools -- build data-manifests/samples/kjv-sample.json -o packs/kjv-sample-dev.sqlite

# Build WEB sample
echo "📦 Building WEB sample pack..."
npm run packtools -- build data-manifests/samples/web-sample.json -o packs/web-sample-dev.sqlite

echo ""
echo "✅ Sample packs built successfully!"
echo "   - packs/kjv-sample-dev.sqlite"
echo "   - packs/web-sample-dev.sqlite"
