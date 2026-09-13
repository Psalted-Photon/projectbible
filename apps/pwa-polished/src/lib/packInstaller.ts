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
 * The catalog, the download-and-import steps and the lock now live here. The
 * pane keeps its confirmations and alerts; Install All runs without them.
 */

import { writable, get } from 'svelte/store';
import {
  importPackFromBytes,
  importArtImageShard,
  importAtlasGeometryShard,
  importAtlasPlaceIndex,
  atlasPackSupported,
} from '../adapters/pack-import';
import { installAudioPackToOPFS } from '../adapters/audio';
import { packInstallFinished } from '../adapters/db-manager';
import { loadPackOnDemand, installArtImageShards, installAtlasParts } from './progressive-init';
import { USE_BUNDLED_PACKS } from '../config';
import {
  isTtsSupported,
  getSelectableVoices,
  voiceIsDownloadable,
  storedVoices,
  downloadVoice,
  type TtsVoiceInfo,
} from '../adapters/tts';

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
    id: "people-biblical-v1",
    name: "Biblical Characters",
    description: "Every named person: family, dates, verses",
    info: "Every named person in scripture: what their name means, roughly when and where they lived, their family relationships, and every verse they appear in.\n\nTap a name in the reader and choose Bio. CC BY-SA 4.0 (Theographic); name meanings from Hitchcock’s (public domain).",
    size: "3.82 MB",
    icon: "👤",
    url: `${PACK_BASE_URL}/people.sqlite`,
  },
  {
    id: "bsb-audio-pt1",
    name: "BSB Audio Part 1",
    description: "Genesis – Psalms",
    info: "The Berean Standard Bible read aloud from Genesis through Psalms — a human narrator, not a synthetic voice.\n\nPlay it with the audio button in any chapter. Around 1.8 GB, stored outside the main database, which is why it can be re-indexed without downloading again. Free to use — bereanbible.com.",
    size: "1.76 GB",
    icon: "🎵",
    url: `${PACK_BASE_URL}/bsb-audio-pt1.sqlite`,
  },
  {
    id: "bsb-audio-pt2",
    name: "BSB Audio Part 2",
    description: "Proverbs – Revelation",
    info: "The Berean Standard Bible read aloud from Proverbs through Revelation — a human narrator, not a synthetic voice.\n\nPlay it with the audio button in any chapter. Around 1.7 GB, stored outside the main database, which is why it can be re-indexed without downloading again. Free to use — bereanbible.com.",
    size: "1.65 GB",
    icon: "🎵",
    url: `${PACK_BASE_URL}/bsb-audio-pt2.sqlite`,
  },
];

export function isAudioPack(packId: string): boolean {
  return packId.startsWith('bsb-audio');
}

/**
 * What Install All installs, in the order it installs them: smallest first, so
 * a phone that gives out partway has already kept everything small. The two
 * big ones -- Commentaries (225 MB) and Lexical (373 MB) -- are the likeliest
 * to get the tab reclaimed under memory pressure, so they go last. BSB audio is
 * left out; Read Aloud has replaced it.
 */
export const INSTALL_ALL_ORDER: string[] = [
  'people-biblical-v1',
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
): Promise<void> {
  // The map's geometry is compressed inside the pack and inflated on read,
  // which needs DecompressionStream. Checked here rather than mid-install:
  // downloading 34 MB and then failing to unpack it would leave a half-built
  // map that looks installed.
  if (pack.id === 'atlas-map' && !atlasPackSupported()) {
    throw new Error(`${pack.name} needs a newer browser than this one.`);
  }

  onMessage(`Preparing ${pack.name}...`);

  // Audio packs (1+ GB) must be streamed directly to OPFS — never loaded into memory
  if (isAudioPack(pack.id)) {
    await installAudioPackToOPFS(pack.url, pack.id, (loaded, total) => {
      const loadedMB = (loaded / (1024 * 1024)).toFixed(0);
      const totalMB = total > 0 ? (total / (1024 * 1024)).toFixed(0) : '?';
      onMessage(`Downloading ${pack.name} (${loadedMB} MB / ${totalMB} MB)…`);
    });
    return;
  }

  if (USE_BUNDLED_PACKS) {
    onMessage(`Loading ${pack.name} from local files...`);

    // Fetch from local bundle (already copied by Vite plugin in dev mode)
    const response = await fetch(pack.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();

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
  });

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
 * Install every pack (except BSB audio) and every voice, one after another.
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
