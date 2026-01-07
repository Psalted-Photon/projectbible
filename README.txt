ProjectBible — Offline Interactive Bible (PWA + Electron)

Purpose
- Personal-study-first Bible app that can run fully offline.
- Ships in two shells:
  - Electron (desktop “power pack”): filesystem + SQLite + big data packs + offline maps.
  - PWA (mobile-friendly): smaller packs first, stored in browser storage (IndexedDB/Cache).
- One shared app core: same UI/logic everywhere.

Non‑negotiables (Vision)
- Include KJV and WEB.
- Offline reading, offline search.
- Tap/hold word menu: definition, occurrences, lemma/original-language mapping, Strong’s.
- Places: tap place -> show info + open in Google Maps/Earth; optional offline map viewer.
- Foundation strong enough to grow into comprehensive tool (Greek/Hebrew, LXX, apocrypha, commentaries, reading plans, sync).

Important licensing note (read this)
- This repo is designed to use only datasets with explicit licenses permitting your use.
- Do NOT copy/redistribute content extracted from proprietary apps (e.g., Logos/e‑Sword modules) unless the specific dataset license explicitly allows redistribution.
- Track license and attribution per “pack” in data manifests.

Where development happens
- Codespaces: ideal for core logic, PWA, pack tooling, docs, tests.
- Desktop: best for Electron packaging, SQLite performance work, offline map tile packs and manual GIS work.

Repository structure (monorepo)
- apps/pwa
  - Installable web app (PWA). Uses IndexedDB/Cache API.
- apps/electron
  - Desktop shell (Electron). Uses filesystem + SQLite.
- packages/core
  - Shared UI + domain logic. No direct platform APIs.
- packages/packtools
  - CLI/tools to build data packs from source files and to validate manifests.
- docs
  - Specs for data formats, UX flows, pack licensing/attribution, and design decisions.
- data-manifests
  - Source manifests (URLs, hashes, licenses) + schema for validation.

Core architectural rule
- The core must only speak to platform interfaces.
- Platform adapters implement those interfaces using either:
  - PWA: IndexedDB + Cache API + service worker
  - Electron: filesystem + SQLite + worker threads

Pack strategy (single universe of packs)
- One pack format family, multiple install profiles.
- Canonical pack formats:
  - SQLite packs: verse text, tokens, lexicon, places, crossrefs.
  - MBTiles packs: offline map tiles and overlays.
- Install profiles:
  - "mobile-min": KJV + WEB + basic search + places (small).
  - "desktop-full": everything + offline maps + morphology packs.

Data sources (target shortlist)
- WEB (public domain): worldenglishbible.org / ebible.org
- KJV (personal ok; global distribution has UK Crown rights complexity)
- OSHB (Hebrew OT: WLC PD, morphology CC BY 4.0)
- SBLGNT (Greek NT, CC BY 4.0)
- STEPBible Data (lexicons/tagging, CC BY 4.0)
- OpenBible.info geo (places, CC BY 4.0)
- Natural Earth (basemap layers, public domain)
- Time-warp maps: start with modern basemap + place pins; ancient boundary polygons are scarce as truly open GIS, so create curated "snapshot overlays" with clear provenance.

Typography & Fonts
- WEB: Use "EB Garamond" (designed by Georg Mayr-Duffner and Octavio Pardo)
  - Source: Google Fonts (Open Font License)
- KJV: Use "Middle Ages" (designed by Måns Grebäck)
  - Source: https://www.dafont.com/middle-ages.font (personal use license)
- Note: Fonts should be embedded/bundled with app for offline use
- Fallback: System serif for Hebrew/Greek that supports Unicode ranges

Time‑warp maps (realistic plan)
- MVP: present-day map + Bible places + “Open in Google Maps/Earth”.
- Phase 2: time slider which switches between 3–5 “snapshot layers”.
  - Ancient/BC: likely places (CC BY gazetteer) + optional curated polygons labeled “approximate”.
  - 1500+ CE: OpenHistoricalMap may provide time-tagged boundaries (coverage varies).
  - Present: Natural Earth PD boundaries.

Sync plan (future)
- Sync only user data at first: reading position, highlights, notes, bookmarks, reading plans.
- Data packs stay local and are re-downloaded per device.

EXHAUSTIVE TODO LIST (living)

EPIC E0 — Repo + DX (Developer Experience)
- [x] Add TypeScript config base (tsconfig.base.json)
- [ ] Add ESLint config + prettier (optional)
- [ ] Add GitHub Actions: typecheck + tests
- [x] Add Codespaces devcontainer configuration

