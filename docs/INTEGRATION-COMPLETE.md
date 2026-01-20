# Integration Complete - Quick Start Guide

## ✅ What Was Integrated

### 1. Bootstrap Pack System
- **Location**: `packs/bootstrap.sqlite` (208KB)
- **Bundled**: Always included with app deployment
- **Purpose**: Instant startup with book metadata, navigation data
- **Loader**: `apps/pwa-polished/src/lib/bootstrap-loader.ts`

### 2. Progressive Initialization
- **File**: `apps/pwa-polished/src/lib/progressive-init.ts`
- **Strategy**: Load bootstrap → Mount app → Lazy load packs
- **Updated**: `apps/pwa-polished/src/main.ts` to use new init

### 3. Configuration
- **File**: `apps/pwa-polished/src/config.ts`
- **Contains**: 
  - App version
  - Pack manifest URL
  - Feature flags
  - Pack loading triggers
  - UI settings

### 4. Pack Loading Triggers
- **File**: `apps/pwa-polished/src/lib/pack-triggers.ts`
- **Triggers**:
  - `reader-open` → translations pack
  - `hebrew-greek-toggle` → ancient-languages pack
  - `word-study-open` → lexical pack
  - `maps-open` → study-tools pack
  - `audio-play` → audio packs

### 5. Progress UI
- **Component**: `apps/pwa-polished/src/components/ProgressModal.svelte`
- **Features**: Download progress, validation, extraction stages
- **Auto-shows**: When downloading packs on-demand

### 6. Build Configuration
- **Vite**: `apps/pwa-polished/vite.config.ts`
  - Bundles bootstrap.sqlite
  - Skips large packs in production
  - Copies polished packs only in dev mode
  
- **Vercel**: `vercel.json`
  - Excludes large packs
  - Sets cache headers for bootstrap
  - Security headers

## 🚀 How to Use

### Development Mode

```bash
# 1. Build bootstrap pack (first time only)
node scripts/build-bootstrap-pack.mjs

# 2. Start dev server
cd apps/pwa-polished
npm run dev
```

The app will:
- Load bootstrap instantly
- Mount UI immediately
- Use bundled packs from `packs/polished/` (if present)

### Production Mode

```bash
# 1. Build consolidated packs
node scripts/build-consolidated-packs.mjs

# 2. Publish to GitHub Releases
node scripts/publish-packs-release.mjs 1.0.0
gh release edit packs-v1.0.0 --draft=false

# 3. Update config with manifest URL
# Edit apps/pwa-polished/src/config.ts:
export const PACK_MANIFEST_URL = 
  'https://github.com/YOUR_USER/YOUR_REPO/releases/download/packs-v1.0.0/manifest.json';

# 4. Build and deploy
cd apps/pwa-polished
npm run build
# Deploy dist/ folder to Vercel
```

The app will:
- Load bootstrap from bundled file (instant)
- Fetch manifest from GitHub Releases
- Download packs on-demand when user needs them

## 📝 Configuration Guide

### Update Pack Manifest URL

Edit `apps/pwa-polished/src/config.ts`:

```typescript
export const PACK_MANIFEST_URL = 
  'https://github.com/USERNAME/REPO/releases/download/packs-v1.0.0/manifest.json';
```

### Customize Pack Triggers

Edit `PACK_TRIGGERS` in `apps/pwa-polished/src/config.ts`:

```typescript
export const PACK_TRIGGERS = {
  'translations': 'reader-open',
  'lexical': 'word-study-open',
  // Add custom triggers
};
```

### Toggle Features

Edit `FEATURES` in `apps/pwa-polished/src/config.ts`:

```typescript
export const FEATURES = {
  lazyPackLoading: true,  // Enable on-demand loading
  persistentStorage: true, // Request persistent storage
  progressiveStartup: true, // Use new init system
  packUpdates: true        // Allow pack updates
};
```

## 🎯 Triggering Pack Loads

### In Your Components

```svelte
<script>
  import { triggerPackLoad } from '$lib/pack-triggers';
  import { currentDownload, showProgressModal } from '$lib/pack-triggers';
  
  async function openReader() {
    // This will automatically load translations pack if needed
    await triggerPackLoad('reader-open');
    
    // Now show reader (pack is ready)
    showReader = true;
  }
</script>

<button on:click={openReader}>Read Bible</button>

<!-- Progress modal shows automatically -->
<ProgressModal 
  progress={$currentDownload} 
  visible={$showProgressModal} 
/>
```

