import { defineConfig, defaultClientConditions } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';

// Plugin to copy bootstrap pack to build output and public folder (for dev)
// Bootstrap is a small (208KB) SQLite file with book metadata for instant startup
function copyBootstrapPack() {
  return {
    name: 'copy-bootstrap-pack',
    buildStart() {
      // Copy to public folder for dev server
      const bootstrapPath = resolve(__dirname, '../../packs/bootstrap.sqlite');
      const publicDir = resolve(__dirname, 'public');
      
      // Check if bootstrap exists
      if (!existsSync(bootstrapPath)) {
        console.warn('⚠️  Bootstrap pack not found at:', bootstrapPath);
        console.warn('   Run: node scripts/build-bootstrap-pack.mjs');
        return;
      }
      
      if (!existsSync(publicDir)) {
        mkdirSync(publicDir, { recursive: true });
      }
      
      // Copy bootstrap to public folder (for dev server)
      const publicDest = resolve(publicDir, 'bootstrap.sqlite');
      copyFileSync(bootstrapPath, publicDest);
      console.log('📦 Copied bootstrap pack to public/ (dev mode)');
    },
    closeBundle() {
      const bootstrapPath = resolve(__dirname, '../../packs/bootstrap.sqlite');
      const targetDir = resolve(__dirname, 'dist');
      
      // Check if bootstrap exists
      if (!existsSync(bootstrapPath)) {
        console.warn('⚠️  Bootstrap pack not found at:', bootstrapPath);
        console.warn('   Run: node scripts/build-bootstrap-pack.mjs');
        return;
      }
      
      // Copy bootstrap to dist root (accessible at /bootstrap.sqlite)
      const dest = resolve(targetDir, 'bootstrap.sqlite');
      copyFileSync(bootstrapPath, dest);
      
      console.log('\n📦 Bundled bootstrap pack (instant startup)\n');
    }
  };
}

// Plugin to copy the TTS runtime (onnxruntime + phonemizer WASM, ~30 MB) to /tts/.
// These are fetched lazily on first Read Aloud use and cached by the service
// worker's runtime route — deliberately NOT precached (see workbox config).
function copyTtsRuntime() {
  const nm = resolve(__dirname, '../../node_modules');
  // Look in the app's own node_modules before the root one. Another dependency
  // pinning a different onnxruntime version pushes our copy down here, and
  // assuming the root path silently copies the wrong version — or nothing.
  // Probing for a file we actually need also catches a version whose layout
  // changed, rather than copying whatever happens to be there.
  const ortDist = [
    resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
    resolve(nm, 'onnxruntime-web/dist'),
  ].find((d) => existsSync(resolve(d, 'ort-wasm-simd-threaded.wasm')));
  if (!ortDist) {
    throw new Error(
      'onnxruntime-web runtime not found. Expected ort-wasm-simd-threaded.wasm in ' +
        'apps/pwa-polished/node_modules or the root node_modules. Read Aloud would ' +
        'ship broken, so this fails the build rather than warning.'
    );
  }
  // onnxruntime renamed these after 1.18 and split the loader out into a
  // separate .mjs that sits beside each .wasm — both halves must be here or the
  // runtime cannot start. The plain build runs Piper on the processor; the jsep
  // build is the one that can use the graphics chip.
  const files = [
    [resolve(ortDist, 'ort-wasm-simd-threaded.wasm'), 'ort-wasm-simd-threaded.wasm'],
    [resolve(ortDist, 'ort-wasm-simd-threaded.mjs'), 'ort-wasm-simd-threaded.mjs'],
    [resolve(ortDist, 'ort-wasm-simd-threaded.jsep.wasm'), 'ort-wasm-simd-threaded.jsep.wasm'],
    [resolve(ortDist, 'ort-wasm-simd-threaded.jsep.mjs'), 'ort-wasm-simd-threaded.jsep.mjs'],
    [resolve(nm, '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm'), 'piper_phonemize.wasm'],
    [resolve(nm, '@diffusionstudio/piper-wasm/build/piper_phonemize.data'), 'piper_phonemize.data'],
  ];

  function copyTo(targetDir: string, label: string) {
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    let copied = 0;
    for (const [src, name] of files) {
      if (!existsSync(src)) {
        console.warn(`⚠️  TTS runtime file missing: ${src}`);
        continue;
      }
      copyFileSync(src, resolve(targetDir, name));
      copied++;
    }
    if (copied > 0) console.log(`🔊 Copied ${copied} TTS runtime file(s) to ${label}`);
  }

  return {
    name: 'copy-tts-runtime',
    buildStart() {
      copyTo(resolve(__dirname, 'public/tts'), 'public/tts (dev)');
    },
    closeBundle() {
      copyTo(resolve(__dirname, 'dist/tts'), 'dist/tts');
    }
  };
}

