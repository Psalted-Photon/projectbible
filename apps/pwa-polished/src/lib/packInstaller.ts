/**
 * Installing packs, from anywhere in the app.
 *
 * This used to live entirely inside PacksPane, which had two consequences. The
 * "one install at a time" rule was a local flag, so closing the pane mid-install
 * and reopening it re-enabled every button while the first install was still
 * running -- and two installs share one progress handler and one install log in
 * progressive-init, so they trample each other. And nothing outside the pane
 * could install anything, which ruled out an Install All that keeps going with
 * the pane shut.
 *
 * The catalog, the download-and-import steps and the lock now live here, and
 * so does installPack: one install with its space check, its notices and the
 * map's browser check, shared by the Packs pane, the Get packs card that
 * features show when their pack is missing, and the translation list.
 * Install All runs without the per-pack notices.
 */

import { writable, get } from 'svelte/store';
import {
  importPackFromBytes,
  importArtImageShard,
  importAtlasGeometryShard,
  importAtlasPlaceIndex,
  atlasPackSupported,
} from '../adapters/pack-import';
import { packInstallFinished, removePack } from '../adapters/db-manager';
import { loadPackOnDemand, installArtImageShards, installAtlasParts } from './progressive-init';
import { USE_BUNDLED_PACKS, PACK_MANIFEST_URL } from '../config';
import {
  isTtsSupported,
  getSelectableVoices,
  voiceIsDownloadable,
  storedVoices,
  downloadVoice,
  voiceDownloadSizeMB,
  type TtsVoiceInfo,
} from '../adapters/tts';
import { showNotice, errorText } from '../stores/noticeStore';
import { markInstalled, markUpdated } from './packUpdates';

/**
 * The Restart every finished download offers, wherever it was started from:
 * most features read their packs once, at startup.
 */
const RESTART = { label: 'Restart', run: () => window.location.reload() };
import { askConfirm } from '../stores/confirmStore';

/** Dev builds read packs straight out of public/; production goes through the proxy. */
export const PACK_BASE_URL = USE_BUNDLED_PACKS ? '/packs/consolidated' : '/api/packs';

export interface CatalogPack {
  id: string;
  name: string;
  /** One-line summary that heads the info card. */
  description: string;
  /** The info card's body: author lists, licence terms, where it shows up. */
  info: string;
  /** Fallback size string for when the manifest cannot be fetched. */
  size: string;
  icon: string;
  url: string;
}

