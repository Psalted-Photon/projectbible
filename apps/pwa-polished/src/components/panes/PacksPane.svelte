<script lang="ts">
  import { onMount } from "svelte";
  import {
    listInstalledPacks,
    removePack,
    getDatabaseStats,
    audioPackHasChapters,
  } from "../../adapters/db-manager";
  import { importPackFromSQLite } from "../../adapters/pack-import";
  import { installAudioPackToOPFS, reindexAudioPack } from "../../adapters/audio";
  import { loadPackOnDemand } from "../../lib/progressive-init";
  import { USE_BUNDLED_PACKS, PACK_MANIFEST_URL } from "../../config";
  import {
    isTtsSupported,
    storedVoices,
    downloadVoice,
    removeVoice,
    getAllVoices,
    getVoiceInfo,
    installVoiceFromFiles,
    voiceIsDownloadable,
    type TtsVoiceInfo,
  } from "../../adapters/tts";

  console.log("DEV:", import.meta.env.DEV);
  console.log("PROD:", import.meta.env.PROD);
  console.log("USE_BUNDLED_PACKS:", USE_BUNDLED_PACKS);

  interface PackInfo {
    id: string;
    type: string;
    version: string;
    size: number;
  }

  let installedPacks: PackInfo[] = [];
  let packsNeedingReindex = new Set<string>();
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

  // Live pack sizes, keyed by pack id. The hardcoded `size` strings below are
  // only a fallback for when the manifest cannot be fetched -- they drift every
  // time a pack is rebuilt, and drifted badly enough that Study Tools advertised
  // 438.89 MB while shipping 523.78 MB.
  let manifestSizes: Record<string, string> = {};
  let manifestBytes: Record<string, number> = {};
  let fileInputElement: HTMLInputElement;
  let installedVoices: string[] = [];
  let voiceList: TtsVoiceInfo[] = [];
  let voiceFileInput: HTMLInputElement;

  async function refreshVoices() {
    if (!isTtsSupported()) return;
    voiceList = getAllVoices();
    try {
      installedVoices = await storedVoices();
    } catch (err) {
      console.warn("[Packs] Could not list TTS voices:", err);
    }
  }

  async function installTtsVoice(voiceId: string) {
    const voice = getVoiceInfo(voiceId);
    if (!voice || isInstalling) return;
    isInstalling = true;
    installProgress = `Preparing ${voice.label}...`;
    try {
      await downloadVoice(voiceId, ({ loaded, total }) => {
        const loadedMB = (loaded / 1024 / 1024).toFixed(0);
        const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(0) : "?";
        installProgress = `Downloading ${voice.label} (${loadedMB} MB / ${totalMB} MB)…`;
      });
      installProgress = "Complete!";
      await refreshVoices();
      setTimeout(() => (installProgress = ""), 2000);
    } catch (err: any) {
      console.error("[Packs] Voice install failed:", err);
      installProgress = `Voice download failed: ${err?.message ?? err}`;
      setTimeout(() => (installProgress = ""), 6000);
    } finally {
      isInstalling = false;
    }
  }

  async function removeTtsVoice(voiceId: string) {
    const voice = getVoiceInfo(voiceId);
    if (!voice) return;
    const canRedownload = voiceIsDownloadable(voice);
    const note = canRedownload
      ? `You can re-download it any time (~${voice.approxSizeMB} MB).`
      : `This is a custom voice — removing it deletes it from this device permanently.`;
    if (!confirm(`Remove the "${voice.label}" voice? ${note}`)) {
      return;
    }
    try {
      await removeVoice(voiceId);
      await refreshVoices();
    } catch (err: any) {
      console.error("[Packs] Voice removal failed:", err);
      alert(`Could not remove voice: ${err?.message ?? err}`);
    }
  }

  function triggerVoiceFilePicker() {
    voiceFileInput?.click();
  }

  async function handleVoiceFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ""; // allow re-picking the same files
    if (files.length === 0) return;

    const model = files.find((f) => f.name.toLowerCase().endsWith(".onnx"));
    const config = files.find((f) => f.name.toLowerCase().endsWith(".json"));
    if (!model || !config) {
      alert(
        "Please select BOTH files for the voice: the model (.onnx) and its settings (.onnx.json)."
      );
      return;
    }

    isInstalling = true;
    installProgress = `Installing ${model.name}...`;
    try {
      const id = await installVoiceFromFiles(model, config);
      installProgress = "Voice installed!";
      await refreshVoices();
      setTimeout(() => (installProgress = ""), 2500);
      console.log(`[Packs] Installed custom voice: ${id}`);
    } catch (err: any) {
      console.error("[Packs] Custom voice install failed:", err);
      installProgress = `Voice install failed: ${err?.message ?? err}`;
      setTimeout(() => (installProgress = ""), 6000);
    } finally {
      isInstalling = false;
    }
  }

  // Use bundled packs in dev mode
  const USE_BUNDLED = USE_BUNDLED_PACKS;
  // Base URL depends on environment
  const BASE_URL = USE_BUNDLED ? "/packs/consolidated" : "/api/packs";
  // Consolidated pack definitions
  const CONSOLIDATED_PACKS = [
    {
      id: "translations",
      name: "English Translations",
      description: "KJV, WEB, BSB, NET, LXX2012",
      size: "34.55 MB",
      icon: "📖",
      url: `${BASE_URL}/translations.sqlite`,
    },
    {
      id: "dictionary-en",
      name: "English Dictionary (Modern + Historic)",
      description: "Modern + Webster 1913 offline definitions",
      size: "48.67 MB",
      icon: "📖",
      url: `${BASE_URL}/dictionary-en.sqlite`,
    },
    {
      id: "commentaries",
      name: "Multi-Author Commentaries",
      description: "Clarke, Wesley, Calvin, Barnes, Robertson + 6 more",
      size: "224.84 MB",
      icon: "💭",
      url: `${BASE_URL}/commentaries.sqlite`,
    },
    {
      id: "tsk-references",
      name: "TSK References",
      description: "Treasury of Scripture Knowledge — 43,000+ cross-reference entries by keyword",
      size: "6.21 MB",
      icon: "🔗",
      url: `${BASE_URL}/tsk-references.sqlite`,
    },
    {
      id: "ancient-languages",
      name: "Ancient Languages",
      description: "Hebrew, Greek with morphology",
      size: "105.31 MB",
      icon: "📜",
      url: `${BASE_URL}/ancient-languages.sqlite`,
    },
    {
      id: "lexical",
      name: "Lexical Resources",
      description: "Strong's + English dictionaries",
      size: "372.67 MB",
      icon: "📚",
      url: `${BASE_URL}/lexical.sqlite`,
    },
    {
      id: "study-tools",
      name: "Study Tools",
      description: "Biblical and ancient places, historical map layers, chronological reading order",
      size: "13.82 MB",
      icon: "🗺️",
      url: `${BASE_URL}/study-tools.sqlite`,
    },
    {
      id: "encyclotopical",
      name: "Encyclotopical",
      description:
        "ISBE Encyclopedia and Nave's Topical Bible. 9,380 scholarly articles on places, people, customs, plants and doctrine, plus 5,322 topics indexing 100,000+ scripture references. Browse both A–Z from the Encyclopedia and Topical windows, or tap a word in the reader → More Info. Public Domain (ISBE 1915; Nave's 1900s); place data CC BY 4.0 (OpenBible.info)",
      size: "77.52 MB",
      icon: "📕",
      url: `${BASE_URL}/encyclotopical.sqlite`,
    },
    {
      id: "geonames-modern-places-v1",
      name: "World Places (GeoNames)",
      description: "Search any modern place: cities, states, countries worldwide. 172,000+ places. License: CC BY 4.0 — geonames.org",
      size: "37.23 MB",
      icon: "🌍",
      url: `${BASE_URL}/geonames.sqlite`,
    },
    {
      id: "section-headings",
      name: "Section Headings",
      description: "Pericope titles for all 66 books — works with any translation",
      size: "0.29 MB",
      icon: "📑",
      url: `${BASE_URL}/section-headings.sqlite`,
    },
    {
      id: "biblical-art",
      name: "Biblical Art",
      description: "Famous public-domain paintings tied to Bible scenes. Tap the in-text art icon in the reader to view. Images bundled for offline. Public domain — Wikimedia Commons",
      size: "83.45 MB",
      icon: "🖼️",
      url: `${BASE_URL}/art.sqlite`,
    },
    {
      id: "people-biblical-v1",
      name: "Biblical Characters",
      description: "Every named person: dates, places, family, name meaning, and verse appearances. Tap a name in the reader → Define. License: CC BY-SA 4.0 — Theographic + Hitchcock's (public domain)",
      size: "3.82 MB",
      icon: "👤",
      url: `${BASE_URL}/people.sqlite`,
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
      // Remove the old copy first so the re-download actually happens —
      // loadPackOnDemand skips the download when the installed version matches
      // the manifest, and pack versions stay unchanged when their data updates.
      // Audio packs skip this: they always re-stream and overwrite in OPFS.
      if (!pack.id.startsWith("bsb-audio")) {
        installProgress = `Removing old ${pack.name}...`;
        await removePack(pack.id);
        await loadPacks();
        await loadStats();
      }
    }

    if (!(await hasRoomFor(pack))) return;

    isInstalling = true;
    installProgress = `Preparing ${pack.name}...`;

    try {
      // Audio packs (1+ GB) must be streamed directly to OPFS — never loaded into memory
      const isAudioPack = pack.id.startsWith('bsb-audio');

      if (isAudioPack) {
        await installAudioPackToOPFS(pack.url, pack.id, (loaded, total) => {
          const loadedMB = (loaded / (1024 * 1024)).toFixed(0);
          const totalMB = total > 0 ? (total / (1024 * 1024)).toFixed(0) : '?';
          installProgress = `Downloading ${pack.name} (${loadedMB} MB / ${totalMB} MB)…`;
        });
      } else if (USE_BUNDLED) {
        installProgress = `Loading ${pack.name} from local files...`;

        console.log("Pack object:", pack);
        console.log("Pack URL:", pack.url);
        console.log("BASE_URL:", BASE_URL);

        // Fetch from local bundle (already copied by Vite plugin in dev mode)
        const response = await fetch(pack.url); // pack.url already has correct BASE_URL
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const file = new File([buffer], `${pack.id}.sqlite`, {
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
      const isQuota =
        error instanceof DOMException &&
        (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
      alert(
        isQuota
          ? `Not enough storage to install ${pack.name}.

Free up space on your device, or remove a pack you are not using, then try again.`
          : `Failed to install ${pack.name}: ${error}`
      );
    } finally {
      isInstalling = false;
      installProgress = "";
    }
  }

  /**
   * Rough pre-flight space check.
   *
   * Installing costs more than the download itself: the file is cached and then
   * expanded into object stores, so budget for roughly twice its size. Returns
   * false only when the user declines to continue after being warned -- the
   * estimate is advisory, and browsers under-report it often enough that a hard
   * block would be wrong.
   */
  async function hasRoomFor(pack: (typeof CONSOLIDATED_PACKS)[0]): Promise<boolean> {
    const needed = manifestBytes[pack.id];
    if (!needed || !navigator.storage?.estimate) return true;

    try {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      if (!quota) return true;

      const available = quota - usage;
      if (available >= needed * 2) return true;

      return confirm(
        `${pack.name} needs about ${formatBytes(needed * 2)} to install, ` +
          `but only ${formatBytes(Math.max(available, 0))} looks available on this device.

` +
          `The install may fail partway through. Continue anyway?`
      );
    } catch {
      return true;
    }
  }

  onMount(async () => {
    await loadManifestSizes();
    await loadPacks();
    await loadStats();
    await refreshVoices();
  });

  async function loadManifestSizes() {
    try {
      const response = await fetch(PACK_MANIFEST_URL);
      if (!response.ok) return;
      const manifest = await response.json();
      const packs = Array.isArray(manifest) ? manifest : (manifest?.packs ?? []);
      const sizes: Record<string, string> = {};
      const bytesById: Record<string, number> = {};
      for (const entry of packs) {
        if (!entry?.id) continue;
        const bytes = Number(entry.size);
        if (Number.isFinite(bytes) && bytes > 0) {
          sizes[entry.id] = formatBytes(bytes);
          bytesById[entry.id] = bytes;
        }
      }
      manifestSizes = sizes;
      manifestBytes = bytesById;
    } catch (error) {
      // Non-fatal: the cards fall back to their hardcoded size strings.
      console.warn("Could not read pack sizes from manifest:", error);
    }
  }

  async function loadPacks() {
    isLoading = true;
    try {
      installedPacks = await listInstalledPacks();
      console.log("Loaded packs:", installedPacks);

      // Check each installed audio pack for a stale index (pack record exists
      // but audio_chapters were evicted). Flag these for Re-index instead of
      // forcing a full re-download.
      const reindexSet = new Set<string>();
      for (const pack of installedPacks) {
        if (pack.type === 'audio') {
          const hasChapters = await audioPackHasChapters(pack.id);
          if (!hasChapters) reindexSet.add(pack.id);
        }
      }
      packsNeedingReindex = reindexSet;
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

    // Clearing a large pack takes a while. Without a busy state the pane just
    // sits there, which looks exactly like the delete having died.
    isInstalling = true;
    installProgress = `Removing ${packId}…`;
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
    } finally {
      isInstalling = false;
      installProgress = "";
    }
  }

  async function handleReindexPack(packId: string) {
    isInstalling = true;
    installProgress = `Re-indexing ${packId}…`;
    try {
      await reindexAudioPack(packId);
      await loadPacks();
      await loadStats();
      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error(`Error re-indexing ${packId}:`, error);
      alert(`Re-index failed — the audio file may be missing. Try reinstalling the pack.\n\n${error}`);
    } finally {
      isInstalling = false;
      installProgress = "";
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
      case "geonames":
        return "🌍";
      case "map":
        return "🗺️";
      case "cross-references":
        return "🔗";
      case "references":
        return "◆";
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
          <div class="pack-item" class:needs-reindex={packsNeedingReindex.has(pack.id)}>
            <div class="pack-icon"><span class="emoji">{getPackTypeIcon(pack.type)}</span></div>
            <div class="pack-info">
              <div class="pack-name">{pack.id}</div>
              <div class="pack-meta">
                <span class="pack-type">{pack.type}</span>
                <span class="pack-separator">•</span>
                <span class="pack-version">v{pack.version}</span>
                <span class="pack-separator">•</span>
                <span class="pack-size">{formatBytes(pack.size)}</span>
                {#if packsNeedingReindex.has(pack.id)}
                  <span class="pack-separator">•</span>
                  <span class="reindex-warning">index missing</span>
                {/if}
              </div>
            </div>
            {#if packsNeedingReindex.has(pack.id)}
              <button
                class="reindex-btn"
                on:click={() => handleReindexPack(pack.id)}
                disabled={isInstalling}
                title="Re-index audio chapters (no re-download needed)"
              >
                Re-index
              </button>
            {/if}
            <button
              class="remove-btn"
              on:click={() => handleRemovePack(pack.id)}
              disabled={isInstalling}
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
            <div class="pack-card-size">{manifestSizes[pack.id] ?? pack.size}</div>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- Read Aloud Voices -->
  {#if isTtsSupported()}
    <div class="section">
      <h3><span class="emoji">🗣</span> Voices (Read Aloud)</h3>
      <p class="section-description">
        AI voices for reading chapters aloud. Downloaded once, then they work
        fully offline — start playback from the 🗣 button in any chapter.
      </p>

      <div class="pack-grid">
        {#each voiceList as voice}
          {@const isVoiceInstalled = installedVoices.includes(voice.id)}
          {@const canDownload = voiceIsDownloadable(voice)}
          <button
            class="pack-card"
            class:installed={isVoiceInstalled}
            on:click={() =>
              isVoiceInstalled || !canDownload
                ? removeTtsVoice(voice.id)
                : installTtsVoice(voice.id)}
            disabled={isInstalling || (!isVoiceInstalled && !canDownload)}
            title={isVoiceInstalled
              ? "Installed — click to remove"
              : canDownload
                ? `Download ${voice.label}`
                : `${voice.label} (custom)`}
          >
            <div class="pack-card-icon"><span class="emoji">{voice.custom ? "🎙" : "🗣"}</span></div>
            <div class="pack-card-content">
              <div class="pack-card-name">
                {voice.label}
                {#if isVoiceInstalled}<span class="installed-badge">✓</span>{/if}
              </div>
              <div class="pack-card-description">
                {voice.quality === "standard"
                  ? "Natural quality, best for daily listening"
                  : voice.quality === "compact"
                    ? "Smaller and faster on older phones"
                    : "Your custom voice"}
              </div>
              <div class="pack-card-size">~{voice.approxSizeMB} MB</div>
            </div>
          </button>
        {/each}
      </div>

      <div class="actions voice-actions">
        <button class="primary-btn" on:click={triggerVoiceFilePicker} disabled={isInstalling}>
          <span class="emoji">🎙</span> Install voice from file
        </button>
      </div>
      <p class="section-description voice-hint">
        Pick a voice's model (.onnx) and settings (.onnx.json) together to add a
        custom or cloned voice.
      </p>
      <input
        type="file"
        accept=".onnx,.json,application/json"
        multiple
        bind:this={voiceFileInput}
        on:change={handleVoiceFiles}
        style="display:none"
      />
    </div>
  {/if}

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

  .pack-item.needs-reindex {
    border-color: rgba(255, 165, 0, 0.4);
    background: rgba(255, 165, 0, 0.05);
  }

  .reindex-warning {
    color: #ffa500;
    font-weight: 500;
    font-size: 0.8rem;
  }

  .reindex-btn {
    padding: 0.4rem 0.85rem;
    background: rgba(255, 165, 0, 0.15);
    border: 1px solid rgba(255, 165, 0, 0.5);
    color: #ffa500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.85rem;
    font-weight: 600;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .reindex-btn:hover:not(:disabled) {
    background: rgba(255, 165, 0, 0.25);
    border-color: rgba(255, 165, 0, 0.7);
  }

  .reindex-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