// Plugin to copy polished packs (only in dev or when USE_BUNDLED_PACKS=true)
function copyPolishedPacks() {
  return {
    name: 'copy-polished-packs',
    buildStart() {
      // Skip in production builds
      const isProduction = process.env.NODE_ENV === 'production' || 
                          process.env.VERCEL || 
                          process.env.CI;
      const useBundled = process.env.VITE_USE_BUNDLED_PACKS === 'true';
      
      if (isProduction && !useBundled) {
        console.log('📦 Skipping polished packs in buildStart (production mode)');
      }
      
      // Copy to public folder for dev server
      const polishedPacksDir = resolve(__dirname, '../../packs/polished');
      const publicPacksDir = resolve(__dirname, 'public/packs');
      const consolidatedPacksDir = resolve(__dirname, '../../packs/consolidated');
      const publicConsolidatedDir = resolve(__dirname, 'public/packs/consolidated');
      
      if (!existsSync(polishedPacksDir)) {
        console.warn('⚠️  No polished packs directory found');
      }
      
      if (!existsSync(publicPacksDir)) {
        mkdirSync(publicPacksDir, { recursive: true });
      }
      if (!existsSync(publicConsolidatedDir)) {
        mkdirSync(publicConsolidatedDir, { recursive: true });
      }
      
      const files = readdirSync(polishedPacksDir).filter(f => f.endsWith('.sqlite'));
      
      if (files.length === 0) {
        console.warn('⚠️  No packs in polished directory');
      }
      
      if (files.length > 0) {
        console.log('📦 Copying polished packs to public/ (dev mode):');
        files.forEach(file => {
          const src = resolve(polishedPacksDir, file);
          const dest = resolve(publicPacksDir, file);
          copyFileSync(src, dest);
          console.log(`   ✓ ${file}`);
        });
      }

      // Copy consolidated packs (for /packs/consolidated)
      if (existsSync(consolidatedPacksDir)) {
        const consolidatedFiles = readdirSync(consolidatedPacksDir).filter(f => f.endsWith('.sqlite'));
        if (consolidatedFiles.length > 0) {
          console.log('📦 Copying consolidated packs to public/ (dev mode):');
          consolidatedFiles.forEach(file => {
            const src = resolve(consolidatedPacksDir, file);
            const dest = resolve(publicConsolidatedDir, file);
            copyFileSync(src, dest);
            console.log(`   ✓ consolidated/${file}`);
          });
        }
      }
    },
    closeBundle() {
      // Skip in production builds (use GitHub Releases CDN instead)
      const isProduction = process.env.NODE_ENV === 'production' || 
                          process.env.VERCEL || 
                          process.env.CI;
      const useBundled = process.env.VITE_USE_BUNDLED_PACKS === 'true';
      
      if (isProduction && !useBundled) {
        console.log('\n📦 Skipping polished packs (will download from GitHub Releases)\n');
      }
      
      const polishedPacksDir = resolve(__dirname, '../../packs/polished');
      const targetDir = resolve(__dirname, 'dist/packs');
      const consolidatedPacksDir = resolve(__dirname, '../../packs/consolidated');
      const targetConsolidatedDir = resolve(__dirname, 'dist/packs/consolidated');
      
      if (!existsSync(polishedPacksDir)) {
        console.warn('⚠️  No polished packs directory found');
      }
      
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      if (!existsSync(targetConsolidatedDir)) {
        mkdirSync(targetConsolidatedDir, { recursive: true });
      }
      
      const files = readdirSync(polishedPacksDir).filter(f => f.endsWith('.sqlite'));
      
      if (files.length === 0) {
        console.warn('⚠️  No packs in polished directory');
      }
      
      if (files.length > 0) {
        console.log('\n📦 Bundling polished packs (dev mode):');
        files.forEach(file => {
          const src = resolve(polishedPacksDir, file);
          const dest = resolve(targetDir, file);
          copyFileSync(src, dest);
          console.log(`   ✓ ${file}`);
        });
        console.log(`\n✨ Bundled ${files.length} pack(s)\n`);
      }

      // Bundle consolidated packs
      if (existsSync(consolidatedPacksDir)) {
        const consolidatedFiles = readdirSync(consolidatedPacksDir).filter(f => f.endsWith('.sqlite'));
        if (consolidatedFiles.length > 0) {
          console.log('\n📦 Bundling consolidated packs (dev mode):');
          consolidatedFiles.forEach(file => {
            const src = resolve(consolidatedPacksDir, file);
            const dest = resolve(targetConsolidatedDir, file);
            copyFileSync(src, dest);
            console.log(`   ✓ consolidated/${file}`);
          });
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      // Neither of these is a manifest icon, and the glob only picks those up.
      // The badge is drawn by the service worker for a wake alarm; the gem
      // spins while Read Aloud generates speech — which is exactly something
      // people do offline, so it has to be cached.
      // The two KJV faces are needed on first paint, so they get precached.
      // The Custom-theme picker fonts do NOT — see the runtimeCaching rule.
      includeAssets: [
        'notification-badge-96.png',
        'pb-gem.png',
        'fonts/berry-rotunda.woff2',
        'fonts/teutonic4.woff2'
      ],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Wake alarm push + notification-tap handling. Workbox still generates
        // the service worker; this is its documented slot for adding a push
        // listener, so the caching config below is unaffected.
        importScripts: ['/push-handler.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MB (covers wa-sqlite-async.wasm at 2.28 MB)
        // TTS runtime files (~30 MB) are cached on first Read Aloud use, not
        // precached — users who never use TTS never pay the download. The
        // voice model itself lives in OPFS, managed by src/lib/tts/.
        // kokoro-test.html is a throwaway speed diagnostic (remove when done).
        // It must bypass the service worker entirely: precaching would replay a
        // stored response, and the navigation fallback below would hand back
        // index.html instead — either way the cross-origin-isolation headers it
        // needs would not be the ones the browser sees.
        globIgnores: ['**/tts/**', '**/kokoro-test.html'],
        navigateFallbackDenylist: [/^\/kokoro-test\.html$/],
        runtimeCaching: [
          {
            // .mjs included since onnxruntime 1.19: each .wasm now ships with a
            // loader beside it, and caching only the .wasm would leave Read
            // Aloud broken offline.
            urlPattern: /\/tts\/.+\.(wasm|data|mjs)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tts-runtime',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 8 }
            }
          },
          // Custom-theme reader fonts (~743 KB across 22 files). Cached the
          // first time a font is actually rendered rather than precached, so
          // someone who never opens the Custom theme never downloads any of
          // them. maxEntries covers every face plus the two KJV ones.
          {
            urlPattern: /\/fonts\/.+\.woff2$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'reader-fonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 32 }
            }
          }
        ]
      },
      manifest: {
        name: 'Hexapla',
        // Android labels notifications with short_name, so this is the name that
        // appears above a wake alarm. Changing it only takes effect after the
        // app is removed from the home screen and re-added.
        short_name: 'Hexapla',
        description: 'Immersive Bible reading experience',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        display: 'fullscreen',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    }),
    copyBootstrapPack(), // Always bundle bootstrap (208KB)
    copyPolishedPacks(), // Only in dev or when VITE_USE_BUNDLED_PACKS=true
    copyTtsRuntime()     // Read Aloud engine WASM → /tts/ (lazy-cached)
  ],
  server: {
    port: 5174,
    strictPort: false,  // Allow fallback to other ports if 5174 is in use
    host: '0.0.0.0',
    proxy: {
      '/api/pwa': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pwa/, '')
      }
    },
    fs: {
      allow: ['..', '../..']
    }
  },
  assetsInclude: ['**/*.wasm', '**/*.sqlite'],

  resolve: {
    // onnxruntime 1.19+ ships two builds behind this export condition. The
    // default one references its .wasm statically so a bundler will emit it,
    // which lands a 24 MB copy in assets/ and fails the build when workbox
    // refuses to precache it. We serve the runtime ourselves from /tts/ (see
    // copyTtsRuntime above and wasmPaths in piperEngine.ts), so we want the
    // extern build, which resolves the file at runtime instead.
    // The defaults must be spread back in: conditions replaces, not extends.
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: true
  }
});
