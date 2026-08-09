<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    applyTheme, getSettings, updateSettings, getTtsSettings, getWakeAlarmSettings,
    getCustomThemeSettings, applyCustomThemeVars, MAX_COLOR_PRESETS,
  } from "../../adapters/settings";
  import { formatDays, formatTime12h } from "../../lib/alarm/alarmSchedule";
  import { getAllVoices, type TtsVoiceInfo } from "../../adapters/tts";
  import { paneStore } from "../../stores/paneStore";
  import { Gear } from 'phosphor-svelte';
  import InterlinearControls from "../InterlinearControls.svelte";
  import { READER_FONT_GROUPS, fontsInGroup, getReaderFont } from "../../lib/readerFonts";
  import { contrastRatio, isLowContrast, isValidHex, redLetterFor } from "../../lib/themeColors";

  let theme: "light" | "dark" | "auto" | "sepia" | "custom" = "dark";

  // ── Custom theme ────────────────────────────────────────────────────────
  let customFontId = "";
  let customTextColor = "#e0e0e0";
  let customBgColor = "#1a1a1a";
  let customTextPresets: string[] = [];
  let customBgPresets: string[] = [];
  /** Edit mode turns each swatch into a delete button. */
  let editingTextPresets = false;
  let editingBgPresets = false;

  $: activeFont = getReaderFont(customFontId);
  $: customContrast = contrastRatio(customTextColor, customBgColor);
  $: customLowContrast = isLowContrast(customTextColor, customBgColor);
  // Placeholder swatches for the unfilled slots. Clamped at zero because a
  // list synced from another device could in principle arrive over-length,
  // and Array(-1) throws.
  $: textSlotsFree = Array(Math.max(0, MAX_COLOR_PRESETS - customTextPresets.length)).fill(0);
  $: bgSlotsFree = Array(Math.max(0, MAX_COLOR_PRESETS - customBgPresets.length)).fill(0);

  function currentCustom() {
    return {
      fontId: customFontId,
      textColor: customTextColor,
      bgColor: customBgColor,
      textPresets: customTextPresets,
      bgPresets: customBgPresets,
    };
  }

  /** Store the current colour in the next free slot. Duplicates are a no-op. */
  function savePreset(kind: "text" | "bg") {
    const color = kind === "text" ? customTextColor : customBgColor;
    if (!isValidHex(color)) return;
    const list = kind === "text" ? customTextPresets : customBgPresets;
    if (list.includes(color) || list.length >= MAX_COLOR_PRESETS) return;
    if (kind === "text") customTextPresets = [...list, color];
    else customBgPresets = [...list, color];
  }

  function removePreset(kind: "text" | "bg", index: number) {
    if (kind === "text") customTextPresets = customTextPresets.filter((_, i) => i !== index);
    else customBgPresets = customBgPresets.filter((_, i) => i !== index);
  }

  function usePreset(kind: "text" | "bg", color: string) {
    if (kind === "text") customTextColor = color;
    else customBgColor = color;
  }
  let fontSize = 18;
  let lineSpacing = 1.8;
  let verseLayout: "one-per-line" | "paragraph" | "paragraph-no-verse-numbers" = "one-per-line";
  let wordWrap: boolean = true;
  let allowRotation: boolean = false;
  let showRedLetter: boolean = true;
  let themedTitles: boolean = true;
  let showArt: boolean = true;
  let showPlaceMarkers: boolean = false;
  let timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const TIMEZONE_OPTIONS: { label: string; value: string }[] = [
    { label: 'Auto-detect (browser)', value: '' },
    { label: 'UTC',                        value: 'UTC' },
    { label: 'Atlantic (Halifax)',          value: 'America/Halifax' },
    { label: 'Eastern (New York)',          value: 'America/New_York' },
    { label: 'Central (Chicago)',           value: 'America/Chicago' },
    { label: 'Mountain (Denver)',           value: 'America/Denver' },
    { label: 'Mountain no-DST (Phoenix)',   value: 'America/Phoenix' },
    { label: 'Pacific (Los Angeles)',       value: 'America/Los_Angeles' },
    { label: 'Alaska (Anchorage)',          value: 'America/Anchorage' },
    { label: 'Hawaii (Honolulu)',           value: 'Pacific/Honolulu' },
    { label: 'London (GMT/BST)',            value: 'Europe/London' },
    { label: 'Paris / Berlin (CET/CEST)',   value: 'Europe/Paris' },
    { label: 'Jerusalem',                   value: 'Asia/Jerusalem' },
    { label: 'Kolkata (IST)',               value: 'Asia/Kolkata' },
    { label: 'Tokyo (JST)',                 value: 'Asia/Tokyo' },
    { label: 'Sydney (AEST/AEDT)',          value: 'Australia/Sydney' },
  ];
  let savedMessage = false;
  let clearing = false;
  let checkingUpdate = false;
  let autoCheckUpdates: boolean = true;
  let ttsVoice: string = 'en_US-lessac-medium';
  let ttsRate: number = 1.0;
  let ttsReadHeadings: boolean = false;
  let ttsHighlightVerse: boolean = true;
  let ttsGlowFollow: boolean = false;
  let ttsVoices: TtsVoiceInfo[] = getAllVoices();
  let alarmSummary = "";

  // The alarm lives in its own pane, which can be open alongside this one —
  // refresh the summary whenever settings change rather than only on mount.
  function refreshAlarmSummary() {
    const alarm = getWakeAlarmSettings();
    alarmSummary = alarm.enabled
      ? `${formatTime12h(alarm.time)} · ${formatDays(alarm.days)}`
      : "off";
  }

  // Load settings on mount
  onMount(() => {
    refreshAlarmSummary();
    window.addEventListener("settingsUpdated", refreshAlarmSummary);
    ttsVoices = getAllVoices();
    const settings = getSettings();
    theme = settings.theme || "dark";
    fontSize = settings.fontSize || 18;
    lineSpacing = settings.lineSpacing || 1.8;
    verseLayout = settings.verseLayout || "one-per-line";
    wordWrap = settings.wordWrap !== undefined ? settings.wordWrap : true;
    allowRotation = settings.allowRotation !== undefined ? settings.allowRotation : false;
    showRedLetter = settings.showRedLetter !== false;
    themedTitles = settings.themedTitles !== false;
    showArt = settings.showArt !== false;
    showPlaceMarkers = settings.showPlaceMarkers === true;
    timezone = settings.timezone || '';
    autoCheckUpdates = settings.autoCheckUpdates !== false; // default true
    const custom = getCustomThemeSettings();
    customFontId = custom.fontId;
    customTextColor = custom.textColor;
    customBgColor = custom.bgColor;
    customTextPresets = custom.textPresets;
    customBgPresets = custom.bgPresets;
    const tts = getTtsSettings();
    ttsVoice = tts.voiceId;
    ttsRate = tts.rate;
    ttsReadHeadings = tts.readHeadings;
    ttsHighlightVerse = tts.highlightVerse;
    ttsGlowFollow = tts.glowFollow;
  });

  onDestroy(() => {
    window.removeEventListener("settingsUpdated", refreshAlarmSummary);
  });

  function deleteIndexedDbDatabase(name: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => {
          console.log(`Deleted database: ${name}`);
          resolve();
        };
        request.onerror = () => {
          console.warn(`Failed to delete database: ${name}`, request.error);
          resolve();
        };
        request.onblocked = () => {
          console.warn(`Database deletion blocked: ${name}`);
          resolve();
        };
      } catch (error) {
        console.warn(`Error deleting database: ${name}`, error);
        resolve();
      }
    });
  }

  async function checkForUpdates() {
    if (!('serviceWorker' in navigator)) {
      alert('Service worker not supported in this browser.');
      return;
    }
    checkingUpdate = true;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
      }
      // Give the new SW time to download and activate (skipWaiting is true)
      await new Promise(resolve => setTimeout(resolve, 2000));
      window.location.reload();
    } catch (err) {
      console.error('Update check failed:', err);
      alert('Could not check for updates. Try again later.');
      checkingUpdate = false;
    }
  }

  async function clearCacheAndReload() {
    const warningMessage =
      'This will delete ALL cached data on this device (downloaded packs, IndexedDB databases, service worker cache, and session storage). You will need to reinstall packs after this. Continue?';
    if (!confirm(warningMessage)) {
      return;
    }
    if (!confirm('Please confirm again: this will permanently delete local packs and cached data from this device. If you are signed in, your cloud-synced settings and reading plans will restore after login. Proceed?')) {
      return;
    }

    clearing = true;

    try {
      // 1. Clear all IndexedDB databases
      if ('indexedDB' in window) {
        const namesToDelete = new Set<string>(["projectbible", "ProjectBible_Packs"]);
        if ('databases' in indexedDB) {
          try {
            const dbs = await indexedDB.databases();
            for (const db of dbs) {
              if (db.name) {
                namesToDelete.add(db.name);
              }
            }
          } catch (error) {
            console.warn('indexedDB.databases() not available:', error);
          }
        }
        await Promise.all([...namesToDelete].map(deleteIndexedDbDatabase));
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

    // applyTheme reads the custom theme back from storage, which is a step
    // behind while the user is still dragging a colour picker — push the
    // in-progress values over the top so the preview is live.
    if (theme === "custom") applyCustomThemeVars(currentCustom());

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
      allowRotation,
      showRedLetter,
      themedTitles,
      showArt,
      showPlaceMarkers,
      timezone: timezone || undefined,
      autoCheckUpdates,
      customTheme: currentCustom(),
      tts: {
        voiceId: ttsVoice,
        rate: ttsRate,
        readHeadings: ttsReadHeadings,
        highlightVerse: ttsHighlightVerse,
        glowFollow: ttsGlowFollow,
      },
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

  function openWakeAlarmPane() {
    paneStore.openPane("wakealarm", "right");
  }

  // Apply settings on value changes (live preview)
  $: {
    fontSize;
    lineSpacing;
    theme;
    wordWrap;
    customFontId;
    customTextColor;
    customBgColor;
    applySettings();
  }
</script>

<div class="settings-pane">
  <h2><span class="header-icon"><Gear size={20} weight="bold" /><span class="icon-overlay"><Gear size={20} weight="thin" /></span></span> Settings</h2>

  <div class="setting-group">
    <label>
      <span class="label-text">Theme</span>
      <select bind:value={theme}>
        <option value="auto">Auto</option>
        <option value="sepia">Sepia</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="custom">Custom</option>
      </select>
    </label>
  </div>

  {#if theme === "custom"}
    <div class="custom-panel">
      <p class="cp-intro">
        Changes the Bible reader's typeface and colours only. Buttons, panels and
        book colours stay as they are, and Jesus' words stay red.
      </p>

      <div class="cp-field">
        <span class="label-text">Typeface</span>
        <select bind:value={customFontId}>
          <option value="">Match translation (default)</option>
          {#each READER_FONT_GROUPS as group}
            <optgroup label={group}>
              {#each fontsInGroup(group) as font}
                <option value={font.id} style="font-family: {font.stack}">{font.label}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
        {#if activeFont?.note}
          <p class="cp-note">{activeFont.note}</p>
        {/if}
      </div>

      <!-- Text colour -->
      <div class="cp-field">
        <div class="cp-head">
          <span class="label-text">Text colour</span>
          <button
            class="cp-edit"
            class:on={editingTextPresets}
            disabled={customTextPresets.length === 0}
            on:click={() => (editingTextPresets = !editingTextPresets)}
          >{editingTextPresets ? "Done" : "Edit"}</button>
        </div>
        <div class="cp-picker">
          <input type="color" bind:value={customTextColor} aria-label="Reader text colour" />
          <code class="cp-hex">{customTextColor}</code>
          <button
            class="cp-save"
            disabled={customTextPresets.includes(customTextColor) || customTextPresets.length >= MAX_COLOR_PRESETS}
            on:click={() => savePreset("text")}
          >Save</button>
        </div>
        <div class="cp-presets">
          {#each customTextPresets as color, i}
            <button
              class="cp-swatch"
              class:removing={editingTextPresets}
              style="background: {color}"
              title={color}
              on:click={() => (editingTextPresets ? removePreset("text", i) : usePreset("text", color))}
            >{#if editingTextPresets}<span class="cp-x">×</span>{/if}</button>
          {/each}
          {#each textSlotsFree as _}
            <span class="cp-swatch empty"></span>
          {/each}
        </div>
      </div>

      <!-- Background colour -->
      <div class="cp-field">
        <div class="cp-head">
          <span class="label-text">Background colour</span>
          <button
            class="cp-edit"
            class:on={editingBgPresets}
            disabled={customBgPresets.length === 0}
            on:click={() => (editingBgPresets = !editingBgPresets)}
          >{editingBgPresets ? "Done" : "Edit"}</button>
        </div>
        <div class="cp-picker">
          <input type="color" bind:value={customBgColor} aria-label="Reader background colour" />
          <code class="cp-hex">{customBgColor}</code>
          <button
            class="cp-save"
            disabled={customBgPresets.includes(customBgColor) || customBgPresets.length >= MAX_COLOR_PRESETS}
            on:click={() => savePreset("bg")}
          >Save</button>
        </div>
        <div class="cp-presets">
          {#each customBgPresets as color, i}
            <button
              class="cp-swatch"
              class:removing={editingBgPresets}
              style="background: {color}"
              title={color}
              on:click={() => (editingBgPresets ? removePreset("bg", i) : usePreset("bg", color))}
            >{#if editingBgPresets}<span class="cp-x">×</span>{/if}</button>
          {/each}
          {#each bgSlotsFree as _}
            <span class="cp-swatch empty"></span>
          {/each}
        </div>
      </div>

      <!-- Live preview -->
      <div class="cp-field">
        <span class="label-text">Preview</span>
        <div
          class="cp-preview"
          style="background: {customBgColor};
                 color: {customTextColor};
                 font-family: {activeFont ? activeFont.stack : 'inherit'};
                 font-size: calc({fontSize}px * {activeFont ? activeFont.scale : 1});
                 line-height: calc({lineSpacing} * {activeFont ? activeFont.lead : 1})"
        >
          <span class="cp-vnum">16</span>For God so loved the world, that he gave his only
          begotten Son, <span style="color: {redLetterFor(customBgColor)}">that whosoever
          believeth in him should not perish, but have everlasting life.</span>
        </div>
        {#if customLowContrast}
          <p class="cp-warn">
            Low contrast ({customContrast.toFixed(1)}:1) — this may be hard to read.
            Saving anyway is fine.
          </p>
        {/if}
      </div>
    </div>
  {/if}

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
        min="0.1"
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
        <option value="paragraph-no-verse-numbers">Paragraph (NoNum)</option>
      </select>
    </label>
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={wordWrap} />
      <span class="label-text">Word Wrap (wrap long lines)</span>
    </label>
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={allowRotation} on:change={saveSettings} />
      <span class="label-text">Allow Screen Rotation</span>
    </label>
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={showRedLetter} on:change={saveSettings} />
      <span class="label-text">Words of Jesus in red letters</span>
    </label>
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={themedTitles} on:change={saveSettings} />
      <span class="label-text">Theme colors in reader titles</span>
    </label>
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={showArt} on:change={saveSettings} />
      <span class="label-text">Show art icons on Bible scenes</span>
    </label>
  </div>

  <div class="setting-group">
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={showPlaceMarkers} on:change={saveSettings} />
      <span class="label-text">Underline multi-word place names (needs Encyclopedia pack)</span>
    </label>
  </div>

  <div class="setting-group">
    <span class="label-text">Interlinear (Greek &amp; Hebrew)</span>
    <p class="section-description il-hint">
      Show the English equivalent stacked under each original-language word. A
      quick toggle also appears in the reader whenever a Greek or Hebrew
      translation is open.
    </p>
    <InterlinearControls />
  </div>

  <div class="setting-group">
    <span class="label-text">Read Aloud (AI voice)</span>
    <p class="section-description il-hint">
      Reads any chapter out loud with an on-device AI voice. The voice downloads
      once (from the reader or Manage Packs) and then works fully offline.
    </p>
    <label>
      <span class="label-text">Voice</span>
      <select bind:value={ttsVoice} on:change={saveSettings}>
        {#each ttsVoices as v}
          <option value={v.id}>{v.label} — ~{v.approxSizeMB} MB</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="label-text">Reading Speed: {ttsRate.toFixed(2)}×</span>
      <input type="range" min="0.8" max="1.5" step="0.05" bind:value={ttsRate} on:change={saveSettings} />
    </label>
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={ttsReadHeadings} on:change={saveSettings} />
      <span class="label-text">Read section headings aloud</span>
    </label>
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={ttsHighlightVerse} on:change={saveSettings} />
      <span class="label-text">Highlight the verse being read</span>
    </label>
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={ttsGlowFollow} on:change={saveSettings} />
      <span class="label-text">Soft glow drifts along the words</span>
    </label>
    <button class="packs-button alarm-button" on:click={openWakeAlarmPane}>
      <span class="icon emoji">⏰</span>
      <span class="text">Wake Alarm{alarmSummary ? ` — ${alarmSummary}` : ""}</span>
      <span class="arrow">→</span>
    </button>
  </div>

  <div class="setting-group">
    <label>
      <span class="label-text">Time Zone</span>
      <select bind:value={timezone}>
        {#each TIMEZONE_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
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
      class="check-update-button"
      on:click={checkForUpdates}
      disabled={checkingUpdate || clearing}
    >
      <span class="icon emoji">🔄</span>
      <span class="text">{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
    </button>
    <label class="auto-check-toggle">
      <input
        type="checkbox"
        bind:checked={autoCheckUpdates}
        on:change={saveSettings}
      />
      <span class="toggle-label">Auto-check on open</span>
    </label>
    <button 
      class="clear-cache-button" 
      on:click={clearCacheAndReload}
      disabled={clearing || checkingUpdate}
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

  .header-icon {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    margin-right: 6px;
    color: #431407;
    background: radial-gradient(circle, #7dd3fc 0%, #7dd3fc 20%, #431407 100%);
    border-radius: 6px;
    padding: 4px;
    position: relative;
  }
  .icon-overlay {
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    line-height: 0;
  }
  :global(.header-icon > svg) {
    filter: drop-shadow(0 0 2px #431407) drop-shadow(0 0 2px #431407);
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

  /* ── Custom theme panel ─────────────────────────────────────────────── */
  .custom-panel {
    margin: -1rem 0 2rem;
    padding: 1rem;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    background: #202020;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .cp-intro {
    font-size: 0.8rem;
    color: #999;
    line-height: 1.5;
    margin: 0;
  }

  .cp-field {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .cp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .cp-note {
    font-size: 0.78rem;
    color: #8f8f8f;
    line-height: 1.45;
    margin: 0;
  }

  .cp-picker {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* The OS colour wheel. Browsers draw their own widget here, so the styling
     is limited to sizing away the default chrome. */
  .cp-picker input[type="color"] {
    width: 46px;
    height: 34px;
    padding: 0;
    border: 1px solid #444;
    border-radius: 6px;
    background: #1a1a1a;
    cursor: pointer;
    flex: none;
  }
  .cp-picker input[type="color"]::-webkit-color-swatch-wrapper { padding: 3px; }
  .cp-picker input[type="color"]::-webkit-color-swatch { border: none; border-radius: 3px; }
  .cp-picker input[type="color"]::-moz-color-swatch { border: none; border-radius: 3px; }

  .cp-hex {
    font-size: 0.8rem;
    color: #aaa;
    font-family: ui-monospace, Menlo, Consolas, monospace;
    text-transform: uppercase;
    flex: 1;
  }

  .cp-save,
  .cp-edit {
    padding: 6px 12px;
    background: #2f2f2f;
    border: 1px solid #4a4a4a;
    border-radius: 6px;
    color: #ddd;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, opacity 0.15s;
  }
  .cp-save:hover:not(:disabled),
  .cp-edit:hover:not(:disabled) { border-color: #667eea; background: #353535; }
  .cp-save:disabled,
  .cp-edit:disabled { opacity: 0.35; cursor: default; }
  .cp-edit.on { border-color: #667eea; color: #9aa9f5; }

  .cp-presets {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 6px;
  }

  .cp-swatch {
    aspect-ratio: 1;
    min-height: 24px;
    border: 1px solid #4a4a4a;
    border-radius: 5px;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.12s, border-color 0.12s;
  }
  .cp-swatch:hover { transform: scale(1.12); border-color: #667eea; }
  .cp-swatch.removing { border-color: #e05252; }
  .cp-swatch.empty {
    background: #262626;
    border-style: dashed;
    border-color: #3a3a3a;
    cursor: default;
  }
  .cp-swatch.empty:hover { transform: none; border-color: #3a3a3a; }

  .cp-x {
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
    color: #fff;
    text-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
  }

  .cp-preview {
    padding: 14px 16px;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    transition: background 0.15s, color 0.15s;
  }

  .cp-vnum {
    font-size: 0.5em;
    vertical-align: super;
    margin-right: 0.15em;
    opacity: 0.6;
  }

  .cp-warn {
    font-size: 0.78rem;
    color: #e0a94a;
    line-height: 1.45;
    margin: 0;
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

  /* Same affordance as Manage Packs, but sitting inside the Read Aloud group. */
  .alarm-button {
    margin-top: 1rem;
    font-size: 0.9rem;
  }
  .alarm-button .text {
    text-align: left;
    flex: 1;
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

  .check-update-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.25rem;
    margin-bottom: 0.75rem;
    background: linear-gradient(135deg, #1565c0 0%, #0288d1 100%);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 8px rgba(2, 136, 209, 0.3);
  }

  .check-update-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(2, 136, 209, 0.4);
  }

  .check-update-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .check-update-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .check-update-button .icon {
    font-size: 1.5rem;
  }

  .check-update-button .text {
    flex: 1;
    text-align: left;
  }

  .auto-check-toggle {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.75rem;
    cursor: pointer;
    color: #b0b0b0;
    font-size: 0.9rem;
  }

  .auto-check-toggle input[type="checkbox"] {
    width: 1.1rem;
    height: 1.1rem;
    cursor: pointer;
    accent-color: #0288d1;
  }

  .toggle-label {
    user-select: none;
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

  /* ── Phone portrait (≤480px) ── */
  @media (max-width: 480px) {
    .settings-pane {
      padding: 12px;
    }

    h2 {
      font-size: 1.1rem;
      margin-bottom: 0.75rem;
    }

    label {
      margin-bottom: 0.3rem;
      font-size: 0.85rem;
    }

    select,
    input[type="range"],
    input[type="text"] {
      padding: 0.45rem 0.5rem;
      margin-bottom: 0.6rem;
      font-size: 0.85rem;
    }

    button {
      padding: 0.5rem;
      margin-bottom: 0.6rem;
      font-size: 0.85rem;
    }

    .note {
      padding: 0.6rem;
      font-size: 0.8rem;
    }
  }
</style>
