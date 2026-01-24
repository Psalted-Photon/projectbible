<script lang="ts">
  import { onMount } from "svelte";
  import { applyTheme, getSettings, updateSettings } from "../../adapters/settings";
  import { paneStore } from "../../stores/paneStore";

  let theme: "light" | "dark" | "auto" | "sepia" = "dark";
  let fontSize = 18;
  let lineSpacing = 1.8;
  let verseLayout: "one-per-line" | "paragraph" = "one-per-line";
  let wordWrap: boolean = true;
  let savedMessage = false;
  let clearing = false;

  // Load settings on mount
  onMount(() => {
    const settings = getSettings();
    theme = settings.theme || "dark";
    fontSize = settings.fontSize || 18;
    lineSpacing = settings.lineSpacing || 1.8;
    verseLayout = settings.verseLayout || "one-per-line";
    wordWrap = settings.wordWrap !== undefined ? settings.wordWrap : true;
  });

  async function clearCacheAndReload() {
    if (!confirm('This will clear all cached data (packs, service worker, etc.) and reload the app. Continue?')) {
      return;
    }

    clearing = true;

    try {
      // 1. Clear all IndexedDB databases
      if ('indexedDB' in window) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            indexedDB.deleteDatabase(db.name);
            console.log(`Deleted database: ${db.name}`);
          }
        }
      }

      // 2. Clear all caches (Service Worker caches)
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => {
            console.log(`Deleting cache: ${cacheName}`);
            return caches.delete(cacheName);
          })
        );
      }

      // 3. Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map(registration => {
            console.log('Unregistering service worker');
            return registration.unregister();
          })
        );
      }

      // 4. Clear localStorage (except user settings if you want to preserve them)
      // Uncomment the next line if you want to clear everything including settings:
      // localStorage.clear();

      // 5. Clear sessionStorage
      sessionStorage.clear();

      // 6. Force reload from server (bypass cache)
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('Error clearing cache:', error);
      alert('Error clearing cache. Check console for details.');
      clearing = false;
    }
  }

  function applySettings() {
    // Apply theme
    applyTheme(theme);

    // Apply font size via CSS variable
    document.documentElement.style.setProperty(
      "--base-font-size",
      `${fontSize}px`,
    );

    // Apply line spacing via CSS variable
    document.documentElement.style.setProperty(
      "--line-spacing",
      lineSpacing.toString(),
    );

    // Apply word wrap
    if (wordWrap) {
      document.documentElement.style.setProperty("--word-wrap", "normal");
    } else {
      document.documentElement.style.setProperty("--word-wrap", "nowrap");
    }
  }

  function saveSettings() {
    updateSettings({
      theme,
      fontSize,
      lineSpacing,
      verseLayout,
      wordWrap,
    });

    // Apply settings immediately
    applySettings();

    // Show saved message
    savedMessage = true;
    setTimeout(() => {
      savedMessage = false;
    }, 2000);

    // Trigger a custom event to notify BibleReader to re-render
    window.dispatchEvent(new CustomEvent("settingsUpdated"));
  }

  function openPacksPane() {
    paneStore.openPane("packs", "right");
  }

  // Apply settings on value changes (live preview)
  $: {
    fontSize;
    lineSpacing;
    theme;
    wordWrap;
    applySettings();
  }
</script>

