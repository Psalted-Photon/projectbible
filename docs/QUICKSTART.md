# Development Quick Start

## What Got Built

You now have a working foundation for ProjectBible with:

### ✅ Core Infrastructure

- **`packages/core`**: Shared interfaces and types
  - Defined all platform interfaces: `PackManager`, `TextStore`, `SearchIndex`, `LexiconStore`, `PlaceStore`, `UserDataStore`
  - Core domain types: `BCV`, `Verse`, `PackInfo`, etc.
- **`packages/packtools`**: CLI for building data packs

  - `build` command: converts JSON manifests to SQLite packs
  - `validate` command: validates manifests against schema
  - Full TypeScript implementation with better-sqlite3

- **`apps/pwa`**: Progressive Web App shell
  - Vite-powered development server
  - VitePWA plugin configured for offline support
  - Service worker auto-generation
  - Manifest for installable app

### ✅ Sample Data

- **KJV Sample**: 13 verses (Genesis 1:1-3, John 1:1-3, John 3:16, Psalm 23)
- **WEB Sample**: Same verses, different translation
- Both in [`data-manifests/samples/`](data-manifests/samples "data-manifests/samples")

## Next Steps (Recommended Order)

### 1. Build Sample Packs (Do This First!)

Test that the packtools CLI works:

```bash
# From monorepo root
npm run packtools -- build data-manifests/samples/kjv-sample.json -o packs/kjv-sample.sqlite

npm run packtools -- build data-manifests/samples/web-sample.json -o packs/web-sample.sqlite
```

This validates the entire pack pipeline.

### 2. Create PWA Storage Adapter

Implement `TextStore` for IndexedDB in the PWA:

**Create** [`apps/pwa/src/adapters/IndexedDBTextStore.ts`](apps/pwa/src/adapters/IndexedDBTextStore.ts "apps/pwa/src/adapters/IndexedDBTextStore.ts"):

```typescript
import { TextStore, Verse } from "@projectbible/core";

export class IndexedDBTextStore implements TextStore {
  async getVerse(
    translation: string,
    book: string,
    chapter: number,
    verse: number
  ): Promise<string | null> {
    // TODO: Query IndexedDB for verse text
    return null;
  }

  async getChapter(
    translation: string,
    book: string,
    chapter: number
  ): Promise<Verse[]> {
    // TODO: Query IndexedDB for all verses in chapter
    return [];
  }

  async getTranslations(): Promise<string[]> {
    // TODO: List installed translation IDs
    return [];
  }
}
```

### 3. Create Simple Reader UI

Update [`packages/core/src/index.ts`](packages/core/src/index.ts "packages/core/src/index.ts") to render verses:

```typescript
import { PlatformContext, Verse } from "./interfaces.js";

export async function renderChapter(
  root: HTMLElement,
  ctx: PlatformContext,
  translation: string,
  book: string,
  chapter: number
): Promise<void> {
  const verses = await ctx.textStore.getChapter(translation, book, chapter);

  root.innerHTML = `
    <div class="chapter">
      <h2>${book} ${chapter}</h2>
      ${verses
        .map(
          (v) => `
        <div class="verse">
          <sup>${v.verse}</sup> ${v.text}
        </div>
      `
        )
        .join("")}
    </div>
  `;
}
```

### 4. Add Pack Import to PWA

Create a simple pack import UI:

```typescript
// apps/pwa/src/pack-importer.ts
export async function importPack(file: File): Promise<void> {
  // 1. Read SQLite file from File object
  // 2. Open in sql.js (wasm SQLite for browser)
  // 3. Copy to IndexedDB for faster queries
  // 4. Update pack registry
}
```

You'll need: `npm install sql.js` in [`apps/pwa`](apps/pwa "apps/pwa")

### 5. Test End-to-End

1. Build sample packs
2. Start PWA dev server: `npm run dev:pwa`
3. Import a pack via file input
4. Render a chapter (Genesis 1 or John 1)
5. Verify verses display correctly

## Development Commands

**Start PWA dev server:**

```bash
npm run dev:pwa
```

**Build all packages:**

```bash
npm run typecheck
```

**Build packs:**

```bash
npm run packtools -- build <manifest.json> -o <output.sqlite>
```

**Validate manifest:**

```bash
npm run packtools -- validate <manifest.json>
```

## Architecture Reminders

### Platform Separation

- **Core** (`packages/core`): Pure logic, no platform APIs
- **PWA** (`apps/pwa`): IndexedDB, Cache API, service workers
- **Electron** (`apps/electron`): filesystem, better-sqlite3 (native)

### Adapters Pattern

Each platform implements the core interfaces:

- PWA: IndexedDB-backed stores
- Electron: SQLite-backed stores (direct file access)

Both inject a `PlatformContext` into the core.

## Common Issues

### "Cannot find module"

Make sure you ran `npm install` at the root. TypeScript should resolve workspace packages.

### Build errors in packtools

Make sure you built it: `npm -w packages/packtools run build`

Or use `tsx` directly: `npm -w packages/packtools run cli`

### PWA not installing

Check that:

1. You're using HTTPS or localhost
2. Service worker is registered
3. Manifest is valid (check DevTools → Application)

## File Structure Reference

```
packages/
  core/
    src/
      index.ts          # Exports interfaces + renderApp
      interfaces.ts     # All platform interfaces
  packtools/
    src/
      cli.ts            # Commander CLI entry
      types.ts          # Pack manifest types
      commands/
        build.ts        # JSON → SQLite builder
        validate.ts     # Manifest validator

apps/
  pwa/
    src/
      main.ts           # Entry point
      adapters/         # (create this) Platform implementations

data-manifests/
  samples/
    kjv-sample.json     # Sample KJV verses
    web-sample.json     # Sample WEB verses
  schemas/
    source-manifest.schema.json  # JSON schema
```

## What's NOT Done Yet

- IndexedDB storage adapter (E2)
- Pack import/download UI (E2)
- Reader component (E5)
- Search functionality (E6)
- Lexicon/Strong's (E8)
- Places/maps (E10)
- Electron shell (E3)

Focus on the PWA first - Electron can wait until you're back on desktop.

## Resources

- [Vite PWA Plugin Docs](https://vite-pwa-org.netlify.app/)
- [IndexedDB Tutorial](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [sql.js (SQLite in browser)](https://github.com/sql-js/sql.js)
- [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3) (Electron only)
