# Quick Command Reference

## Development

```bash
# Start PWA dev server (http://localhost:5173)
npm run dev:pwa

# Type checking (all workspaces)
npm run typecheck

# Build PWA for production
npm run build:pwa
```

## Pack Building

```bash
# Build a pack from manifest
npm run packtools -- build <manifest.json> -o <output.sqlite>

# Example: Build KJV sample
npm run packtools -- build data-manifests/samples/kjv-sample.json -o packs/kjv.sqlite

# Example: Build WEB sample
npm run packtools -- build data-manifests/samples/web-sample.json -o packs/web.sqlite

# Build both samples
npm run build:samples
```

## Pack Validation

```bash
# Validate manifest against schema
npm run packtools -- validate <manifest.json>

# Example
npm run packtools -- validate data-manifests/samples/kjv-sample.json

# Verify built pack structure
npm run verify-pack <pack.sqlite>

# Example
npm run verify-pack packs/kjv.sqlite
```

## Workspace Navigation

```bash
# Root package.json runs workspace commands
npm run <script>

# Run command in specific workspace
npm -w apps/pwa run dev
npm -w packages/core run typecheck
npm -w packages/packtools run build

# Install dependencies
npm install                    # Root + all workspaces
npm -w apps/pwa install <pkg>  # Specific workspace
```

## Common Tasks

**Add a new sample verse:**

1. Edit `data-manifests/samples/kjv-sample.json`
2. Add verse object to `sourceData` array
3. Rebuild: `npm run packtools -- build data-manifests/samples/kjv-sample.json -o packs/kjv.sqlite`

**Test pack contents:**

```bash
# Install sqlite3 CLI if needed
npm install -g sqlite3

# Query pack
sqlite3 packs/kjv.sqlite "SELECT * FROM verses;"
sqlite3 packs/kjv.sqlite "SELECT * FROM metadata;"
```

**Check file sizes:**

```bash
ls -lh packs/
```

## Next Implementation Steps

See [`docs/QUICKSTART.md`](QUICKSTART.md) for detailed next steps.

**TL;DR:**

1. Build sample packs
2. Create `apps/pwa/src/adapters/IndexedDBTextStore.ts`
3. Implement pack import UI
4. Build reader component
5. Test end-to-end

## Troubleshooting

**"Cannot find module @projectbible/core"**
→ Run `npm install` at root

**"Command not found: packtools"**
→ Use full command: `npm run packtools -- <args>`

**TypeScript errors in packtools**
→ Build it first: `npm -w packages/packtools run build`

**PWA not going offline**
→ Check DevTools → Application → Service Workers
→ Make sure you're on localhost or HTTPS
