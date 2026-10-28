/**
 * The audio library: recordings made in Notes, and audio files brought in,
 * kept on this device only.
 *
 * A recording is saved in 2-second pieces as it goes (recorder.ts), so a
 * crash or a closed app loses only the last couple of seconds. Each piece is
 * its own row; the file is the pieces joined in order. A recording still
 * marked as running when the app starts again was cut off by the app
 * closing, and is finished there and then.
 *
 * Its own database, apart from the app's, so recordings never wait on a pack
 * install's upgrade and can be cleared without touching anything else.
 */

import { writable } from 'svelte/store';

export type RecordQuality = 'speech' | 'music';

/** A stretch where the mic gave dead silence, in seconds of the recording. */
export interface RecordingGap {
  from: number;
  to: number;
  /** The app was off the screen through it: the screen locked. */
  screenOff: boolean;
}

/** Where transcribing has got to (transcribe.ts). */
export interface TranscriptProgress {
  state: 'running' | 'paused' | 'done' | 'failed';
  /** Seconds of the recording already turned into text. */
  doneSec: number;
  /** Pieces added to the page so far. */
  pieces: number;
  /** Seconds of the last speech added, for the pause before the next one. */
  lastEnd: number;
  error?: string;
}

export interface Recording {
  id: string;
  name: string;
  mime: string;
  createdAt: number;
  /** Seconds of audio, pauses left out. */
  durationSec: number;
  bytes: number;
  pieces: number;
  quality: RecordQuality;
  /** 'recording' while the mic is on. */
  state: 'recording' | 'done';
  /** The app closed before Stop: the last couple of seconds may be missing. */
  interrupted?: boolean;
  /** Brought in from a file rather than recorded here. */
  imported?: boolean;
  gaps: RecordingGap[];
  /** The notebook page its words go into. */
  page?: { notebookId: string; pageId: string } | null;
  transcript?: TranscriptProgress | null;
}

// ── The database ────────────────────────────────────────────────────────────

const DB_NAME = 'irisbible-recordings';
let dbReady: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbReady) {
    dbReady = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('recs', { keyPath: 'id' });
        r.result.createObjectStore('chunks', { keyPath: ['rec', 'seq'] });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => {
        dbReady = null;
        reject(r.error);
      };
    });
  }
  return dbReady;
}

async function idb<T>(store: 'recs' | 'chunks', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

// ── The list ────────────────────────────────────────────────────────────────

/** Every recording on this device, newest first. Filled by refreshRecordings. */
export const recordings = writable<Recording[]>([]);

/** The one the mic is on now, set by the recorder, so it isn't taken for a cut-off one. */
let liveId: string | null = null;
export function markLive(id: string | null): void {
  liveId = id;
}

let checkedCutOff = false;

export async function refreshRecordings(): Promise<Recording[]> {
  let all = await idb<Recording[]>('recs', 'readonly', (s) => s.getAll()).catch(() => [] as Recording[]);
  // Still running from before the app closed: finished as it stands. Only
  // once a session, so a recording started since is never caught by it.
  if (!checkedCutOff) {
    checkedCutOff = true;
    for (const r of all) {
      if (r.state === 'recording' && r.id !== liveId) {
        r.state = 'done';
        r.interrupted = true;
        await putRecording(r, false);
      }
      // A transcript running when the app closed waits to be picked up again.
      if (r.transcript?.state === 'running') {
        r.transcript.state = 'paused';
        await putRecording(r, false);
      }
    }
  }
  all = all.sort((a, b) => b.createdAt - a.createdAt);
  recordings.set(all);
  return all;
}

export async function getRecording(id: string): Promise<Recording | null> {
  return (await idb<Recording | undefined>('recs', 'readonly', (s) => s.get(id))) ?? null;
}

/** Save a recording's details. `refresh` false skips redrawing the list (a save every few seconds while recording). */
export async function putRecording(rec: Recording, refresh = true): Promise<void> {
  await idb('recs', 'readwrite', (s) => s.put(rec));
  if (refresh) await refreshRecordings();
  else recordings.update((list) => list.map((r) => (r.id === rec.id ? { ...rec } : r)));
}

/** Change some of a recording's details, reading the latest first. */
export async function updateRecording(id: string, patch: Partial<Recording>, refresh = true): Promise<Recording | null> {
  const rec = await getRecording(id);
  if (!rec) return null;
  const next = { ...rec, ...patch };
  await putRecording(next, refresh);
  return next;
}

export async function addChunk(id: string, seq: number, blob: Blob): Promise<void> {
  await idb('chunks', 'readwrite', (s) => s.put({ rec: id, seq, blob }));
}

/** The whole recording as one file. */
export async function recordingBlob(rec: Recording): Promise<Blob> {
  const rows = await idb<Array<{ blob: Blob }>>('chunks', 'readonly', (s) => s.getAll(chunkRange(rec.id)));
  return new Blob(rows.map((r) => r.blob), { type: rec.mime });
}

export async function renameRecording(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (clean) await updateRecording(id, { name: clean });
}

export async function deleteRecording(id: string): Promise<void> {
  await idb('chunks', 'readwrite', (s) => s.delete(chunkRange(id)));
  await idb('recs', 'readwrite', (s) => s.delete(id));
  await refreshRecordings();
}

/** "Oct 28, 2026, 7:42 PM": what a new recording is called. */
export function defaultRecordingName(at = new Date()): string {
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function newRecordingId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Files in and out ────────────────────────────────────────────────────────

function extensionFor(mime: string): string {
  if (/ogg/.test(mime)) return 'ogg';
  if (/mp4|m4a|aac/.test(mime)) return 'm4a';
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  if (/wav/.test(mime)) return 'wav';
  return 'webm';
}

/** Hand the recording to the browser to save as a file. */
export async function saveRecordingFile(rec: Recording): Promise<void> {
  const blob = await recordingBlob(rec);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${rec.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Recording'}.${extensionFor(rec.mime)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * How long a file plays, in seconds. A recording straight from the browser's
 * recorder has no length written in it, so the player is sent to the far end
 * first, which makes it work the length out.
 */
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let done = false;
    const finish = (sec: number) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(Number.isFinite(sec) && sec > 0 ? sec : 0);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) return finish(audio.duration);
      audio.ondurationchange = () => {
        if (Number.isFinite(audio.duration)) finish(audio.duration);
      };
      audio.currentTime = 1e101;
    };
    audio.onerror = () => finish(0);
    setTimeout(() => finish(audio.duration), 15_000);
    audio.src = url;
  });
}

/** An audio file from this device, kept as a recording. Null when it isn't audio the browser can play. */
export async function importRecording(file: File): Promise<Recording | null> {
  const durationSec = await probeDuration(file);
  if (!durationSec) return null;
  const rec: Recording = {
    id: newRecordingId(),
    name: file.name.replace(/\.[^.]+$/, '') || defaultRecordingName(),
    mime: file.type || 'audio/webm',
    createdAt: Date.now(),
    durationSec,
    bytes: file.size,
    pieces: 1,
    quality: 'speech',
    state: 'done',
    imported: true,
    gaps: [],
    page: null,
  };
  await addChunk(rec.id, 0, file);
  await putRecording(rec);
  return rec;
}

/** "2:13", or "1:02:13" past an hour. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "14.2 MB" */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
