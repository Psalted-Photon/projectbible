import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';

// Plugin to copy polished packs to build output
function copyPolishedPacks() {
  return {
    name: 'copy-polished-packs',
    closeBundle() {
      const polishedPacksDir = resolve(__dirname, '../../packs/polished');
      const targetDir = resolve(__dirname, 'dist/assets/packs');
      
      // Create target directory if it doesn't exist
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
      
      // Check if polished packs directory exists
      if (!existsSync(polishedPacksDir)) {
        console.warn('⚠️  No polished packs directory found at:', polishedPacksDir);
        console.warn('   Create packs/polished/ and add .sqlite files to bundle with the app');
        return;
      }
      
      // Copy all .sqlite files from polished to dist
      const files = readdirSync(polishedPacksDir).filter(f => f.endsWith('.sqlite'));
      
      if (files.length === 0) {
        console.warn('⚠️  No .sqlite packs found in packs/polished/');
        console.warn('   Add packs to bundle with the polished app');
        return;
      }
      
      console.log('\n📦 Bundling polished packs:');
      files.forEach(file => {
        const src = resolve(polishedPacksDir, file);
        const dest = resolve(targetDir, file);
        copyFileSync(src, dest);
        console.log(`   ✓ ${file}`);
      });
      console.log(`\n✨ Bundled ${files.length} pack(s) into polished build\n`);
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
    copyPolishedPacks()
  ],
  server: {
    port: 5174,
    strictPort: true,
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