// Each pack carries two descriptions, and both open with the (i) button:
// `description` is the one-line summary that heads the info card, and `info`
// is the body under it -- author lists, licence terms, where the pack
// actually shows up in the app. The pill itself shows only the name, because
// on a phone that is all there is room to read.
export const PACK_CATALOG: CatalogPack[] = [
  {
    id: "translations",
    name: "English Translations",
    description: "KJV, WEB, BSB, LXX2012",
    info: "Four more English Bibles alongside the NET you already have: the King James Version (1611), World English Bible, Berean Standard Bible, and LXX2012 — an English rendering of the Greek Septuagint.\n\nSwitch between them from the translation picker in any reader window. All public domain or freely licensed.",
    size: "28.21 MB",
    icon: "📖",
    url: `${PACK_BASE_URL}/translations.sqlite`,
  },
  {
    id: "dictionary-en",
    name: "English Dictionary",
    description: "Modern + Webster 1913 definitions",
    info: "Two English dictionaries in one: a modern definition set, and Webster’s 1913 unabridged — which is what the KJV’s older vocabulary actually meant to the people reading it.\n\nTap any English word in the reader and choose Define. Public domain.",
    size: "48.67 MB",
    icon: "📖",
    url: `${PACK_BASE_URL}/dictionary-en.sqlite`,
  },
  {
    id: "commentaries",
    name: "Commentaries",
    description: "Henry, Clarke, Calvin, Spurgeon + 14 more",
    info: "Eighteen commentary sets working through the text a verse at a time: Matthew Henry, Adam Clarke, John Calvin, Charles Spurgeon, John Wesley, Albert Barnes, A.T. Robertson, Martin Luther, Thomas Aquinas (Catena Aurea), Jamieson-Fausset-Brown, E.W. Bullinger, John Lightfoot, Abbott, KingComments, Family Bible Notes, NET Bible Notes, Quotations & Allusions, and the Treasury of Scripture Knowledge.\n\nOpen the Commentary window, or tap a verse and choose Commentary, to read what each one said about where you are. Public domain or free for personal use, via the CrossWire Sword Project and Plano Bible Chapel.",
    size: "224.84 MB",
    icon: "💭",
    url: `${PACK_BASE_URL}/commentaries.sqlite`,
  },
  {
    id: "tsk-references",
    name: "TSK References",
    description: "43,000+ cross-references by keyword",
    info: "The Treasury of Scripture Knowledge: over 43,000 entries linking each verse to the other passages that echo it, organised by the specific word in the verse that triggers the link.\n\nCross-references show beside the verse you are reading and in the Cross-References window. Public domain (1830s).",
    size: "6.21 MB",
    icon: "🔗",
    url: `${PACK_BASE_URL}/tsk-references.sqlite`,
  },
  {
    id: "ancient-languages",
    name: "Ancient Languages",
    description: "Hebrew + Greek with morphology",
    info: "The Hebrew Old Testament and Greek New Testament in their original words, with every word tagged for grammar — tense, case, person and number.\n\nPowers the interlinear view and Greek read-aloud. Turn it on with the interlinear controls in the reader. Public domain.",
    size: "105.31 MB",
    icon: "📜",
    url: `${PACK_BASE_URL}/ancient-languages.sqlite`,
  },
  {
    id: "lexical",
    name: "Lexical Resources",
    description: "Strong’s + English dictionaries",
    info: "Strong’s Hebrew and Greek lexicons plus supporting English dictionaries — root meanings, definitions, and every place a given original word appears in scripture.\n\nTap a Greek or Hebrew word in the interlinear to see its Strong’s entry and full verse list. The largest reference pack at around 370 MB. Public domain.",
    size: "372.67 MB",
    icon: "📚",
    url: `${PACK_BASE_URL}/lexical.sqlite`,
  },
  {
    id: "study-tools",
    name: "Study Tools",
    description: "Biblical places, map layers, reading order",
    info: "Biblical and ancient place locations, historical map layers running from the Old Testament through the Roman era, and a chronological reading order that puts the books in the sequence the events happened.\n\nFeeds the Map window and the chronological plan under Reading Plans. Public domain; place data CC BY 4.0 (OpenBible.info).",
    size: "13.82 MB",
    icon: "🗺️",
    url: `${PACK_BASE_URL}/study-tools.sqlite`,
  },
  {
    id: "encyclotopical",
    name: "Encyclotopical",
    description: "Bible encyclopedia + Nave’s topical index",
    info: "Two classic references in one pack. The International Standard Bible Encyclopedia (ISBE, 1915) — 9,380 scholarly articles on people, places, customs, plants and doctrine. And Nave’s Topical Bible — 5,322 topics indexing over 100,000 verse references, so looking up “mercy” or “fasting” gives you every passage on it.\n\nBrowse either A–Z from the Encyclopedia and Topical windows, or tap a word in the reader and choose More Info. Public domain; place data CC BY 4.0 (OpenBible.info).",
    size: "77.52 MB",
    icon: "📕",
    url: `${PACK_BASE_URL}/encyclotopical.sqlite`,
  },
  {
    id: "atlas-map",
    name: "Historical Map",
    description: "Offline world map + 16 eras of the biblical world",
    info: "A drawn map of the world that works with no connection, and a timeline of sixteen eras over the top of it — from Abraham leaving Ur to the later Roman empire. Tap any place for the verses that name it, its encyclopedia article and a photograph.\n\nEvery place Scripture names is searchable, alongside 562,000 modern ones. Opens from the Map window, and from the Map tab on any place in the encyclopedia.\n\nNatural Earth (public domain); Barrington Atlas and OpenStreetMap (ODbL); Digital Atlas of the Roman Empire (CC BY-SA); OpenBible.info and GeoNames (CC BY 4.0).",
    size: "33.78 MB",
    icon: "🗺️",
    url: `${PACK_BASE_URL}/atlas-map.sqlite`,
  },
  {
    id: "biblical-art",
    name: "Biblical Art",
    description: "Public-domain paintings of Bible scenes",
    info: "Famous paintings by the old masters, matched to the passages they depict. The images ship inside the pack, so they display with no connection.\n\nA small art icon appears in the text wherever a painting exists — tap it to view full screen. Public domain — Wikimedia Commons.",
    size: "83.45 MB",
    icon: "🖼️",
    url: `${PACK_BASE_URL}/art.sqlite`,
  },
  {
    id: "devotionals",
    name: "Devotionals",
    description: "Morning and Evening, Faith's Checkbook, Daily Light",
    info: "Three classic daily devotionals, a reading for every morning and evening of the year. Charles Spurgeon's Morning and Evening, a short meditation on one verse twice a day. Spurgeon's Faith's Checkbook, a promise of God for each day. And Bagster's Daily Light on the Daily Path, morning and evening readings made entirely of Scripture.\n\nRead them from Reading Plan → Devotionals, or from the link under the Verse of the Day. Every reference opens the reader. Public domain.",
    size: "8.59 MB",
    icon: "📖",
    url: `${PACK_BASE_URL}/devotionals.sqlite`,
  },
  {
    id: "timeline",
    name: "Timeline",
    description: "The whole story on one strip, with kings and prophets",
    info: "About four hundred events from Creation to Revelation, in the eras they belong to: every king of Judah and Israel with the Bible's verdict on him, the prophets, the empires and the rulers Scripture names, the four hundred years between the Testaments, the lives of the patriarchs, and when each book was written. Tap anything to read it.\n\nOpens from the Timeline window. Dates are modern conservative (Exodus 1446 BC, Thiele for the kings). CC BY-SA 4.0 (Theographic Bible Metadata).",
    size: "0.31 MB",
    icon: "⏳",
    url: `${PACK_BASE_URL}/timeline.sqlite`,
  },
  {
    id: "people-biblical-v1",
    name: "Biblical Characters",
    description: "Every named person: family, dates, verses",
    info: "Every named person in scripture: what their name means, roughly when and where they lived, their family relationships, and every verse they appear in.\n\nTap a name in the reader and choose Bio. CC BY-SA 4.0 (Theographic); name meanings from Hitchcock’s (public domain).",
    size: "3.82 MB",
    icon: "👤",
    url: `${PACK_BASE_URL}/people.sqlite`,
  },
];

