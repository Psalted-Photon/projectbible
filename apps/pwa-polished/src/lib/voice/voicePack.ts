/**
 * Voice Control's downloads: the model files, kept on this device.
 *
 * Not sqlite packs, so nothing is imported. Each file is downloaded through the
 * same /api/packs proxy as the packs, checked against the SHA-256 the manifest
 * gives it, and written to its own folder in the browser's private file
 * storage, the way Read Aloud keeps its voices (lib/tts/ttsRuntime.ts). The
 * manifest lists every file under an id that says which download it belongs
 * to (voice-control-*, voice-transcribe-*); see scripts/generate-manifest.mjs.
 *
 * Two downloads: Voice Control itself (the engine, Whistle and Needle) and the
 * Transcribe add-on (punctuation and the voice detector) that recording notes
 * use. Each takes the app-wide install lock, so the screen stays awake and the
 * shared progress line shows it.
 *
 * A file the Voice Control lab already downloaded on this device is taken from
 * the lab's cache, after the same checksum, instead of downloading it again.
 */

import { get, writable } from 'svelte/store';
import { PACK_MANIFEST_URL } from '../../config';
import { PACK_BASE_URL, installBusy, installMessage, installPercent, formatBytes } from '../packInstaller';
import { showNotice, errorText } from '../../stores/noticeStore';

export type VoiceDownloadId = 'voice-control' | 'voice-transcribe';

export interface VoiceDownload {
  id: VoiceDownloadId;
  name: string;
  description: string;
}

export const VOICE_DOWNLOADS: VoiceDownload[] = [
  { id: 'voice-control', name: 'Voice Control', description: 'Hold-to-talk commands: Whistle hears, Needle chooses' },
  { id: 'voice-transcribe', name: 'Transcribe add-on', description: 'Punctuation and the voice detector, for transcribing recordings in Notes' },
];

/** One model file as the manifest lists it. */
export interface VoiceFile {
  id: string;
  file: string;
  size: number;
  sha256: string;
}

export interface VoiceDownloadState {
  /** Every file it needs is on the release (the manifest lists them). */
  available: boolean;
  /** Every file is on this device. */
  installed: boolean;
  /** Installed, but the release has a different version of at least one file. */
  update: boolean;
  /** What a download pulls down: everything, or only the changed files for an update. */
  bytes: number;
}

/** Fired on window whenever a download is added or removed. */
export const VOICE_DOWNLOADS_EVENT = 'voiceDownloadsUpdated';

/** The download in progress, so its row can show the progress line. */
export const voiceInstallingId = writable<VoiceDownloadId | null>(null);

// Where the Voice Control lab pinned each file, so its cached copy can be reused.
const HF = 'https://huggingface.co/';
const NEEDLE = HF + 'Cactus-Compute/needle3/resolve/d6c7d6a2e9655505e0f8e23339356dd1705900eb/';
const PUNCT = HF + 'brady-pplx/sherpa-onnx-online-punct-en-2024-08-06/resolve/29a49a07620ef067e6fa40580da620c11db07b83/';
const LAB_CACHE = 'voice-control-lab-v1';
/** Each download's files, so what is here can be judged with no manifest (offline). */
const FILES_OF: Record<VoiceDownloadId, string[]> = {
  'voice-control': ['voice-needle.js', 'voice-needle.wasm', 'voice-whistle.cact', 'voice-needle3.cact'],
  'voice-transcribe': ['voice-punct.int8.onnx', 'voice-punct.vocab', 'voice-vad.onnx'],
};
const LAB_URLS: Record<string, string> = {
  'voice-needle.js': NEEDLE + 'wasm/needle.js',
  'voice-needle.wasm': NEEDLE + 'wasm/needle.wasm',
  'voice-whistle.cact': HF + 'Cactus-Compute/whistle/resolve/741118687e1f008f06d1351a402a731274789790/whistle.cact',
  'voice-needle3.cact': NEEDLE + 'needle3.cact',
  'voice-punct.int8.onnx': PUNCT + 'model.int8.onnx',
  'voice-punct.vocab': PUNCT + 'bpe.vocab',
  'voice-vad.onnx': HF + 'onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx',
};

// ── The manifest ────────────────────────────────────────────────────────────

let manifestRequest: Promise<VoiceFile[]> | null = null;

