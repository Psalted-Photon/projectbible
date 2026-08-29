<script lang="ts">
  import { onMount } from "svelte";
  import {
    listInstalledPacks,
    removePack,
    getDatabaseStats,
    audioPackHasChapters,
    packDataLooksComplete,
  } from "../../adapters/db-manager";
  import { importPackFromSQLite, importPackFromBytes, importArtImageShard } from "../../adapters/pack-import";
  import { installAudioPackToOPFS, reindexAudioPack } from "../../adapters/audio";
  import { loadPackOnDemand, installArtImageShards } from "../../lib/progressive-init";
  import { USE_BUNDLED_PACKS, PACK_MANIFEST_URL } from "../../config";
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
      alert(`Could not free the shared engine: ${err?.message ?? err}`);
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
  // Each pack carries two descriptions, and both open with the (i) button:
  // `description` is the one-line summary that heads the info card, and `info`
  // is the body under it -- author lists, licence terms, where the pack
  // actually shows up in the app. The pill itself shows only the name, because
  // on a phone that is all there is room to read.
  const CONSOLIDATED_PACKS = [
    {
      id: "translations",
      name: "English Translations",
      description: "KJV, WEB, BSB, NET, LXX2012",
      info: "Five complete English Bibles: the King James Version (1611), World English Bible, Berean Standard Bible, NET Bible, and LXX2012 — an English rendering of the Greek Septuagint.\n\nThis is the pack everything else builds on; without it there is nothing to read. Switch between the five from the translation picker in any reader window. All public domain or freely licensed.",
      size: "34.55 MB",
      icon: "📖",
      url: `${BASE_URL}/translations.sqlite`,
    },
    {
      id: "dictionary-en",
      name: "English Dictionary",
      description: "Modern + Webster 1913 definitions",
      info: "Two English dictionaries in one: a modern definition set, and Webster’s 1913 unabridged — which is what the KJV’s older vocabulary actually meant to the people reading it.\n\nTap any English word in the reader and choose Define. Public domain.",
      size: "48.67 MB",
      icon: "📖",
      url: `${BASE_URL}/dictionary-en.sqlite`,
    },
    {
      id: "commentaries",
      name: "Commentaries",
      description: "Henry, Clarke, Calvin, Spurgeon + 14 more",
      info: "Eighteen commentary sets working through the text a verse at a time: Matthew Henry, Adam Clarke, John Calvin, Charles Spurgeon, John Wesley, Albert Barnes, A.T. Robertson, Martin Luther, Thomas Aquinas (Catena Aurea), Jamieson-Fausset-Brown, E.W. Bullinger, John Lightfoot, Abbott, KingComments, Family Bible Notes, NET Bible Notes, Quotations & Allusions, and the Treasury of Scripture Knowledge.\n\nOpen the Commentary window, or tap a verse and choose Commentary, to read what each one said about where you are. Public domain or free for personal use, via the CrossWire Sword Project and Plano Bible Chapel.",
      size: "224.84 MB",
      icon: "💭",
      url: `${BASE_URL}/commentaries.sqlite`,
    },
    {
      id: "tsk-references",
      name: "TSK References",
      description: "43,000+ cross-references by keyword",
      info: "The Treasury of Scripture Knowledge: over 43,000 entries linking each verse to the other passages that echo it, organised by the specific word in the verse that triggers the link.\n\nCross-references show beside the verse you are reading and in the Cross-References window. Public domain (1830s).",
      size: "6.21 MB",
      icon: "🔗",
      url: `${BASE_URL}/tsk-references.sqlite`,
    },
    {
      id: "ancient-languages",
      name: "Ancient Languages",
      description: "Hebrew + Greek with morphology",
      info: "The Hebrew Old Testament and Greek New Testament in their original words, with every word tagged for grammar — tense, case, person and number.\n\nPowers the interlinear view and Greek read-aloud. Turn it on with the interlinear controls in the reader. Public domain.",
      size: "105.31 MB",
      icon: "📜",
      url: `${BASE_URL}/ancient-languages.sqlite`,
    },
    {
      id: "lexical",
      name: "Lexical Resources",
      description: "Strong’s + English dictionaries",
      info: "Strong’s Hebrew and Greek lexicons plus supporting English dictionaries — root meanings, definitions, and every place a given original word appears in scripture.\n\nTap a Greek or Hebrew word in the interlinear to see its Strong’s entry and full verse list. The largest reference pack at around 370 MB. Public domain.",
      size: "372.67 MB",
      icon: "📚",
      url: `${BASE_URL}/lexical.sqlite`,
    },
    {
      id: "study-tools",
      name: "Study Tools",
      description: "Biblical places, map layers, reading order",
      info: "Biblical and ancient place locations, historical map layers running from the Old Testament through the Roman era, and a chronological reading order that puts the books in the sequence the events happened.\n\nFeeds the Map window and the chronological plan under Reading Plans. Public domain; place data CC BY 4.0 (OpenBible.info).",
      size: "13.82 MB",
      icon: "🗺️",
      url: `${BASE_URL}/study-tools.sqlite`,
    },
    {
      id: "encyclotopical",
      name: "Encyclotopical",
      description: "Bible encyclopedia + Nave’s topical index",
      info: "Two classic references in one pack. The International Standard Bible Encyclopedia (ISBE, 1915) — 9,380 scholarly articles on people, places, customs, plants and doctrine. And Nave’s Topical Bible — 5,322 topics indexing over 100,000 verse references, so looking up “mercy” or “fasting” gives you every passage on it.\n\nBrowse either A–Z from the Encyclopedia and Topical windows, or tap a word in the reader and choose More Info. Public domain; place data CC BY 4.0 (OpenBible.info).",
      size: "77.52 MB",
      icon: "📕",
      url: `${BASE_URL}/encyclotopical.sqlite`,
    },
    {
      id: "geonames-modern-places-v1",
      name: "World Places",
      description: "172,000+ modern cities, states, countries",
      info: "A gazetteer of over 172,000 modern places worldwide — cities, states, provinces and countries — so you can find somewhere by its present-day name rather than its biblical one.\n\nUsed by the Map window’s search. Entirely optional: the biblical places in Study Tools work without it. CC BY 4.0 — geonames.org.",
      size: "37.23 MB",
      icon: "🌍",
      url: `${BASE_URL}/geonames.sqlite`,
    },
    {
      id: "section-headings",
      name: "Section Headings",
      description: "Pericope titles for all 66 books",
      info: "The short headings that mark where one passage ends and the next begins — “The Beatitudes”, “Jesus Calms the Storm” — for all 66 books.\n\nThey render above the verse they introduce and work with whichever translation you are reading. Under a megabyte.",
      size: "0.29 MB",
      icon: "📑",
      url: `${BASE_URL}/section-headings.sqlite`,
    },
    {
      id: "biblical-art",
      name: "Biblical Art",
      description: "Public-domain paintings of Bible scenes",
      info: "Famous paintings by the old masters, matched to the passages they depict. The images ship inside the pack, so they display with no connection.\n\nA small art icon appears in the text wherever a painting exists — tap it to view full screen. Public domain — Wikimedia Commons.",
      size: "83.45 MB",
      icon: "🖼️",
      url: `${BASE_URL}/art.sqlite`,
    },
    {
      id: "people-biblical-v1",
      name: "Biblical Characters",
      description: "Every named person: family, dates, verses",
      info: "Every named person in scripture: what their name means, roughly when and where they lived, their family relationships, and every verse they appear in.\n\nTap a name in the reader and choose Bio. CC BY-SA 4.0 (Theographic); name meanings from Hitchcock’s (public domain).",
      size: "3.82 MB",
      icon: "👤",
      url: `${BASE_URL}/people.sqlite`,
    },
    {
      id: "bsb-audio-pt1",
      name: "BSB Audio Part 1",
      description: "Genesis – Psalms",
      info: "The Berean Standard Bible read aloud from Genesis through Psalms — a human narrator, not a synthetic voice.\n\nPlay it with the audio button in any chapter. Around 1.8 GB, stored outside the main database, which is why it can be re-indexed without downloading again. Free to use — bereanbible.com.",
      size: "1.76 GB",
      icon: "🎵",
      url: `${BASE_URL}/bsb-audio-pt1.sqlite`,
    },
    {
      id: "bsb-audio-pt2",
      name: "BSB Audio Part 2",
      description: "Proverbs – Revelation",
      info: "The Berean Standard Bible read aloud from Proverbs through Revelation — a human narrator, not a synthetic voice.\n\nPlay it with the audio button in any chapter. Around 1.7 GB, stored outside the main database, which is why it can be re-indexed without downloading again. Free to use — bereanbible.com.",
      size: "1.65 GB",
      icon: "🎵",
      url: `${BASE_URL}/bsb-audio-pt2.sqlite`,
    },
  ];

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
    needsReindex: boolean;
    incomplete: boolean;
  }

  /** Roll the installed rows up into one entry per catalog pack. */
  function mergeInstalled(
    rows: PackInfo[],
    reindex: Set<string>,
    incomplete: Set<string>
  ): Map<string, InstalledState> {
    const merged = new Map<string, InstalledState>();
    for (const row of rows) {
      const catalogId = catalogIdFor(row.id);
      if (!catalogId) continue;
      let state = merged.get(catalogId);
      if (!state) {
        state = { version: "", bytes: 0, needsReindex: false, incomplete: false };
        merged.set(catalogId, state);
      }
      // Only the parent row carries the pack's own version -- the sub-rows get
      // whatever the import happened to stamp on them, which is not it.
      if (row.id === catalogId) state.version = row.version;
      state.bytes += row.size;
      if (reindex.has(row.id)) state.needsReindex = true;
      if (incomplete.has(row.id)) state.incomplete = true;
    }
    return merged;
  }

  $: installedById = mergeInstalled(installedPacks, packsNeedingReindex, packsIncomplete);
  $: orphanPacks = installedPacks.filter((p) => catalogIdFor(p.id) === null);
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

        installProgress = `Installing ${pack.name}...`;
        // No File wrapper: it would copy the whole pack into blob storage
        // just to be read straight back out again.
        await importPackFromBytes(new Uint8Array(buffer), `${pack.id}.sqlite`);

        if (pack.id === "biblical-art") {
          // Bundled mode has no manifest to enumerate, so walk the numbered
          // shards until one is missing.
          for (let n = 1; ; n++) {
            const part = String(n).padStart(2, "0");
            const res = await fetch(`${BASE_URL}/art-images-${part}.sqlite`);
            if (!res.ok) break;
            installProgress = `Installing artwork (part ${n})…`;
            const shard = new Uint8Array(await res.arrayBuffer());
            await importArtImageShard(shard, { clearFirst: n === 1, label: `art-images-${part}` });
          }
        }
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

        // art.sqlite carries only the scenes; the paintings arrive as small
        // shards so sql.js never holds the whole pack at once.
        if (pack.id === "biblical-art") {
          await installArtImageShards((message) => {
            installProgress = message;
          });
        }
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
    const needed = installBytesFor(pack.id);
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
      // Show the art pack as what it downloads, not as the 60 KB scenes file --
      // its paintings arrive in separate shards.
      const artTotal = Object.entries(bytesById).reduce(
        (sum, [id, bytes]) =>
          id === "biblical-art" || id.startsWith("biblical-art-images-") ? sum + bytes : sum,
        0
      );
      if (artTotal > 0) sizes["biblical-art"] = formatBytes(artTotal);

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
      // And each reference pack for a cut-short import — a registry row over
      // stores that are partly or entirely empty. Nothing re-downloads these on
      // their own, so without a flag here the damage is invisible until you open
      // an article or a topic and find the page blank.
      const incompleteSet = new Set<string>();
      for (const pack of installedPacks) {
        if (pack.type === 'audio') {
          const hasChapters = await audioPackHasChapters(pack.id);
          if (!hasChapters) reindexSet.add(pack.id);
        } else if (!(await packDataLooksComplete(pack.id, pack.type))) {
          incompleteSet.add(pack.id);
        }
      }
      packsNeedingReindex = reindexSet;
      packsIncomplete = incompleteSet;
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
  {#if installProgress}
    <div class="progress-message">{installProgress}</div>
  {/if}

  {#if isLoading}
    <div class="loading">Loading packs…</div>
  {:else}
    <div class="pill-list">
      {#each CONSOLIDATED_PACKS as pack (pack.id)}
        {@const state = installedById.get(pack.id)}
        <div
          class="pill stacked"
          class:installed={!!state}
          class:flagged={state?.needsReindex || state?.incomplete}
        >
          <div class="pill-text">
            <div class="pill-head">
              <span class="pill-icon emoji">{pack.icon}</span>
              <span class="pill-name">{pack.name}</span>
              {#if state?.needsReindex}
                <span class="pill-flag">index missing</span>
              {:else if state?.incomplete}
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
            {#if state?.needsReindex}
              <button
                class="text-btn"
                on:click={() => handleReindexPack(pack.id)}
                disabled={isInstalling}
                title="Re-index audio chapters (no re-download needed)">Re-index</button
              >
            {/if}
            <button
              class="icon-btn"
              class:go={!state}
              on:click={() => installConsolidatedPack(pack)}
              disabled={isInstalling}
              title={state ? `Re-download ${pack.name}` : `Install ${pack.name}`}
              aria-label={state ? `Re-download ${pack.name}` : `Install ${pack.name}`}
              >{state ? "↻" : "↓"}</button
            >
            {#if state}
              <button
                class="icon-btn danger"
                on:click={() => handleRemovePack(pack.id)}
                disabled={isInstalling}
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
                disabled={isInstalling}
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
      disabled={isInstalling}
    >
      <span class="emoji">🌐</span> From URL
    </button>
    <button class="small-btn" on:click={handleInstallFromFileClick} disabled={isInstalling}>
      <span class="emoji">📁</span> From File
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
                disabled={isInstalling || (!isVoiceInstalled && !canDownload)}
                title="Remove {voice.label}"
                aria-label="Remove {voice.label}"><span class="emoji">🗑️</span></button
              >
            {:else}
              <button
                class="icon-btn go"
                on:click={() => installTtsVoice(voice.id)}
                disabled={isInstalling}
                title="Install {voice.label}"
                aria-label="Install {voice.label}">↓</button
              >
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <button class="small-btn" on:click={triggerVoiceFilePicker} disabled={isInstalling}>
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

  .text-btn {
    height: 34px;
    padding: 0 0.6rem;
    background: rgba(255, 165, 0, 0.15);
    border: 1px solid rgba(255, 165, 0, 0.5);
    border-radius: 6px;
    color: #ffa500;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .text-btn:hover:not(:disabled) {
    background: rgba(255, 165, 0, 0.25);
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
       for an orphan, four for a flagged audio pack. Shorter than they are
       tall now, but far wider, so an easier target than the squares were. */
    .pill.stacked .icon-btn,
    .pill.stacked .text-btn {
      flex: 1;
      width: auto;
      height: 30px;
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
  .text-btn:disabled,
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
