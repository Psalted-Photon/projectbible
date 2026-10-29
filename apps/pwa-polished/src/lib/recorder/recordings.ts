/**
 * The audio library: recordings made in Notes and the journal, and audio
 * files brought in, kept on this device only.
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

/** The last thing a transcript wrote on its page, so the next piece can carry it on. */
export interface TranscriptTail {
  kind: 'p' | 'h' | 'li';
  text: string;
}

/**
 * Where transcribing has got to (lib/voice/transcribe.ts). 'waiting' is one
 * the app closed on, picked up again by itself; 'queued' is in line behind
 * another; 'paused' was stopped by hand.
 */
export interface TranscriptProgress {
  state: 'running' | 'waiting' | 'queued' | 'paused' | 'done' | 'failed';
  /** Seconds of the recording already turned into text. */
  doneSec: number;
  /** Pieces added to the page so far. */
  pieces: number;
  /** Scrambled, like the name, while the recording is (journalLock/recordingCrypto.ts). */
  tail: TranscriptTail | null;
  error?: string;
  /** Delete the recording, and its chip, once the words are safely in. */
  deleteAfter?: boolean;
  /** Waiting for the journal to be unlocked, not for the app to settle. */
  forUnlock?: boolean;
}

/** The journal day a recording's words go into. */
export interface JournalTarget {
  date: string;
  /** The account whose journal it is. */
  userId: string | null;
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
  /** Or the journal day. */
  journal?: JournalTarget | null;
  /**
   * The audio, name and transcript tail are scrambled with the journal key
   * (journalLock/recordingCrypto.ts): a journal recording while the lock is on.
   */
  scrambled?: boolean;
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

/** The list above has been read at least once, so a recording missing from it really isn't here. */
export const recordingsLoaded = writable(false);

/** The one the mic is on now, set by the recorder, so it isn't taken for a cut-off one. */
let liveId: string | null = null;
export function markLive(id: string | null): void {
  liveId = id;
}

/**
 * Recordings the recorder or a transcript is working on. The journal lock's
 * pass leaves them alone (journalLock/recordingCrypto.ts): their own saves
 * would undo its changes.
 */
const busy = new Set<string>();
export function markBusy(id: string, on: boolean): void {
  if (on) busy.add(id);
  else busy.delete(id);
}
export function isBusy(id: string): boolean {
  return busy.has(id) || id === liveId;
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
        r.transcript.state = 'waiting';
        await putRecording(r, false);
      }
    }
  }
  all = all.sort((a, b) => b.createdAt - a.createdAt);
  recordings.set(all);
  recordingsLoaded.set(true);
  return all;
}

/** Scrambled journal recordings are still on this device: the journal's key slots must stay. */
export async function hasScrambledRecordings(userId?: string | null): Promise<boolean> {
  const all = await idb<Recording[]>('recs', 'readonly', (s) => s.getAll()).catch(() => [] as Recording[]);
  return all.some((r) => r.scrambled && (!userId || !r.journal?.userId || r.journal.userId === userId));
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

/**
 * Change a recording's details: `change` gets the latest and returns what to
 * save, or null to leave it. Read and written in one go, so nothing saved in
 * between is lost. Null when it isn't there, or was left.
 */
export async function changeRecording(
  id: string,
  change: (rec: Recording) => Recording | null,
  refresh = true,
): Promise<Recording | null> {
  const d = await db();
  const next = await new Promise<Recording | null>((resolve, reject) => {
    const tx = d.transaction('recs', 'readwrite');
    const store = tx.objectStore('recs');
    let out: Recording | null = null;
    const req = store.get(id);
    req.onsuccess = () => {
      const rec = req.result as Recording | undefined;
      out = rec ? change(rec) : null;
      if (out) store.put(out);
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  if (next) {
    if (refresh) await refreshRecordings();
    else recordings.update((list) => list.map((r) => (r.id === id ? { ...next } : r)));
  }
  return next;
}

/** Change some of a recording's details, on the latest. */
export function updateRecording(id: string, patch: Partial<Recording>, refresh = true): Promise<Recording | null> {
  return changeRecording(id, (rec) => ({ ...rec, ...patch }), refresh);
}

export async function addChunk(id: string, seq: number, blob: Blob): Promise<void> {
  await idb('chunks', 'readwrite', (s) => s.put({ rec: id, seq, blob }));
}

/** The pieces as saved, in order. Scrambled ones are opened by journalLock/recordingCrypto.ts. */
export async function recordingChunks(id: string): Promise<Array<{ seq: number; blob: Blob }>> {
  const rows = await idb<Array<{ seq: number; blob: Blob }>>('chunks', 'readonly', (s) => s.getAll(chunkRange(id)));
  return rows.map((r) => ({ seq: r.seq, blob: r.blob }));
}

/**
 * Every piece swapped for its scrambled or opened copy, and the details
 * saved with them, in one go, so the recording is never left half and half.
 * `change` gets the latest details and returns them changed, or null when
 * they moved on in the meantime, which leaves everything as it was. False
 * then.
 */
export async function replaceRecordingChunks(
  id: string,
  chunks: Array<{ seq: number; blob: Blob }>,
  change: (rec: Recording) => Recording | null,
): Promise<boolean> {
  const d = await db();
  const done = await new Promise<boolean>((resolve, reject) => {
    const tx = d.transaction(['chunks', 'recs'], 'readwrite');
    const recs = tx.objectStore('recs');
    let ok = false;
    const req = recs.get(id);
    req.onsuccess = () => {
      const rec = req.result as Recording | undefined;
      const next = rec ? change(rec) : null;
      if (!next) return;
      const store = tx.objectStore('chunks');
      for (const c of chunks) store.put({ rec: id, seq: c.seq, blob: c.blob });
      recs.put(next);
      ok = true;
    };
    tx.oncomplete = () => resolve(ok);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  if (done) await refreshRecordings();
  return done;
}

/** The whole recording as one file, as saved. A scrambled one needs journalLock/recordingCrypto.ts's openRecordingBlob. */
export async function recordingBlob(rec: Recording): Promise<Blob> {
  const rows = await recordingChunks(rec.id);
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

/** Hand the recording to the browser to save as a file: `opened` is a scrambled one's audio and name, already opened. */
export async function saveRecordingFile(rec: Recording, opened?: { blob: Blob; name: string }): Promise<void> {
  const blob = opened?.blob ?? (await recordingBlob(rec));
  const name = opened?.name ?? rec.name;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Recording'}.${extensionFor(rec.mime)}`;
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
