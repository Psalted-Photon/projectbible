# ProjectBible - Dual Version Access

## Overview

ProjectBible now has **two versions** available:

1. **Polished Version** (Svelte) - Modern, streamlined navigation
2. **Classic Version** (Vanilla TS) - Full-featured, stable

## Quick Start

### Run Both Versions Simultaneously

```bash
npm run dev:all
```

This will start:
- **Classic PWA** at http://localhost:5173
- **Polished PWA** at http://localhost:5174

### Run Individual Versions

**Classic Version:**
```bash
npm run dev:pwa
```
Opens at http://localhost:5173

**Polished Version:**
```bash
npm run dev:polished
```
Opens at http://localhost:5174

### Build for Production

**Build Classic:**
```bash
npm run build:pwa
```

**Build Polished:**
```bash
npm run build:polished
```

## What's Different?

### Polished Version (NEW)
- ✨ **2-dropdown navigation** - Translation + Reference
- 🌲 **Tree-style book selector** - Click to expand chapters
- 📱 **Mobile-first design** - Optimized for touch
- 🎯 **Streamlined UX** - No verse dropdown, navigate directly to chapters
- ⚡ **Svelte-powered** - Fast and reactive

### Classic Version (STABLE)
- 🔧 **4-dropdown navigation** - Translation, Book, Chapter, Verse
- 📦 **Full pack management** - Import/download packs
- 🔗 **Cross-references** - View related verses
- 🔍 **Search** - Full-text search across Bible
- 🗺️ **Maps & Places** - Interactive biblical geography
- 🎨 **Themes** - Light/dark mode

## File Structure

```
apps/
├── pwa/              # Classic version
│   ├── src/
│   │   └── main.ts   # Main app entry
│   └── index.html
│
└── pwa-polished/     # Polished version
    ├── src/
    │   ├── main.ts
    │   ├── App.svelte
    │   ├── components/
    │   │   ├── NavigationBar.svelte    # New navigation
    │   │   └── BibleReader.svelte
    │   ├── stores/
    │   │   └── navigationStore.ts      # State management
    │   └── lib/
    │       └── bibleData.ts            # Book/chapter data
    └── index.html
```

## Navigation Comparison

### Classic Version
1. Select Translation
2. Select Book
3. Select Chapter
4. Select Verse
5. Click "Read Verse" or "Read Chapter"

### Polished Version
1. Click Translation dropdown → Select version
2. Click Reference dropdown → Click book to expand
3. Click chapter number → Instantly navigates to chapter verse 1
4. Scroll to read

## Development

Both versions share the `@projectbible/core` package for common functionality.

To add a feature to both:
1. Add core logic to `packages/core/`
2. Integrate in `apps/pwa/src/main.ts` (Classic)
3. Integrate in `apps/pwa-polished/src/components/` (Polished)

## Choosing Which to Use

**Use Polished Version if you want:**
- Modern, clean interface
- Faster navigation
- Mobile reading experience
- Minimal distractions

**Use Classic Version if you need:**
- All features available now
- Pack management
- Cross-references and maps
- Verse-level navigation
- Search functionality

## Future Plans

The Polished version will gradually incorporate features from Classic as they're redesigned for the new interface.

Currently implemented in Polished:
- [x] Navigation bar with 2 dropdowns
- [x] Tree-style book/chapter selection
- [x] Reactive state management
- [ ] Pack integration (coming soon)
- [ ] Cross-references
- [ ] Search
- [ ] Maps
