# ProjectBible — AI Agent Instructions

## The App

**Always work in `apps/pwa-polished/`** — this is the only production app. Never touch other apps (`pwa`, `lampstand`, `trivcanon`, etc.) unless explicitly asked.

Live site: **projectbible.vercel.app** — every git push triggers a Vercel deploy. There is no local dev server in use.

## Commit & Deploy Workflow

- Commit after every distinct change
- Push to git often — that is what deploys to the live site
- No local builds or previews needed

## Tech Stack

- **Svelte 5** + TypeScript + Vite
- **wa-sqlite** / **PowerSync** — local SQLite in-browser
- **Supabase** — auth + sync backend
- **Vercel** — hosting (auto-deploy on push)

## Terminology

| User's word | What it means in code |
|---|---|
| **Navbar** | Top menu bar → `src/components/NavigationBar.svelte` |
| **Bumpers** | All 4 screen edges — drag inward to open a new window → `src/components/EdgeGestureDetector.svelte` |
| **Windows** | Panels docked to any edge, managed by `src/lib/stores/windowStore.ts` |

## Key Files

| File | What it is |
|---|---|
| `src/App.svelte` | Root component |
| `src/components/NavigationBar.svelte` | Navbar (top menu) |
| `src/components/EdgeGestureDetector.svelte` | Bumpers (edge drag zones, 40px wide) |
| `src/components/WindowContainer.svelte` | Renders all open windows |
| `src/components/Window.svelte` | Single window panel |
| `src/lib/stores/windowStore.ts` | Window open/close/resize state |
| `src/adapters/settings.ts` | Theme, font size, line spacing |
| `src/config.ts` | Feature flags, pack URLs |
| `src/main.ts` | App entry, applies CSS vars on load |

## CSS Variables (set on `<html>`)

| Variable | Default | Controls |
|---|---|---|
| `--base-font-size` | `18px` | Bible text size |
| `--line-spacing` | `1.8` | Line height |

## Pack System

- `bootstrap.sqlite` — always bundled (~208KB), loaded on first start
- All other packs — lazy-loaded from GitHub Releases CDN
- Packs live in `packs/` at monorepo root

### Pack Rules

- All `.sqlite` pack files are stored in `C:\Users\Marlowe\Desktop\ProjectBible\packs\` or `packs/consolidated/` — nowhere else
- The manifest (`manifest.json`) lives in `packs/consolidated/` and **must be updated whenever a pack changes** (size, filename, description, etc.)
- **GitHub Release version is always `v1.0.0`** — do not create new release versions. The app is still growing; versioning will change only when explicitly asked
- The user manually uploads updated `.sqlite` files to the GitHub release at `v1.0.0` after being told they're ready
- When a pack is updated, always remind the user: upload the new `.sqlite` to GitHub Releases `v1.0.0`, and the updated `manifest.json` as well
- Install buttons in the app must be wired to the correct GitHub Releases `v1.0.0` download URL for each pack — verify the URL matches the actual filename in the release before considering a pack "done"

## Communication Style

**Keep plans short and in plain language.** Do not list files, technical steps, or explain what each file does — just say what will change. When a number is involved, always show the **current value** and suggest a specific **new value** (e.g. "currently 18px — want 20px, or bigger?"). Ask for confirmation on anything that changes visible behavior. Let the user approve direction; handle the code details silently.

## Accuracy

Double-check current values before reporting them. Read the file first — do not guess or estimate sizes, colors, or settings.

**Never state a number, limit, or external fact as if you know it when you don't.** If you are not certain, say "I don't know" or "I'm not sure — you should verify this." Giving a confident wrong answer wastes the user's time and money. Uncertainty is always preferable to a fabricated fact.

## Before Starting Any Task

1. **Read these instructions first.** Do not begin implementation without checking whether the answer is already here.
2. **Follow existing architecture.** If the instructions describe how something works (e.g. packs come from GitHub Releases `v1.0.0`), apply that same pattern to new work — do not invent an alternative.
3. **Do not question established patterns** without first reading the instructions to confirm they don't already answer the question.
