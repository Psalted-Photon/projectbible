# Vercel Deployment Guide

This document explains how the three submodule apps (TrivCanon, LampStand, and GuessTheFlag) are configured to deploy on Vercel, and how to set up similar deployments for ProjectBible.

## Submodule Apps Overview

### 1. **TrivCanon** - React + Vite PWA
- **Location**: `apps/trivcanon/app/`
- **Stack**: React 19, Vite 7, PWA (Progressive Web App)
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Key Features**:
  - Static site generation with Vite
  - PWA with offline support (Workbox)
  - Questions stored as static JSON files
  - No backend/API needed

### 2. **LampStand** - Next.js 16 Full-Stack App
- **Location**: `apps/lampstand/`
- **Stack**: Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Key Features**:
  - Server-side rendering (SSR)
  - API routes for article extraction and analysis
  - SQLite database (disabled on Vercel serverless)
  - RSS feed fetching and Bible scripture lookups
  - Integration with Groq AI API

### 3. **GuessTheFlag** - Static HTML/CSS/JS PWA
- **Location**: `apps/guesstheflag/`
- **Stack**: Vanilla JavaScript, Service Worker PWA
- **Build Command**: None (static files)
- **Output Directory**: `.` (root)
- **Key Features**:
  - Pure HTML/CSS/JS - no build step
  - PWA with offline caching
  - Flag data in static JSON
  - 264 flags (countries + US states)

---

## How They Deploy on Vercel

### TrivCanon Deployment

**vercel.json** (minimal):
```json
{
  "name": "trivcanon"
}
```

**Why it works:**
1. Vercel auto-detects Vite from `package.json`
2. Runs `npm run build` automatically
3. Serves static files from `dist/` directory
4. PWA service worker works natively
5. All routes handled by client-side routing

**Deployment Steps:**
1. Connect GitHub repo to Vercel
2. Vercel detects Vite framework
3. Root directory: `app/`
4. Build command: `npm run build` (auto-detected)
5. Output directory: `dist` (auto-detected)

---

### LampStand Deployment

**No vercel.json needed** - Next.js is natively supported

**Why it works:**
1. Vercel created Next.js - it's the primary framework
2. Auto-detects Next.js from `package.json`
3. Runs `npm run build` automatically
4. Deploys as serverless functions
5. API routes become serverless edge functions

**Key Considerations:**
- SQLite database is disabled on Vercel (serverless environment)
- Uses `process.env.VERCEL === '1'` to detect serverless mode
- Environment variables set in Vercel dashboard:
  - `BIBLE_API_KEY`
  - `AI_PROVIDER=groq`
  - `GROQ_API_KEY`
  - `GROQ_MODEL`

**Deployment Steps:**
1. Connect GitHub repo to Vercel
2. Vercel auto-detects Next.js
3. Root directory: `./` (project root)
4. Build command: `npm run build` (auto-detected)
5. Environment variables added via Vercel dashboard

---

### GuessTheFlag Deployment

**No vercel.json or package.json** - Pure static site

**Why it works:**
1. Vercel serves static HTML/CSS/JS files directly
2. No build step needed
3. Service worker runs in browser
4. All assets cached locally

**Deployment Steps:**
1. Connect GitHub repo to Vercel
2. Vercel detects static site (no framework)
3. Root directory: `./` (project root)
4. Build command: (empty/none)
5. Output directory: `./` or `public` if preferred

---

## Common Vercel Patterns

### 1. Framework Auto-Detection
Vercel automatically detects:
- Next.js (from `next.config.js`)
- Vite (from `vite.config.js`)
- React (Create React App)
- Vue, Angular, Svelte, etc.

### 2. Build Configuration Priority
1. `vercel.json` (if exists)
2. Framework defaults
3. `package.json` scripts

### 3. Environment Variables
Set in Vercel dashboard:
- Production, Preview, Development scopes
- Encrypted and secure
- Available as `process.env.VAR_NAME`

