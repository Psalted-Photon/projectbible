# Bootstrap Database Fix - January 20, 2026

## Issue

**Error:** "Bootstrap load failed: file is not a database"

This error occurs when the app tries to load the bootstrap.sqlite file but finds it's corrupted or invalid.

## What Was Fixed

### 1. Updated Build Process

Modified [vercel.json](vercel.json) to rebuild bootstrap pack during deployment:

- Added `node scripts/build-bootstrap-pack.mjs` to buildCommand
- Ensures fresh bootstrap is generated for every deployment

### 2. Added Proper HTTP Headers

Added headers for SQLite and WASM files:

- `.sqlite` files get `Content-Type: application/x-sqlite3`
- `.wasm` files get `Content-Type: application/wasm`
- Both get cache headers for optimal performance

## Quick Fix (If Error Persists Locally)

```bash
# 1. Rebuild bootstrap pack
node scripts/build-bootstrap-pack.mjs

# 2. Clean and rebuild app
rm -rf apps/pwa-polished/dist
npm run build --workspace=@projectbible/pwa-polished

# 3. Test locally
cd apps/pwa-polished
npm run dev
```

## Deploy the Fix

```bash
# Commit changes
git add vercel.json FIX-BOOTSTRAP.md BOOTSTRAP-FIX-INSTRUCTIONS.md
git commit -m "fix: Rebuild bootstrap pack during deployment and add proper headers"
git push origin main
```

Vercel will automatically:

1. Build fresh bootstrap pack
2. Copy it to dist/
3. Serve with proper content-type headers
4. Deploy the working app

## Verification After Deploy

Visit your deployed site and check:

1. ✅ App loads without errors
2. ✅ Console shows: "✓ Bootstrap loaded: 66 books"
3. ✅ No database errors in Network tab

## Why This Happened

The bootstrap.sqlite file can become corrupted when:

- Not rebuilt before deployment
- Binary file corruption during git operations
- Wrong content-type causing browser misinterpretation
- Incomplete file transfer

## Prevention

The fix ensures:

- ✅ Fresh bootstrap built on every deployment
- ✅ Proper content-type headers prevent corruption
- ✅ Cache headers optimize performance
- ✅ Reliable startup every time
