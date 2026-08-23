# ProjectBible

**An offline-first Bible study platform with advanced features**

---

## What is ProjectBible?

ProjectBible is a comprehensive Bible study app designed to work fully offline with professional-grade tools:

✅ **Multi-translation reading** — KJV, WEB, BSB, NET, LXX2012, Hebrew, Greek  
✅ **Word-level study** — Strong's lexicons, morphology, IPA pronunciation  
✅ **Historical maps** — 12,606 biblical places, 38 map layers spanning 2000+ years  
✅ **Reading plans** — Whole Bible, NT-only, custom selections, intelligent catch-up  
✅ **Cross-references** — 340k+ curated references with voting system  
✅ **Audio narration** — All 1,189 chapters (3.41GB embedded MP3s)  
✅ **Power search** — Regex support, translation tree results, morphology filters  

**Status:** Production-ready (January 2026), deployed to Vercel

---

## Quick Start

**Production App (Svelte):**
```bash
npm install
npm run dev:polished      # Port 5174
```

**Development App (Vanilla TS):**
```bash
npm run dev:pwa           # Port 5173 (includes DevTools)
```

**Run Both:**
```bash
npm run dev:all
```

**Build for Production:**
```bash
npm run build:polished
```

---

## 📘 Technical Specification

**For complete architectural details, data models, invariants, and constraints, see:**

### **[PROJECT_SPEC.md](PROJECT_SPEC.md)** ← Authoritative technical specification

The spec includes:
- **System architecture** — Dual PWA strategy, monorepo structure, platform abstraction
- **Data models** — IndexedDB schema v18, pack formats, reading plans with catch-up overlays
- **Features** — 2-dropdown navigation, consolidated packs, translation tree search
- **Constraints & decisions** — Immutable packs, overlay-based adjustments, 2GB SQLite limit
- **Future work** — Electron app, sync system, English morphology filters

**When working with AI assistants, use this command:**

```
Use PROJECT_SPEC.md as the authoritative description of the system.
Do not contradict or revert anything documented there.
```

---

## Repository Structure

```
ProjectBible/
├── apps/
│   ├── pwa/              # Development workbench (Vanilla TS, port 5173)
│   ├── pwa-polished/     # Production app (Svelte 5, port 5174)
│   └── electron/         # Desktop app (planned, not implemented)
├── packages/
│   ├── core/             # Shared UI + domain logic (platform-agnostic)
│   └── packtools/        # CLI tools for building/validating packs
├── packs/
│   ├── workbench/        # Testing area (DevTools promotion)
│   ├── polished/         # Production-ready packs
│   └── consolidated/     # 6 multi-resource bundles (3.87GB total)
├── scripts/              # Build scripts (bootstrap, consolidated packs, manifest)
├── docs/                 # Detailed implementation guides (20+ docs)
└── PROJECT_SPEC.md       # ⭐ Authoritative specification
```

---

## Important Licensing Note

⚠️ **Read this before contributing:**

This repo uses **only datasets with explicit licenses permitting redistribution**. Do NOT copy/redistribute content from proprietary apps (Logos, e-Sword modules, etc.) unless the dataset license explicitly allows it.

All packs include machine-readable attribution and license information.

**Approved data sources:**
- WEB, KJV (public domain)
- OSHB Hebrew OT (WLC PD, morphology CC BY 4.0)
- SBLGNT Greek NT (CC BY 4.0)
- STEPBible Data (CC BY 4.0)
- OpenBible.info geography (CC BY 4.0)
- Pleiades ancient places (open data)
- Natural Earth basemaps (public domain)

See [docs/DEV.md](docs/DEV.md) for complete licensing details.

---

## Development

**Where Development Happens:**

- **Codespaces/Cloud:** Core logic, PWA, pack tooling, docs, tests
- **Desktop:** Electron packaging, SQLite performance, offline map work, GIS processing

**Key npm Scripts:**

```bash
npm run dev:pwa           # Development app (port 5173)
npm run dev:polished      # Production app (port 5174)
npm run dev:all           # Run both apps concurrently

npm run build:pwa         # Build development app
npm run build:polished    # Build production app

npm run packs:list        # List all packs
npm run packs:promote     # Promote pack (workbench → polished)
npm run build:all-packs   # Build all packs from source data
```

