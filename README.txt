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
  - Classic PWA version. Full-featured with pack management, search, maps.
  - Uses IndexedDB/Cache API.
  - Run: npm run dev:pwa (port 5173)
- apps/pwa-polished
  - Modern Svelte-based PWA. Streamlined 2-dropdown navigation.
  - Gesture-based mobile-optimized interface.
  - Run: npm run dev:polished (port 5174)
  - Run both: npm run dev:all
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
=============================================================================
FEATURE RESEARCH: Potential Integrations from Major Biblical Resources
=============================================================================

This section documents capabilities of leading biblical/geographic platforms that could inspire
future ProjectBible features. User directive: "wow if my app could be a combo of that it would 
be the best app ever. is this possible? please save what you learn in the readme for features"

1. eBible.org — World Bible Translation Repository
   Website: https://ebible.org
   Developer Resources: https://ebible.org/Scriptures/
   
   What They Offer:
   - 1000+ Bible translations across 600+ languages
   - Multiple English translations (50+): ASV, BBE, BSB, Darby, ERV, Geneva 1599, KJV, 
     LSV, NET, NASB, WEB, YLT, Brenton Septuagint, etc.
   - International coverage: African languages (100+), Asian languages (300+), Pacific Islands,
     Indigenous Americas, European minority languages
   - Audio Bibles: MP3 and Ogg Vorbis formats for many translations
   - Multiple formats: USFM, USFX, OSIS, plain text, SWORD modules
   - Free download from /Scriptures/ directory
   - Study web app: https://ebible.org/study/
   
   License Model:
   - Public domain translations (KJV, WEB, ASV, BBE, etc.)
   - Creative Commons licenses for modern translations
   - Clear licensing metadata per translation
   
   Integration Possibilities:
   - Bulk import tool to add 50+ English translations to ProjectBible
   - Multi-language support: Add Spanish, French, Portuguese, Chinese, Arabic translations
   - Audio Bible player: Sync text with MP3 audio for listening mode
   - Translation comparison view: Show 3-5 translations side-by-side
   - Download manager: Browse eBible.org catalog and install translations on demand
   
   Technical Approach:
   - Parse USFM/USFX files from https://ebible.org/Scriptures/
   - Convert to ProjectBible pack format (SQLite verses table)
   - Store audio files alongside text packs for audio playback
   - Create metadata catalog (translation name, language, license, year)
   - Build UI for browsing/installing from 1000+ translation catalog

2. Pleiades Gazetteer — Ancient Places Database
   Website: https://pleiades.stoa.org
   Downloads: https://pleiades.stoa.org/downloads
   GitHub: https://github.com/isawnyu/pleiades.datasets
   
   What They Offer:
   - Comprehensive ancient world gazetteer (40,000+ places)
   - Scholarly place identification with precise coordinates
   - Historical name variations across different periods
   - Time periods: Archaic through Late Antique (3000 BC - 640 AD)
   - Connections to modern places via GeoNames URIs
   - Place types: settlements, regions, ethnic groups, waters, roads
   - Attestations: Links to ancient sources mentioning places
   
   Data Formats Available:
   - JSON (preferred): Complete dump with all attributes
     - Daily exports at https://atlantides.org/downloads/pleiades/json/
     - File: pleiades-places-latest.json.gz
   - CSV for GIS: QGIS-ready, general use
     - Download: https://atlantides.org/downloads/pleiades/gis/
   - KML: For Google Earth
   - RDF/Turtle: For linked data applications
   - GeoJSON: Abridged dataset via https://github.com/ryanfb/pleiades-geojson
   
   Quarterly Releases:
   - Numbered versions via GitHub: https://github.com/isawnyu/pleiades.datasets/releases
   - Archived at Zenodo.org: https://doi.org/10.5281/zenodo.1193921
   - Current release: 4.1 (May 28, 2025)
   
   License:
   - Creative Commons Attribution 3.0 (CC-BY)
   - Free for commercial and non-commercial use with attribution
   
   Integration Possibilities:
   - Import 40,000+ ancient places into ProjectBible places database
   - Add historical name variations (Greek, Latin, Hebrew, Aramaic forms)
   - Time-period filtering: Show places that existed in specific biblical eras
     - Patriarchal Period (2000-1500 BC)
     - United/Divided Kingdom (1000-586 BC)
     - Persian Period (539-330 BC)
     - Hellenistic/Roman Period (330 BC - 640 AD)
   - Scholarly coordinates: Replace approximate locations with precise Pleiades data
   - Modern connections: Link ancient places to modern GeoNames for "then and now" view
   - Source attestations: Show which ancient texts mention each place
   - Place type icons: Different markers for cities, regions, rivers, mountains
   
   Technical Approach:
   - Download daily JSON dump: pleiades-places-latest.json.gz
   - Parse JSON and extract: id, title, names (with languages/periods), locations (coordinates),
     place types, time periods (yearStart/yearEnd), connections, descriptions
   - Create places_pleiades table in SQLite:
     - id, title, primary_name, coordinates, place_type, year_start, year_end
   - Create places_names table for name variations:
     - place_id, name, language, romanized, time_period_id
   - Link to existing Bible places via name matching + coordinate proximity
   - UI: "View in Pleiades" button with scholarly details
   - Time slider: Filter places by biblical period

