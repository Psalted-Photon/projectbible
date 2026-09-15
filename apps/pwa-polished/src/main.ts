console.log('🔥 MAIN.TS LOADING...');

import { mount } from 'svelte';
import App from './App.svelte';
import { hasStarterText, installStarterText, warmPackManifest } from './lib/progressive-init';
import { applyTheme, getSettings } from './adapters/settings';
import { FEATURES } from './config';
import './adapters/tts'; // Read Aloud engine client (registers __tts dev hook; worker starts lazily)
import { initMediaSession } from './lib/tts/mediaSession';
import { dumpPreviousInstallLog } from './lib/install-log';

console.log('🔥 IMPORTS LOADED');

console.log('🔥 GETTING APP ELEMENT');

function getAppElement(): HTMLElement {
  const element = document.getElementById('app');
  if (!element) {
    console.error('❌ NO APP ELEMENT FOUND!');
    throw new Error('No #app element found');
  }
  return element;
}

const appElement = getAppElement();

console.log('🔥 APP ELEMENT FOUND:', appElement);

// Apply initial settings
function applyInitialSettings() {
  const settings = getSettings();
  
  // Apply theme
  applyTheme(settings.theme || 'dark');
  
  // Apply font size
  const fontSize = settings.fontSize || 18;
  document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);
  
  // Apply line spacing
  const lineSpacing = settings.lineSpacing || 1.8;
  document.documentElement.style.setProperty('--line-spacing', lineSpacing.toString());
}

// Apply settings before app loads
applyInitialSettings();

// Initialize app with progressive loading
async function initApp() {
  console.log('🚀 Starting app initialization...');
  console.log('Environment:', import.meta.env.DEV ? 'DEV' : 'PROD');
  console.log('Features:', FEATURES);

  // If a pack install killed the tab, its breadcrumbs outlived the crash.
  // Replay them here, since the console buffer did not survive.
  dumpPreviousInstallLog();

  // Request persistent storage so the browser won't evict IndexedDB/OPFS under pressure.
  // Without this, mobile OSes can silently delete all pack data overnight.
  if (navigator.storage?.persist) {
    navigator.storage.persist().then(granted =>
      console.log('[Storage] Persistent storage granted:', granted)
    );
  }

  // Mirror Read Aloud onto the lock screen. Beyond showing the chapter, this is
  // what marks the page as a media player, so the phone is far less willing to
  // throttle it once the screen goes off.
  initMediaSession();

  // The speech runtime used to be cached under a name with no version in it.
  // Its filenames never change between onnxruntime releases - only the contents
  // do - and the cache is CacheFirst, so upgrading left devices serving an old
  // binary to new JavaScript and both voices died with an unreadable error.
  // The cache key now carries the version; this clears the poisoned one that
  // predates that, which workbox's own cleanup does not touch.
  void caches
    ?.delete('tts-runtime')
    .then((gone) => gone && console.log('🔊 Cleared the old unversioned speech-runtime cache'))
    .catch(() => {});
  
  // In dev mode the packs are bundled, so mount immediately
  if (import.meta.env.DEV) {
    console.log('✅ Dev mode - mounting app immediately');
    const app = mount(App, {
      target: appElement
    });
    return app;
  }

  // The one thing launch waits for: that there is something to read. On every
  // launch after the first this is a single database check and nothing is
  // drawn, so the app goes straight up. Only a device with no text — a first
  // launch, or one whose starter install failed — sees the screen below.
  if (!(await hasStarterText())) {
    appElement.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #1a1a1a; color: white; font-family: 'Milonga', cursive;">
        <h1 style="margin-bottom: 20px;">Hexapla</h1>
        <div style="width: 300px; background: #333; border-radius: 8px; padding: 20px;">
          <div id="init-message" style="margin-bottom: 10px; text-align: center;">Getting the text...</div>
          <div style="width: 100%; height: 6px; background: #555; border-radius: 3px; overflow: hidden;">
            <div id="init-progress" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); transition: width 0.3s;"></div>
          </div>
          <div id="init-percent" style="margin-top: 10px; text-align: center; font-size: 12px; color: #888;">0%</div>
        </div>
      </div>
    `;

    // Never throws: a device that could not get the text still reaches the
    // reader, which says so itself rather than leaving a dead loading bar.
    await installStarterText((message, percent) => {
      const messageEl = document.getElementById('init-message');
      const progressEl = document.getElementById('init-progress');
      const percentEl = document.getElementById('init-percent');

      if (messageEl) messageEl.textContent = message;
      if (progressEl) progressEl.style.width = `${percent}%`;
      if (percentEl) percentEl.textContent = `${percent}%`;
    });

    appElement.innerHTML = '';
  }

  // Mount the main app
  const app = mount(App, {
    target: appElement
  });

  // Everything that does not have to happen first happens here, with the app
  // already on screen behind it.
  warmPackManifest();

  return app;
}

// Start initialization
const app = await initApp();

export default app;