/** Every voice file on the release. Fetched once a session; a failed fetch isn't kept. */
function releaseFiles(): Promise<VoiceFile[]> {
  if (!manifestRequest) {
    manifestRequest = (async () => {
      const response = await fetch(PACK_MANIFEST_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      const packs: any[] = Array.isArray(manifest) ? manifest : (manifest?.packs ?? []);
      return packs
        .filter((p) => typeof p?.id === 'string' && p.id.startsWith('voice-') && typeof p.downloadUrl === 'string')
        .map((p) => ({ id: p.id, file: p.downloadUrl.split('/').pop() as string, size: Number(p.size) || 0, sha256: String(p.sha256) }));
    })().catch((error) => {
      manifestRequest = null;
      throw error;
    });
  }
  return manifestRequest;
}

async function filesFor(id: VoiceDownloadId): Promise<VoiceFile[]> {
  return (await releaseFiles()).filter((f) => f.id.startsWith(id + '-'));
}

// ── This device's copies ────────────────────────────────────────────────────

const RECORD = 'installed.json';

async function folder(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('voice-control', { create: true });
}

/** Which version of each file is here: file name → SHA-256. */
async function readRecord(): Promise<Record<string, string>> {
  try {
    const file = await (await (await folder()).getFileHandle(RECORD)).getFile();
    return JSON.parse(await file.text()) || {};
  } catch {
    return {};
  }
}

async function writeFile(name: string, data: Blob | string): Promise<void> {
  const dir = await folder();
  const handle = await dir.getFileHandle(name, { create: true });
  try {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (err) {
    // An empty file left by a failed write must not look installed.
    await dir.removeEntry(name).catch(() => {});
    throw err;
  }
}

async function saveRecord(record: Record<string, string>): Promise<void> {
  await writeFile(RECORD, JSON.stringify(record));
}

/** A model file from this device, for the engine to load. Undefined when it isn't here. */
export async function voiceFile(name: string): Promise<File | undefined> {
  try {
    const file = await (await (await folder()).getFileHandle(name)).getFile();
    return file.size > 0 ? file : undefined;
  } catch {
    return undefined;
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every file of it is on this device, whatever version. Needs no manifest, so it answers offline. */
export async function voiceInstalledHere(id: VoiceDownloadId): Promise<boolean> {
  const record = await readRecord();
  const here = await Promise.all(FILES_OF[id].map(async (name) => !!record[name] && !!(await voiceFile(name))));
  return here.every(Boolean);
}

/** Is each file here, and is it the version the release has? */
export async function voiceDownloadState(id: VoiceDownloadId): Promise<VoiceDownloadState> {
  let files: VoiceFile[] = [];
  try {
    files = await filesFor(id);
  } catch {
    // No manifest (offline): judge by what is here.
    return { available: false, installed: await voiceInstalledHere(id), update: false, bytes: 0 };
  }
  const record = await readRecord();
  const here = await Promise.all(files.map(async (f) => !!record[f.file] && !!(await voiceFile(f.file))));
  const installed = files.length > 0 && here.every(Boolean);
  const stale = files.filter((f, i) => here[i] && record[f.file] !== f.sha256);
  const missing = files.filter((_, i) => !here[i]);
  return {
    available: files.length > 0,
    installed,
    update: installed && stale.length > 0,
    bytes: [...(installed ? stale : missing.concat(stale))].reduce((a, f) => a + f.size, 0),
  };
}

// ── Downloading ─────────────────────────────────────────────────────────────

/** The lab's copy of a file, when it is the version wanted. */
async function fromLabCache(f: VoiceFile): Promise<ArrayBuffer | null> {
  const url = LAB_URLS[f.file];
  if (!url || typeof caches === 'undefined') return null;
  try {
    const hit = await (await caches.open(LAB_CACHE)).match(url);
    if (!hit) return null;
    const bytes = await hit.arrayBuffer();
    return (await sha256(bytes)) === f.sha256 ? bytes : null;
  } catch {
    return null;
  }
}

async function download(f: VoiceFile, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  // ?v= pins the bytes, so the proxy's CDN can keep and serve them.
  const response = await fetch(`${PACK_BASE_URL}/${encodeURIComponent(f.file)}?v=${f.sha256}`);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes(got);
  }
  const bytes = await new Blob(parts as BlobPart[]).arrayBuffer();
  if ((await sha256(bytes)) !== f.sha256) throw new Error(`${f.file} did not match its checksum`);
  return bytes;
}

/** Where a download has got to: a line and, while bytes arrive, a percent. */
export type VoiceReport = (message: string, percent?: number | null) => void;

/** Thrown when the device hasn't room, so Install everything can stop there. */
export class VoiceOutOfSpace extends Error {}

/**
 * Fetch whatever of one download is missing or changed, and keep it. Doesn't
 * take the install lock: the caller holds it (installVoiceDownload, or
 * Install everything). Throws when it can't finish.
 */
export async function fetchVoiceDownload(id: VoiceDownloadId, report: VoiceReport): Promise<void> {
  const what = VOICE_DOWNLOADS.find((d) => d.id === id)!;
  voiceInstallingId.set(id);
  try {
    const files = await filesFor(id);
    if (!files.length) throw new Error(`${what.name} isn't on the download server yet`);
    const record = await readRecord();
    const todo: VoiceFile[] = [];
    for (const f of files) if (record[f.file] !== f.sha256 || !(await voiceFile(f.file))) todo.push(f);
    const total = todo.reduce((a, f) => a + f.size, 0);
    const percent = (n: number) => (total ? Math.min(100, Math.floor((n / total) * 100)) : null);

    const estimate = await navigator.storage?.estimate?.().catch(() => null);
    if (estimate?.quota && estimate.usage != null && estimate.quota - estimate.usage < total * 1.1) {
      throw new VoiceOutOfSpace(`Not enough space on this device: ${what.name} needs ${formatBytes(total)}`);
    }

    let before = 0;
    for (const f of todo) {
      report(`Downloading ${what.name}`, percent(before));
      const bytes = (await fromLabCache(f)) ?? (await download(f, (n) => report(`Downloading ${what.name}`, percent(before + n))));
      report(`Saving ${what.name}`, percent(before));
      await writeFile(f.file, new Blob([bytes]));
      record[f.file] = f.sha256;
      await saveRecord(record);
      before += f.size;
    }
  } finally {
    voiceInstallingId.set(null);
    window.dispatchEvent(new Event(VOICE_DOWNLOADS_EVENT));
  }
}

/**
 * Download one of the two, or update it: only files that are missing or
 * changed are fetched. Takes the install lock; returns false when something
 * else holds it or the download failed (a notice has said why).
 */
export async function installVoiceDownload(id: VoiceDownloadId): Promise<boolean> {
  if (get(installBusy)) {
    showNotice('Another download is running. Try again when it finishes.', 'error');
    return false;
  }
  const what = VOICE_DOWNLOADS.find((d) => d.id === id)!;
  installBusy.set(true);
  try {
    await fetchVoiceDownload(id, (message, percent = null) => {
      installMessage.set(message);
      installPercent.set(percent);
    });
    showNotice(`${what.name} is downloaded.`);
    return true;
  } catch (error) {
    showNotice(`${what.name} could not download: ${errorText(error)}`, 'error');
    return false;
  } finally {
    installMessage.set('');
    installPercent.set(null);
    installBusy.set(false);
  }
}

/** One download Install everything would get: missing, or a newer version of one that's here. */
export interface VoiceWaiting {
  id: VoiceDownloadId;
  name: string;
  bytes: number;
  update: boolean;
  /** Says which version is waiting, for the check-up's Not now. */
  key: string;
}

/**
 * What Install everything still has to get: Voice Control when it isn't here
 * or the release has a newer one, and the Transcribe add-on only to update it,
 * as recording notes downloads it on first use. Nothing when the release
 * can't be read.
 */
export async function voiceDownloadsWaiting(): Promise<VoiceWaiting[]> {
  const out: VoiceWaiting[] = [];
  for (const d of VOICE_DOWNLOADS) {
    const s = await voiceDownloadState(d.id).catch(() => null);
    if (!s?.available || (s.installed && !s.update) || (!s.installed && d.id !== 'voice-control')) continue;
    const files = await filesFor(d.id).catch(() => []);
    const key = files.map((f) => f.sha256.slice(0, 8)).join('');
    out.push({ id: d.id, name: d.name, bytes: s.bytes, update: s.installed, key });
  }
  return out;
}

/** Delete one of the two from this device. */
export async function removeVoiceDownload(id: VoiceDownloadId): Promise<void> {
  const record = await readRecord();
  // Offline, the list this app knows stands in for the release's.
  const names = await filesFor(id).then((files) => files.map((f) => f.file), () => FILES_OF[id]);
  const dir = await folder();
  for (const name of names) {
    await dir.removeEntry(name).catch(() => {});
    delete record[name];
  }
  await saveRecord(record);
  window.dispatchEvent(new Event(VOICE_DOWNLOADS_EVENT));
}