<div class="settings-pane">
  <h2><span class="emoji">⚙️</span> Display Settings</h2>

  <div class="setting-group">
    <label>
      <span class="label-text">Theme</span>
      <select bind:value={theme}>
        <option value="auto">Auto</option>
        <option value="sepia">Sepia</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  </div>

  <div class="setting-group">
    <label>
      <span class="label-text">Font Size: {fontSize}px</span>
      <input type="range" min="12" max="32" bind:value={fontSize} />
    </label>
  </div>

  <div class="setting-group">
    <label>
      <span class="label-text">Line Spacing: {lineSpacing.toFixed(1)}</span>
      <input
        type="range"
        min="1"
        max="2.5"
        step="0.1"
        bind:value={lineSpacing}
      />
    </label>
  </div>

  <div class="setting-group">
    <label>
      <span class="label-text">Verse Layout</span>
      <select bind:value={verseLayout}>
        <option value="one-per-line">Each verse on new line</option>
        <option value="paragraph">Paragraph (flow like book)</option>
      </select>
    </label>
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={wordWrap} />
      <span class="label-text">Word Wrap (wrap long lines)</span>
    </label>
  </div>

  <div class="button-group">
    <button class="save-button" on:click={saveSettings}> Save Settings </button>
    {#if savedMessage}
      <span class="saved-indicator">✓ Saved</span>
    {/if}
  </div>

  <!-- Pack Management Section -->
  <div class="pack-management-section">
    <h3><span class="emoji">📦</span> Pack Management</h3>
    <p class="section-description">
      Manage installed Bible translations, lexicons, maps, and other resources.
    </p>
    <button class="packs-button" on:click={openPacksPane}>
      <span class="icon emoji">📦</span>
      <span class="text">Manage Packs</span>
      <span class="arrow">→</span>
    </button>
  </div>

  <!-- Cache Management Section -->
  <div class="cache-management-section">
    <h3><span class="emoji">🔄</span> Cache Management</h3>
    <p class="section-description">
      Clear all cached data including packs, service workers, and databases. Use this if packs aren't installing or the app is stuck with old data.
    </p>
    <button 
      class="clear-cache-button" 
      on:click={clearCacheAndReload}
      disabled={clearing}
    >
      <span class="icon emoji">🗑️</span>
      <span class="text">{clearing ? 'Clearing...' : 'Clear Cache & Reload'}</span>
    </button>
  </div>

  <p class="note">
    Settings are saved to your browser and will persist across sessions.
  </p>
</div>

<style>
  .settings-pane {
    padding: 20px;
    color: #e0e0e0;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 2rem;
    color: #f0f0f0;
    font-weight: 600;
  }

  .setting-group {
    margin-bottom: 2rem;
  }

  .setting-group label {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .checkbox-label {
    flex-direction: row !important;
    align-items: center;
    gap: 0.75rem !important;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: #667eea;
  }

  .label-text {
    font-size: 0.95rem;
    color: #ccc;
    font-weight: 500;
  }

  select {
    width: 100%;
    padding: 0.75rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 0.95rem;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  select:hover {
    border-color: #667eea;
  }

  select:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  input[type="range"] {
    width: 100%;
    height: 6px;
    background: #3a3a3a;
    border-radius: 3px;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    background: #667eea;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }

  input[type="range"]::-webkit-slider-thumb:hover {
    background: #7e8ff0;
    transform: scale(1.1);
  }

  input[type="range"]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    background: #667eea;
    border-radius: 50%;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }

  input[type="range"]::-moz-range-thumb:hover {
    background: #7e8ff0;
    transform: scale(1.1);
  }

  .button-group {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 2rem;
    margin-bottom: 2rem;
  }

  .save-button {
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  }

  .save-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .save-button:active {
    transform: translateY(0);
  }

  .saved-indicator {
    color: #4caf50;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .pack-management-section {
    margin-top: 2.5rem;
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: linear-gradient(
      135deg,
      rgba(102, 126, 234, 0.05),
      rgba(118, 75, 162, 0.05)
    );
    border: 1px solid rgba(102, 126, 234, 0.2);
    border-radius: 8px;
  }

  .pack-management-section h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    color: #f0f0f0;
  }

  .section-description {
    margin: 0 0 1.5rem 0;
    color: #aaa;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .packs-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  }

  .packs-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .packs-button:active {
    transform: translateY(0);
  }

  .packs-button .icon {
    font-size: 1.5rem;
  }

  .packs-button .text {
    flex: 1;
    text-align: left;
  }

  .packs-button .arrow {
    font-size: 1.2rem;
    opacity: 0.7;
  }

  .cache-management-section {
    margin-top: 1.5rem;
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: linear-gradient(
      135deg,
      rgba(244, 67, 54, 0.05),
      rgba(233, 30, 99, 0.05)
    );
    border: 1px solid rgba(244, 67, 54, 0.2);
    border-radius: 8px;
  }

  .cache-management-section h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    color: #f0f0f0;
  }

  .clear-cache-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: linear-gradient(135deg, #f44336 0%, #e91e63 100%);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(244, 67, 54, 0.3);
  }

  .clear-cache-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(244, 67, 54, 0.4);
  }

  .clear-cache-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .clear-cache-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .clear-cache-button .icon {
    font-size: 1.5rem;
  }

  .clear-cache-button .text {
    flex: 1;
    text-align: left;
  }

  .note {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(102, 126, 234, 0.1);
    border-left: 3px solid #667eea;
    border-radius: 4px;
    color: #aaa;
    font-size: 0.85rem;
    line-height: 1.5;
  }
</style>