### 4. Serverless vs Static
- **Static**: Pure HTML/CSS/JS, Vite, Create React App
  - Served from CDN edge network
  - No server-side code
  - Fastest performance

- **Serverless**: Next.js, API routes
  - Functions run on-demand
  - Each route = separate lambda
  - No persistent storage (no SQLite)

---

## ProjectBible Vercel Setup

### Option 1: Monorepo with Vercel Projects

**Structure:**
```
ProjectBible/
├── apps/
│   ├── pwa/          → Deploy as separate Vercel project
│   ├── electron/     → Not for Vercel (desktop app)
│   ├── trivcanon/    → Already deployed
│   ├── lampstand/    → Already deployed
│   └── guesstheflag/ → Already deployed
├── packages/
│   └── core/         → Shared code (not deployed separately)
└── packs/            → Static data
```

**Deploy PWA to Vercel:**

1. **Create `apps/pwa/vercel.json`:**
```json
{
  "name": "projectbible-pwa",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "routes": [
    {
      "handle": "filesystem"
    },
    {
      "src": "/(.*)",
      "dest": "/index.html"
    }
  ]
}
```

2. **Update `apps/pwa/vite.config.ts`:**
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'ProjectBible',
        short_name: 'ProjectBible',
        description: 'Bible study application with morphology packs',
        theme_color: '#2563eb',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,json}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.(woff2|woff|ttf)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
```

3. **Deploy to Vercel:**
```bash
# Install Vercel CLI
npm i -g vercel

# From apps/pwa directory
cd apps/pwa
vercel

# Follow prompts:
# - Set up new project: Yes
# - Project name: projectbible-pwa
# - Link to existing: No
# - Root directory: ./
```

### Option 2: Separate Repositories

If monorepo is too complex:

1. Create separate repos:
   - `projectbible-pwa` (from `apps/pwa`)
   - Keep core packages as npm packages or git submodules

2. Each repo deploys independently to Vercel

---

## Key Lessons from Submodule Apps

### From TrivCanon:
- ✅ Vite builds are fast and efficient on Vercel
- ✅ PWA works perfectly with static deployment
- ✅ Large JSON files (questions) work fine in `public/`
- ✅ Service workers cache everything for offline use

### From LampStand:
- ✅ Next.js API routes = serverless functions
- ✅ SQLite doesn't work on Vercel (use external DB or disable caching)
- ✅ Environment variables for API keys work great
- ✅ RSS feeds and external API calls work fine
- ⚠️ Check for serverless compatibility: `process.env.VERCEL === '1'`

### From GuessTheFlag:
- ✅ Static HTML sites deploy instantly
- ✅ No build step = no build errors
- ✅ Service workers and PWA features work natively
- ✅ Perfect for demos and simple apps

---

## Troubleshooting Vercel Deployments

### Build Fails
1. Check `package.json` scripts
2. Ensure `build` command exists
3. Check Node.js version compatibility
4. Review build logs in Vercel dashboard

### Routes Not Working
1. Add catch-all route in `vercel.json`
2. For SPAs, redirect all to `index.html`
3. Check `.gitignore` isn't excluding necessary files

### Environment Variables
1. Set in Vercel dashboard (Settings → Environment Variables)
2. Restart deployment after adding variables
3. Prefix browser variables with `VITE_` or `NEXT_PUBLIC_`

### Large Files
1. Vercel has 100MB deployment limit
2. Use CDN for large assets
3. Compress images and data files
4. Consider external storage (S3, Cloudinary)

---

## Next Steps for ProjectBible

1. **Choose deployment strategy**: Monorepo or separate repos
2. **Set up Vercel project** for PWA app
3. **Configure environment variables** (if needed)
4. **Add `vercel.json`** with appropriate settings
5. **Test locally** with `vercel dev`
6. **Deploy** with `vercel --prod`

---

## Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/nextjs)
- [PWA on Vercel](https://vercel.com/guides/deploying-pwa)