/**
 * What Install All installs, in the order it installs them: smallest first, so
 * a phone that gives out partway has already kept everything small. The two
 * big ones -- Commentaries (225 MB) and Lexical (373 MB) -- are the likeliest
 * to get the tab reclaimed under memory pressure, so they go last.
 */
export const INSTALL_ALL_ORDER: string[] = [
  'timeline',
  'people-biblical-v1',
  'devotionals',
  'tsk-references',
  'study-tools',
  'translations',
  'atlas-map',
  'dictionary-en',
  'encyclotopical',
  'biblical-art',
  'ancient-languages',
  'commentaries',
  'lexical',
];

// ── The lock ────────────────────────────────────────────────────────────────

/** True while anything is installing, removing or re-indexing. One at a time, app-wide. */
export const installBusy = writable(false);

/** The line shown in the Packs pane while that is happening. */
export const installMessage = writable('');

/**
 * Something new was installed this session. The reader, the encyclopedia
 * indexes, the place underlines and the people list all load once at startup,
 * so a new pack does nothing until the app restarts.
 */
export const restartNeeded = writable(false);

// ── Installing one catalog pack ─────────────────────────────────────────────

function stageLabel(stage: string): string {
  switch (stage) {
    case 'downloading': return 'Downloading';
    case 'validating': return 'Validating';
    case 'extracting': return 'Extracting';
    case 'caching': return 'Caching';
    case 'complete': return 'Complete';
    default: return 'Working';
  }
}

/**
 * Download and import one catalog pack, with its shards.
 *
 * No confirmations and no alerts: callers that want those ask first. Progress
 * goes to `onMessage`. Throws on failure. Does not take the lock -- the caller
 * holds it for as long as it needs, which for Install All is the whole run.
 */
