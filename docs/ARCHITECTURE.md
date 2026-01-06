# Architecture

## Goal
One shared app core, two shells (PWA + Electron), two adapters.

## Packages
- packages/core: no platform APIs.
- apps/pwa: web shell + IndexedDB/Cache adapter.
- apps/electron: desktop shell + filesystem/SQLite adapter.
- packages/packtools: build/validate packs.

## Interfaces (core)
- PackManager
- TextStore
- SearchIndex
- LexiconStore
- PlaceStore
- UserDataStore

## Pack formats
- SQLite: text/search/lexicons/places.
- MBTiles: offline map tiles/overlays (Electron-first).

## Data provenance
Every pack must include machine-readable attribution and a pointer to its source manifest.
