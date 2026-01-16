import { mount } from 'svelte';
import App from './App.svelte';
import { initializePolishedApp, isInitialized } from './lib/pack-init';
import { getSettings } from './adapters/settings';

const appElement = document.getElementById('app');

if (!appElement) {
  throw new Error('No #app element found');
}

// Apply initial settings
function applyInitialSettings() {
  const settings = getSettings();
  
  // Apply theme
  const theme = settings.theme || 'dark';
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
    document.body.classList.remove('light-theme');
  } else {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  }
  
  // Apply font size
  const fontSize = settings.fontSize || 18;
  document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);
  
  // Apply line spacing
  const lineSpacing = settings.lineSpacing || 1.8;
  document.documentElement.style.setProperty('--line-spacing', lineSpacing.toString());
}

// Apply settings before app loads
applyInitialSettings();

// Initialize app with bundled packs on first run
async function initApp() {
  if (!isInitialized()) {
    // Show loading screen during first-run initialization
    appElement.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #1a1a1a; color: white; font-family: sans-serif;">
        <h1 style="margin-bottom: 20px;">ProjectBible</h1>
        <div style="width: 300px; background: #333; border-radius: 8px; padding: 20px;">
          <div id="init-message" style="margin-bottom: 10px; text-align: center;">Initializing...</div>
          <div style="width: 100%; height: 6px; background: #555; border-radius: 3px; overflow: hidden;">
            <div id="init-progress" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); transition: width 0.3s;"></div>
          </div>
          <div id="init-percent" style="margin-top: 10px; text-align: center; font-size: 12px; color: #888;">0%</div>
        </div>
      </div>
    `;
    
    try {
      await initializePolishedApp((message, percent) => {
        const messageEl = document.getElementById('init-message');
        const progressEl = document.getElementById('init-progress');
        const percentEl = document.getElementById('init-percent');
        
        if (messageEl) messageEl.textContent = message;
        if (progressEl) progressEl.style.width = `${percent}%`;
        if (percentEl) percentEl.textContent = `${percent}%`;
      });
      
      // Clear loading screen
      appElement.innerHTML = '';
      
    } catch (error) {
      console.error('Failed to initialize app:', error);
      appElement.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #1a1a1a; color: white; font-family: sans-serif;">
          <h1 style="color: #f44336; margin-bottom: 20px;">Initialization Failed</h1>
          <p style="max-width: 400px; text-align: center; color: #888;">
            Could not initialize the app. Please check your internet connection and refresh the page.
          </p>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">
            Error: ${error.message}
          </p>
          <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
            Retry
          </button>
        </div>
      `;
      return;
    }
  }
  
  // Mount the main app
  const app = mount(App, {
    target: appElement
  });
  
  return app;
}

// Start initialization
const app = await initApp();

export default app;