export async function downloadAndImportPack(
  pack: CatalogPack,
  onMessage: (message: string) => void,
  /** An update: the old copy goes only after the new one has downloaded. */
  opts: { replaceAfterDownload?: boolean } = {},
): Promise<void> {
  // The map's geometry is compressed inside the pack and inflated on read,
  // which needs DecompressionStream. Checked here rather than mid-install:
  // downloading 34 MB and then failing to unpack it would leave a half-built
  // map that looks installed.
  if (pack.id === 'atlas-map' && !atlasPackSupported()) {
    throw new Error(`${pack.name} needs a newer browser than this one.`);
  }

  onMessage(`Preparing ${pack.name}...`);

  if (USE_BUNDLED_PACKS) {
    onMessage(`Loading ${pack.name} from local files...`);

    // Fetch from local bundle (already copied by Vite plugin in dev mode)
    const response = await fetch(pack.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();

    if (opts.replaceAfterDownload) await removePack(pack.id);
    onMessage(`Installing ${pack.name}...`);
    // No File wrapper: it would copy the whole pack into blob storage
    // just to be read straight back out again.
    await importPackFromBytes(new Uint8Array(buffer), `${pack.id}.sqlite`);

    if (pack.id === 'biblical-art') {
      // Bundled mode has no manifest to enumerate, so walk the numbered
      // shards until one is missing.
      for (let n = 1; ; n++) {
        const part = String(n).padStart(2, '0');
        const res = await fetch(`${PACK_BASE_URL}/art-images-${part}.sqlite`);
        if (!res.ok) break;
        onMessage(`Installing artwork (part ${n})…`);
        const shard = new Uint8Array(await res.arrayBuffer());
        await importArtImageShard(shard, { clearFirst: n === 1, label: `art-images-${part}` });
      }
    }

    if (pack.id === 'atlas-map') {
      // Same walk for the map's geometry shards, then its place index.
      for (let n = 1; ; n++) {
        const part = String(n).padStart(2, '0');
        const res = await fetch(`${PACK_BASE_URL}/atlas-map-${part}.sqlite`);
        if (!res.ok) break;
        onMessage(`Installing map layers (part ${n})…`);
        const shard = new Uint8Array(await res.arrayBuffer());
        await importAtlasGeometryShard(shard, { clearFirst: n === 1, label: `atlas-map-${part}` });
      }
      const placesRes = await fetch(`${PACK_BASE_URL}/atlas-places.sqlite`);
      if (placesRes.ok) {
        onMessage('Installing place search…');
        await importAtlasPlaceIndex(new Uint8Array(await placesRes.arrayBuffer()));
      }
    }
    return;
  }

  await loadPackOnDemand(pack.id, (progress) => {
    const label = stageLabel(progress.stage);
    if (progress.stage === 'downloading') {
      const loadedMB = (progress.loaded / (1024 * 1024)).toFixed(1);
      const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
      onMessage(`${label} ${pack.name} (${loadedMB} MB / ${totalMB} MB)...`);
    } else {
      onMessage(`${label} ${pack.name}...`);
    }
  }, opts);

  // art.sqlite carries only the scenes; the paintings arrive as small
  // shards so sql.js never holds the whole pack at once.
  if (pack.id === 'biblical-art') {
    await installArtImageShards(onMessage);
  }

  // atlas-map.sqlite carries the eras and the places; the drawn geometry
  // and the place search index arrive as separate files, for the same
  // reason the paintings do.
  if (pack.id === 'atlas-map') {
    await installAtlasParts(onMessage);
  }
}

// ── Install All ─────────────────────────────────────────────────────────────

export interface InstallAllState {
  running: boolean;
  /** 1-based position of the item installing now. */
  step: number;
  total: number;
  /** Name of the item installing now. */
  current: string;
  /** Names that failed this run. */
  failed: string[];
  /** The last run reached the end (with or without failures). */
  finished: boolean;
  /** The last run stopped early because the device ran out of storage. */
  outOfSpace: boolean;
}

const IDLE: InstallAllState = {
  running: false,
  step: 0,
  total: 0,
  current: '',
  failed: [],
  finished: false,
  outOfSpace: false,
};

export const installAllState = writable<InstallAllState>({ ...IDLE });

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/** Catalog packs Install All still has to do, in install order. */
export async function packsStillToInstall(): Promise<CatalogPack[]> {
  const remaining: CatalogPack[] = [];
  for (const id of INSTALL_ALL_ORDER) {
    const pack = PACK_CATALOG.find((p) => p.id === id);
    if (!pack) continue;
    if (!(await packInstallFinished(pack.id))) remaining.push(pack);
  }
  return remaining;
}

/**
 * Voices Install All still has to download: every downloadable built-in voice
 * this device can run (getSelectableVoices already hides the natural voices on
 * a device that cannot run them). Standard voices first -- they are small and
 * independent -- then the natural ones, the first of which pulls the shared
 * 310 MB engine.
 */
export async function voicesStillToInstall(): Promise<TtsVoiceInfo[]> {
  if (!isTtsSupported()) return [];
  try {
    const [voices, stored] = await Promise.all([getSelectableVoices(), storedVoices()]);
    const missing = voices.filter(
      (v) => !v.custom && voiceIsDownloadable(v) && !stored.includes(v.id),
    );
    return [
      ...missing.filter((v) => v.engine !== 'kokoro'),
      ...missing.filter((v) => v.engine === 'kokoro'),
    ];
  } catch (error) {
    console.warn('[InstallAll] Could not list voices:', error);
    return [];
  }
}

/**
 * Install every pack and every voice, one after another.
 *
 * Skips whatever already finished, so running it again after the phone
 * reclaimed the tab picks up where the last run stopped. A pack that fails is
 * noted and the run moves on -- a dropped connection on one pack should not
 * cost the rest -- except running out of storage, which stops the run, because
 * every later install would fail the same way.
 *
 * Returns false without doing anything if another install is already running.
 */
export async function installAll(): Promise<boolean> {
  if (get(installBusy)) return false;
  installBusy.set(true);
  installAllState.set({ ...IDLE, running: true });
  installMessage.set('Checking what is already installed…');

  const failed: string[] = [];
  let outOfSpace = false;

  try {
    const packs = await packsStillToInstall();
    const voices = await voicesStillToInstall();
    const total = packs.length + voices.length;
    let step = 0;

    for (const pack of packs) {
      step++;
      installAllState.update((s) => ({ ...s, step, total, current: pack.name }));
      try {
        await downloadAndImportPack(pack, (message) =>
          installMessage.set(`${step} of ${total} · ${message}`),
        );
        restartNeeded.set(true);
        window.dispatchEvent(new CustomEvent('packsUpdated'));
      } catch (error) {
        console.error(`[InstallAll] ${pack.name} failed:`, error);
        failed.push(pack.name);
        if (isQuotaError(error)) {
          outOfSpace = true;
          break;
        }
      }
    }

    if (!outOfSpace) {
      for (const voice of voices) {
        step++;
        installAllState.update((s) => ({ ...s, step, total, current: voice.label }));
        installMessage.set(`${step} of ${total} · Preparing ${voice.label}...`);
        try {
          await downloadVoice(voice.id, ({ loaded, total: bytes }) => {
            const loadedMB = (loaded / 1024 / 1024).toFixed(0);
            const totalMB = bytes > 0 ? (bytes / 1024 / 1024).toFixed(0) : '?';
            installMessage.set(
              `${step} of ${total} · Downloading ${voice.label} (${loadedMB} MB / ${totalMB} MB)…`,
            );
          });
        } catch (error) {
          console.error(`[InstallAll] ${voice.label} failed:`, error);
          failed.push(voice.label);
          if (isQuotaError(error)) {
            outOfSpace = true;
            break;
          }
        }
      }
    }
  } finally {
    installAllState.update((s) => ({
      ...s,
      running: false,
      current: '',
      failed,
      finished: true,
      outOfSpace,
    }));
    installMessage.set('');
    installBusy.set(false);
  }
  return true;
}

// ── Sizes ───────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export interface PackSizes {
  /** What to show for each catalog pack, its shards folded in. */
  label: Record<string, string>;
  /** Bytes per file in the manifest, shards listed on their own. */
  bytes: Record<string, number>;
}

