<script lang="ts">
  import { onMount } from "svelte";
  import {
    listInstalledPacks,
    removePack,
    getDatabaseStats,
  } from "../../adapters/db-manager";
  import { importPackFromSQLite } from "../../adapters/pack-import";
  import { loadPackOnDemand } from "../../lib/progressive-init";
  import { USE_BUNDLED_PACKS } from "../../config";

  interface PackInfo {
    id: string;
    type: string;
    version: string;
    size: number;
  }

  let installedPacks: PackInfo[] = [];
  let isLoading = true;
  let dbStats = {
    totalSize: "0 MB",
    packCount: 0,
    verseCount: 0,
  };
  let showInstallUrl = false;
  let installUrl = "";
  let isInstalling = false;
  let installProgress = "";
  let fileInputElement: HTMLInputElement;

  // Use bundled packs when running locally or when VITE_USE_BUNDLED_PACKS=true
  const USE_BUNDLED = USE_BUNDLED_PACKS;
  const CDN_BASE = "/api/packs";
  const BASE_URL = CDN_BASE;
  // Consolidated pack definitions
  const CONSOLIDATED_PACKS = [
    {
      id: "translations",
      name: "English Translations",
      description: "KJV, WEB, BSB, NET, LXX2012",
      size: "33.80 MB",
      icon: "📖",
      url: `${BASE_URL}/translations.sqlite`,
    },
    {
      id: "dictionary-en",
      name: "English Dictionary (Modern + Historic)",
      description: "Wiktionary + Webster 1913 offline definitions",
      size: "38.36 MB",
      icon: "📖",
      url: `${BASE_URL}/dictionary-en.sqlite`,
    },
    {
      id: "ancient-languages",
      name: "Ancient Languages",
      description: "Hebrew, Greek with morphology",
      size: "67.11 MB",
      icon: "📜",
      url: `${BASE_URL}/ancient-languages.sqlite`,
    },
    {
      id: "lexical",
      name: "Lexical Resources",
      description: "Strong's + English dictionaries",
      size: "365.45 MB",
      icon: "📚",
      url: `${BASE_URL}/lexical.sqlite`,
    },
    {
      id: "study-tools",
      name: "Study Tools",
      description: "Maps, OpenBible, Pleiades, cross-refs, chronological",
      size: "438.89 MB",
      icon: "🗺️",
      url: `${BASE_URL}/study-tools.sqlite`,
    },
    {
      id: "bsb-audio-pt1",
      name: "BSB Audio Part 1",
      description: "Genesis - Psalms",
      size: "1.76 GB",
      icon: "🎵",
      url: `${BASE_URL}/bsb-audio-pt1.sqlite`,
    },
    {
      id: "bsb-audio-pt2",
      name: "BSB Audio Part 2",
      description: "Proverbs - Revelation",
      size: "1.65 GB",
      icon: "🎵",
      url: `${BASE_URL}/bsb-audio-pt2.sqlite`,
    },
  ];

  function getStageLabel(stage: string): string {
    switch (stage) {
      case "downloading":
        return "Downloading";
      case "validating":
        return "Validating";
      case "extracting":
        return "Extracting";
      case "caching":
        return "Caching";
      case "complete":
        return "Complete";
      default:
        return "Working";
    }
  }

  async function installConsolidatedPack(pack: (typeof CONSOLIDATED_PACKS)[0]) {
    if (installedPacks.some((p) => p.id === pack.id)) {
      if (
        !confirm(`Pack "${pack.name}" is already installed. Re-download it?`)
      ) {
        return;
      }
      if (pack.id === "study-tools") {
        installProgress = `Removing old ${pack.name}...`;
        await removePack(pack.id);
        await loadPacks();
        await loadStats();
      }
    }

    isInstalling = true;
    installProgress = `Preparing ${pack.name}...`;

    try {
      if (USE_BUNDLED) {
        installProgress = `Downloading ${pack.name} (${pack.size})...`;

        let response = await fetch(pack.url);
        if (!response.ok) {
          console.warn(`CDN fetch failed for ${pack.id}. Trying local bundle...`);
          const localUrl = `/packs/consolidated/${pack.id}.sqlite`;
          response = await fetch(localUrl);
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        const file = new File([blob], `${pack.id}.sqlite`, {
          type: "application/x-sqlite3",
        });

        installProgress = `Installing ${pack.name}...`;
        await importPackFromSQLite(file);
      } else {
        await loadPackOnDemand(pack.id, (progress) => {
          const stageLabel = getStageLabel(progress.stage);
          if (progress.stage === "downloading") {
            const loadedMB = (progress.loaded / (1024 * 1024)).toFixed(1);
            const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
            installProgress = `${stageLabel} ${pack.name} (${loadedMB} MB / ${totalMB} MB)...`;
          } else {
            installProgress = `${stageLabel} ${pack.name}...`;
          }
        });
      }

      installProgress = "Complete!";
      alert(`${pack.name} installed successfully!`);

      await loadPacks();
      await loadStats();

      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error(`Error installing ${pack.name}:`, error);
      alert(`Failed to install ${pack.name}: ${error}`);
    } finally {
      isInstalling = false;
      installProgress = "";
    }
  }

  onMount(async () => {
    await loadPacks();
    await loadStats();
  });

  async function loadPacks() {
    isLoading = true;
    try {
      installedPacks = await listInstalledPacks();
      console.log("Loaded packs:", installedPacks);
    } catch (error) {
      console.error("Error loading packs:", error);
      alert(`Failed to load packs: ${error}`);
    } finally {
      isLoading = false;
    }
  }

  async function loadStats() {
    try {
      const stats = await getDatabaseStats();
      dbStats = {
        totalSize: stats.totalSizeEstimate,
        packCount: stats.packs,
        verseCount: stats.verses,
      };
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  }

  async function handleRemovePack(packId: string) {
    const pack = installedPacks.find((p) => p.id === packId);
    if (!pack) return;

    const confirmMessage = `Remove "${packId}"?\n\nThis will delete all data for this pack. This cannot be undone.`;

    if (!confirm(confirmMessage)) return;

    try {
      await removePack(packId);
      alert(`Pack "${packId}" removed successfully`);
      await loadPacks();
      await loadStats();

      // Trigger a reload to refresh the UI
      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error("Error removing pack:", error);
      alert(`Failed to remove pack: ${error}`);
    }
  }

  async function handleInstallFromUrl() {
    if (!installUrl.trim()) {
      alert("Please enter a URL");
      return;
    }

    isInstalling = true;
    installProgress = "Downloading pack...";

    try {
      const response = await fetch(installUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      const file = new File([blob], "pack.sqlite", {
        type: "application/x-sqlite3",
      });

      installProgress = "Installing pack...";
      await importPackFromSQLite(file);

      installProgress = "Complete!";
      alert("Pack installed successfully!");

      installUrl = "";
      showInstallUrl = false;
      await loadPacks();
      await loadStats();

      // Trigger a reload to refresh the UI
      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error("Error installing pack from URL:", error);
      alert(`Failed to install pack: ${error}`);
    } finally {
      isInstalling = false;
      installProgress = "";
    }
  }

  function handleInstallFromFileClick() {
    fileInputElement?.click();
  }

  async function handleFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (!file) return;

    isInstalling = true;
    installProgress = `Installing ${file.name}...`;

    try {
      await importPackFromSQLite(file);

      installProgress = "Complete!";
      alert("Pack installed successfully!");

      await loadPacks();
      await loadStats();

      // Trigger a reload to refresh the UI
      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error("Error installing pack from file:", error);
      alert(`Failed to install pack: ${error}`);
    } finally {
      isInstalling = false;
      installProgress = "";
      target.value = ""; // Reset file input
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  function getPackTypeIcon(type: string): string {
    switch (type) {
      case "text":
      case "original-language":
        return "📖";
      case "lexicon":
        return "📚";
      case "places":
        return "📍";
      case "map":
        return "🗺️";
      case "cross-references":
        return "🔗";
      case "morphology":
        return "🔤";
      default:
        return "📦";
    }
  }
</script>

<div class="packs-pane">
  <h2><span class="emoji">📦</span> Pack Management</h2>

  <!-- Database Stats -->
  <div class="stats-card">
    <h3>Database Statistics</h3>
    <div class="stats-grid">
      <div class="stat">
        <span class="stat-label">Installed Packs</span>
        <span class="stat-value">{dbStats.packCount}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Total Verses</span>
        <span class="stat-value">{dbStats.verseCount.toLocaleString()}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Storage Used</span>
        <span class="stat-value">{dbStats.totalSize}</span>
      </div>
    </div>
  </div>

  <!-- Installed Packs List -->
  <div class="section">
    <h3>Installed Packs</h3>

    {#if isLoading}
      <div class="loading">Loading packs...</div>
    {:else if installedPacks.length === 0}
      <div class="empty-state">
        <p>No packs installed yet.</p>
        <p>Install a pack to get started!</p>
      </div>
    {:else}
      <div class="pack-list">
        {#each installedPacks as pack (pack.id)}
          <div class="pack-item">
            <div class="pack-icon"><span class="emoji">{getPackTypeIcon(pack.type)}</span></div>
            <div class="pack-info">
              <div class="pack-name">{pack.id}</div>
              <div class="pack-meta">
                <span class="pack-type">{pack.type}</span>
                <span class="pack-separator">•</span>
                <span class="pack-version">v{pack.version}</span>
                <span class="pack-separator">•</span>
                <span class="pack-size">{formatBytes(pack.size)}</span>
              </div>
            </div>
            <button
              class="remove-btn"
              on:click={() => handleRemovePack(pack.id)}
              title="Remove this pack"
            >
              <span class="emoji">🗑️</span>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Quick Install: Consolidated Packs -->
  <div class="section">
    <h3><span class="emoji">📦</span> Quick Install</h3>
    <p class="section-description">
      Install official consolidated packs with one click. These packs are hosted
      on GitHub Releases and verified with SHA-256 hashes.
    </p>

    <div class="pack-grid">
      {#each CONSOLIDATED_PACKS as pack}
        {@const isInstalled = installedPacks.some((p) => p.id === pack.id)}
        <button
          class="pack-card"
          class:installed={isInstalled}
          on:click={() => installConsolidatedPack(pack)}
          disabled={isInstalling}
          title={isInstalled
            ? `Already installed - click to re-download`
            : `Download ${pack.name}`}
        >
          <div class="pack-card-icon"><span class="emoji">{pack.icon}</span></div>
          <div class="pack-card-content">
            <div class="pack-card-name">
              {pack.name}
              {#if isInstalled}<span class="installed-badge">✓</span>{/if}
            </div>
            <div class="pack-card-description">{pack.description}</div>
            <div class="pack-card-size">{pack.size}</div>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- Install Actions -->
  <div class="section">
    <h3>Advanced Install</h3>

    <div class="actions">
      <button
        class="primary-btn"
        on:click={() => (showInstallUrl = !showInstallUrl)}
        disabled={isInstalling}
      >
        <span class="emoji">🌐</span> Install from URL
      </button>

      <button
        class="primary-btn"
        on:click={handleInstallFromFileClick}
        disabled={isInstalling}
      >
        <span class="emoji">📁</span> Install from File
      </button>
    </div>

    {#if showInstallUrl}
      <div class="install-url-form">
        <input
          type="text"
          bind:value={installUrl}
          placeholder="https://example.com/pack.sqlite"
          disabled={isInstalling}
        />
        <button
          class="install-btn"
          on:click={handleInstallFromUrl}
          disabled={isInstalling || !installUrl.trim()}
        >
          Install
        </button>
      </div>
    {/if}

    {#if installProgress}
      <div class="progress-message">{installProgress}</div>
    {/if}

    <!-- Hidden file input -->
    <input
      type="file"
      accept=".sqlite,.db,.sqlite3"
      bind:this={fileInputElement}
      on:change={handleFileSelected}
      style="display: none;"
    />
  </div>

  <!-- Help Text -->
  <div class="help-section">
    <h3><span class="emoji">ℹ️</span> About Packs</h3>
    <p>
      Packs are SQLite databases containing Bible texts, lexicons, maps, and
      other resources.
    </p>
    <p>You can install packs from:</p>
    <ul>
      <li>A URL (must be a direct link to a .sqlite file)</li>
      <li>A local file on your device</li>
    </ul>
    <p class="warning">
      <span class="emoji">⚠️</span> Only install packs from trusted sources. Removing a pack will delete
      all its data.
    </p>
  </div>
</div>

<style>
  .packs-pane {
    color: #e0e0e0;
    max-width: 800px;
    margin: 0 auto;
  }

  h2 {
    font-size: 1.5rem;
    margin-bottom: 2rem;
    color: #f0f0f0;
    font-weight: 600;
  }

  h3 {
    font-size: 1.1rem;
    margin-bottom: 1rem;
    color: #f0f0f0;
    font-weight: 600;
  }

  .stats-card {
    background: linear-gradient(
      135deg,
      rgba(102, 126, 234, 0.1),
      rgba(118, 75, 162, 0.1)
    );
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .stats-card h3 {
    margin-top: 0;
    margin-bottom: 1.5rem;
    font-size: 1rem;
    color: #667eea;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1.5rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .stat-label {
    font-size: 0.85rem;
    color: #aaa;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #667eea;
  }

  .section {
    margin-bottom: 2.5rem;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #888;
    font-style: italic;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 2rem;
    background: #1a1a1a;
    border: 2px dashed #444;
    border-radius: 8px;
    color: #888;
  }

  .empty-state p {
    margin: 0.5rem 0;
  }

  .pack-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .pack-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    transition: all 0.2s;
  }

  .pack-item:hover {
    background: #252525;
    border-color: #667eea;
  }

  .pack-icon {
    font-size: 2rem;
    flex-shrink: 0;
  }

  .pack-info {
    flex: 1;
    min-width: 0;
  }

  .pack-name {
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 0.25rem;
    word-break: break-word;
  }

  .pack-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #888;
    flex-wrap: wrap;
  }

  .pack-type {
    color: #667eea;
    font-weight: 500;
  }

  .pack-separator {
    color: #555;
  }

  .pack-version,
  .pack-size {
    color: #888;
  }

  .remove-btn {
    padding: 0.5rem 1rem;
    background: rgba(220, 38, 38, 0.1);
    border: 1px solid rgba(220, 38, 38, 0.3);
    color: #ff6b6b;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 1.2rem;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    background: rgba(220, 38, 38, 0.2);
    border-color: rgba(220, 38, 38, 0.5);
  }

  .actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .pack-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
    margin-top: 1rem;
  }

  .pack-card {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    background: linear-gradient(
      135deg,
      rgba(102, 126, 234, 0.08),
      rgba(118, 75, 162, 0.08)
    );
    border: 1px solid rgba(102, 126, 234, 0.25);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
  }

  .pack-card:hover:not(:disabled) {
    background: linear-gradient(
      135deg,
      rgba(102, 126, 234, 0.15),
      rgba(118, 75, 162, 0.15)
    );
    border-color: rgba(102, 126, 234, 0.5);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
  }

  .pack-card:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .pack-card.installed {
    background: linear-gradient(
      135deg,
      rgba(76, 175, 80, 0.1),
      rgba(56, 142, 60, 0.1)
    );
    border-color: rgba(76, 175, 80, 0.4);
  }

  .pack-card-icon {
    font-size: 2rem;
    line-height: 1;
  }

  .pack-card-content {
    flex: 1;
  }

  .pack-card-name {
    font-weight: 600;
    color: #f0f0f0;
    margin-bottom: 0.25rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .installed-badge {
    display: inline-block;
    background: #4caf50;
    color: white;
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    font-weight: 700;
  }

  .pack-card-description {
    font-size: 0.85rem;
    color: #aaa;
    margin-bottom: 0.5rem;
  }

  .pack-card-size {
    font-size: 0.75rem;
    color: #888;
    font-weight: 500;
  }

  .primary-btn {
    padding: 0.875rem 1.25rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    color: white;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 1rem;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  }

  .primary-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
  }

  .primary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .install-url-form {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    padding: 1rem;
    background: #1a1a1a;
    border-radius: 8px;
  }

  .install-url-form input {
    flex: 1;
    padding: 0.75rem;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 0.95rem;
  }

  .install-url-form input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
  }

  .install-url-form input::placeholder {
    color: #666;
  }

  .install-btn {
    padding: 0.75rem 1.5rem;
    background: #4caf50;
    border: none;
    color: white;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    font-weight: 600;
  }

  .install-btn:hover:not(:disabled) {
    background: #45a049;
  }

  .install-btn:disabled {
    background: #2a4a2a;
    cursor: not-allowed;
  }

  .progress-message {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(102, 126, 234, 0.1);
    border-left: 3px solid #667eea;
    border-radius: 4px;
    color: #667eea;
    font-weight: 500;
  }

  .help-section {
    margin-top: 3rem;
    padding: 1.5rem;
    background: #1a1a1a;
    border-radius: 8px;
    border: 1px solid #333;
  }

  .help-section h3 {
    margin-top: 0;
    color: #667eea;
  }

  .help-section p {
    margin: 0.75rem 0;
    line-height: 1.6;
    color: #ccc;
  }

  .help-section ul {
    margin: 0.75rem 0;
    padding-left: 1.5rem;
    color: #ccc;
  }

  .help-section li {
    margin: 0.5rem 0;
    line-height: 1.6;
  }

  .warning {
    color: #ffa500 !important;
    font-weight: 500;
    margin-top: 1rem !important;
  }

  @media (max-width: 768px) {
    .stats-grid {
      grid-template-columns: 1fr;
    }

    .actions {
      grid-template-columns: 1fr;
    }

    .install-url-form {
      flex-direction: column;
    }

    .pack-item {
      padding: 0.875rem;
    }

    .pack-icon {
      font-size: 1.5rem;
    }
  }
</style>
