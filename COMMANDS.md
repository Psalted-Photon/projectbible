# Quick Command Reference

## Development

### Run Apps

```bash
# Classic PWA (full-featured) - http://localhost:5173
npm run dev:pwa

# Polished PWA (streamlined navigation) - http://localhost:5174
npm run dev:polished

# Run BOTH versions simultaneously
npm run dev:all

# Electron + PWA
npm run dev

# Type checking (all workspaces)
npm run typecheck

# Build for production
npm run build:pwa        # Classic version
npm run build:polished   # Polished version
```

## Pack Building

```bash
# Build all packs at once
npm run build:all-packs

# Build individual translation packs
npm run build:greek     # Greek: LXX, Byzantine, TR, OpenGNT
npm run build:hebrew    # Hebrew: WLC with morphology
npm run build:web       # World English Bible
npm run build:kjv       # King James Version

# Build feature/data packs
npm run build:places    # Biblical geography with place name linking
npm run build:maps      # Historical map layers
npm run build:cross-refs # Cross-references

# Build sample/dev packs
npm run build:samples   # Small sample packs for testing
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

**Test place lookups:**

```bash
# Query places pack
sqlite3 packs/places-biblical.sqlite "SELECT name, type, region FROM places;"
sqlite3 packs/places-biblical.sqlite "SELECT * FROM place_name_links WHERE normalized_word='bethel';"

# Query map pack
sqlite3 packs/maps-biblical.sqlite "SELECT display_name, period, type FROM historical_layers;"
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