const NO_SIZES: PackSizes = { label: {}, bytes: {} };
let sizesRequest: Promise<PackSizes> | null = null;

/**
 * Live pack sizes from the manifest. The catalog's `size` strings are only a
 * fallback for when it can't be fetched: they drift every time a pack is
 * rebuilt, and drifted badly enough that Study Tools once advertised 438.89 MB
 * while shipping 523.78 MB.
 *
 * Fetched once a session. A failed fetch isn't kept, so the next caller tries
 * again.
 */
export function loadPackSizes(): Promise<PackSizes> {
  if (!sizesRequest) {
    sizesRequest = fetchPackSizes().catch((error) => {
      console.warn('Could not read pack sizes from manifest:', error);
      sizesRequest = null;
      return NO_SIZES;
    });
  }
  return sizesRequest;
}

async function fetchPackSizes(): Promise<PackSizes> {
  const response = await fetch(PACK_MANIFEST_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const manifest = await response.json();
  const packs = Array.isArray(manifest) ? manifest : (manifest?.packs ?? []);
  const label: Record<string, string> = {};
  const bytes: Record<string, number> = {};
  for (const entry of packs) {
    if (!entry?.id) continue;
    const size = Number(entry.size);
    if (Number.isFinite(size) && size > 0) {
      label[entry.id] = formatBytes(size);
      bytes[entry.id] = size;
    }
  }
  // The art pack and the map are split into shards, so each shows as what it
  // downloads, not as its small first file.
  for (const id of ['biblical-art', 'atlas-map']) {
    const total = installBytesFor(id, bytes);
    if (total > 0) label[id] = formatBytes(total);
  }
  return { label, bytes };
}

/**
 * Bytes an install actually pulls down, shards included. 0 when the manifest
 * didn't say.
 *
 * art.sqlite holds only the scenes (60 KB) and the paintings arrive as
 * biblical-art-images-NN; atlas-map.sqlite is under 2 MB and its geometry
 * shards and place index are the other 32.
 */
export function installBytesFor(packId: string, bytes: Record<string, number>): number {
  let total = bytes[packId] ?? 0;
  if (packId === 'biblical-art') {
    for (const [id, size] of Object.entries(bytes)) {
      if (id.startsWith('biblical-art-images-')) total += size;
    }
  }
  if (packId === 'atlas-map') {
    for (const [id, size] of Object.entries(bytes)) {
      if (id !== 'atlas-map' && id.startsWith('atlas-map-')) total += size;
    }
  }
  return total;
}

/** The size to show for a catalog pack: the manifest's, or the catalog's fallback. */
export function packSizeLabel(pack: CatalogPack, sizes: PackSizes | null): string {
  return sizes?.label[pack.id] ?? pack.size;
}

// ── Space check ─────────────────────────────────────────────────────────────

/**
 * Rough pre-flight space check.
 *
 * Installing costs more than the download itself: the file is cached and then
 * expanded into object stores, so budget for roughly twice its size. Returns
 * false only when the user declines to continue after being warned -- the
 * estimate is advisory, and browsers under-report it often enough that a hard
 * block would be wrong.
 */
export async function hasRoomForBytes(name: string, needed: number): Promise<boolean> {
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

    return await askConfirm(
      `${name} needs about ${formatBytes(needed * 2)} to install, ` +
        `but only ${formatBytes(Math.max(available, 0))} looks available on this device.\n\n` +
        `The install may fail partway through. Continue anyway?`,
      { confirmLabel: 'Continue' },
    );
  } catch {
    return true;
  }
}