EPIC E1 — Domain model + interfaces (core)
- [x] Define canonical IDs: Book/Chapter/Verse (BCV), translation IDs, pack IDs
- [x] Define interfaces:
      - PackManager: list/install/remove packs; track versions
      - TextStore: getVerse/getChapter
      - SearchIndex: search(query)->results
      - LexiconStore: getStrong/getLemma
      - PlaceStore: place lookup + verse->places
      - UserDataStore: notes/highlights/bookmarks
- [ ] Define UI routing: /read/:translation/:book/:chapter, /search, /place/:id, /settings

EPIC E2 — PWA shell (small packs first)
- [x] Vite app + PWA service worker basic offline shell
- [ ] IndexedDB storage adapter
- [ ] Pack import (download .sqlite, verify checksum, store)
- [ ] Basic “install profile” UI (mobile-min)

EPIC E3 — Electron shell (power pack)
- [ ] Electron main process + renderer
- [ ] Filesystem pack storage + SQLite adapter
- [ ] Worker-based indexing (if needed)
- [ ] Optional: open dev server in Electron during dev

EPIC E4 — Pack builder tooling (packtools)
- [x] Pack manifest schema + validator
- [x] CLI: build packs from source inputs
- [ ] CLI: verify source downloads + hashes
- [x] Provenance log: record source URL, date, license, checksum
- [x] "Sample pack" for dev: tiny KJV/WEB subset (no copyrighted modern texts)

EPIC E5 — Reader MVP
- [ ] Render chapter-view
- [ ] Next/prev navigation
- [ ] Font controls, line spacing, night mode
- [ ] Parallel view (KJV + WEB side-by-side)

EPIC E6 — Search MVP
- [ ] Verse text search across installed translations
- [ ] Result grouping and navigation
- [ ] Later: token-level Strong’s search

EPIC E7 — Long-press menu
- [ ] Word selection for mouse/touch
- [ ] Actions: define, occurrences, copy, open lexicon

EPIC E8 — Lexicon + Strong’s
- [ ] Show Strong’s definition
- [ ] Link token -> Strong’s -> lemma -> morphology

EPIC E9 — Greek/Hebrew display
- [ ] Fonts + RTL Hebrew rendering
- [ ] Toggle interlinear or parallel panes

EPIC E10 — Places + maps
- [ ] Place entity pages (name, alt names, coords)
- [ ] Verse -> place links
- [ ] Open in Google Maps/Earth
- [ ] Offline basemap viewer in Electron (MBTiles)

EPIC E11 — Time slider overlays
- [ ] Support “eras” as overlay layers with year range
- [ ] Start with 3–5 layers where license/provenance is clean

EPIC E12 — Reading plan generator
- [ ] Selection UI (books/chapters, groups)
- [ ] Multipliers (OT xN, specific chapter xN)
- [ ] Date range + excluded weekdays
- [ ] Ordering (canonical/shuffled/chronological)
- [ ] Even distribution algorithm (difference <= 1 chapter per day when possible)

EPIC E13 — User data + (future) sync
- [ ] Notes/highlights/bookmarks stored locally
- [ ] Optional sync later (WebDAV/Dropbox/GitHub gist/custom server)

What to work on from a phone (Codespaces)
- docs updates, TODO refinement
- core algorithms (reading plan, query parsing)
- UI components (reader/search/menu)
- pack manifest validation logic

What to work on from desktop
- Electron packaging
- large pack builds
- MBTiles map experiments and GIS work

Git workflow (recommended)
- main: stable
- feature branches: feature/*
- Keep commits small and descriptive.

Getting started (Windows)
1) Install Node.js (LTS).
2) From repo root:
   - npm install
   - npm run dev:pwa

Run PWA + Electron together (desktop)
- npm run dev

Codespaces
- The repo includes `.devcontainer/devcontainer.json` so Codespaces can auto-install dependencies.
- In Codespaces, prefer `npm run dev:pwa` + core work. Electron packaging is best locally.

Next immediate milestones
- M1: PWA runs with placeholder UI and offline shell.
- M2: Electron runs and loads the same UI.
- M3: Pack manifest schema + tiny sample pack + basic reader view.

Next thing to do (recommended)
- Build a tiny "sample pack" pipeline in `packages/packtools`: JSON -> SQLite with a handful of verses.
  - Goal: unlock the real reader/search vertical slice without downloading any big datasets yet.
  - Deliverables: a CLI command that compiles `data-manifests/samples/*.json` (or a new `packs/samples/*.json`) into a small `.sqlite` pack + a verifier that checks schema + checksums.
