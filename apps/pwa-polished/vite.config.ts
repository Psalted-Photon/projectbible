import { defineConfig } from 'vite';
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
      manifest: {
        name: 'ProjectBible - Polished',
        short_name: 'Bible',
        description: 'Immersive Bible reading experience',
        theme_color: '#1a1a1a',
        icons: []
      }
    }),
    copyBootstrapPack(), // Always bundle bootstrap (208KB)
    copyPolishedPacks()  // Only in dev or when VITE_USE_BUNDLED_PACKS=true
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
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: true
  }
});