// ── Installing one pack, with everything around it ─────────────────────────

/** The catalog pack installPack is working on, so the row that started it can show progress. */
export const installingPackId = writable<string | null>(null);

/**
 * Install one catalog pack the way a person asks for it: the lock, the map's
 * browser check, the space check, then the download, then a notice either way.
 * Sets restartNeeded and fires packsUpdated when it finishes.
 *
 * `replaceExisting` removes the installed copy first, so a re-download really
 * downloads -- loadPackOnDemand skips the download when the installed version
 * matches the manifest, and pack versions stay unchanged when their data
 * updates. The caller asks before passing it.
 *
 * Returns true when the pack went in. False when another install holds the
 * lock, the user said no, or it failed (the notice has said why).
 */
export async function installPack(
  pack: CatalogPack,
  opts: { replaceExisting?: boolean } = {},
): Promise<boolean> {
  if (get(installBusy)) return false;

  // The map's geometry is compressed inside the pack and inflated on read,
  // which needs DecompressionStream. Checked before anything downloads.
  if (pack.id === 'atlas-map' && !atlasPackSupported()) {
    showNotice(
      `${pack.name} needs a newer browser than this one.\n` +
        'It works in Chrome 80 and later, Safari 16.4 and later, and Firefox 113 and later.',
      'error',
    );
    return false;
  }

  installBusy.set(true);
  installingPackId.set(pack.id);
  try {
    // Asked before anything is removed, so saying no leaves the old copy alone.
    const sizes = await loadPackSizes();
    if (!(await hasRoomForBytes(pack.name, installBytesFor(pack.id, sizes.bytes)))) return false;

    if (opts.replaceExisting) {
      installMessage.set(`Removing old ${pack.name}...`);
      await removePack(pack.id);
    }

    await downloadAndImportPack(pack, (message) => installMessage.set(message));

    restartNeeded.set(true);
    markInstalled(pack.id);
    showNotice(`${pack.name} installed`, 'success', { action: RESTART });
    window.dispatchEvent(new CustomEvent('packsUpdated'));
    return true;
  } catch (error) {
    console.error(`Error installing ${pack.name}:`, error);
    showNotice(
      isQuotaError(error)
        ? `Not enough storage to install ${pack.name}.\n` +
            'Free up space on your device, or remove a pack you are not using, then try again.'
        : `Couldn't install ${pack.name}: ${errorText(error)}`,
      'error',
    );
    return false;
  } finally {
    installingPackId.set(null);
    installMessage.set('');
    installBusy.set(false);
  }
}