**For detailed setup instructions, see:**
- [docs/QUICKSTART.md](docs/QUICKSTART.md) — Quick start guide
- [docs/DEV.md](docs/DEV.md) — Development guide
- [docs/PACK-MANAGEMENT.md](docs/PACK-MANAGEMENT.md) — Pack promotion workflow

---

## Features Overview

### 2-Dropdown Navigation
Streamlined navigation using Translation selector + Book/Chapter tree. Swipe gestures on mobile.

### Consolidated Packs (6 total, 3.87GB)
- `translations.sqlite` (33.69 MB) — KJV, WEB, BSB, NET, LXX2012
- `ancient-languages.sqlite` (67 MB) — Hebrew OT, Greek NT/LXX with morphology
- `lexical.sqlite` (365.32 MB) — Strong's lexicons, 470k+ English words, thesaurus
- `study-tools.sqlite` (13.82 MB) — Places, historical map layers, chronological reading order
- `bsb-audio-pt1.sqlite` (1.76 GB) — Genesis–Psalms audio
- `bsb-audio-pt2.sqlite` (1.65 GB) — Proverbs–Revelation audio

### Reading Plans with Catch-Up Adjustments
Whole Bible, NT-only, custom selections. Intelligent catch-up uses **overlays** (never mutates plan).

### Translation Tree Search
Search multiple translations, results organized by translation. Regex support with safety warnings.

### Historical Maps
12,606 biblical places (Pleiades), 38 map layers spanning 2000+ years, journey routes, POIs.

### Cross-References
340k+ curated references, bidirectional links, voting system, user-created references.

---

## Deployment

**Production:** Vercel static deployment (Svelte app)  
**Packs:** GitHub Releases (free CDN, unlimited bandwidth)  
**Manifest:** `/api/packs/manifest.json` (proxies to GitHub)

See [docs/VERCEL-DEPLOYMENT.md](docs/VERCEL-DEPLOYMENT.md) for deployment instructions.

---

## Documentation

**Start here:**
- [PROJECT_SPEC.md](PROJECT_SPEC.md) — **Authoritative specification** (architecture, data models, constraints)
- [docs/QUICKSTART.md](docs/QUICKSTART.md) — Quick start guide
- [docs/DEV.md](docs/DEV.md) — Development guide

**Implementation guides:**
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture
- [docs/PACK-STANDARD-V1.md](docs/PACK-STANDARD-V1.md) — Pack format specification
- [OPTIMIZATION-IMPLEMENTATION-COMPLETE.md](OPTIMIZATION-IMPLEMENTATION-COMPLETE.md) — Bootstrap system, performance optimizations
- [docs/NAVIGATION-IMPLEMENTATION.md](docs/NAVIGATION-IMPLEMENTATION.md) — 2-dropdown navigation
- [docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md](docs/CONSOLIDATED-PACKS-IMPLEMENTATION.md) — Consolidated packs system
- [docs/READING-PLANS.md](docs/READING-PLANS.md) — Reading plan engine
- [docs/CROSS-REFERENCES-IMPLEMENTATION.md](docs/CROSS-REFERENCES-IMPLEMENTATION.md) — Cross-reference system
- [docs/ENHANCED-MAPS-SUMMARY.md](docs/ENHANCED-MAPS-SUMMARY.md) — Historical maps

See [docs/](docs/) for complete documentation (20+ guides).

---

## Contributing

1. Read [PROJECT_SPEC.md](PROJECT_SPEC.md) — Understand the authoritative specification
2. Read [docs/DEV.md](docs/DEV.md) — Setup development environment
3. Make changes aligned with spec constraints
4. Test locally (`npm run dev:polished`)
5. Submit pull request

**Do not:**
- Contradict invariants in PROJECT_SPEC.md
- Mutate pack files after installation
- Change catchUpAdjustment from overlay to mutation
- Break 2GB SQLite pack size limit
- Revert to 4-dropdown navigation

---

## License

**Code:** MIT License (see LICENSE file)  
**Data:** Various open licenses (see pack attribution and [docs/DEV.md](docs/DEV.md))

---

**Questions?** See [PROJECT_SPEC.md](PROJECT_SPEC.md) §7 Further Reading for detailed documentation.
