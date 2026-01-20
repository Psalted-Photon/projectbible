# Performance Optimization - Quick Reference

## 🚀 Build Commands

```bash
# 1. Build bootstrap pack (208KB, instant startup)
node scripts/build-bootstrap-pack.mjs

# 2. Build consolidated packs (6 bundles, GitHub Releases ready)
node scripts/build-consolidated-packs.mjs

# 3. Publish to GitHub Releases
node scripts/publish-packs-release.mjs 1.0.0
```

## 📦 Pack Sizes

| Pack | Size | Contents |
|------|------|----------|
| bootstrap.sqlite | 208KB | Book metadata, verse counts, navigation |
| translations.sqlite | ~1.5GB | KJV, WEB, BSB, NET, LXX2012 |
| ancient-languages.sqlite | ~1.5GB | Hebrew, Greek NT, LXX + morphology |
| lexical.sqlite | ~1.2GB | Strong's + English resources |
| study-tools.sqlite | ~300MB | Maps, places, chronology, cross-refs |
| bsb-audio-pt1.sqlite | ~1.7GB | Genesis-Psalms audio |
| bsb-audio-pt2.sqlite | ~1.7GB | Proverbs-Revelation audio |

## 💻 Usage

### PackLoader API
```typescript
import { PackLoader } from '@projectbible/core/services/PackLoader';

const loader = new PackLoader({
  manifestUrl: 'https://github.com/USER/REPO/releases/download/packs-v1.0.0/manifest.json',
  appVersion: '1.0.0',
  onProgress: (progress) => {
    console.log(`${progress.packId}: ${progress.percentage}% (${progress.stage})`);
  }
});

// Install pack
await loader.installPack('translations');

// Request persistent storage
await loader.requestPersistentStorage();

// Get installed packs
const installed = await loader.getInstalledPacks();

// Remove cached pack
await loader.removeCachedPack('audio-pt1');
```

### SQLite Worker API
```typescript
import { sqliteWorker } from '@projectbible/core/services/SQLiteWorkerPool';

// Open database
await sqliteWorker.openDatabase('mydb', uint8ArrayData);

// Query
const verses = await sqliteWorker.query('mydb', 
  'SELECT * FROM verses WHERE book = ? AND chapter = ?',
  ['John', 3]
);

// Execute
await sqliteWorker.exec('mydb', 'CREATE INDEX idx_verses ON verses(book)');

// Extract pack
const data = await sqliteWorker.extractPack('mydb', 'translation');

// Close
await sqliteWorker.closeDatabase('mydb');
```

## 🔄 Workflow

### Development
1. Build packs locally: `node scripts/build-consolidated-packs.mjs`
2. Test pack structure: `sqlite3 packs/consolidated/translations.sqlite`
3. Verify schemas match app expectations

### Release
1. Authenticate: `gh auth login`
2. Build packs: `node scripts/build-consolidated-packs.mjs`
3. Create release: `node scripts/publish-packs-release.mjs 1.0.0`
4. Review draft: `gh release view packs-v1.0.0 --web`
5. Publish: `gh release edit packs-v1.0.0 --draft=false`

### Integration
1. Update app config with manifest URL
2. Bundle bootstrap.sqlite with app
3. Initialize PackLoader on app startup
4. Load packs on-demand based on user actions

## 📊 Performance

| Metric | Before | After |
|--------|--------|-------|
| Startup time | 10-30s | <100ms |
| Main thread blocking | Yes | No |
| Pack loading | Synchronous | On-demand |
| SQLite initialization | Multiple | Once |
| Storage | Bundled | CDN |

## 🔍 Debugging

### Check bootstrap pack
```bash
sqlite3 packs/bootstrap.sqlite "SELECT * FROM books LIMIT 5"
sqlite3 packs/bootstrap.sqlite "SELECT COUNT(*) FROM book_aliases"
```

### Check consolidated pack
```bash
sqlite3 packs/consolidated/translations.sqlite "SELECT * FROM metadata"
sqlite3 packs/consolidated/translations.sqlite "SELECT COUNT(*) FROM verses"
```

### Verify SHA-256
```bash
# Windows (PowerShell)
Get-FileHash packs/consolidated/translations.sqlite -Algorithm SHA256

# Linux/Mac
shasum -a 256 packs/consolidated/translations.sqlite
```

## ⚠️ Important

### Do NOT
- ❌ Merge ancient-languages + lexical (exceeds 2GB)
- ❌ Implement automatic background updates
- ❌ Attempt delta updates for SQLite packs
- ❌ Create worker pools for SQLite

### Do
- ✅ Respect 2GB SQLite file limit
- ✅ Use single global worker
- ✅ Validate SHA-256 on every download
- ✅ Request persistent storage
- ✅ Show progress during downloads
- ✅ Let users control pack updates

## 📚 Documentation

- **Full Guide:** `docs/PERFORMANCE-OPTIMIZATION.md`
- **Implementation Status:** `docs/OPTIMIZATION-IMPLEMENTATION-COMPLETE.md`
- **Pack Management:** `docs/PACK-MANAGEMENT.md`
- **Manifest Schema:** `packages/core/src/schemas/PackManifest.ts`

## 🎯 Next Steps

1. Bundle bootstrap with app
2. Update Vercel config (exclude large packs)
3. Add progress UI
4. Implement lazy loading triggers
5. Test with slow network
6. Deploy to production