### Available Triggers

```typescript
- 'reader-open'          // Load translations
- 'hebrew-greek-toggle'  // Load ancient languages
- 'word-study-open'      // Load lexical resources
- 'maps-open'            // Load study tools
- 'audio-play'           // Load audio packs
```

## 🔧 Development Tips

### Test Bootstrap Loading

```bash
# Build bootstrap
node scripts/build-bootstrap-pack.mjs

# Check it exists
ls packs/bootstrap.sqlite

# Start dev server
cd apps/pwa-polished
npm run dev

# Check console for "Bootstrap loaded"
```

### Test Pack Loading

```javascript
// In browser console (dev mode):

// Load a pack manually
await loadPack('translations');

// Check installed packs
await getInstalledPacks();

// Remove a pack
await removePack('translations');
```

### Force CDN Mode in Dev

```bash
# Set env var to use GitHub Releases in dev
VITE_USE_BUNDLED_PACKS=false npm run dev
```

## 📦 Pack Priority

Packs load in this order when requested:

1. **Essential**: bootstrap (always bundled)
2. **High**: translations (most users need)
3. **Medium**: study-tools, lexical (advanced features)
4. **Low**: ancient-languages, audio (specialized)

## ⚙️ Environment Variables

### `.env` (Development)

```bash
# Use local packs instead of CDN
VITE_USE_BUNDLED_PACKS=true

# Override manifest URL
VITE_PACK_MANIFEST_URL=http://localhost:3000/manifest.json
```

### Vercel (Production)

```bash
# Set in Vercel dashboard:
NODE_ENV=production
```

## 🎨 Customize Progress UI

Edit `apps/pwa-polished/src/components/ProgressModal.svelte`:

```svelte
<!-- Change colors -->
.progress-bar {
  background: linear-gradient(90deg, #yourColor1, #yourColor2);
}

<!-- Add custom stages -->
const stageLabels = {
  downloading: 'Downloading...',
  validating: 'Checking integrity...',
  extracting: 'Installing...',
  caching: 'Saving for offline...',
  complete: 'Ready!'
};
```

## 📊 Monitor Performance

### Check Startup Time

```javascript
// In main.ts
const startTime = performance.now();
await initializeApp();
const endTime = performance.now();
console.log(`Startup: ${endTime - startTime}ms`);
```

### Check Pack Load Time

```javascript
// In pack-triggers.ts
const start = performance.now();
await loadPackOnDemand(packId, onProgress);
const duration = performance.now() - start;
console.log(`Pack ${packId} loaded in ${duration}ms`);
```

## 🐛 Troubleshooting

### Bootstrap not found

```bash
# Build it
node scripts/build-bootstrap-pack.mjs

# Check location
ls packs/bootstrap.sqlite

# Rebuild app
npm run build
```

### Packs not loading

```javascript
// Check config
console.log(PACK_MANIFEST_URL);
console.log(FEATURES.lazyPackLoading);

// Test manifest fetch
fetch(PACK_MANIFEST_URL).then(r => r.json()).then(console.log);

// Check loader
const loader = getPackLoader();
console.log(loader);
```

### Progress modal not showing

```svelte
<script>
  import { showProgressModal } from '$lib/pack-triggers';
  
  // Force show for testing
  $showProgressModal = true;
</script>
```

## ✅ Integration Checklist

- [x] Bootstrap pack builder created
- [x] Vite config updated to bundle bootstrap
- [x] Vercel config updated to exclude large packs
- [x] App config created with manifest URL
- [x] Progressive initialization implemented
- [x] PackLoader integrated
- [x] Progress UI component created
- [x] Pack loading triggers implemented
- [ ] **TODO**: Update manifest URL with your repo
- [ ] **TODO**: Test bootstrap loading
- [ ] **TODO**: Test pack downloads
- [ ] **TODO**: Deploy to Vercel
- [ ] **TODO**: Monitor performance

## 🎉 Next Steps

1. **Build bootstrap**: `node scripts/build-bootstrap-pack.mjs`
2. **Test locally**: `npm run dev`
3. **Build packs**: `node scripts/build-consolidated-packs.mjs`
4. **Publish**: `node scripts/publish-packs-release.mjs 1.0.0`
5. **Update config**: Edit `PACK_MANIFEST_URL` in `config.ts`
6. **Deploy**: `npm run build` → Deploy to Vercel

Your app is now ready for progressive, offline-first operation! 🚀
