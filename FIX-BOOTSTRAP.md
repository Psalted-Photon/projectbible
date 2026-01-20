# Bootstrap Database Fix - January 20, 2026

## Problem

Getting error: "Bootstrap load failed: file is not a database"

This means the bootstrap.sqlite file in the deployment is corrupted or invalid.

## Root Cause

The bootstrap.sqlite file either:

1. Wasn't properly generated before deployment
2. Got corrupted during the build/copy process
3. Has a content-type issue causing binary corruption

## Solution Steps

### 1. Rebuild Bootstrap Pack

```bash
# Generate a fresh bootstrap pack
node scripts/build-bootstrap-pack.mjs

# Verify it's valid
sqlite3 packs/bootstrap.sqlite "SELECT COUNT(*) FROM books;"
# Should return 66

# Check file size
ls -lh packs/bootstrap.sqlite
# Should be ~208KB
```

### 2. Clean and Rebuild App

```bash
# Clean previous builds
rm -rf apps/pwa-polished/dist
rm -rf apps/pwa-polished/public/bootstrap.sqlite

# Rebuild (this will copy fresh bootstrap to public/)
npm run build --workspace=@projectbible/pwa-polished
```

### 3. Verify Local Build

```bash
# Check dist has bootstrap
ls -lh apps/pwa-polished/dist/bootstrap.sqlite

# Verify it's a valid database
file apps/pwa-polished/dist/bootstrap.sqlite
# Should say: "SQLite 3.x database"

sqlite3 apps/pwa-polished/dist/bootstrap.sqlite "SELECT COUNT(*) FROM books;"
# Should return 66
```

### 4. Add Vercel Headers for SQLite Files

Add to `vercel.json` to ensure proper content-type:

```json
{
  "headers": [
    {
      "source": "/(.*).sqlite",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/x-sqlite3"
        },
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/(.*).wasm",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/wasm"
        }
      ]
    }
  ]
}
```

### 5. Deploy

```bash
git add .
git commit -m "fix: Rebuild bootstrap pack and add proper headers"
git push origin main
```

## Prevention

The bootstrap pack should be:

1. Built as part of the CI/CD pipeline (not committed)
2. Verified with integrity checks
3. Served with proper headers

Consider adding to package.json:

```json
{
  "scripts": {
    "prebuild": "node scripts/build-bootstrap-pack.mjs",
    "build": "npm run build --workspace=@projectbible/core && cd apps/pwa-polished && vite build"
  }
}
```
