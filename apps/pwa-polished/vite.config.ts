import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

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
    })
  ],
  server: {
    port: 5174,
    strictPort: false,
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