3. Ancient World Mapping Center (AWMC) — Interactive Historical Maps
   Website: https://awmc.unc.edu
   Platform: ArcGIS Experience (JavaScript-based)
   Note: Full feature details require alternative research (page blocked by JavaScript requirements)
   
   What We Know:
   - University of North Carolina academic project
   - ArcGIS-powered interactive ancient world maps
   - Historical layer overlays (kingdoms, empires, trade routes)
   - Zoom/pan functionality for exploring ancient geography
   - Time-period controls for showing different historical eras
   
   Observed Best Practices (from similar platforms):
   - Layer switcher: Toggle between different map overlays
   - Time slider: Animate historical changes over centuries
   - Place search: Find cities/regions and zoom to location
   - Information popups: Click place markers for details
   - Legend panel: Explain map symbols and colors
   - Export/share: Save map views or generate links
   
   Integration Possibilities:
   - Interactive map viewer (Leaflet.js) with existing GeoJSON historical layers
   - Time period selector: Switch between 11 biblical/historical eras
     - Already implemented: 11 historical_layers in maps.sqlite
     - Ancient Near East 2000 BC, Twelve Tribes 1000 BC, United Kingdom, etc.
   - Layer controls: Toggle visibility of kingdoms, routes, regions
   - Smooth zoom/pan navigation (already using Leaflet)
   - Place markers with click popups (verse references, descriptions)
   - Search box: Type place name and map zooms to location
   - Legend: Explain boundary colors and map symbols
   
   Technical Approach (Using Existing Data):
   - Already have: 11 historical_layers with GeoJSON boundaries in maps.sqlite
   - Enhance map viewer UI:
     - Add Leaflet layer controls for toggling layers on/off
     - Add time period dropdown selector (replaces simple list)
     - Add place search box (query places store, zoom to coordinates)
     - Add legend panel showing current layer info
     - Add zoom level controls and scale bar
   - Create animated time slider:
     - Smooth transitions between time periods
     - Auto-play option to watch historical progression
   - Add place tooltips: Hover over features to preview names
   - Integration with Bible text: Click map place → show verses mentioning it

=============================================================================
INTEGRATION ROADMAP: Combining All Three Resources
=============================================================================

Priority 1 — eBible.org Translation Library:
  - Download and parse 50+ English translations from https://ebible.org/Scriptures/
  - Build translation import tool (USFM → SQLite pack converter)
  - Add translation selector UI (dropdown with 50+ options)
  - Translation comparison view (2-3 side-by-side)
  - Estimated effort: 2-3 weeks
  - Impact: Massive content expansion, user choice

Priority 2 — Enhanced Map Viewer (AWMC-inspired):
  - Upgrade existing map viewer with layer controls
  - Add time period dropdown and smooth transitions
  - Add place search with autocomplete
  - Add legend panel for each historical layer
  - Estimated effort: 1 week
  - Impact: Professional map experience with existing data

Priority 3 — Pleiades Ancient Places Integration:
  - Download Pleiades JSON dump (40,000+ places)
  - Parse and import into places_pleiades table
  - Link to existing Bible places via name/coordinate matching
  - Add "Scholarly Details" panel with Pleiades data
  - Add time period filter (show only places from selected era)
  - Estimated effort: 2 weeks
  - Impact: Scholarly accuracy, historical name variations

Priority 4 — Audio Bible Support:
  - Download sample audio Bibles from eBible.org (MP3/Ogg)
  - Build audio player UI with text sync
  - Highlight current verse as audio plays
  - Estimated effort: 1-2 weeks
  - Impact: New study mode (reading + listening)

The Vision:
ProjectBible would combine:
- eBible.org's comprehensive translation library (1000+ translations, 600+ languages)
- AWMC's interactive mapping experience (zoom, pan, time slider, layers)
- Pleiades' scholarly place database (40,000+ ancient places, historical names)
- PLUS existing features: morphology, word study, cross-references, offline capability

Result: "The best app ever" — comprehensive, scholarly, interactive, offline-capable
        Bible study tool rivaling commercial products like Logos/Accordance but fully free.
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

EPIC E14 — Advanced text formatting & styling
- [ ] Custom font selection (user-configurable per translation/type)
  - KJV: Middle Ages/Gothic fonts
  - WEB: EB Garamond or modern serif
  - Greek/Hebrew: Specialized biblical fonts (SBL, Cardo)
- [ ] Font size adjustment (global + per-translation)
- [ ] Line spacing control (tight/normal/relaxed)
- [ ] Verse display modes:
  - New line per verse (current default)
  - Continuous paragraph flow
  - Poetry mode (indentation for Psalms, etc.)
- [ ] Custom color highlights (not just yellow)
  - Color picker for highlight backgrounds
  - Multiple highlight colors per user preference
  - Persist highlight color with verse reference
- [ ] Custom underline colors
  - Color picker for underlines
  - Underline style variants (solid/dashed/dotted)
  - Persist underline color + style with verse reference
- [ ] Word-level text color customization
  - Custom text colors per word
  - Persist word color with book:chapter:verse:position
- [ ] Style persistence across translations
  - Notes, underlines, highlights keyed to canonical references (not translation-specific)
  - Transfer annotations when switching translations
  - Smart handling when verse numbering differs between versions
- [ ] Theme support
  - Light/dark/sepia modes
  - Custom color schemes
  - High contrast accessibility mode

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
