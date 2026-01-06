# Development

## Quick start (local)

```powershell
cd "c:\\Users\\Marlowe\\Desktop\\ProjectBible"
npm install
npm run dev:pwa
```

## Run PWA + Electron together (desktop)

1) Start both:

```powershell
npm run dev
```

- This starts the PWA dev server, waits for `http://127.0.0.1:5173`, then launches Electron.

## Codespaces workflow

What works great in Codespaces:
- `npm run dev:pwa` (web preview)
- core logic (`packages/core`), UI, docs, pack tooling

What is best done locally on desktop:
- Running/packaging Electron
- SQLite performance testing and large pack builds
- Offline MBTiles experiments

## Useful scripts
- `npm run dev:pwa`: run web app
- `npm run dev`: run PWA + Electron (Electron expects local desktop)
- `npm run build:pwa`: production build
- `npm -w packages/core run build`: build core

## Data packs
- Don’t commit large pack binaries to git (see `.gitignore`).
- Track dataset sources in `data-manifests/`.
