#!/bin/bash
# Git commit script for dictionary parsers

cd /workspaces/projectbible

echo "📝 Staging changes..."
git add scripts/dictionary-parsers/

echo ""
echo "📊 Status:"
git status --short

echo ""
echo "💾 Committing..."
git commit -m "feat: Add complete dictionary harvest pipeline

- Implement Wiktionary XML parser (modern definitions)
- Implement GCIDE XML parser (historic definitions)  
- Add source download automation (Wiktionary + GCIDE)
- Add word mapping seeder
- Add pack builder with integrity checks
- Add end-to-end harvest script
- Add validation suite
- All parsers output NDJSON compatible with DB v13 schema
- Complete pipeline from download → SQLite pack"

echo ""
echo "🚀 Pushing to remote..."
git push origin main

echo ""
echo "✅ Complete! Changes committed and pushed."
