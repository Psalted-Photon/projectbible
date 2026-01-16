<script lang="ts">
  import { onMount } from "svelte";
  import { getSettings, updateSettings } from "../../adapters/settings";

  let theme: "light" | "dark" = "dark";
  let fontSize = 18;
  let lineSpacing = 1.8;
  let verseLayout: "one-per-line" | "paragraph" = "one-per-line";
  let savedMessage = false;

  // Load settings on mount
  onMount(() => {
    const settings = getSettings();
    theme = settings.theme || "dark";
    fontSize = settings.fontSize || 18;
    lineSpacing = settings.lineSpacing || 1.8;
    verseLayout = settings.verseLayout || "one-per-line";
  });

  function applySettings() {
    // Apply theme
    if (theme === "dark") {
      document.body.classList.add("dark-theme");
      document.body.classList.remove("light-theme");
    } else {
      document.body.classList.add("light-theme");
      document.body.classList.remove("dark-theme");
    }

    // Apply font size via CSS variable
    document.documentElement.style.setProperty(
      "--base-font-size",
      `${fontSize}px`
    );

    // Apply line spacing via CSS variable
    document.documentElement.style.setProperty(
      "--line-spacing",
      lineSpacing.toString()
    );
  }

  function saveSettings() {
    updateSettings({
      theme,
      fontSize,
      lineSpacing,
      verseLayout,
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

  // Apply settings on value changes (live preview)
  $: {
    fontSize;
    lineSpacing;
    theme;
    applySettings();
  }
</script>

<div class="settings-pane">
  <h2>⚙️ Display Settings</h2>

  <div class="setting-group">
    <label>
      <span class="label-text">Theme</span>
      <select bind:value={theme}>
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

  <div class="button-group">
    <button class="save-button" on:click={saveSettings}> Save Settings </button>
    {#if savedMessage}
      <span class="saved-indicator">✓ Saved</span>
    {/if}
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