/**
 * Replace an installed pack with the newer one on the release.
 *
 * Unlike a re-download, the old copy stays in place while the new one
 * downloads: the feature keeps working on what it has, and a download that
 * fails leaves it untouched. The old data is cleared only once the new file is
 * in hand and its checksum matches, then the new one is imported.
 *
 * Takes the same lock, space check and notices as installPack, so one install
 * or update runs at a time, app-wide.
 */
export async function updatePack(pack: CatalogPack): Promise<boolean> {
  if (get(installBusy)) return false;

  if (pack.id === 'atlas-map' && !atlasPackSupported()) {
    showNotice(
      `${pack.name} needs a newer browser than this one.\n` +
        'It works in Chrome 80 and later, Safari 16.4 and later, and Firefox 113 and later.',
      'error',
    );
    return false;
  }

  installBusy.set(true);
  installingPackId.set(pack.id);
  try {
    const sizes = await loadPackSizes();
    if (!(await hasRoomForBytes(pack.name, installBytesFor(pack.id, sizes.bytes)))) return false;

    await downloadAndImportPack(pack, (message) => installMessage.set(message), { replaceAfterDownload: true });

    restartNeeded.set(true);
    markUpdated(pack.id);
    showNotice(`${pack.name} updated`, 'success', { action: RESTART });
    window.dispatchEvent(new CustomEvent('packsUpdated'));
    return true;
  } catch (error) {
    console.error(`Error updating ${pack.name}:`, error);
    showNotice(
      isQuotaError(error)
        ? `Not enough storage to update ${pack.name}.\n` +
            'Free up space on your device, or remove a pack you are not using, then try again.'
        : `Couldn't update ${pack.name}: ${errorText(error)}`,
      'error',
    );
    return false;
  } finally {
    installingPackId.set(null);
    installMessage.set('');
    installBusy.set(false);
  }
}

// ── Install All, as a person asks for it ────────────────────────────────────

/**
 * What Install All would still do, and roughly what it would download. The
 * natural voices all share one 310 MB engine, and each of their own sizes
 * includes it while it is missing, so the engine is counted once rather than
 * once per voice.
 */
export async function estimateRemaining(): Promise<{ count: number; bytes: number }> {
  const [packs, voices, sizes] = await Promise.all([
    packsStillToInstall(),
    voicesStillToInstall(),
    loadPackSizes(),
  ]);
  const MB = 1024 * 1024;
  let bytes = packs.reduce(
    (sum, pack) => sum + (installBytesFor(pack.id, sizes.bytes) || parseFloat(pack.size) * MB || 0),
    0,
  );
  const voiceMB = await Promise.all(
    voices.map((v) => voiceDownloadSizeMB(v).catch(() => v.approxSizeMB)),
  );
  const standard = voices.map((v, i) => ({ v, mb: voiceMB[i] })).filter(({ v }) => v.engine !== 'kokoro');
  const natural = voices.map((v, i) => ({ v, mb: voiceMB[i] })).filter(({ v }) => v.engine === 'kokoro');
  bytes += standard.reduce((sum, { mb }) => sum + mb * MB, 0);
  if (natural.length > 0) {
    const largest = Math.max(...natural.map(({ mb }) => mb));
    bytes += (largest + (natural.length - 1)) * MB;
  }
  return { count: packs.length + voices.length, bytes };
}

/**
 * Install All with its space warning first. Returns false without starting
 * when another install is running or the user declined the warning.
 */
export async function installEverything(): Promise<boolean> {
  if (get(installBusy)) return false;
  const { bytes } = await estimateRemaining();
  if (!(await hasRoomForBytes('Everything left to install', bytes))) return false;
  return installAll();
}
