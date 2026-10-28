/**
 * Transcribe: a recording's words into a notebook page, in the background
 * while the app is used. One recording at a time.
 *
 * The work is in transcribeWorker.ts. Each piece it finishes is added to the
 * page straight away (transcriptSink.ts), through the editor when the page is
 * open in Notes, so the words can be read as they come. Progress is saved
 * after each piece: closing the app stops it where it is, and opening the app
 * again carries on from there by itself, the way pack downloads do. The
 * screen stays awake while it runs.
 *
 * A recording started from a page goes into that page. One started from
 * Recordings gets a page of its own in Quick Notes, named after it.
 *
 * Needs Whistle (Voice Control's download) and the Transcribe add-on; the
 * first tap offers whichever is missing.
 */

import { get, writable } from 'svelte/store';
import { showNotice, errorText } from '../../stores/noticeStore';
import { userProfileStore } from '../../stores/userProfileStore';
import { syncedNotebookStore } from '../../adapters/SyncedNotebookStore';
import { stayAwake, allowSleep } from '../installAwake';
import { openNotesPage, NOTES_PAGE_WRITTEN, type NotesPageRef } from '../openNotesPage';
import {
  clock,
  getRecording,
  putRecording,
  recordingBlob,
  refreshRecordings,
  type Recording,
  type TranscriptProgress,
} from '../recorder/recordings';
import { voiceInstalledHere, type VoiceDownloadId } from './voicePack';
import { openTranscribeCard } from './holdToTalk';
import { appendBlocksToHtml, type TranscriptBlock, type TranscriptTail } from './transcriptSink';
import type { TranscriptPiece } from './transcribeWorker';

export interface TranscribeState {
  /** The recording being transcribed. */
  id: string | null;
  phase: 'idle' | 'loading' | 'running' | 'stopping';
  /** Seconds of the recording read so far. */
  readSec: number;
  totalSec: number;
  /** What loading is doing, the first time. */
  stage: string | null;
}

const IDLE: TranscribeState = { id: null, phase: 'idle', readSec: 0, totalSec: 0, stage: null };

export const transcribing = writable<TranscribeState>(IDLE);

const STAGES: Record<string, string> = {
  engine: 'Starting…',
  whistle: 'Loading Whistle…',
  punct: 'Loading punctuation…',
  vad: 'Loading the voice detector…',
};

/** The notebook a recording's page goes in when it wasn't started from one. Same name the Notes pane uses. */
const QUICK_NOTES = 'Quick Notes';

// ── The worker ──────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let nextId = 1;
interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  onProgress?: (p: { stage?: string; readSec?: number }) => void;
  onPiece?: (p: TranscriptPiece) => void;
}
const pending = new Map<number, Pending>();
let loaded: Promise<void> | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./transcribeWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, ok, result, error, progress, piece } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    if (piece) return entry.onPiece?.(piece);
    if (progress) return entry.onProgress?.(progress);
    pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error || 'Transcribe failed'));
  };
  worker.onerror = (event) => {
    for (const [id, entry] of pending) {
      entry.reject(new Error(`Transcribe stopped: ${event.message}`));
      pending.delete(id);
    }
    worker?.terminate();
    worker = null;
    loaded = null;
  };
  return worker;
}

function call<T>(action: string, payload: Record<string, unknown> = {}, handlers: Omit<Pending, 'resolve' | 'reject'> = {}, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, ...handlers });
    getWorker().postMessage({ id, action, payload }, transfer);
  });
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = call<void>('load', {}, { onProgress: (p) => p.stage && transcribing.update((s) => ({ ...s, stage: STAGES[p.stage!] ?? null })) })
      .catch((err) => {
        loaded = null;
        throw err;
      })
      .finally(() => transcribing.update((s) => ({ ...s, stage: null })));
  }
  return loaded;
}

// ── Writing on the page ─────────────────────────────────────────────────────

