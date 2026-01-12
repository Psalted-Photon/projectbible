# Polished Version Installation Guide

## Problem

The `npm run dev:polished` command failed because dependencies aren't installed.

## Solution

### Option 1: Install from pwa-polished directory

```bash
cd apps/pwa-polished
npm install
npm run dev
```

### Option 2: Install from root using workspace

```bash
npm install --workspace=apps/pwa-polished
npm run dev:polished
```

### Option 3: Install all workspaces

```bash
npm install
npm run dev:polished
```

## What I Fixed

1. **Removed platform-specific dependency** - `@esbuild/win32-x64` was causing issues on Linux
2. **Removed @tsconfig/svelte dependency** - Not needed, using inline config instead
3. **Updated tsconfig.json** - Removed the extends that required the package

## Updated Files

- `apps/pwa-polished/package.json` - Cleaned dependencies
- `apps/pwa-polished/tsconfig.json` - Removed external extends

## After Installing

Run the polished version:

```bash
npm run dev:polished
```

Visit: http://localhost:5174

## Troubleshooting

If you still get errors:

1. Delete node_modules:

```bash
cd apps/pwa-polished
rm -rf node_modules
npm install
```

2. Clear npm cache:

```bash
npm cache clean --force
npm install
```

3. Check Node version (should be 18+):

```bash
node --version
```
