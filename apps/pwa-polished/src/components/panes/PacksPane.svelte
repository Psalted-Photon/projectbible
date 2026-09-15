<script lang="ts">
  import { onMount } from "svelte";
  import {
    listInstalledPacks,
    removePack,
    getDatabaseStats,
    packDataLooksComplete,
  } from "../../adapters/db-manager";
  import { importPackFromSQLite, atlasPackSupported } from "../../adapters/pack-import";
  import { USE_BUNDLED_PACKS, PACK_MANIFEST_URL } from "../../config";
  import {
    PACK_CATALOG,
    downloadAndImportPack,
    installAll,
    installAllState,
    installBusy,
    installMessage,
    restartNeeded,
    packsStillToInstall,
    voicesStillToInstall,
  } from "../../lib/packInstaller";
  import {
    isTtsSupported,
    storedVoices,
    downloadVoice,
    removeVoice,
    getSelectableVoices,
    voiceDownloadSizeMB,
    hasKokoroModel,
    removeKokoroModel,
    getVoiceInfo,
    installVoiceFromFiles,
    voiceIsDownloadable,
    type TtsVoiceInfo,
  } from "../../adapters/tts";
  import { showNotice, errorText } from "../../stores/noticeStore";

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
  /** Reference packs whose import was cut short — installed, but missing rows. */
  let packsIncomplete = new Set<string>();
  let isLoading = true;
  let dbStats = {
    totalSize: "0 MB",
    packCount: 0,
    verseCount: 0,
  };
  let showInstallUrl = false;
  let installUrl = "";

  // Live pack sizes, keyed by pack id. The hardcoded `size` strings below are
  // only a fallback for when the manifest cannot be fetched -- they drift every
  // time a pack is rebuilt, and drifted badly enough that Study Tools advertised
  // 438.89 MB while shipping 523.78 MB.
  let manifestSizes: Record<string, string> = {};
  let manifestBytes: Record<string, number> = {};
  let fileInputElement: HTMLInputElement;
  let installedVoices: string[] = [];
  let voiceList: TtsVoiceInfo[] = [];
  // Kokoro voices share one 310 MB model, so what a voice actually costs to
  // install depends on whether that model is already here. A fixed number would
  // be wrong every time, in one direction or the other.
  let voiceSizes: Record<string, number> = {};
  $: naturalVoices = voiceList.filter((v) => v.engine === "kokoro");
  $: standardVoices = voiceList.filter((v) => v.engine !== "kokoro");
  let voiceFileInput: HTMLInputElement;

  async function refreshVoices() {
    if (!isTtsSupported()) return;
    try {
      voiceList = await getSelectableVoices();
      installedVoices = await storedVoices();
      const sizes: Record<string, number> = {};
      for (const v of voiceList) sizes[v.id] = await voiceDownloadSizeMB(v);
      voiceSizes = sizes;
    } catch (err) {
      console.warn("[Packs] Could not list TTS voices:", err);
    }
  }

  async function installTtsVoice(voiceId: string) {
    const voice = getVoiceInfo(voiceId);
    if (!voice || $installBusy) return;
    $installBusy = true;
    $installMessage = `Preparing ${voice.label}...`;
    try {
      await downloadVoice(voiceId, ({ loaded, total }) => {
        const loadedMB = (loaded / 1024 / 1024).toFixed(0);
        const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(0) : "?";
        $installMessage = `Downloading ${voice.label} (${loadedMB} MB / ${totalMB} MB)…`;
      });
      $installMessage = "Complete!";
      await refreshVoices();
      setTimeout(() => ($installMessage = ""), 2000);
    } catch (err: any) {
      console.error("[Packs] Voice install failed:", err);
      $installMessage = `Voice download failed: ${err?.message ?? err}`;
      setTimeout(() => ($installMessage = ""), 6000);
    } finally {
      $installBusy = false;
    }
  }

  /**
   * Every natural voice runs on one shared 310 MB model, so removing the last
   * of them leaves it behind taking up space for nothing. Asked separately and
   * only when none are left: it is a much bigger deletion than the voice the
   * user actually clicked, and folding it into that first confirmation would
   * make a 310 MB delete look like a 1 MB one.
   */
  async function offerToFreeSharedModel(removed: TtsVoiceInfo) {
    if (removed.engine !== "kokoro") return;
    if (naturalVoices.some((v) => installedVoices.includes(v.id))) return;
    if (!(await hasKokoroModel())) return;
    if (
      !confirm(
        `That was your last natural voice.\n\n` +
          `They all share one 310 MB engine, which is still stored on this device. ` +
          `Free it up?\n\n` +
          `Installing a natural voice again later will re-download it.`,
      )
    ) {
      return;
    }
    try {
      await removeKokoroModel();
      await refreshVoices();
    } catch (err: any) {
      console.error("[Packs] Could not free the shared voice engine:", err);
      showNotice(`Couldn't free up the shared voice engine: ${errorText(err)}`, "error");
    }
  }

  async function removeTtsVoice(voiceId: string) {
    const voice = getVoiceInfo(voiceId);
    if (!voice) return;
    const canRedownload = voiceIsDownloadable(voice);
    const note = canRedownload
      ? `You can re-download it any time (~${voiceSizes[voiceId] ?? voice.approxSizeMB} MB).`
      : `This is a custom voice — removing it deletes it from this device permanently.`;
    if (!confirm(`Remove the "${voice.label}" voice? ${note}`)) {
      return;
    }
    try {
      await removeVoice(voiceId);
      await refreshVoices();
      await offerToFreeSharedModel(voice);
    } catch (err: any) {
      console.error("[Packs] Voice removal failed:", err);
      showNotice(`Couldn't remove the voice: ${errorText(err)}`, "error");
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
      showNotice(
        "Pick both files for the voice: the model (.onnx) and its settings (.onnx.json).",
        "error"
      );
      return;
    }

    $installBusy = true;
    $installMessage = `Installing ${model.name}...`;
    try {
      const id = await installVoiceFromFiles(model, config);
      $installMessage = "Voice installed!";
      await refreshVoices();
      setTimeout(() => ($installMessage = ""), 2500);
      console.log(`[Packs] Installed custom voice: ${id}`);
    } catch (err: any) {
      console.error("[Packs] Custom voice install failed:", err);
      $installMessage = `Voice install failed: ${err?.message ?? err}`;
      setTimeout(() => ($installMessage = ""), 6000);
    } finally {
      $installBusy = false;
    }
  }

  // The catalog lives with the installer, so Install All can reach it too.
  const CONSOLIDATED_PACKS = PACK_CATALOG;

  const CATALOG_IDS = CONSOLIDATED_PACKS.map((p) => p.id);

  /**
   * The catalog pack an installed row belongs to, or null when nothing in the
   * catalog claims it.
   *
   * Importing a pack writes a row per translation and per edition inside it --
   * `translations-KJV`, `biblical-art-images-01` -- and the old installed list
   * rendered every one of them as a pack in its own right. They fold into their
   * parent here. What is left over is a real orphan: the standalone `isbe` pack
   * from before Encyclotopical absorbed it is still installed on devices that
   * had it, and with the installed list gone there would otherwise be nowhere
   * left to remove it from.
   */
  function catalogIdFor(rowId: string): string | null {
    if (CATALOG_IDS.includes(rowId)) return rowId;
    return CATALOG_IDS.find((id) => rowId.startsWith(`${id}-`)) ?? null;
  }

  interface InstalledState {
    version: string;
    bytes: number;
    incomplete: boolean;
  }

  /** Roll the installed rows up into one entry per catalog pack. */
  function mergeInstalled(
    rows: PackInfo[],
    incomplete: Set<string>
  ): Map<string, InstalledState> {
    const merged = new Map<string, InstalledState>();
    for (const row of rows) {
      const catalogId = catalogIdFor(row.id);
      if (!catalogId) continue;
      let state = merged.get(catalogId);
      if (!state) {
        state = { version: "", bytes: 0, incomplete: false };
        merged.set(catalogId, state);
      }
      // Only the parent row carries the pack's own version -- the sub-rows get
      // whatever the import happened to stamp on them, which is not it.
      if (row.id === catalogId) state.version = row.version;
      state.bytes += row.size;
      if (incomplete.has(row.id)) state.incomplete = true;
    }
    return merged;
  }

  $: installedById = mergeInstalled(installedPacks, packsIncomplete);
  /**
   * The Bible the app ships with (the NET text and its headings). It is not in
   * the catalog, so without this it would be listed as an older pack with a
   * delete button -- and deleting it leaves a new user with nothing to read.
   */
  function isStarterRow(rowId: string): boolean {
    return rowId === "starter" || rowId.startsWith("starter-");
  }

  $: orphanPacks = installedPacks.filter(
    (p) => catalogIdFor(p.id) === null && !isStarterRow(p.id)
  );
  // Count what is on screen. getDatabaseStats() counts rows, so on its own it
  // reports every sub-row this list folds away.
  $: packCount = installedById.size + orphanPacks.length;

  /**
   * The one open info card, or null. Shared by packs and voices. `subtitle` is
   * the pack's one-line summary; voices have no equivalent and leave it unset.
   */
  let infoCard: {
    title: string;
    subtitle?: string;
    body: string;
    meta: string;
  } | null = null;

  function openPackInfo(
    pack: (typeof CONSOLIDATED_PACKS)[0],
    state: InstalledState | undefined
  ) {
    infoCard = {
      title: pack.name,
      subtitle: pack.description,
      body: pack.info,
      meta: state
        ? `Installed${state.version ? ` · v${state.version}` : ""} · ${formatBytes(state.bytes)}`
        : `Download size ${manifestSizes[pack.id] ?? pack.size}`,
    };
  }

  function voiceInfoText(voice: TtsVoiceInfo): string {
    if (voice.custom) {
      return (
        "A voice you added yourself, from a Piper model file and its settings.\n\n" +
        "It reads chapters like any other voice. Removing it deletes it permanently — " +
        "there is nothing to download it back from."
      );
    }
    const quality =
      voice.quality === "standard"
        ? "Standard quality: the fuller and more natural of the two sizes, and the better pick for long stretches of listening."
        : "Compact quality: a smaller, lighter model that stays responsive on older phones, at the cost of some smoothness.";
    return (
      `${quality}\n\nThe voice downloads once and then runs entirely on your device — ` +
      "no connection needed, and nothing you listen to leaves the phone. Start it from " +
      "the 🗣 button in any chapter."
    );
  }

  function openVoiceInfo(voice: TtsVoiceInfo, installed: boolean) {
    infoCard = {
      title: voice.label,
      body: voiceInfoText(voice),
      meta: installed ? "Installed" : `Download size ~${voice.approxSizeMB} MB`,
    };
  }

  function closeInfo() {
    infoCard = null;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && infoCard) closeInfo();
  }

  async function installConsolidatedPack(pack: (typeof CONSOLIDATED_PACKS)[0]) {
    // Closing the pane mid-install and reopening it must not start a second
    // one: the lock is app-wide now, not this component's.
    if ($installBusy) return;

    // The map's geometry is compressed inside the pack and inflated on read,
    // which needs DecompressionStream. Checked here rather than mid-install:
    // downloading 34 MB and then failing to unpack it would leave a half-built
    // map that looks installed.
    if (pack.id === "atlas-map" && !atlasPackSupported()) {
      showNotice(
        `${pack.name} needs a newer browser than this one.\n` +
          "It works in Chrome 80 and later, Safari 16.4 and later, and Firefox 113 and later.",
        "error"
      );
      return;
    }

    const reinstall = installedPacks.some((p) => p.id === pack.id);
    if (reinstall && !confirm(`Pack "${pack.name}" is already installed. Re-download it?`)) {
      return;
    }

    $installBusy = true;
    try {
      // Remove the old copy first so the re-download actually happens —
      // loadPackOnDemand skips the download when the installed version matches
      // the manifest, and pack versions stay unchanged when their data updates.
      if (reinstall) {
        $installMessage = `Removing old ${pack.name}...`;
        await removePack(pack.id);
        await loadPacks();
        await loadStats();
      }

      if (!(await hasRoomFor(pack))) return;

      await downloadAndImportPack(pack, (message) => ($installMessage = message));

      $installMessage = "Complete!";
      $restartNeeded = true;
      showNotice(`${pack.name} installed`);

      await loadPacks();
      await loadStats();

      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error(`Error installing ${pack.name}:`, error);
      const isQuota =
        error instanceof DOMException &&
        (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
      showNotice(
        isQuota
          ? `Not enough storage to install ${pack.name}.\n` +
              "Free up space on your device, or remove a pack you are not using, then try again."
          : `Couldn't install ${pack.name}: ${errorText(error)}`,
        "error"
      );
    } finally {
      $installBusy = false;
      $installMessage = "";
    }
  }

  /**
   * Bytes an install actually pulls down, shards included.
   *
   * The art pack is split: art.sqlite holds only the scenes (60 KB) and the
   * paintings arrive as biblical-art-images-NN. Reading the pack's own manifest
   * entry alone would call an 85 MB install "60 KB".
   */
  function installBytesFor(packId: string): number {
    let total = manifestBytes[packId] ?? 0;
    if (packId === "biblical-art") {
      for (const [id, bytes] of Object.entries(manifestBytes)) {
        if (id.startsWith("biblical-art-images-")) total += bytes;
      }
    }
    // The map is split the same way: atlas-map.sqlite is under 2 MB, and the
    // geometry shards and the place index are the other 32.
    if (packId === "atlas-map") {
      for (const [id, bytes] of Object.entries(manifestBytes)) {
        if (id !== "atlas-map" && id.startsWith("atlas-map-")) total += bytes;
      }
    }
    return total;
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
    return hasRoomForBytes(pack.name, installBytesFor(pack.id));
  }

  async function hasRoomForBytes(name: string, needed: number): Promise<boolean> {
    if (!needed || !navigator.storage?.estimate) return true;

    try {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      if (!quota) return true;

      // A device reporting more usage than quota is not out of space -- it is
      // reporting nonsense, and it does so often enough (6 GB used against a
      // 2 GB quota, on a machine with room to spare) that warning from these
      // numbers means warning when nothing is wrong.
      if (usage >= quota) return true;

      const available = quota - usage;
      if (available >= needed * 2) return true;

      return confirm(
        `${name} needs about ${formatBytes(needed * 2)} to install, ` +
          `but only ${formatBytes(Math.max(available, 0))} looks available on this device.

` +
          `The install may fail partway through. Continue anyway?`
      );
    } catch {
      return true;
    }
  }

  // ── Install All ──────────────────────────────────────────────────────────

  /** What Install All would still do, and roughly what it would download. */
  let remainingCount = 0;
  let remainingBytes = 0;

  /**
   * Count what is left and estimate its size. The natural voices all share one
   * 310 MB engine, and each of their own sizes includes it while it is missing,
   * so the engine is counted once rather than once per voice.
   */
  async function refreshRemaining() {
    try {
      const [packs, voices] = await Promise.all([packsStillToInstall(), voicesStillToInstall()]);
      const MB = 1024 * 1024;
      let bytes = packs.reduce(
        (sum, pack) => sum + (installBytesFor(pack.id) || parseFloat(pack.size) * MB || 0),
        0
      );
      const standard = voices.filter((v) => v.engine !== "kokoro");
      const natural = voices.filter((v) => v.engine === "kokoro");
      bytes += standard.reduce((sum, v) => sum + (voiceSizes[v.id] ?? v.approxSizeMB) * MB, 0);
      if (natural.length > 0) {
        const largest = Math.max(...natural.map((v) => voiceSizes[v.id] ?? v.approxSizeMB));
        bytes += (largest + (natural.length - 1)) * MB;
      }
      remainingCount = packs.length + voices.length;
      remainingBytes = bytes;
    } catch (error) {
      console.warn("[Packs] Could not work out what is left to install:", error);
    }
  }

  async function handleInstallAll() {
    if ($installBusy) return;
    if (!(await hasRoomForBytes("Everything left to install", remainingBytes))) return;
    await installAll();
  }

  /**
   * Refresh the lists once an Install All run ends -- including one this pane
   * did not start, because the pane was closed and reopened while it ran.
   */
  let installAllWasRunning = $installAllState.running;
  $: if (installAllWasRunning !== $installAllState.running) {
    installAllWasRunning = $installAllState.running;
    if (!installAllWasRunning) void refreshAfterInstallAll();
  }

  async function refreshAfterInstallAll() {
    await loadPacks();
    await loadStats();
    await refreshVoices();
    await refreshRemaining();
  }

  onMount(async () => {
    await loadManifestSizes();
    await loadPacks();
    await loadStats();
    await refreshVoices();
    await refreshRemaining();
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
      // Show the art pack as what it downloads, not as the 60 KB scenes file --
      // its paintings arrive in separate shards.
      const artTotal = Object.entries(bytesById).reduce(
        (sum, [id, bytes]) =>
          id === "biblical-art" || id.startsWith("biblical-art-images-") ? sum + bytes : sum,
        0
      );
      if (artTotal > 0) sizes["biblical-art"] = formatBytes(artTotal);

      // Same for the map: atlas-map.sqlite is under 2 MB on its own, and the
      // card would be advertising a 34 MB download as a small one.
      const atlasTotal = Object.entries(bytesById).reduce(
        (sum, [id, bytes]) => (id === "atlas-map" || id.startsWith("atlas-map-") ? sum + bytes : sum),
        0
      );
      if (atlasTotal > 0) sizes["atlas-map"] = formatBytes(atlasTotal);

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

      // Check each reference pack for a cut-short import — a registry row over
      // stores that are partly or entirely empty. Nothing re-downloads these on
      // their own, so without a flag here the damage is invisible until you open
      // an article or a topic and find the page blank.
      const incompleteSet = new Set<string>();
      for (const pack of installedPacks) {
        if (!(await packDataLooksComplete(pack.id, pack.type))) {
          incompleteSet.add(pack.id);
        }
      }
      packsIncomplete = incompleteSet;
    } catch (error) {
      console.error("Error loading packs:", error);
      showNotice(`Couldn't load your packs: ${errorText(error)}`, "error");
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
    $installBusy = true;
    $installMessage = `Removing ${packId}…`;
    try {
      await removePack(packId);
      showNotice(`${CONSOLIDATED_PACKS.find((p) => p.id === packId)?.name ?? packId} removed`);
      await loadPacks();
      await loadStats();

      // Trigger a reload to refresh the UI
      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error("Error removing pack:", error);
      showNotice(`Couldn't remove the pack: ${errorText(error)}`, "error");
    } finally {
      $installBusy = false;
      $installMessage = "";
    }
  }

  async function handleInstallFromUrl() {
    if (!installUrl.trim()) {
      showNotice("Enter a link to the pack first", "error");
      return;
    }

    $installBusy = true;
    $installMessage = "Downloading pack...";

    try {
      const response = await fetch(installUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      const file = new File([blob], "pack.sqlite", {
        type: "application/x-sqlite3",
      });

      $installMessage = "Installing pack...";
      await importPackFromSQLite(file);

      $installMessage = "Complete!";
      showNotice("Pack installed");

      installUrl = "";
      showInstallUrl = false;
      await loadPacks();
      await loadStats();

      // Trigger a reload to refresh the UI
      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error("Error installing pack from URL:", error);
      showNotice(`Couldn't install the pack: ${errorText(error)}`, "error");
    } finally {
      $installBusy = false;
      $installMessage = "";
    }
  }

  function handleInstallFromFileClick() {
    fileInputElement?.click();
  }

  async function handleFileSelected(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (!file) return;

    $installBusy = true;
    $installMessage = `Installing ${file.name}...`;

    try {
      await importPackFromSQLite(file);

      $installMessage = "Complete!";
      showNotice(`${file.name} installed`);

      await loadPacks();
      await loadStats();

      // Trigger a reload to refresh the UI
      window.dispatchEvent(new CustomEvent("packsUpdated"));
    } catch (error) {
      console.error("Error installing pack from file:", error);
      showNotice(`Couldn't install ${file.name}: ${errorText(error)}`, "error");
    } finally {
      $installBusy = false;
      $installMessage = "";
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
      case "references":
        return "◆";
      case "morphology":
        return "🔤";
      default:
        return "📦";
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="packs-pane">
  <h2><span class="emoji">📦</span> Pack Management</h2>
  <p class="db-line">
    {packCount}
    {packCount === 1 ? "pack" : "packs"} · {dbStats.verseCount.toLocaleString()} verses
    · {dbStats.totalSize} used
  </p>

  <!-- Sticky: an install started from the top of the list has to stay visible
       once you scroll down to watch something else. -->
  {#if $installMessage}
    <div class="progress-message">{$installMessage}</div>
  {/if}

  {#if $restartNeeded && !$installBusy}
    <div class="restart-bar">
      <span>New packs switch on after a restart.</span>
      <button class="restart-btn" on:click={() => window.location.reload()}>Restart</button>
    </div>
  {/if}

  <div class="install-all">
    {#if $installAllState.running}
      <p class="ia-note">
        Installing everything — {$installAllState.step} of {$installAllState.total}. It keeps
        going if you close this pane.
      </p>
    {:else if remainingCount > 0}
      <button class="install-all-btn" on:click={handleInstallAll} disabled={$installBusy}>
        <span class="emoji">⬇️</span> Install all
      </button>
      <p class="ia-note">
        {remainingCount} left · about {formatBytes(remainingBytes)} · Wi-Fi recommended
      </p>
    {:else if !isLoading}
      <p class="ia-note">Every pack and voice is installed.</p>
    {/if}

    {#if !$installAllState.running && $installAllState.outOfSpace}
      <p class="ia-warn">
        Stopped: this device ran out of storage. Free up some space, then tap Install all to
        carry on.
      </p>
    {:else if !$installAllState.running && $installAllState.failed.length > 0}
      <p class="ia-warn">
        {$installAllState.failed.length === 1 ? "One didn't" : `${$installAllState.failed.length} didn't`}
        finish: {$installAllState.failed.join(", ")}. Tap Install all to try again.
      </p>
    {/if}
  </div>

  {#if isLoading}
    <div class="loading">Loading packs…</div>
  {:else}
    <div class="pill-list">
      {#each CONSOLIDATED_PACKS as pack (pack.id)}
        {@const state = installedById.get(pack.id)}
        <div
          class="pill stacked"
          class:installed={!!state}
          class:flagged={state?.incomplete}
        >
          <div class="pill-text">
            <div class="pill-head">
              <span class="pill-icon emoji">{pack.icon}</span>
              <span class="pill-name">{pack.name}</span>
              {#if state?.incomplete}
                <span class="pill-flag">install unfinished</span>
              {/if}
            </div>
          </div>
          <div class="pill-actions">
            <button
              class="icon-btn"
              on:click={() => openPackInfo(pack, state)}
              title="About {pack.name}"
              aria-label="About {pack.name}">ⓘ</button
            >
            <button
              class="icon-btn"
              class:go={!state}
              on:click={() => installConsolidatedPack(pack)}
              disabled={$installBusy}
              title={state ? `Re-download ${pack.name}` : `Install ${pack.name}`}
              aria-label={state ? `Re-download ${pack.name}` : `Install ${pack.name}`}
              >{state ? "↻" : "↓"}</button
            >
            {#if state}
              <button
                class="icon-btn danger"
                on:click={() => handleRemovePack(pack.id)}
                disabled={$installBusy}
                title="Remove {pack.name}"
                aria-label="Remove {pack.name}"><span class="emoji">🗑️</span></button
              >
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <!-- Packs installed from an older release that the catalog no longer
         offers. Nothing describes them any more, but they still take up space,
         so they keep a delete button. -->
    {#if orphanPacks.length > 0}
      <h3 class="sub-head">Other installed</h3>
      <div class="pill-list">
        {#each orphanPacks as pack (pack.id)}
          <div class="pill stacked">
            <div class="pill-text">
              <div class="pill-head">
                <span class="pill-icon emoji">{getPackTypeIcon(pack.type)}</span>
                <span class="pill-name">{pack.id}</span>
              </div>
              <!-- No info button on these rows, so the version and size ride
                   along on the description line rather than vanishing. -->
              <div class="pill-desc">
                Older pack, no longer offered · v{pack.version} · {formatBytes(pack.size)}
              </div>
            </div>
            <div class="pill-actions">
              <button
                class="icon-btn danger"
                on:click={() => handleRemovePack(pack.id)}
                disabled={$installBusy}
                title="Remove {pack.id}"
                aria-label="Remove {pack.id}"><span class="emoji">🗑️</span></button
              >
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  <h3 class="sub-head">Advanced Install</h3>
  <div class="adv-actions">
    <button
      class="small-btn"
      on:click={() => (showInstallUrl = !showInstallUrl)}
      disabled={$installBusy}
    >
      <span class="emoji">🌐</span> From URL
    </button>
    <button class="small-btn" on:click={handleInstallFromFileClick} disabled={$installBusy}>
      <span class="emoji">📁</span> From File
    </button>
  </div>

  {#if showInstallUrl}
    <div class="install-url-form">
      <input
        type="text"
        bind:value={installUrl}
        placeholder="https://example.com/pack.sqlite"
        disabled={$installBusy}
      />
      <button
        class="install-btn"
        on:click={handleInstallFromUrl}
        disabled={$installBusy || !installUrl.trim()}
      >
        Install
      </button>
    </div>
  {/if}

  <!-- Hidden file input -->
  <input
    type="file"
    accept=".sqlite,.db,.sqlite3"
    bind:this={fileInputElement}
    on:change={handleFileSelected}
    style="display: none;"
  />

  {#if isTtsSupported()}
    <h3 class="sub-head"><span class="emoji">🗣</span> Voices (Read Aloud)</h3>

    {#if naturalVoices.length > 0}
      <p class="voice-group-note">
        <strong>Natural voices.</strong> These sound closest to a real reader. They
        share one engine, so the first one is a large download and the rest are
        nearly instant.
      </p>
    {/if}
    <div class="pill-list">
      {#each [...naturalVoices, ...standardVoices] as voice (voice.id)}
        {#if voice === standardVoices[0] && naturalVoices.length > 0}
          <p class="voice-group-note second">
            <strong>Standard voices.</strong> Lighter on the battery, and the only
            option for Greek.
          </p>
        {/if}
        {@const isVoiceInstalled = installedVoices.includes(voice.id)}
        {@const canDownload = voiceIsDownloadable(voice)}
        <div class="pill" class:installed={isVoiceInstalled}>
          <div class="pill-text">
            <div class="pill-head">
              <span class="pill-icon emoji">{voice.custom ? "🎙" : "🗣"}</span>
              <span class="pill-name">{voice.label}</span>
            </div>
            <div class="pill-desc">
              {voice.custom
                ? "Your own voice"
                : voice.engine === "kokoro"
                  ? (voiceSizes[voice.id] ?? 0) < 10
                    ? "Shares the engine you already have"
                    : "Includes the shared engine, downloaded once"
                  : voice.quality === "standard"
                    ? "Lighter on the battery"
                    : "Smaller and faster on older phones"}
            </div>
          </div>
          <div class="pill-actions">
            <button
              class="icon-btn"
              on:click={() => openVoiceInfo(voice, isVoiceInstalled)}
              title="About {voice.label}"
              aria-label="About {voice.label}">ⓘ</button
            >
            {#if isVoiceInstalled || !canDownload}
              <button
                class="icon-btn danger"
                on:click={() => removeTtsVoice(voice.id)}
                disabled={$installBusy || (!isVoiceInstalled && !canDownload)}
                title="Remove {voice.label}"
                aria-label="Remove {voice.label}"><span class="emoji">🗑️</span></button
              >
            {:else}
              <button
                class="icon-btn go"
                on:click={() => installTtsVoice(voice.id)}
                disabled={$installBusy}
                title="Install {voice.label}"
                aria-label="Install {voice.label}">↓</button
              >
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <button class="small-btn" on:click={triggerVoiceFilePicker} disabled={$installBusy}>
      <span class="emoji">🎙</span> Install voice from file
    </button>
    <p class="hint">
      Pick a voice's model (.onnx) and settings (.onnx.json) together.
    </p>
    <input
      type="file"
      accept=".onnx,.json,application/json"
      multiple
      bind:this={voiceFileInput}
      on:change={handleVoiceFiles}
      style="display:none"
    />
  {/if}

  <p class="footnote">
    <span class="emoji">⚠️</span> Only install packs from sources you trust. Removing
    a pack deletes all of its data.
  </p>
</div>

<!-- Info card. The backdrop is a real button so dismissing by tapping away
     works from the keyboard too, without an interactive-div warning. -->
{#if infoCard}
  <button class="info-backdrop" on:click={closeInfo} aria-label="Close"></button>
  <div class="info-card" role="dialog" aria-modal="true" aria-label={infoCard.title}>
    <button class="info-close" on:click={closeInfo} aria-label="Close">✕</button>
    <h4>{infoCard.title}</h4>
    {#if infoCard.subtitle}
      <div class="info-sub">{infoCard.subtitle}</div>
    {/if}
    {#each infoCard.body.split("\n\n") as paragraph}
      <p>{paragraph}</p>
    {/each}
    <div class="info-meta">{infoCard.meta}</div>
  </div>
{/if}

<style>
  .voice-group-note {
    font-size: 0.8rem;
    color: #9a9a9a;
    line-height: 1.5;
    margin: 2px 0 10px;
  }
  .voice-group-note.second {
    margin-top: 18px;
    grid-column: 1 / -1;
  }
  .voice-group-note strong {
    color: #d5d5d5;
    font-weight: 600;
  }

  .packs-pane {
    color: #e0e0e0;
    max-width: 800px;
    margin: 0 auto;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #f0f0f0;
    margin: 0 0 0.2rem;
  }

  .db-line {
    font-size: 0.78rem;
    color: #888;
    margin: 0 0 0.9rem;
  }

  .sub-head {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #667eea;
    margin: 1.4rem 0 0.4rem;
  }

  .loading {
    padding: 1rem 0;
    color: #888;
    font-style: italic;
  }

  /* The @container rule further down reflows pack pills when the pane itself
     is narrow. It has to key off the pane and not the viewport: panes are
     resizable drawers at 75% width on a phone and 40% elsewhere, so 40% of a
     768px tablet is the same ~307px as a phone, while 40% of a 1920px desktop
     has room to spare. The list is the container rather than the pane, because
     container-type would make an ancestor the containing block for any
     position:fixed descendant -- the list holds only pills. */
  .pill-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    container-type: inline-size;
  }

  .pill {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.45rem;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
  }

  .pill.installed {
    background: rgba(76, 175, 80, 0.06);
    border-color: rgba(76, 175, 80, 0.35);
  }

  .pill.flagged {
    background: rgba(255, 165, 0, 0.06);
    border-color: rgba(255, 165, 0, 0.45);
  }

  .pill-icon {
    font-size: 1.15rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .pill-text {
    flex: 1;
    min-width: 0;
  }

  .pill-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .pill-name {
    /* One line, never wrapped. Names top out at 20 characters and the stacked
       layout below hands them the whole row, so the ellipsis is only a guard
       -- wrapping was a workaround for the buttons taking the width, and it
       broke names mid-word. */
    min-width: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #f0f0f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill-flag {
    font-size: 0.68rem;
    font-weight: 600;
    color: #ffa500;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Voice and orphan rows only -- pack pills show the name alone. One line,
     always: for voices the full text is a tap away on the info button. */
  .pill-desc {
    font-size: 0.72rem;
    color: #999;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pill-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .icon-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: #262626;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #bbb;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:hover:not(:disabled) {
    background: #303030;
    border-color: #667eea;
    color: #fff;
  }

  .icon-btn.go {
    background: rgba(102, 126, 234, 0.15);
    border-color: rgba(102, 126, 234, 0.45);
    color: #8fa3f5;
  }

  .icon-btn.danger {
    background: rgba(220, 38, 38, 0.1);
    border-color: rgba(220, 38, 38, 0.3);
    color: #ff6b6b;
    font-size: 0.85rem;
  }

  .icon-btn.danger:hover:not(:disabled) {
    background: rgba(220, 38, 38, 0.2);
    border-color: rgba(220, 38, 38, 0.5);
  }

  /* Narrow pane: give the name the whole first row and drop the buttons onto
     a second one, stretched edge to edge. Three 34px squares crammed at the
     right of a 300px pane left the name ~130px and nothing read in full.
     Packs and orphans only -- voice rows are short enough to stay on one line
     at any width, so they never get the `stacked` class. */
  @container (max-width: 360px) {
    .pill.stacked {
      flex-direction: column;
      align-items: stretch;
      gap: 0.4rem;
    }

    .pill.stacked .pill-actions {
      gap: 0.3rem;
    }

    /* flex: 1 splits the row evenly however many buttons the pack has -- one
       for an orphan, three for an installed pack. A quarter shorter than
       the 34px square, since the glyphs never needed that much headroom, and
       far wider, so still an easier target than the squares were. */
    .pill.stacked .icon-btn {
      flex: 1;
      width: auto;
      height: 25px;
    }
  }

  .small-btn {
    margin-top: 0.5rem;
    padding: 0.45rem 0.8rem;
    background: #262626;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #ddd;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .small-btn:hover:not(:disabled) {
    border-color: #667eea;
    color: #fff;
  }

  .icon-btn:disabled,
  .small-btn:disabled,
  .install-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .adv-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .hint {
    font-size: 0.7rem;
    color: #777;
    margin: 0.3rem 0 0;
  }

  .footnote {
    font-size: 0.7rem;
    color: #777;
    line-height: 1.5;
    margin: 1.4rem 0 0;
  }

  .install-url-form {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .install-url-form input {
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.6rem;
    background: #202020;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 0.85rem;
  }

  .install-url-form input:focus {
    outline: none;
    border-color: #667eea;
  }

  .install-url-form input::placeholder {
    color: #666;
  }

  .install-btn {
    padding: 0.45rem 1rem;
    background: #4caf50;
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .install-btn:hover:not(:disabled) {
    background: #45a049;
  }

  /* Opaque, because it sticks over the list as you scroll past it. */
  .progress-message {
    position: sticky;
    top: 0;
    z-index: 5;
    margin-bottom: 0.7rem;
    padding: 0.5rem 0.7rem;
    background: #1c2033;
    border-left: 3px solid #667eea;
    border-radius: 4px;
    color: #8fa3f5;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .restart-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-bottom: 0.7rem;
    padding: 0.5rem 0.7rem;
    background: #1c2033;
    border-left: 3px solid #667eea;
    border-radius: 4px;
    color: #c9d3fb;
    font-size: 0.8rem;
  }

  .restart-btn {
    flex-shrink: 0;
    padding: 0.35rem 0.8rem;
    background: #667eea;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .install-all {
    margin-bottom: 1rem;
  }

  .install-all-btn {
    width: 100%;
    padding: 0.65rem 0.8rem;
    background: rgba(102, 126, 234, 0.15);
    border: 1px solid rgba(102, 126, 234, 0.45);
    border-radius: 8px;
    color: #8fa3f5;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .install-all-btn:hover:not(:disabled) {
    background: rgba(102, 126, 234, 0.25);
  }

  .install-all-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ia-note {
    margin: 0.4rem 0 0;
    color: #9a9a9a;
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .ia-warn {
    margin: 0.4rem 0 0;
    color: #f0b35a;
    font-size: 0.78rem;
    line-height: 1.45;
  }

  .info-backdrop {
    position: fixed;
    inset: 0;
    z-index: 900;
    padding: 0;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    cursor: pointer;
  }

  .info-card {
    position: fixed;
    z-index: 901;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(430px, calc(100vw - 2rem));
    max-height: min(70vh, 540px);
    overflow-y: auto;
    padding: 1rem 1.1rem 0.9rem;
    background: #1c1c1c;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  }

  .info-close {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    color: #888;
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
  }

  .info-close:hover {
    color: #fff;
  }

  .info-card h4 {
    margin: 0 2rem 0.6rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: #f0f0f0;
  }

  /* The pack's one-line summary, which used to sit on the pill. The negative
     top margin pulls it up under its own title -- the h4 keeps its 0.6rem gap
     for voice cards, which have no subtitle. */
  .info-sub {
    margin: -0.4rem 2rem 0.85rem 0;
    font-size: 0.8rem;
    color: #999;
  }

  .info-card p {
    margin: 0 0 0.7rem;
    font-size: 0.85rem;
    line-height: 1.55;
    color: #c8c8c8;
  }

  .info-meta {
    padding-top: 0.6rem;
    border-top: 1px solid #333;
    font-size: 0.72rem;
    color: #777;
  }

  @media (max-width: 600px) {
    .install-url-form {
      flex-direction: column;
    }
  }
</style>