/** Adds blocks to an open page's editor. Undefined when the editor isn't ready yet. */
export type PageWriter = (blocks: TranscriptBlock[], tail: TranscriptTail | null) => TranscriptTail | null | undefined;

const writers = new Map<string, PageWriter>();

/** The Notes pane has this page open in its editor: pieces go through it. Returns the undo. */
export function registerPageWriter(pageId: string, write: PageWriter): () => void {
  writers.set(pageId, write);
  return () => {
    if (writers.get(pageId) === write) writers.delete(pageId);
  };
}

async function writeBlocks(page: NotesPageRef, blocks: TranscriptBlock[], tail: TranscriptTail | null): Promise<TranscriptTail | null> {
  if (!blocks.length) return tail;
  // The editor may still be loading: a moment to let it.
  for (let i = 0; i < 4; i++) {
    const w = writers.get(page.pageId);
    if (!w) break;
    const out = w(blocks, tail);
    if (out !== undefined) return out;
    await new Promise((r) => setTimeout(r, 250));
  }
  const saved = await syncedNotebookStore.getPage(page.pageId);
  if (!saved) throw new Error('The page it was going into has been deleted.');
  const next = appendBlocksToHtml(saved.text, blocks, tail);
  await syncedNotebookStore.updatePage(page.pageId, { text: next.html });
  window.dispatchEvent(new CustomEvent(NOTES_PAGE_WRITTEN, { detail: page.pageId }));
  return next.tail;
}

/** The page the words go into: the one it was recorded from, or a new one in Quick Notes. */
async function pageFor(rec: Recording): Promise<NotesPageRef> {
  if (rec.page && (await syncedNotebookStore.getPage(rec.page.pageId))) return rec.page;
  const books = await syncedNotebookStore.getNotebooks();
  const quick = books.find((n) => n.name === QUICK_NOTES) ?? (await syncedNotebookStore.createNotebook(QUICK_NOTES));
  const page = await syncedNotebookStore.createPage({ notebookId: quick.id, title: rec.name, text: '' });
  return { notebookId: quick.id, pageId: page.id };
}

// ── Decoding on the page ────────────────────────────────────────────────────

/** A file the worker can't read a little at a time: decoded whole here, at 16 kHz. */
async function decodeHere(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice();
  const out = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / audio.numberOfChannels;
  }
  return out;
}

// ── Transcribing ────────────────────────────────────────────────────────────

/** Which of Transcribe's downloads aren't on this device. */
async function missingDownloads(): Promise<VoiceDownloadId[]> {
  const ids: VoiceDownloadId[] = ['voice-control', 'voice-transcribe'];
  const here = await Promise.all(ids.map((id) => voiceInstalledHere(id).catch(() => false)));
  return ids.filter((_, i) => !here[i]);
}

let stopAsked = false;

/**
 * Transcribes a recording, or carries on with one stopped part way. `quiet`
 * leaves out the notices that it started, for picking one up at launch.
 */
export async function transcribeRecording(id: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const busy = get(transcribing);
  if (busy.phase !== 'idle') {
    if (busy.id !== id) showNotice('One at a time: another recording is being transcribed.', 'info');
    return;
  }
  const missing = await missingDownloads();
  if (missing.length) {
    if (!opts.quiet) openTranscribeCard(missing, () => void transcribeRecording(id));
    return;
  }
  await refreshRecordings();
  const rec = await getRecording(id);
  if (!rec || rec.state !== 'done') return;

  stopAsked = false;
  transcribing.set({ id, phase: 'loading', readSec: rec.transcript?.doneSec ?? 0, totalSec: rec.durationSec, stage: null });
  stayAwake('transcribe');
  let page: NotesPageRef | null = null;
  let progress: TranscriptProgress = rec.transcript && rec.transcript.state !== 'done'
    ? { ...rec.transcript, state: 'running', error: undefined }
    : { state: 'running', doneSec: 0, pieces: 0, tail: null };

  const save = (patch: Partial<Recording> = {}) => {
    Object.assign(rec, patch, { transcript: { ...progress } });
    return putRecording({ ...rec }, false);
  };

  try {
    page = await pageFor(rec);
    await save({ page });
    await load();
    if (stopAsked) throw new Stopped();
    transcribing.update((s) => ({ ...s, phase: 'running' }));
    if (!opts.quiet && progress.doneSec > 0) showNotice(`Carrying on with “${rec.name}” from ${clock(progress.doneSec)}.`, 'info');

    const blob = await recordingBlob(rec);
    // Pieces are written in order, each after the last.
    let writing = Promise.resolve();
    let writeFailed: Error | null = null;
    const onPiece = (piece: TranscriptPiece) => {
      writing = writing.then(async () => {
        if (writeFailed) return;
        try {
          progress.tail = await writeBlocks(page!, piece.blocks, progress.tail);
          progress.doneSec = piece.doneSec;
          if (piece.blocks.length) progress.pieces++;
          await save();
        } catch (err) {
          writeFailed = err instanceof Error ? err : new Error(String(err));
          void call('cancel');
        }
      });
    };
    const onProgress = (p: { readSec?: number }) => {
      if (p.readSec != null) transcribing.update((s) => ({ ...s, readSec: p.readSec! }));
    };

    let result = await call<{ cancelled: boolean; needsPcm?: boolean; doneSec: number }>(
      'transcribe',
      { blob, fromSec: progress.doneSec },
      { onPiece, onProgress },
    );
    if (result.needsPcm && !stopAsked) {
      const pcm = await decodeHere(blob);
      result = await call('transcribe', { pcm, fromSec: progress.doneSec }, { onPiece, onProgress }, [pcm.buffer]);
    }
    await writing;
    if (writeFailed) throw writeFailed;
    if (result.cancelled || stopAsked) throw new Stopped();

    progress.state = 'done';
    progress.doneSec = rec.durationSec;
    await save();
    const where = page;
    showNotice(
      progress.pieces ? `Transcribed “${rec.name}”.` : `No speech was found in “${rec.name}”.`,
      'success',
      progress.pieces ? { action: { label: 'Open', run: () => openNotesPage(where) } } : {},
    );
  } catch (err) {
    if (err instanceof Stopped) {
      progress.state = 'paused';
      await save().catch(() => {});
    } else {
      progress.state = 'failed';
      progress.error = errorText(err);
      await save().catch(() => {});
      showNotice(`Transcribing “${rec.name}” stopped: ${progress.error}`, 'error');
    }
  } finally {
    allowSleep('transcribe');
    transcribing.set(IDLE);
    void refreshRecordings();
  }
}

class Stopped extends Error {}

/** Stops the transcript where it is. Transcribe again carries on from there. */
export function stopTranscribing(): void {
  if (get(transcribing).phase === 'idle') return;
  stopAsked = true;
  transcribing.update((s) => ({ ...s, phase: 'stopping' }));
  if (worker) void call('cancel').catch(() => {});
}

/**
 * At launch: a transcript the app closed on carries on by itself, once the
 * app has settled. Signed out, it waits, as its page can't be written.
 */
export async function resumeWaitingTranscript(): Promise<void> {
  const all = await refreshRecordings();
  const waiting = all.find((r) => r.transcript?.state === 'waiting');
  if (!waiting || !get(userProfileStore).isSignedIn) return;
  if ((await missingDownloads()).length) return;
  showNotice(`Carrying on transcribing “${waiting.name}”.`, 'info');
  await transcribeRecording(waiting.id, { quiet: true });
}


/** "Saved …" after a recording stops, with Transcribe on it. */
export function noticeSaved(rec: Recording): void {
  showNotice(`Saved “${rec.name}” (${clock(rec.durationSec)}) to Recordings in Notes.`, 'success', {
    action: { label: 'Transcribe', run: () => void transcribeRecording(rec.id) },
  });
}
